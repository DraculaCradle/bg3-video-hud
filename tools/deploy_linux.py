#!/usr/bin/env python3
"""Offline Linux installer for BG3 Video HUD; Python 3.9+, standard library only."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import pwd
import re
import shutil
import signal
import stat
import sys
import tempfile
from zipfile import ZipFile

MODULE_ID = 'bg3-video-hud'
MAX_BYTES = 100 * 1024 * 1024
MAX_FILES = 5000
IMPORT = re.compile(r'''(?:from\s*|import\s*(?:\(\s*)?)['"](\.[^'"]+)['"]''')


def read_json(path):
    with open(path, encoding='utf-8') as stream:
        return json.load(stream)


def validate_payload(files, *, legacy=False):
    """Validate the manifest and its complete local ES-module import graph."""
    try:
        manifest = json.loads(files['module.json'])
    except (KeyError, ValueError) as error:
        raise ValueError('Missing or invalid root module.json') from error
    if manifest.get('id') != MODULE_ID:
        raise ValueError('Refusing an archive for a different module id')
    version = manifest.get('version', '')
    if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('Invalid module version')
    if manifest.get('compatibility', {}).get('minimum') != '14':
        raise ValueError('Expected Foundry v14 compatibility')
    requires = manifest.get('relationships', {}).get('requires', [])
    legacy_bg3 = (isinstance(requires, list) and len(requires) == 2
                  and all(isinstance(r, dict) and r.get('type') == 'module' for r in requires)
                  and sorted(r.get('id', '') for r in requires) == ['bg3-hud-core', 'bg3-hud-dnd5e'])
    if requires != [] and not (legacy and legacy_bg3):
        raise ValueError('Standalone HUD must not declare required modules')
    systems = manifest.get('relationships', {}).get('systems', [])
    if not any(s.get('id') == 'dnd5e' and s.get('compatibility', {}).get('verified') == '6.0.6' for s in systems):
        raise ValueError('Expected D&D5e 6.0.6 target')
    if not manifest.get('esmodules') or not manifest.get('styles'):
        raise ValueError('The manifest must declare scripts and styles')
    queue = list(manifest['esmodules'])
    for path in manifest['styles'] + queue:
        if not isinstance(path, str) or path not in files:
            raise ValueError(f'Missing manifest asset: {path}')
    seen = set()
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        if path not in files:
            raise ValueError(f'Missing JavaScript dependency: {path}')
        for dependency in IMPORT.findall(files[path].decode('utf-8')):
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(path), dependency))
            if resolved.startswith('../') or resolved.startswith('/') or resolved not in files:
                raise ValueError(f'Missing or escaping JavaScript dependency: {path} -> {dependency}')
            queue.append(resolved)
    return manifest


def archive_payload(path, expected_sha256=None, *, legacy=False):
    if expected_sha256:
        if not re.fullmatch(r'[a-fA-F0-9]{64}', expected_sha256):
            raise ValueError('--sha256 must be exactly 64 hexadecimal characters')
        with open(path, 'rb') as stream:
            actual = hashlib.sha256()
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                actual.update(block)
        if actual.hexdigest() != expected_sha256.lower():
            raise ValueError('ZIP SHA-256 mismatch')
    files = {}
    with ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > MAX_FILES or sum(e.file_size for e in entries) > MAX_BYTES:
            raise ValueError('Archive exceeds the module size/file limit')
        seen = set()
        for entry in entries:
            name = entry.filename
            parts = PurePosixPath(name).parts
            if (not parts or name.startswith('/') or '\\' in name or any(p in ('', '.', '..') for p in name.rstrip('/').split('/'))
                    or any(ord(c) < 32 for c in name)):
                raise ValueError(f'Unsafe ZIP path: {name!r}')
            normalized = name.rstrip('/')
            if normalized in seen:
                raise ValueError(f'Duplicate ZIP path: {name}')
            seen.add(normalized)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 1:
                raise ValueError(f'Links, special files and encrypted entries are unsupported: {name}')
            if entry.is_dir():
                continue
            files[name] = archive.read(entry)  # ZipFile also verifies each CRC.
    validate_payload(files, legacy=legacy)
    return files


def tree_payload(root):
    files = {}
    for parent, directories, names in os.walk(root, followlinks=False):
        for name in directories + names:
            path = Path(parent) / name
            if path.is_symlink() or not (path.is_dir() or path.is_file()):
                raise ValueError(f'Module tree contains a link or special file: {path}')
        for name in names:
            path = Path(parent) / name
            if len(files) >= MAX_FILES or path.stat().st_size + sum(map(len, files.values())) > MAX_BYTES:
                raise ValueError('Module tree exceeds the module size/file limit')
            files[path.relative_to(root).as_posix()] = path.read_bytes()
    # Existing installations/backups may predate standalone mode. Recognize
    # only the known old pair; incoming release archives stay standalone-only.
    validate_payload(files, legacy=True)
    return files


def verify_tree(root, expected):
    if tree_payload(root) != expected:
        raise OSError('Installed files do not match the validated payload')


def check_access(path, mode, purpose):
    if not os.access(path, mode):
        raise PermissionError(f'{purpose}: insufficient permissions on {path}')


def check_system(data):
    # Module requirements are forbidden by validate_payload. The required
    # D&D5e system/version remains checked, independent of optional HUD modules.
    system = read_json(data / 'Data' / 'systems' / 'dnd5e' / 'system.json')
    if system.get('id') != 'dnd5e' or system.get('version') != '6.0.6':
        raise ValueError('Install D&D5e 6.0.6 before deploying this module')


def ownership(owner, target):
    if owner:
        username, separator, groupname = owner.partition(':')
        account = pwd.getpwuid(int(username)) if username.isdigit() else pwd.getpwnam(username)
        gid = account.pw_gid
        if separator:
            gid = int(groupname) if groupname.isdigit() else grp.getgrnam(groupname).gr_gid
        uid = account.pw_uid
    elif target.exists():
        metadata = target.stat()
        uid, gid = metadata.st_uid, metadata.st_gid
    elif os.geteuid() == 0:
        raise ValueError('A first installation as root requires --owner USER[:GROUP]')
    else:
        uid, gid = os.geteuid(), os.getegid()
    if os.geteuid() != 0 and (uid != os.geteuid() or gid not in {os.getegid(), *os.getgroups()}):
        raise PermissionError('Run as the target owner or an administrator to preserve module ownership')
    return uid, gid


@contextmanager
def deployment_lock(modules, owner=None):
    path = modules / f'.{MODULE_ID}.deploy.lock'
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise ValueError('Deployment lock must be a regular file without hard links')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('Another deployment holds this module lock') from error
        if owner and os.geteuid() == 0:
            os.fchown(descriptor, *owner)
        yield
    finally:
        os.close(descriptor)
    # Retain the lock inode: deleting it would let a third installer bypass a waiter.


def deploy(args):
    if not args.data_dir:
        raise ValueError('Provide --data-dir or FOUNDRY_DATA_DIR; no server path is assumed')
    data = Path(args.data_dir).expanduser().resolve(strict=True)
    modules = (data / 'Data' / 'modules').resolve(strict=True)
    if not modules.is_dir():
        raise ValueError('--data-dir must contain the existing Data/modules directory')
    check_access(modules, os.R_OK | os.W_OK | os.X_OK, 'Module directory')
    target = modules / MODULE_ID
    if target.is_symlink() or (target.exists() and not target.is_dir()):
        raise ValueError('Refusing a linked or non-directory deployment target')
    if not args.server_stopped:
        raise ValueError('Stop Foundry using your actual service/container manager, then pass --server-stopped')
    if args.sha256 and not args.zip:
        raise ValueError('--sha256 is only valid with --zip')
    if args.zip:
        files = archive_payload(Path(args.zip).expanduser().resolve(strict=True), args.sha256)
    else:
        backup = Path(args.rollback).expanduser().resolve(strict=True)
        if read_json(backup / 'deployment.json').get('module') != MODULE_ID:
            raise ValueError('This backup does not belong to BG3 Video HUD')
        if (backup / 'module').is_symlink():
            raise ValueError('Linked backup payload is unsupported')
        files = tree_payload(backup / 'module')
    manifest = validate_payload(files, legacy=bool(args.rollback))
    check_system(data)
    uid, gid = ownership(args.owner, target)
    backup_root = Path(args.backup_dir).expanduser().resolve() if args.backup_dir else data / f'.{MODULE_ID}-backups'
    if backup_root == target or target in backup_root.parents:
        raise ValueError('Backup directory must be outside the module being replaced')
    if backup_root.exists():
        if not backup_root.is_dir():
            raise ValueError('Backup parent must be a directory')
        check_access(backup_root, os.R_OK | os.W_OK | os.X_OK, 'Backup directory')
    else:
        ancestor = backup_root.parent
        while not ancestor.exists():
            ancestor = ancestor.parent
        check_access(ancestor, os.W_OK | os.X_OK, 'Backup directory parent')
    if args.dry_run:
        if target.exists():
            tree_payload(target)
        print(f'DRY RUN: validated {MODULE_ID} {manifest["version"]}; target={target}; backup={backup_root}; uid:gid={uid}:{gid}')
        return
    with deployment_lock(modules, (uid, gid)):
        # Recheck mutable state after obtaining the lock.
        if target.is_symlink():
            raise ValueError('Deployment target became a symlink')
        previous_files = tree_payload(target) if target.exists() else None
        needed = sum(map(len, files.values())) + sum(map(len, (previous_files or {}).values()))
        if shutil.disk_usage(modules).free < needed + 1024 * 1024:
            raise OSError('Insufficient free disk space for staging and rollback')
        stage = Path(tempfile.mkdtemp(prefix=f'.{MODULE_ID}-stage-', dir=modules))
        candidate, previous = stage / 'candidate', stage / 'previous'
        moved_old = installed_new = committed = candidate_created = False
        backup = None
        try:
            candidate.mkdir()
            candidate_created = True
            for name, content in files.items():
                path = candidate / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            for path in [*candidate.rglob('*'), candidate]:
                path.chmod(0o755 if path.is_dir() else 0o644)
                if (path.stat().st_uid, path.stat().st_gid) != (uid, gid):
                    os.chown(path, uid, gid)
            verify_tree(candidate, files)
            if previous_files is not None:
                backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
                backup = Path(tempfile.mkdtemp(prefix=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-'), dir=backup_root))
                shutil.copytree(target, backup / 'module')
                verify_tree(backup / 'module', previous_files)
                (backup / 'deployment.json').write_text(json.dumps({
                    'module': MODULE_ID, 'previous_version': validate_payload(previous_files, legacy=True)['version'],
                    'target': str(target), 'uid': target.stat().st_uid, 'gid': target.stat().st_gid,
                }, indent=2) + '\n', encoding='utf-8')
                print(f'Backup verified: {backup}', flush=True)
                os.replace(target, previous)
                moved_old = True
            os.replace(candidate, target)
            installed_new = True
            verify_tree(target, files)
            committed = True
            print(f'Installed {MODULE_ID} {manifest["version"]} at {target}')
        except BaseException:
            try:
                # Inspect rename results too, in case a signal arrived between
                # the atomic syscall and its following Python assignment.
                moved_old = moved_old or previous.exists()
                installed_new = installed_new or (candidate_created and not candidate.exists() and target.exists())
                if installed_new:
                    shutil.rmtree(target)
                if moved_old:
                    os.replace(previous, target)
                    print('Deployment failed; previous module restored.', file=sys.stderr)
                elif installed_new:
                    print('Deployment failed; incomplete first installation removed.', file=sys.stderr)
            except BaseException as rollback_error:
                print(f'ROLLBACK FAILED: {rollback_error}. Preserve {stage} and verified backup {backup} for recovery.', file=sys.stderr)
                raise
            raise
        finally:
            if committed or not previous.exists():
                shutil.rmtree(stage)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument('--data-dir', default=os.environ.get('FOUNDRY_DATA_DIR'), help='Foundry user data root containing Data/modules')
    source = result.add_mutually_exclusive_group(required=True)
    source.add_argument('--zip', help='Local release ZIP (module.json at archive root)')
    source.add_argument('--rollback', help='Verified backup directory containing deployment.json and module/')
    result.add_argument('--backup-dir', help='Backup parent; default: <data-dir>/.bg3-video-hud-backups')
    result.add_argument('--owner', help='File owner USER[:GROUP]; default preserves existing module ownership')
    result.add_argument('--sha256', help='Expected ZIP SHA-256 from trusted release checksums')
    result.add_argument('--server-stopped', action='store_true', help='Acknowledge Foundry has been stopped by its administrator')
    result.add_argument('--dry-run', action='store_true', help='Validate without creating locks, backups or module files')
    return result


def main():
    def interrupt(_signum, _frame):
        raise InterruptedError('Deployment interrupted')
    signal.signal(signal.SIGTERM, interrupt)
    try:
        deploy(parser().parse_args())
    except (Exception, KeyboardInterrupt) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
