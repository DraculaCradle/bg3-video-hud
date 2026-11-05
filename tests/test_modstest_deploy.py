"""Real temporary filesystem transactions, failure injection; no live server."""
import copy
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
SPEC = importlib.util.spec_from_file_location('deploy_modstest', ROOT / 'tools/deploy_modstest.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)
SEED_SPEC = importlib.util.spec_from_file_location('seed_modstest', ROOT / 'tools/seed_modstest.py')
seed = importlib.util.module_from_spec(SEED_SPEC)
SEED_SPEC.loader.exec_module(seed)


class ModsTestDeployment(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'deploy'
        for name in ['releases', 'backups']:
            (self.root / name).mkdir(parents=True)
        self.world = self.base / 'Data/worlds/another-world/actors.db'
        self.world.parent.mkdir(parents=True)
        self.world.write_bytes(b'untouched player data')
        manifest = json.loads((ROOT / 'module.json').read_text())
        self.files = {'module.json': json.dumps(manifest).encode(),
                      'scripts/module.js': b'export const candidate = true;',
                      'styles/video-hud.css': b'.bg3-video-hud {}'}
        self.old_files = copy.deepcopy(self.files)
        self.old_files['scripts/module.js'] = b'export const candidate = false;'
        self.old = self.seed(self.old_files)
        self.new = self.seed(self.files, install=False)
        deploy.swap(self.root, self.old)
        self.events = []

    def seed(self, files, install=True):
        stream = io.BytesIO()
        with ZipFile(stream, 'w') as archive:
            for name, data in files.items():
                archive.writestr(name, data)
        data = stream.getvalue()
        digest = hashlib.sha256(data).hexdigest()
        deploy.retain_archive(self.root, digest, data)
        if install:
            for name, content in files.items():
                path = self.root / 'releases' / digest / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
        return digest

    def run_deploy(self, check=lambda: None, control=None):
        deploy.transact(self.root, self.files, self.new, check, control or self.events.append)

    def assert_old(self):
        self.assertEqual(deploy.current_release(self.root), self.old)
        deploy.verify_tree(self.root / 'current', self.old_files)
        self.assertEqual(self.world.read_bytes(), b'untouched player data')

    def test_success_publishes_atomic_pointer_and_retains_verified_backup(self):
        def check():
            self.assertEqual(deploy.current_release(self.root), self.new)
            self.assertTrue((self.root / 'pending.json').exists())
            self.events.append('test')
        self.run_deploy(check)
        self.assertEqual(self.events, ['stop', 'start', 'check', 'test'])
        self.assertEqual(deploy.current_release(self.root), self.new)
        self.assertFalse((self.root / 'pending.json').exists())
        deploy.verify_tree(self.root / 'releases' / self.old,
                           deploy.archive_payload(self.root / 'backups' / (self.old + '.zip'), self.old))
        self.assertEqual(self.world.read_bytes(), b'untouched player data')

    def test_browser_failure_rolls_back_and_returns_failure(self):
        def fail():
            raise RuntimeError('browser failed')
        with self.assertRaises(RuntimeError):
            self.run_deploy(fail)
        self.assertEqual(self.events, ['stop', 'start', 'check', 'stop', 'start', 'check'])
        self.assert_old()
        self.assertFalse((self.root / 'pending.json').exists())

    def test_health_failure_rolls_back(self):
        failed = False
        def control(action):
            nonlocal failed
            self.events.append(action)
            if action == 'check' and not failed:
                failed = True
                raise OSError('not healthy')
        with self.assertRaises(OSError):
            self.run_deploy(control=control)
        self.assert_old()

    def test_start_failure_rolls_back(self):
        failed = False
        def control(action):
            nonlocal failed
            self.events.append(action)
            if action == 'start' and not failed:
                failed = True
                raise OSError('cannot start candidate')
        with self.assertRaises(OSError):
            self.run_deploy(control=control)
        self.assert_old()

    def test_interruption_rolls_back(self):
        def fail():
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            self.run_deploy(fail)
        self.assert_old()

    def test_rollback_failure_preserves_journal_and_next_run_recovers_only(self):
        def control(action):
            if action == 'start':
                raise OSError('service unavailable')
        with self.assertRaises(OSError):
            self.run_deploy(control=control)
        self.assertTrue((self.root / 'pending.json').is_file())
        with self.assertRaisesRegex(RuntimeError, 'Recovered interrupted'):
            self.run_deploy(lambda: self.fail('must not run new tests during recovery'))
        self.assert_old()
        self.assertFalse((self.root / 'pending.json').exists())

    def test_corrupt_backup_aborts_before_stopping_service(self):
        (self.root / 'backups' / (self.old + '.zip')).write_bytes(b'corrupt')
        with self.assertRaises(ValueError):
            self.run_deploy()
        self.assertEqual(self.events, [])
        self.assert_old()

    def test_modified_old_install_aborts_before_stopping_service(self):
        (self.root / 'current/scripts/module.js').write_bytes(b'local edit')
        with self.assertRaises(OSError):
            self.run_deploy()
        self.assertEqual(self.events, [])

    def test_linked_release_is_rejected(self):
        (self.root / 'releases' / self.new).symlink_to(self.root / 'releases' / self.old)
        with self.assertRaises(ValueError):
            self.run_deploy()
        self.assert_old()

    def test_unseeded_instance_is_rejected(self):
        (self.root / 'current').unlink()
        with self.assertRaises(ValueError):
            self.run_deploy()
        self.assertEqual(self.events, [])

    def test_competing_transaction_is_rejected(self):
        with deploy.lock(self.root):
            with self.assertRaises(BlockingIOError):
                self.run_deploy()
        self.assert_old()

    def test_unsafe_release_identifier_is_rejected(self):
        with self.assertRaises(ValueError):
            deploy.transact(self.root, self.files, '../worlds', lambda: None, self.events.append)
        self.assertEqual(self.events, [])

    def test_archive_digest_mismatch_creates_no_backup(self):
        with self.assertRaises(ValueError):
            deploy.retain_archive(self.root, '0' * 64, b'invalid')
        self.assertFalse((self.root / 'backups' / ('0' * 64 + '.zip')).exists())

    def test_atomic_pointer_never_replaces_foundry_fixed_link(self):
        link = self.base / 'Data/modules/bg3-video-hud'
        link.parent.mkdir(parents=True)
        link.symlink_to(self.root / 'current')
        inode = link.lstat().st_ino
        self.run_deploy()
        self.assertEqual(link.lstat().st_ino, inode)
        deploy.verify_tree(link, self.files)

    def test_seed_creates_readable_release_and_exact_backup_without_world_writes(self):
        from unittest.mock import patch
        root = self.base / 'new-deploy'
        (root / 'releases').mkdir(parents=True)
        (root / 'backups').mkdir()
        archive = self.root / 'backups' / (self.new + '.zip')
        with patch.object(seed, 'configuration', return_value=root), patch.object(sys, 'argv',
                ['seed_modstest.py', '--zip', str(archive), '--sha256', self.new]):
            seed.main()
        deploy.verify_tree(root / 'current', self.files)
        self.assertEqual((root / 'current').stat().st_mode & 0o777, 0o755)
        self.assertEqual((root / 'backups' / (self.new + '.zip')).read_bytes(), archive.read_bytes())
        self.assertEqual(self.world.read_bytes(), b'untouched player data')

    def test_seed_refuses_existing_baseline(self):
        from unittest.mock import patch
        archive = self.root / 'backups' / (self.new + '.zip')
        with patch.object(seed, 'configuration', return_value=self.root), patch.object(sys, 'argv',
                ['seed_modstest.py', '--zip', str(archive), '--sha256', self.new]):
            with self.assertRaises(ValueError):
                seed.main()
        self.assert_old()


if __name__ == '__main__':
    unittest.main()
