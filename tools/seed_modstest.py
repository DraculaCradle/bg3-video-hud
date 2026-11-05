#!/usr/bin/env python3
"""One-time seed of an administrator-verified module; run as bg3deploy."""
import argparse
import hashlib
from pathlib import Path

from deploy_modstest import configuration, lock, retain_archive, swap, sync_directory
from deploy_linux import archive_payload, verify_tree


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zip', required=True)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    root = configuration()
    files = archive_payload(Path(args.zip), args.sha256)
    data = Path(args.zip).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != args.sha256.lower():
        raise ValueError('Seed changed during validation')
    with lock(root):
        if (root / 'current').exists() or (root / 'current').is_symlink() or (root / 'pending.json').exists():
            raise ValueError('Seed only supports an uninitialized deployment root')
        retain_archive(root, digest, data)
        destination = root / 'releases' / digest
        destination.mkdir()
        for name, content in files.items():
            path = destination / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            path.chmod(0o644)
        for directory in [p for p in destination.rglob('*') if p.is_dir()] + [destination]:
            directory.chmod(0o755)
            sync_directory(directory)
        verify_tree(destination, files)
        swap(root, digest)
    print('Known-good module seeded; administrator must install fixed link and smoke-test before enabling CI')


if __name__ == '__main__':
    main()
