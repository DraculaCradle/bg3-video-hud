#!/usr/bin/env python3
"""Transactional deployment on a dedicated ModsTest runner. No SSH or world writes."""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile

from deploy_linux import archive_payload, verify_tree

CONFIG = Path('/etc/bg3-modstest.json')
SERVICE = ['/usr/bin/sudo', '-n', '/usr/local/sbin/bg3-modstest-service']


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_json(path, value):
    fd, name = tempfile.mkstemp(prefix='.journal-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        sync_directory(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def swap(root, release):
    # Only this private directory is writable by the deployment account.
    # Foundry's fixed Data/modules/bg3-video-hud link points at root/current.
    temp = root / '.next'
    temp.unlink(missing_ok=True)
    if release is None:
        (root / 'current').unlink(missing_ok=True)
    else:
        if not re.fullmatch(r'[a-f0-9]{64}', release):
            raise ValueError('Invalid release identifier')
        temp.symlink_to('releases/' + release, target_is_directory=True)
        os.replace(temp, root / 'current')
    sync_directory(root)


def current_release(root):
    link = root / 'current'
    if not link.is_symlink():
        raise ValueError('An administrator must seed a known-good current release first')
    match = re.fullmatch(r'releases/([a-f0-9]{64})', os.readlink(link))
    if not match or not link.is_dir():
        raise ValueError('Current release must be an existing local release')
    return match[1]


@contextmanager
def lock(root):
    fd = os.open(root / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode) or os.fstat(fd).st_nlink != 1:
            raise ValueError('Unsafe lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(fd)


def service(action):
    subprocess.run([*SERVICE, action], check=True, timeout=120,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def recover_pending(root, control=service):
    """Caller holds the deployment lock. Keep recovery evidence on failure."""
    journal = root / 'pending.json'
    if not journal.exists():
        return False
    pending = json.loads(journal.read_text())
    old = pending['previous']
    if not re.fullmatch(r'[a-f0-9]{64}', old):
        raise ValueError('Invalid recovery release')
    backup_files = archive_payload(root / 'backups' / (old + '.zip'), old)
    verify_tree(root / 'releases' / old, backup_files)
    control('stop')
    swap(root, old)
    control('start')
    control('check')
    journal.unlink()
    sync_directory(root)
    return True


def transact(root, files, release, check, control=service):
    """Keep the lock through server restart, browser tests and rollback."""
    root = Path(root)
    if not root.is_dir() or root.is_symlink():
        raise ValueError('Invalid deployment root')
    root = root.resolve(strict=True)
    if not re.fullmatch(r'[a-f0-9]{64}', release):
        raise ValueError('Invalid release identifier')
    with lock(root):
        journal = root / 'pending.json'
        if recover_pending(root, control):
            # Recovery is its own operation; require a new run for new code.
            raise RuntimeError('Recovered interrupted deployment; rerun after checking test cleanup')
        previous = current_release(root)
        backups = root / 'backups'
        releases = root / 'releases'
        for directory in (backups, releases):
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError('Administrator must provision private releases and backups directories')
        # Store exact previous archive and verify both checksum and installed bytes.
        old_files = archive_payload(backups / (previous + '.zip'), previous)
        verify_tree(releases / previous, old_files)
        destination = releases / release
        if destination.is_symlink():
            raise ValueError('Linked release directory is forbidden')
        if not destination.exists():
            stage = Path(tempfile.mkdtemp(prefix='.stage-', dir=releases))
            for name, content in files.items():
                path = stage / name
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('wb') as stream:
                    stream.write(content)
                    stream.flush()
                    os.fsync(stream.fileno())
                path.chmod(0o644)
            for directory in sorted((p for p in stage.rglob('*') if p.is_dir()), reverse=True):
                directory.chmod(0o755)
                sync_directory(directory)
            stage.chmod(0o755)
            verify_tree(stage, files)
            sync_directory(stage)
            os.replace(stage, destination)
            sync_directory(releases)
        verify_tree(destination, files)
        # Snapshot is durable before any stop or pointer change. Archives/releases
        # are retained on success and failure; there is no automatic pruning.
        atomic_json(journal, {'previous': previous, 'candidate': release})
        try:
            control('stop')
            swap(root, release)
            control('start')
            control('check')
            check()
        except BaseException:
            # Preserve the journal on any rollback failure for next-run recovery.
            control('stop')
            verify_tree(releases / previous, old_files)
            swap(root, previous)
            control('start')
            control('check')
            journal.unlink()
            sync_directory(root)
            raise
        journal.unlink()
        sync_directory(root)


def configuration():
    if os.geteuid() == 0:
        raise ValueError('Run as the dedicated deployment account, never root')
    meta = CONFIG.lstat()
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o022:
        raise ValueError('Configuration must be root-owned and not group/world writable')
    config = json.loads(CONFIG.read_text())
    if config.get('world') != 'ModsTest' or config.get('dedicated_instance') is not True:
        raise ValueError('A dedicated ModsTest instance is required')
    root = Path(config['deploy_root'])
    if not root.is_absolute() or root.is_symlink():
        raise ValueError('Expected a fixed absolute deployment root')
    # No arbitrary data-dir, world, service, command or credential CLI arguments.
    return root


def retain_archive(root, release, data):
    if not re.fullmatch(r'[a-f0-9]{64}', release) or hashlib.sha256(data).hexdigest() != release:
        raise ValueError('Archive changed during validation')
    directory = root / 'backups'
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('Provision a real backups directory')
    fd, temporary = tempfile.mkstemp(prefix='.archive-', dir=directory)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        # Atomic publication also makes concurrent same-digest staging harmless.
        os.replace(temporary, directory / (release + '.zip'))
        sync_directory(directory)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--zip')
    source.add_argument('--recover-only', action='store_true')
    parser.add_argument('--sha256')
    args = parser.parse_args()
    root = configuration()
    if args.recover_only:
        with lock(root):
            recovered = recover_pending(root)
        print('Previous module restored' if recovered else 'No pending deployment')
        return
    if not args.sha256:
        parser.error('--zip requires --sha256')
    files = archive_payload(Path(args.zip), args.sha256)
    release = args.sha256.lower()
    source = Path(args.zip)
    # Candidate archive is also the next run's verified rollback archive.
    data = source.read_bytes()
    retain_archive(root, release, data)
    backup = root / 'backups' / (release + '.zip')
    expected_files = archive_payload(backup, release)
    if expected_files != files:
        raise ValueError('Archive changed during staging')
    def check():
        # Fixed command; no remotely supplied shell string. Secrets stay inherited.
        child = subprocess.Popen(['npm', '--prefix', 'e2e', 'test'], start_new_session=True)
        try:
            if child.wait(timeout=900) != 0:
                raise RuntimeError('Live acceptance failed')
        except BaseException:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait()
            raise
    transact(root, files, release, check)
    print('ModsTest module deployment and live acceptance passed')


if __name__ == '__main__':
    def interrupted(_signum, _frame):
        raise InterruptedError('Interrupted deployment')
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except BaseException:
        # Do not expose subprocess output, credentials, URLs or document data.
        print('ModsTest deployment failed; inspect sanitized report and pending journal locally.', file=sys.stderr)
        sys.exit(1)
