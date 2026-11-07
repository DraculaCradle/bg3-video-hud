#!/usr/bin/env python3
"""Guarded hot update of one module in the EXISTING Foundry process."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

from deploy_linux import archive_payload
from modstest_filesystem import load_config

HELPER = ['/usr/bin/sudo', '-n', '/usr/local/libexec/bg3-video-hud-deploy/session']


class Blocked(Exception):
    def __init__(self, status, reason):
        self.status, self.reason = status, reason


class Peer:
    def __init__(self, command, environment=None):
        self.broken = False
        self.child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1, env=environment, start_new_session=True)

    def read(self, timeout=90):
        if not select.select([self.child.stdout], [], [], timeout)[0]:
            self.broken = True
            raise Blocked('failed', 'peer-timeout')
        line = self.child.stdout.readline()
        if not line:
            self.broken = True
            raise Blocked('failed', 'peer-disconnected')
        try:
            value = json.loads(line)
        except ValueError:
            self.broken = True
            raise Blocked('failed', 'invalid-peer-response') from None
        if not value.get('ok'):
            raise Blocked(value.get('status', 'failed'), value.get('reason', 'guard-failed'))
        return value['value']

    def call(self, operation, timeout=90, **fields):
        if self.broken:
            raise Blocked('failed', 'peer-session-invalid-after-timeout')
        self.child.stdin.write(json.dumps({'op': operation, **fields}) + '\n')
        self.child.stdin.flush()
        return self.read(timeout)

    def close(self):
        try:
            self.child.stdin.close()
        except OSError:
            pass
        try:
            self.child.wait(timeout=15)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(self.child.pid, signal.SIGTERM)
            except (PermissionError, ProcessLookupError):
                return  # Privileged helper exits on EOF; do not acquire more authority.
            try:
                self.child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait()


def run_transaction(guard, helper, archive, digest, recover_only=False):
    """Every file mutation requires a fresh world/session check, including recovery."""
    guard.call('check')
    state = helper.call('inspect')
    if state['pending']:
        guard.call('check')
        previous = helper.call('rollback')
        guard.call('assets', assets=previous['assets'])
        guard.call('cleanup')
        guard.call('check')
        helper.call('finish-rollback')
        return {'status': 'recovered', 'reason': 'previous-transaction-restored-rerun-to-deploy'}
    if recover_only:
        guard.call('cleanup')
        return {'status': 'no-pending-deployment', 'reason': 'nothing-to-recover'}
    # Ensure the server registered exactly the version on disk; never install a
    # new manifest into an already-running process and pretend it was discovered.
    live = guard.call('check')
    if live['moduleVersion'] != state['version'] or live['entrypoints'] != state['entrypoints'] or not live['moduleApi']:
        raise Blocked('maintenance-required', 'server-module-registration-needs-maintenance')
    guard.call('cleanup')
    guard.call('check')
    helper.call('prepare', archive=base64.b64encode(archive).decode(), sha256=digest)
    try:
        guard.call('check')
        candidate = helper.call('activate')
        guard.call('assets', assets=candidate['assets'])
        guard.call('test', timeout=900)
        guard.call('check')
        helper.call('commit')
        return {'status': 'passed', 'reason': 'module-updated-tests-passed-fixtures-restored'}
    except BaseException:
        try:
            # If the world changed, a socket disconnected, a non-test user joined
            # or cleanup failed, defer writes rather than running an unsafe rollback.
            guard.call('check')
            previous = helper.call('rollback')
            guard.call('assets', assets=previous['assets'])
            guard.call('cleanup')
            guard.call('check')
            helper.call('finish-rollback')
        except BaseException:
            return {'status': 'recovery-required', 'reason': 'guard-or-recovery-failed-journal-retained'}
        return {'status': 'rolled-back', 'reason': 'acceptance-failed-previous-module-restored'}


def report(outcome):
    destination = Path('e2e/results')
    destination.mkdir(parents=True, exist_ok=True)
    value = {**outcome, 'commit': os.environ.get('GITHUB_SHA'), 'restartAttempted': False,
             'worldSwitched': False, 'module': 'bg3-video-hud', 'executedAt': int(time.time())}
    (destination / 'deployment.json').write_text(json.dumps(value, indent=2) + '\n')
    print(f"ModsTest: {outcome['status']} ({outcome['reason']})")
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write(f"deployment_status={outcome['status']}\n")
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(f"ModsTest deployment: **{outcome['status']}** — {outcome['reason']}. No service restart or world switch.\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--zip')
    source.add_argument('--recover-only', action='store_true')
    parser.add_argument('--sha256')
    args = parser.parse_args()
    guard = helper = None
    try:
        if os.geteuid() == 0:
            raise Blocked('blocked', 'runner-must-not-be-root')
        config = load_config()
        if not config['enabled']:
            raise Blocked('skipped', 'administrator-has-not-enabled-deployment')
        if not config['other_worlds_disabled_reviewed']:
            raise Blocked('blocked', 'other-world-disablement-review-required')
        if (Path(config['test_state_dir']) / 'created-fixtures.json').exists():
            raise Blocked('blocked', 'temporary-fixtures-need-tests-only-recovery')
        archive = b''
        digest = ''
        if not args.recover_only:
            if not args.sha256:
                parser.error('--zip requires --sha256')
            archive_payload(Path(args.zip), args.sha256)
            archive = Path(args.zip).read_bytes()
            digest = hashlib.sha256(archive).hexdigest()
            if digest != args.sha256.lower():
                raise Blocked('blocked', 'archive-changed-during-validation')
        environment = {**os.environ, 'FOUNDRY_URL': config['url'],
            'FOUNDRY_WORLD_ID': config['world_id'], 'MODSTEST_STATE_DIR': config['test_state_dir'],
            'MODSTEST_LIVE_ENABLED': 'true', 'MODSTEST_CREATE_FIXTURES': 'false', 'MODSTEST_RECOVER_ONLY': 'false',
            'MODSTEST_SOURCE_PROBE': 'false', 'MODSTEST_CLIENT_PROBE': 'false', 'MODSTEST_ROUTE': 'public'}
        # Start only the client-side guard. No server command, service name, port
        # or dataPath is accepted here. The privileged peer starts after the gate.
        guard = Peer(['node', 'e2e/deployment-guard.mjs'], environment)
        guard.read()
        helper = Peer(HELPER)
        outcome = run_transaction(guard, helper, archive, digest, args.recover_only)
    except Blocked as error:
        outcome = {'status': error.status, 'reason': error.reason}
    except BaseException:
        outcome = {'status': 'recovery-required' if helper else 'failed',
                   'reason': 'configuration-or-transaction-failed-inspect-private-journal'}
    finally:
        for peer in [helper, guard]:
            if peer:
                peer.close()
    report(outcome)
    return 0 if outcome['status'] in ('passed', 'skipped', 'maintenance-required', 'recovered', 'no-pending-deployment') else 1


if __name__ == '__main__':
    def interrupted(_signum, _frame):
        raise InterruptedError('Interrupted')
    signal.signal(signal.SIGTERM, interrupted)
    sys.exit(main())
