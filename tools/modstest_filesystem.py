#!/usr/bin/python3 -I
"""Root-installed fixed-target file transaction helper. Never controls Foundry."""
import base64
from contextlib import contextmanager
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import stat
import sys
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

if __name__ == '__main__':
    # Installed as a root-owned executable with a root-owned sibling dependency.
    # -I excludes caller PYTHONPATH and user site packages from privileged imports.
    directory = Path(__file__).resolve().parent
    for trusted in [directory, Path(__file__).resolve(), directory / 'deploy_linux.py']:
        metadata = trusted.lstat()
        if metadata.st_uid != 0 or metadata.st_mode & 0o022 or trusted.is_symlink():
            raise SystemExit('Untrusted helper installation')
    sys.path.insert(0, str(directory))

from deploy_linux import archive_payload, tree_payload, validate_payload, verify_tree

CONFIG = Path('/etc/bg3-modstest.json')
MAX_INPUT = 150 * 1024 * 1024


class MaintenanceRequired(Exception):
    pass


def load_config():
    meta = CONFIG.lstat()
    if not stat.S_ISREG(meta.st_mode) or meta.st_uid != 0 or meta.st_mode & 0o022:
        raise ValueError('Configuration must be root-owned and not writable by the runner')
    config = json.loads(CONFIG.read_text())
    if (config.get('schema') != 2 or config.get('mode') != 'existing-instance'
            or 'dedicated_instance' in config or 'service' in config):
        raise ValueError('Expected reviewed schema 2 existing-instance configuration')
    if not re.fullmatch(r'[A-Za-z0-9_-]+', config.get('world_id', '')):
        raise ValueError('Configure the exact existing ModsTest world id')
    if config.get('url') != 'https://redmagic.club/':
        raise ValueError('Expected the existing Foundry endpoint')
    target = Path(config['module_dir'])
    if (not target.is_absolute() or target.name != 'bg3-video-hud'
            or target.parent.name != 'modules' or target.parent.parent.name != 'Data'):
        raise ValueError('Expected the existing Data/modules/bg3-video-hud path')
    for key in ['module_dir', 'state_dir', 'test_state_dir']:
        path = Path(config[key])
        if not path.is_absolute() or path.is_symlink() or path.resolve() != path:
            raise ValueError('Fixed canonical paths without symlinks are required')
    data = target.parent.parent
    state = Path(config['state_dir'])
    if data == state or data in state.parents or state == target or state in target.parents:
        raise ValueError('Transaction state must be outside the existing Foundry Data directory')
    tests = Path(config['test_state_dir'])
    if data == tests or data in tests.parents or state == tests or state in tests.parents or tests in state.parents:
        raise ValueError('Runner fixture state must be separate from Data and privileged transaction state')
    if not isinstance(config.get('enabled'), bool) or not isinstance(config.get('other_worlds_disabled_reviewed'), bool):
        raise ValueError('Explicit administrator enablement and other-world review are required')
    return config


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(path, value):
    descriptor, temporary = tempfile.mkstemp(prefix='.journal-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_dir(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def fingerprint(files):
    return hashlib.sha256(json.dumps({name: hashlib.sha256(data).hexdigest()
        for name, data in sorted(files.items())}, sort_keys=True).encode()).hexdigest()


def read_tree(path):
    if path.is_symlink() or not path.is_dir():
        raise MaintenanceRequired('module-not-installed-or-linked')
    for item in path.rglob('*'):
        if item.is_file() and item.stat().st_nlink != 1:
            raise ValueError('Hard-linked module files are forbidden')
    return tree_payload(path)


def exchange(left, right):
    # A single Linux syscall swaps two real directories, without an absent-target
    # interval. There is deliberately no two-rename fallback on a live server.
    library = ctypes.CDLL(None, use_errno=True)
    rename = getattr(library, 'renameat2', None)
    if rename is None:
        raise MaintenanceRequired('atomic-exchange-unsupported')
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(left), -100, os.fsencode(right), 2):
        number = ctypes.get_errno()
        if number in (errno.ENOSYS, errno.EINVAL, errno.EXDEV, errno.EOPNOTSUPP):
            raise MaintenanceRequired('atomic-exchange-unsupported')
        raise OSError(number, 'Atomic module exchange failed')
    sync_dir(left.parent)
    sync_dir(right.parent)


