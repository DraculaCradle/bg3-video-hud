"""Filesystem integration/failure-injection tests; never use a real Foundry directory."""
import argparse
from contextlib import redirect_stdout, redirect_stderr
import copy
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('deploy_linux', ROOT / 'tools' / 'deploy_linux.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bg3 deployment test ')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.data = self.base / 'user data'
        self.modules = self.data / 'Data' / 'modules'
        self.modules.mkdir(parents=True)
        self.target = self.modules / deploy.MODULE_ID
        self.backups = self.data / f'.{deploy.MODULE_ID}-backups'
        for name in ['bg3-hud-core', 'bg3-hud-dnd5e']:
            directory = self.modules / name
            directory.mkdir()
            (directory / 'module.json').write_text(json.dumps({'id': name, 'version': '0.8.0'}))
            (directory / 'player-config.txt').write_text('unchanged upstream')
        system = self.data / 'Data' / 'systems' / 'dnd5e'
        system.mkdir(parents=True)
        (system / 'system.json').write_text(json.dumps({'id': 'dnd5e', 'version': '6.0.6'}))
        world = self.data / 'Data' / 'worlds' / 'ModsTest'
        world.mkdir(parents=True)
        (world / 'actors.db').write_text('unchanged world')
        self.manifest = json.loads((ROOT / 'module.json').read_text())
        self.files = {
            'module.json': json.dumps(self.manifest).encode(),
            'scripts/module.js': b'import {value} from "./model.js"; export const result=value;',
            'scripts/model.js': b'export const value=1;',
            'styles/video-hud.css': b'.bg3-video-hud {color:white;}',
        }
        self.zip = self.base / 'module package.zip'
        self.write_zip(self.files)
        self.out = io.StringIO()
        self.capture_out = redirect_stdout(self.out)
        self.capture_err = redirect_stderr(self.out)
        self.capture_out.__enter__()
        self.capture_err.__enter__()
        self.addCleanup(self.capture_out.__exit__, None, None, None)
        self.addCleanup(self.capture_err.__exit__, None, None, None)

    def write_zip(self, files):
        with ZipFile(self.zip, 'w') as archive:
            for name, content in files.items():
                archive.writestr(name, content)

    def args(self, **kwargs):
        defaults = dict(data_dir=str(self.data), zip=str(self.zip), rollback=None, backup_dir=None,
                        owner=str(os.getuid()), sha256=None, server_stopped=True, dry_run=False)
        defaults.update(kwargs)
        return argparse.Namespace(**defaults)

    def seed_old(self):
        files = copy.deepcopy(self.files)
        manifest = copy.deepcopy(self.manifest)
        manifest['version'] = '0.0.9'
        files['module.json'] = json.dumps(manifest).encode()
        files['notes.txt'] = b'local file must survive in backup'
        for name, content in files.items():
            path = self.target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        return files

    def assert_neighbors_untouched(self):
        for name in ['bg3-hud-core', 'bg3-hud-dnd5e']:
            self.assertEqual((self.modules / name / 'player-config.txt').read_text(), 'unchanged upstream')
        self.assertEqual((self.data / 'Data/worlds/ModsTest/actors.db').read_text(), 'unchanged world')

    def test_first_install_sets_readable_modes_and_leaves_neighbors_untouched(self):
        deploy.deploy(self.args())
        self.assertEqual(deploy.tree_payload(self.target), self.files)
        self.assertEqual(stat.S_IMODE(self.target.stat().st_mode), 0o755)
        self.assertEqual(stat.S_IMODE((self.target / 'module.json').stat().st_mode), 0o644)
        self.assertEqual(self.target.stat().st_uid, os.getuid())
        self.assertFalse(self.backups.exists())
        self.assert_neighbors_untouched()

    def test_update_verifies_full_backup_and_preserves_ownership(self):
        previous = self.seed_old()
        deploy.deploy(self.args(owner=None))
        backup = next(self.backups.iterdir())
        self.assertEqual(deploy.tree_payload(backup / 'module'), previous)
        self.assertEqual(deploy.tree_payload(self.target), self.files)
        self.assertEqual(json.loads((backup / 'deployment.json').read_text())['previous_version'], '0.0.9')
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
        self.assertFalse(list(self.modules.glob('.*-stage-*')))
        self.assert_neighbors_untouched()

    def test_manual_rollback_backs_up_current_install_before_restoring(self):
        previous = self.seed_old()
        deploy.deploy(self.args())
        backup = next(self.backups.iterdir())
        deploy.deploy(self.args(zip=None, rollback=str(backup)))
        self.assertEqual(deploy.tree_payload(self.target), previous)
        self.assertEqual(len(list(self.backups.iterdir())), 2)
        self.assert_neighbors_untouched()

    def test_dry_run_creates_no_lock_stage_backup_or_target(self):
        before = sorted(p.name for p in self.modules.iterdir())
        deploy.deploy(self.args(dry_run=True))
        self.assertEqual(sorted(p.name for p in self.modules.iterdir()), before)
        self.assertFalse(self.backups.exists())
        self.assertIn('DRY RUN', self.out.getvalue())

    def test_cli_accepts_data_directory_environment_variable_and_spaces(self):
        result = subprocess.run([sys.executable, str(ROOT / 'tools/deploy_linux.py'), '--zip', str(self.zip),
                                 '--owner', str(os.getuid()), '--server-stopped', '--dry-run'],
                                env={**os.environ, 'FOUNDRY_DATA_DIR': str(self.data)}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(str(self.modules), result.stdout)

    def test_real_release_assets_checksums_and_frontend_deploy_together(self):
        result = subprocess.run([sys.executable, 'tools/package.py'], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = ROOT / 'dist'
        for line in (output / 'SHA256SUMS').read_text().splitlines():
            digest, name = line.split('  ', 1)
            self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), digest)
        self.assertEqual((output / 'deploy_linux.py').read_bytes(), (ROOT / 'tools/deploy_linux.py').read_bytes())
        payload = deploy.archive_payload(output / 'bg3-video-hud.zip')
        self.assertEqual(json.loads(payload['module.json']), json.loads((output / 'module.json').read_text()))
        deploy.deploy(self.args(zip=str(output / 'bg3-video-hud.zip')))
        for path in list((ROOT / 'scripts').glob('*.js')) + list((ROOT / 'styles').glob('*.css')):
            self.assertEqual((self.target / path.relative_to(ROOT)).read_bytes(), path.read_bytes())
        self.assert_neighbors_untouched()

    def test_wrong_path_and_running_server_acknowledgment_fail_before_mutation(self):
        for args in [self.args(data_dir=None), self.args(data_dir=str(self.base)), self.args(server_stopped=False)]:
            with self.subTest(args=args), self.assertRaises((ValueError, FileNotFoundError)):
                deploy.deploy(args)
        self.assertFalse(self.target.exists())
        self.assertFalse(self.backups.exists())

    def test_checksum_is_verified_before_any_write(self):
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            deploy.deploy(self.args(sha256='0' * 64))
        self.assertFalse(self.target.exists())
        digest = hashlib.sha256(self.zip.read_bytes()).hexdigest()
        deploy.deploy(self.args(sha256=digest))
        self.assertTrue(self.target.exists())

    def test_path_traversal_and_absolute_paths_are_rejected(self):
        for name in ['../escape', '/tmp/escape', 'scripts/../../escape', 'scripts\\escape', 'scripts//escape']:
            with self.subTest(name=name):
                self.write_zip({**self.files, name: b'bad'})
                with self.assertRaisesRegex(ValueError, 'Unsafe ZIP'):
                    deploy.deploy(self.args())
        self.assertFalse(self.target.exists())

    def test_symlink_and_duplicate_archive_entries_are_rejected(self):
        with ZipFile(self.zip, 'a') as archive:
            link = ZipInfo('scripts/link')
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(link, '/tmp/outside')
        with self.assertRaisesRegex(ValueError, 'Links'):
            deploy.archive_payload(self.zip)
        self.write_zip(self.files)
        with ZipFile(self.zip, 'a') as archive:
            with self.assertWarns(UserWarning):
                archive.writestr('module.json', self.files['module.json'])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            deploy.archive_payload(self.zip)

    def test_incomplete_frontend_or_wrong_manifest_does_not_replace_existing(self):
        previous = self.seed_old()
        cases = []
        for path in ['module.json', 'scripts/model.js', 'styles/video-hud.css']:
            case = self.files.copy()
            del case[path]
            cases.append(case)
        manifest = {**self.manifest, 'id': 'bg3-hud-core'}
        cases.append({**self.files, 'module.json': json.dumps(manifest).encode()})
        for case in cases:
            self.write_zip(case)
            with self.assertRaises(ValueError):
                deploy.deploy(self.args())
            self.assertEqual(deploy.tree_payload(self.target), previous)

    def test_missing_dependencies_and_wrong_system_version_block_install(self):
        dependency = self.modules / 'bg3-hud-core/module.json'
        dependency.write_text(json.dumps({'id': 'bg3-hud-core', 'version': '0.7.9'}))
        with self.assertRaisesRegex(ValueError, 'bg3-hud-core'):
            deploy.deploy(self.args())
        dependency.write_text(json.dumps({'id': 'bg3-hud-core', 'version': '0.8.0'}))
        (self.data / 'Data/systems/dnd5e/system.json').write_text(json.dumps({'id': 'dnd5e', 'version': '5.3.0'}))
        with self.assertRaisesRegex(ValueError, 'D&D5e'):
            deploy.deploy(self.args())
        self.assertFalse(self.target.exists())

    def test_directory_permission_failure_leaves_original_intact(self):
        previous = self.seed_old()
        original = os.access
        with patch.object(deploy.os, 'access', side_effect=lambda p, mode: False if p == self.modules else original(p, mode)):
            with self.assertRaises(PermissionError):
                deploy.deploy(self.args())
        self.assertEqual(deploy.tree_payload(self.target), previous)

    def test_ownership_validation_requires_explicit_root_owner_for_first_install(self):
        with patch.object(deploy.os, 'geteuid', return_value=0):
            with self.assertRaisesRegex(ValueError, '--owner'):
                deploy.ownership(None, self.target)

    def test_nested_backup_or_linked_target_is_rejected(self):
        previous = self.seed_old()
        with self.assertRaisesRegex(ValueError, 'outside'):
            deploy.deploy(self.args(backup_dir=str(self.target / 'backup')))
        self.assertEqual(deploy.tree_payload(self.target), previous)
        import shutil
        shutil.rmtree(self.target)
        other = self.base / 'elsewhere'
        other.mkdir()
        self.target.symlink_to(other, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'linked'):
            deploy.deploy(self.args())
        self.assertFalse(list(other.iterdir()))

    def test_backup_failure_never_replaces_existing_module(self):
        previous = self.seed_old()
        with patch.object(deploy.shutil, 'copytree', side_effect=OSError('Backup disk full')):
            with self.assertRaisesRegex(OSError, 'Backup disk full'):
                deploy.deploy(self.args())
        self.assertEqual(deploy.tree_payload(self.target), previous)

    def test_atomic_install_failure_restores_previous_module(self):
        previous = self.seed_old()
        replace = os.replace
        def fail_candidate(source, target):
            if Path(source).name == 'candidate':
                raise OSError('Injected rename failure')
            return replace(source, target)
        with patch.object(deploy.os, 'replace', side_effect=fail_candidate):
            with self.assertRaisesRegex(OSError, 'rename failure'):
                deploy.deploy(self.args())
        self.assertEqual(deploy.tree_payload(self.target), previous)
        self.assertIn('previous module restored', self.out.getvalue())

    def test_signal_after_old_directory_rename_rolls_back(self):
        previous = self.seed_old()
        replace = os.replace
        def interrupt_after_move(source, target):
            result = replace(source, target)
            if Path(target).name == 'previous':
                raise InterruptedError('Simulated TERM after rename')
            return result
        with patch.object(deploy.os, 'replace', side_effect=interrupt_after_move):
            with self.assertRaises(InterruptedError):
                deploy.deploy(self.args())
        self.assertEqual(deploy.tree_payload(self.target), previous)

    def test_post_install_verification_failure_restores_exact_old_bytes(self):
        previous = self.seed_old()
        verify = deploy.verify_tree
        def fail_installed(path, files):
            if path == self.target:
                raise OSError('Installed verification failed')
            return verify(path, files)
        with patch.object(deploy, 'verify_tree', side_effect=fail_installed):
            with self.assertRaisesRegex(OSError, 'verification failed'):
                deploy.deploy(self.args())
        self.assertEqual(deploy.tree_payload(self.target), previous)
        self.assert_neighbors_untouched()

    def test_failed_first_install_removes_new_module(self):
        verify = deploy.verify_tree
        with patch.object(deploy, 'verify_tree', side_effect=lambda p, f: (_ for _ in ()).throw(OSError('fail installed')) if p == self.target else verify(p, f)):
            with self.assertRaises(OSError):
                deploy.deploy(self.args())
        self.assertFalse(self.target.exists())

    def test_failed_rollback_retains_verified_backup_and_old_directory(self):
        previous = self.seed_old()
        verify, replace = deploy.verify_tree, os.replace
        def fail_installed(path, files):
            if path == self.target:
                raise OSError('Cannot verify new installation')
            return verify(path, files)
        def fail_restore(source, target):
            if Path(source).name == 'previous':
                raise OSError('Cannot restore old directory')
            return replace(source, target)
        with patch.object(deploy, 'verify_tree', side_effect=fail_installed), patch.object(deploy.os, 'replace', side_effect=fail_restore):
            with self.assertRaisesRegex(OSError, 'Cannot restore'):
                deploy.deploy(self.args())
        stage = next(self.modules.glob('.*-stage-*'))
        self.assertEqual(deploy.tree_payload(stage / 'previous'), previous)
        self.assertEqual(deploy.tree_payload(next(self.backups.iterdir()) / 'module'), previous)
        self.assertIn('ROLLBACK FAILED', self.out.getvalue())

    def test_concurrent_deployment_is_rejected(self):
        with deploy.deployment_lock(self.modules):
            with self.assertRaisesRegex(RuntimeError, 'Another deployment'):
                deploy.deploy(self.args())
        self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