@contextmanager
def deployment_lock(state):
    descriptor = os.open(state / '.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        meta = os.fstat(descriptor)
        if not stat.S_ISREG(meta.st_mode) or meta.st_nlink != 1:
            raise ValueError('Unsafe deployment lock')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


class Transaction:
    def __init__(self, config):
        if not config['enabled'] or not config['other_worlds_disabled_reviewed']:
            raise ValueError('Deployment not enabled or other-world review missing')
        self.target = Path(config['module_dir'])
        self.state = Path(config['state_dir'])
        self.journal = self.state / 'pending.json'
        if self.state.is_symlink() or not self.state.is_dir():
            raise ValueError('Provision a private transaction directory')
        metadata = self.state.stat()
        if os.geteuid() == 0 and (metadata.st_uid != 0 or metadata.st_mode & 0o077):
            raise ValueError('Privileged transaction state must be root-private')
        if self.target.parent.stat().st_dev != self.state.stat().st_dev:
            raise MaintenanceRequired('backup-and-module-filesystems-differ')

    def inspect(self):
        files = read_tree(self.target)
        manifest = validate_payload(files, legacy=True)
        return {'pending': self.journal.exists(), 'version': manifest['version'],
                'entrypoints': {key: manifest.get(key, []) for key in ['esmodules', 'styles']},
                'manifest_sha256': hashlib.sha256(files['module.json']).hexdigest(),
                'digest': fingerprint(files), 'assets': {name: hashlib.sha256(data).hexdigest()
                for name, data in files.items() if name.endswith(('.js', '.css'))}}

    def pending(self):
        value = json.loads(self.journal.read_text())
        if not re.fullmatch(r'[a-f0-9]{32}', value.get('transaction', '')):
            raise ValueError('Invalid journal transaction')
        for key in ['old', 'new', 'backup_sha256']:
            if not re.fullmatch(r'[a-f0-9]{64}', value.get(key, '')):
                raise ValueError('Invalid journal digest')
        if any(not isinstance(value.get(key), int) or value[key] < 1 for key in ['target_inode', 'candidate_inode']):
            raise ValueError('Missing directory identity in recovery journal')
        return value, self.state / value['transaction'] / 'candidate'

    def prepare(self, archive, digest):
        if self.journal.exists():
            raise ValueError('Recover the pending transaction before deployment')
        if not re.fullmatch(r'[a-f0-9]{64}', digest) or hashlib.sha256(archive).hexdigest() != digest:
            raise ValueError('Candidate archive digest mismatch')
        # archive_payload verifies CRC, paths, manifest, version, dependencies and imports.
        with tempfile.NamedTemporaryFile(dir=self.state, suffix='.zip') as stream:
            stream.write(archive)
            stream.flush()
            files = archive_payload(Path(stream.name), digest)
        old_files = read_tree(self.target)
        if files['module.json'] != old_files['module.json']:
            raise MaintenanceRequired('manifest-or-version-change-requires-maintenance')
        needed = sum(map(len, files.values())) + sum(map(len, old_files.values())) + len(archive)
        if shutil.disk_usage(self.state).free < needed + 1024 * 1024:
            raise OSError('Insufficient space for candidate and verified backup')
        previous = self.target.stat()
        directory = Path(tempfile.mkdtemp(dir=self.state))
        # Fixed-width, validated transaction identifiers make journal recovery path-safe.
        token = os.urandom(16).hex()
        destination = self.state / token
        os.replace(directory, destination)
        backup = destination / 'previous.zip'
        with ZipFile(backup, 'w', ZIP_DEFLATED) as bundle:
            for name, content in old_files.items():
                bundle.writestr(name, content)
        backup.chmod(0o600)
        with backup.open('rb') as stream:
            os.fsync(stream.fileno())
        backup_digest = hashlib.sha256(backup.read_bytes()).hexdigest()
        if archive_payload(backup, backup_digest, legacy=True) != old_files:
            raise OSError('Backup verification failed')
        candidate = destination / 'candidate'
        candidate.mkdir(mode=0o755)
        for name, content in files.items():
            path = candidate / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            path.chmod(0o644)
        for path in [*candidate.rglob('*'), candidate]:
            if path.is_dir():
                path.chmod(0o755)
                sync_dir(path)
            if os.geteuid() == 0:
                os.chown(path, previous.st_uid, previous.st_gid)
        verify_tree(candidate, files)
        # Probe renameat2 on private empty directories before touching the real module.
        a, b = destination / 'probe-a', destination / 'probe-b'
        a.mkdir(); b.mkdir()
        exchange(a, b)
        a.rmdir(); b.rmdir()
        sync_dir(destination)
        atomic_json(self.journal, {'transaction': token, 'phase': 'prepared',
            'old': fingerprint(old_files), 'new': fingerprint(files), 'backup_sha256': backup_digest,
            'target_inode': previous.st_ino, 'candidate_inode': candidate.stat().st_ino})
        return self.inspect()

    def activate(self):
        journal, candidate = self.pending()
        if (journal['phase'] != 'prepared' or fingerprint(read_tree(self.target)) != journal['old']
                or self.target.stat().st_ino != journal['target_inode']):
            raise ValueError('Target changed before activation')
        if fingerprint(read_tree(candidate)) != journal['new']:
            raise ValueError('Staged candidate changed')
        exchange(self.target, candidate)
        # If killed before the following write, recovery recognizes the two trees.
        if fingerprint(read_tree(self.target)) != journal['new']:
            raise OSError('Activation verification failed')
        journal['phase'] = 'active'
        atomic_json(self.journal, journal)
        return self.inspect()

    def rollback(self):
        journal, candidate = self.pending()
        backup = candidate.parent / 'previous.zip'
        previous = archive_payload(backup, journal['backup_sha256'], legacy=True)
        if fingerprint(previous) != journal['old']:
            raise ValueError('Backup does not match the journal')
        actual, staged = fingerprint(read_tree(self.target)), fingerprint(read_tree(candidate))
        actual_inode, staged_inode = self.target.stat().st_ino, candidate.stat().st_ino
        if (actual == journal['new'] and staged == journal['old']
                and actual_inode == journal['candidate_inode'] and staged_inode == journal['target_inode']):
            verify_tree(candidate, previous)
            exchange(self.target, candidate)
        elif not (actual == journal['old'] and staged == journal['new']
                  and actual_inode == journal['target_inode'] and staged_inode == journal['candidate_inode']):
            raise OSError('Unknown disk state; preserve evidence for maintenance')
        verify_tree(self.target, previous)
        journal['phase'] = 'restored'
        atomic_json(self.journal, journal)
        return self.inspect()

    def finish(self, rollback=False):
        journal, candidate = self.pending()
        expected = journal['old'] if rollback else journal['new']
        phase = 'restored' if rollback else 'active'
        inode = journal['target_inode'] if rollback else journal['candidate_inode']
        if journal['phase'] != phase or fingerprint(read_tree(self.target)) != expected or self.target.stat().st_ino != inode:
            raise ValueError('Transaction cannot be finalized')
        previous = archive_payload(candidate.parent / 'previous.zip', journal['backup_sha256'], legacy=True)
        if fingerprint(previous) != journal['old'] or (not rollback and fingerprint(read_tree(candidate)) != journal['old']):
            raise ValueError('Recovery backup changed before finalization')
        self.journal.unlink()
        sync_dir(self.state)
        return self.inspect()


def serve(config):
    transaction = Transaction(config)
    with deployment_lock(transaction.state):
        for _ in range(100):
            if not select.select([sys.stdin], [], [], 1200)[0]:
                return 1  # Leave the journal; never roll back without a fresh live guard.
            line = sys.stdin.readline(MAX_INPUT + 1)
            if not line:
                return 0
            try:
                if len(line) > MAX_INPUT:
                    raise ValueError('Request too large')
                request = json.loads(line)
                operation = request.get('op')
                if operation == 'inspect':
                    value = transaction.inspect()
                elif operation == 'prepare':
                    value = transaction.prepare(base64.b64decode(request['archive'], validate=True), request['sha256'])
                elif operation == 'activate':
                    value = transaction.activate()
                elif operation == 'rollback':
                    value = transaction.rollback()
                elif operation in ('commit', 'finish-rollback'):
                    value = transaction.finish(rollback=operation == 'finish-rollback')
                else:
                    raise ValueError('Unsupported operation')
                result = {'ok': True, 'value': value}
            except MaintenanceRequired as error:
                result = {'ok': False, 'status': 'maintenance-required', 'reason': str(error)}
            except Exception:
                result = {'ok': False, 'status': 'failed', 'reason': 'filesystem-check-failed'}
            print(json.dumps(result), flush=True)
    return 1


if __name__ == '__main__':
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1:
            raise ValueError('Only the installed fixed-target helper may be elevated')
        sys.exit(serve(load_config()))
    except Exception:
        print(json.dumps({'ok': False, 'status': 'failed', 'reason': 'helper-unavailable'}), flush=True)
        sys.exit(1)
