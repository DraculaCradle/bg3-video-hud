"""Real Linux file exchange and guarded transaction failure tests; no live server."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import modstest_filesystem as files
import deploy_modstest as orchestrator
import live_test_config
import runner_browser_inventory


class RunnerBrowserInventory(unittest.TestCase):
    def test_pinned_playwright_headless_shell_is_included_without_argument_leak(self):
        args = ('/srv/bg3deploy/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell\0'
                '--remote-debugging-pipe\0--user-data-dir=/tmp/playwright_chromiumdev_profile-fixture\0'
                '--example=PRIVATE_SENTINEL\0').encode()
        with patch.object(os, 'getuid', return_value=1000), \
                patch.object(runner_browser_inventory.subprocess, 'check_output', return_value='321 1 headless_shell 900\n400 1 node 900\n'), \
                patch.object(Path, 'stat', return_value=SimpleNamespace(st_uid=1000)), \
                patch.object(Path, 'read_bytes', return_value=args):
            report = runner_browser_inventory.inventory()
        self.assertEqual(len(report['browsers']), 1)
        self.assertEqual(report['browsers'][0], {'pid': 321, 'parentPid': 1, 'name': 'headless_shell',
                                              'ageSeconds': 900, 'playwrightBrowser': True})
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(report))
        self.assertNotIn('user-data-dir', json.dumps(report))

    def test_a_process_whose_owner_changed_is_not_read_or_reported(self):
        with patch.object(os, 'getuid', return_value=1000), \
                patch.object(runner_browser_inventory.subprocess, 'check_output', return_value='321 1 headless_shell 900\n'), \
                patch.object(Path, 'stat', return_value=SimpleNamespace(st_uid=2000)), \
                patch.object(Path, 'read_bytes') as read:
            report = runner_browser_inventory.inventory()
        read.assert_not_called()
        self.assertEqual(report['browsers'], [])


class SharedInstanceFiles(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.target = self.base / 'existing/Data/modules/bg3-video-hud'
        self.target.mkdir(parents=True)
        self.state = self.base / 'transaction-state'
        self.state.mkdir(mode=0o700)
        self.config = {'enabled': True, 'other_worlds_disabled_reviewed': True,
                       'module_dir': str(self.target), 'state_dir': str(self.state)}
        self.transaction = files.Transaction(self.config)
        self.old = {'module.json': (ROOT / 'module.json').read_bytes(),
                    'scripts/module.js': b'export const build="old";',
                    'styles/video-hud.css': b'.bg3-video-hud {}'}
        self.new = {**self.old, 'scripts/module.js': b'export const build="new";'}
        for name, data in self.old.items():
            path = self.target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.neighbors = [self.target.parent / 'another-module/module.json',
                          self.base / 'existing/Data/worlds/ModsTest/settings.db',
                          self.base / 'existing/Data/worlds/Campaign/actors.db']
        for path in self.neighbors:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'NEVER CHANGE')

    def archive(self, content=None):
        stream = io.BytesIO()
        with ZipFile(stream, 'w') as bundle:
            for name, data in (content or self.new).items():
                bundle.writestr(name, data)
        data = stream.getvalue()
        return data, hashlib.sha256(data).hexdigest()

    def prepare(self):
        return self.transaction.prepare(*self.archive())

    def assert_old(self):
        files.verify_tree(self.target, self.old)
        for path in self.neighbors:
            self.assertEqual(path.read_bytes(), b'NEVER CHANGE')

    def test_real_atomic_exchange_commit_keeps_neighbors_and_verified_backup(self):
        self.prepare(); self.assert_old(); self.transaction.activate()
        files.verify_tree(self.target, self.new)
        self.transaction.finish()
        self.assertFalse(self.transaction.journal.exists())
        self.assertEqual(files.archive_payload(next(self.state.glob('*/previous.zip'))), self.old)
        for path in self.neighbors:
            self.assertEqual(path.read_bytes(), b'NEVER CHANGE')

    def test_rollback_restores_bytes_directory_inode_and_mode(self):
        original = self.target.stat()
        self.prepare(); self.transaction.activate(); self.transaction.rollback()
        self.assert_old()
        self.assertEqual(self.target.stat().st_ino, original.st_ino)
        self.assertEqual(self.target.stat().st_mode, original.st_mode)
        self.assertTrue(self.transaction.journal.exists())
        self.transaction.finish(rollback=True)

    def test_prepared_only_recovery_keeps_installation(self):
        self.prepare(); self.transaction.rollback(); self.transaction.finish(rollback=True)
        self.assert_old()

    def test_identical_content_prepared_recovery_does_not_swap_original_inode(self):
        original = self.target.stat().st_ino
        self.transaction.prepare(*self.archive(self.old))
        self.transaction.rollback(); self.transaction.finish(rollback=True)
        self.assertEqual(self.target.stat().st_ino, original)
        self.assert_old()

    def test_identical_content_activated_recovery_restores_original_inode(self):
        original = self.target.stat().st_ino
        self.transaction.prepare(*self.archive(self.old)); self.transaction.activate()
        self.transaction.rollback(); self.transaction.finish(rollback=True)
        self.assertEqual(self.target.stat().st_ino, original)
        self.assert_old()

    def test_interruption_between_exchange_and_journal_write_is_recoverable(self):
        self.prepare()
        with patch.object(files, 'atomic_json', side_effect=InterruptedError()):
            with self.assertRaises(InterruptedError):
                self.transaction.activate()
        self.assertEqual(json.loads(self.transaction.journal.read_text())['phase'], 'prepared')
        self.transaction.rollback(); self.transaction.finish(rollback=True)
        self.assert_old()

    def test_bad_checksum_rejected_before_staging(self):
        with self.assertRaises(ValueError):
            self.transaction.prepare(self.archive()[0], '0' * 64)
        self.assertEqual(list(self.state.iterdir()), [])
        self.assert_old()

    def test_manifest_or_version_change_needs_maintenance(self):
        changed = dict(self.new)
        manifest = json.loads(changed['module.json']); manifest['version'] = '0.1.1'
        changed['module.json'] = json.dumps(manifest).encode()
        with self.assertRaises(files.MaintenanceRequired):
            self.transaction.prepare(*self.archive(changed))
        self.assert_old()
        self.assertFalse(self.transaction.journal.exists())

    def test_missing_installation_needs_maintenance(self):
        self.target.rename(self.target.with_name('initial-backup'))
        with self.assertRaises(files.MaintenanceRequired):
            self.transaction.inspect()
        self.assertFalse(self.target.exists())

    def test_linked_target_rejected(self):
        self.target.rename(self.target.with_name('initial-backup'))
        self.target.symlink_to(self.target.with_name('initial-backup'))
        with self.assertRaises(files.MaintenanceRequired):
            self.transaction.inspect()

    def test_hard_linked_file_is_rejected(self):
        os.link(self.target / 'scripts/module.js', self.state / 'hard-link')
        with self.assertRaises(ValueError):
            self.prepare()
        self.assert_old()

    def test_unsupported_atomic_exchange_does_not_replace_target(self):
        with patch.object(files, 'exchange', side_effect=files.MaintenanceRequired('unsupported')):
            with self.assertRaises(files.MaintenanceRequired):
                self.prepare()
        self.assert_old()
        self.assertFalse(self.transaction.journal.exists())

    def test_corrupt_backup_blocks_rollback_and_retains_journal(self):
        self.prepare(); self.transaction.activate()
        next(self.state.glob('*/previous.zip')).write_bytes(b'CORRUPTED')
        with self.assertRaises(ValueError):
            self.transaction.rollback()
        self.assertTrue(self.transaction.journal.exists())
        files.verify_tree(self.target, self.new)

    def test_commit_revalidates_backup_and_preserves_journal_if_corrupted(self):
        self.prepare(); self.transaction.activate()
        next(self.state.glob('*/previous.zip')).write_bytes(b'CORRUPTED')
        with self.assertRaises(ValueError):
            self.transaction.finish()
        self.assertTrue(self.transaction.journal.exists())

    def test_unknown_target_edit_is_never_overwritten_during_recovery(self):
        self.prepare(); self.transaction.activate()
        (self.target / 'scripts/module.js').write_bytes(b'EXTERNAL EDIT')
        with self.assertRaises(OSError):
            self.transaction.rollback()
        self.assertEqual((self.target / 'scripts/module.js').read_bytes(), b'EXTERNAL EDIT')
        self.assertTrue(self.transaction.journal.exists())

    def test_target_edit_between_prepare_and_activate_is_rejected(self):
        self.prepare()
        (self.target / 'scripts/module.js').write_bytes(b'EXTERNAL EDIT')
        with self.assertRaises(ValueError):
            self.transaction.activate()

    def test_pending_transaction_blocks_another_prepare(self):
        self.prepare()
        with self.assertRaises(ValueError):
            self.prepare()

    def test_competing_lock_rejected(self):
        with files.deployment_lock(self.state):
            with self.assertRaises(BlockingIOError):
                with files.deployment_lock(self.state):
                    self.fail('lock bypassed')

    def test_disabled_admin_gate_blocks_transaction(self):
        for key in ['enabled', 'other_worlds_disabled_reviewed']:
            with self.assertRaises(ValueError):
                files.Transaction({**self.config, key: False})
        self.assert_old()

    def test_unsafe_journal_path_cannot_escape_state(self):
        self.prepare()
        journal = json.loads(self.transaction.journal.read_text())
        journal['transaction'] = '../../existing/Data/worlds'
        self.transaction.journal.write_text(json.dumps(journal))
        with self.assertRaises(ValueError):
            self.transaction.rollback()
        self.assert_old()

    def test_insufficient_space_rejected_before_backup(self):
        with patch.object(files.shutil, 'disk_usage', return_value=type('Space', (), {'free': 0})()):
            with self.assertRaises(OSError):
                self.prepare()
        self.assert_old()


class GuardedWorkflow(unittest.TestCase):
    class Guard:
        def __init__(self, failure=None):
            self.failure, self.calls = failure, []
        def call(self, operation, **_fields):
            self.calls.append(operation)
            if self.failure == operation:
                raise orchestrator.Blocked('blocked', 'test-denial')
            return {'moduleVersion': '0.1.0', 'moduleApi': True, 'entrypoints': {}}

    class Helper:
        def __init__(self, pending=False):
            self.calls, self.pending = [], pending
        def call(self, operation, **_fields):
            self.calls.append(operation)
            return {'pending': self.pending, 'version': '0.1.0', 'assets': {}, 'entrypoints': {}}

    def test_guard_denial_prevents_any_helper_call(self):
        guard, helper = self.Guard('check'), self.Helper()
        with self.assertRaises(orchestrator.Blocked):
            orchestrator.run_transaction(guard, helper, b'zip', 'digest')
        self.assertEqual(helper.calls, [])

    def test_pass_keeps_guard_through_commit_without_service_commands(self):
        guard, helper = self.Guard(), self.Helper()
        result = orchestrator.run_transaction(guard, helper, b'zip', 'digest')
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(helper.calls, ['inspect', 'prepare', 'activate', 'commit'])
        self.assertIn('cleanup', guard.calls)

    def test_test_failure_rolls_back_and_cleans_up(self):
        guard, helper = self.Guard('test'), self.Helper()
        result = orchestrator.run_transaction(guard, helper, b'zip', 'digest')
        self.assertEqual(result['status'], 'rolled-back')
        self.assertEqual(helper.calls[-2:], ['rollback', 'finish-rollback'])

    def test_non_test_user_joining_mid_test_defers_all_further_file_writes(self):
        guard, helper = self.Guard(), self.Helper()
        original = guard.call
        def call(operation, **fields):
            if operation == 'test':
                guard.failure = 'check'
                raise orchestrator.Blocked('blocked', 'non-test-account-active')
            return original(operation, **fields)
        guard.call = call
        result = orchestrator.run_transaction(guard, helper, b'zip', 'digest')
        self.assertEqual(result['status'], 'recovery-required')
        self.assertNotIn('rollback', helper.calls)
        self.assertNotIn('commit', helper.calls)

    def test_pending_recovery_is_guarded_and_does_not_start_another_deployment(self):
        guard, helper = self.Guard(), self.Helper(pending=True)
        result = orchestrator.run_transaction(guard, helper, b'zip', 'digest')
        self.assertEqual(result['status'], 'recovered')
        self.assertEqual(helper.calls, ['inspect', 'rollback', 'finish-rollback'])
        self.assertNotIn('test', guard.calls)

    def test_failed_fixture_cleanup_preserves_recovery_journal(self):
        guard, helper = self.Guard('cleanup'), self.Helper(pending=True)
        with self.assertRaises(orchestrator.Blocked):
            orchestrator.run_transaction(guard, helper, b'zip', 'digest')
        self.assertNotIn('finish-rollback', helper.calls)

    def test_stale_server_manifest_needs_maintenance_before_preparing(self):
        guard, helper = self.Guard(), self.Helper()
        original = guard.call
        guard.call = lambda operation, **fields: {**original(operation, **fields), 'moduleVersion': '0.0.9'}
        with self.assertRaises(orchestrator.Blocked) as outcome:
            orchestrator.run_transaction(guard, helper, b'zip', 'digest')
        self.assertEqual(outcome.exception.status, 'maintenance-required')
        self.assertEqual(helper.calls, ['inspect'])

    def test_stale_registered_asset_list_needs_maintenance(self):
        guard, helper = self.Guard(), self.Helper()
        original = guard.call
        guard.call = lambda operation, **fields: {**original(operation, **fields), 'entrypoints': {'styles': ['old.css']}}
        with self.assertRaises(orchestrator.Blocked) as outcome:
            orchestrator.run_transaction(guard, helper, b'zip', 'digest')
        self.assertEqual(outcome.exception.status, 'maintenance-required')
        self.assertEqual(helper.calls, ['inspect'])


class ConfigurationPolicy(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.config = {'schema': 2, 'mode': 'existing-instance', 'enabled': False,
            'url': 'https://redmagic.club/', 'world_id': 'modstest',
            'module_dir': str(self.base / 'existing/Data/modules/bg3-video-hud'),
            'state_dir': str(self.base / 'private'), 'test_state_dir': str(self.base / 'runner'),
            'other_worlds_disabled_reviewed': False}

    def read(self, config=None, uid=0, permissions=0o644):
        from unittest.mock import Mock
        location = Mock()
        location.lstat.return_value = SimpleNamespace(st_uid=uid, st_mode=stat.S_IFREG | permissions)
        location.read_text.return_value = json.dumps(config or self.config)
        with patch.object(files, 'CONFIG', location):
            return files.load_config()

    def test_existing_instance_schema_preserves_both_disabled_gates(self):
        self.assertEqual(self.read(), self.config)

    def test_file_deployment_cannot_take_over_pending_temporary_world_fixtures(self):
        pending = self.base / 'created-fixtures.json'
        pending.write_text('{}')
        config = {**self.config, 'enabled': True, 'other_worlds_disabled_reviewed': True, 'test_state_dir': str(self.base)}
        with patch.object(orchestrator, 'load_config', return_value=config), patch.object(orchestrator.os, 'geteuid', return_value=1000), \
             patch.object(sys, 'argv', ['deploy_modstest.py', '--recover-only']), patch.object(orchestrator, 'Peer') as peer, \
             patch.object(orchestrator, 'report') as report:
            self.assertEqual(orchestrator.main(), 1)
            peer.assert_not_called()
            self.assertEqual(report.call_args[0][0]['reason'], 'temporary-fixtures-need-tests-only-recovery')

    def test_tests_only_metadata_does_not_require_deployment_enabled_or_player_secret(self):
        result = live_test_config.test_metadata({'MODSTEST_TOKEN_IDS': 'aaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbb'},
            {'world_id': 'modstest', 'test_state_dir': str(self.base / 'snapshots'), 'enabled': False})
        self.assertEqual(result['FOUNDRY_WORLD_ID'], 'modstest')
        self.assertNotIn('FOUNDRY_PLAYER_PASSWORD', result)

    def test_fixture_creation_requires_explicit_opt_in_and_does_not_reuse_existing_tokens(self):
        env = {'FOUNDRY_WORLD_ID': 'modstest', 'MODSTEST_CREATE_FIXTURES': 'true'}
        result = live_test_config.test_metadata(env, {'test_state_dir': str(self.base / 'snapshots')})
        self.assertEqual(result['MODSTEST_TOKEN_IDS'], '')
        self.assertEqual(result['MODSTEST_CREATE_FIXTURES'], 'true')
        with self.assertRaises(ValueError):
            live_test_config.test_metadata({**env, 'MODSTEST_CREATE_FIXTURES': 'false'})

    def test_tests_only_metadata_rejects_missing_or_duplicate_fixture_ids(self):
        for tokens in ['', 'aaaaaaaaaaaaaaaa,aaaaaaaaaaaaaaaa']:
            with self.assertRaises(ValueError):
                live_test_config.test_metadata({'FOUNDRY_WORLD_ID': 'modstest', 'MODSTEST_TOKEN_IDS': tokens})

    def test_recovery_only_needs_no_token_ids_and_overrides_creation(self):
        result = live_test_config.test_metadata({'FOUNDRY_WORLD_ID': 'modstest',
            'MODSTEST_RECOVER_ONLY': 'true', 'MODSTEST_CREATE_FIXTURES': 'true'})
        self.assertEqual(result['MODSTEST_RECOVER_ONLY'], 'true')
        self.assertEqual(result['MODSTEST_CREATE_FIXTURES'], 'false')
        self.assertEqual(result['MODSTEST_TOKEN_IDS'], '')

    def test_recovery_only_does_not_accept_malformed_provided_token_ids(self):
        with self.assertRaises(ValueError):
            live_test_config.test_metadata({'FOUNDRY_WORLD_ID': 'modstest',
                'MODSTEST_RECOVER_ONLY': 'true', 'MODSTEST_TOKEN_IDS': 'bad'})

    def test_read_only_source_inspection_suppresses_creation_and_recovery(self):
        result = live_test_config.test_metadata({'FOUNDRY_WORLD_ID': 'modstest',
            'MODSTEST_SOURCE_PROBE': 'true', 'MODSTEST_RECOVER_ONLY': 'true', 'MODSTEST_CREATE_FIXTURES': 'true'})
        self.assertEqual(result['MODSTEST_SOURCE_PROBE'], 'true')
        self.assertEqual(result['MODSTEST_RECOVER_ONLY'], 'false')
        self.assertEqual(result['MODSTEST_CREATE_FIXTURES'], 'false')
        self.assertEqual(result['MODSTEST_TOKEN_IDS'], '')

    def test_client_inspection_needs_no_tokens_and_remains_read_only(self):
        result = live_test_config.test_metadata({'FOUNDRY_WORLD_ID': 'modstest', 'MODSTEST_CLIENT_PROBE': 'true'})
        self.assertEqual(result['MODSTEST_CLIENT_PROBE'], 'true')
        self.assertEqual(result['MODSTEST_SOURCE_PROBE'], 'false')
        self.assertEqual(result['MODSTEST_CREATE_FIXTURES'], 'false')
        self.assertEqual(result['MODSTEST_RECOVER_ONLY'], 'false')
        self.assertEqual(result['MODSTEST_TOKEN_IDS'], '')

    def test_client_inspection_rejects_combined_write_recovery_or_document_modes(self):
        for key in ['MODSTEST_SOURCE_PROBE', 'MODSTEST_RECOVER_ONLY', 'MODSTEST_CREATE_FIXTURES']:
            with self.assertRaises(ValueError):
                live_test_config.test_metadata({'FOUNDRY_WORLD_ID': 'modstest',
                    'MODSTEST_CLIENT_PROBE': 'true', key: 'true'})

    def test_test_routes_default_public_and_accept_only_fixed_loopback_option(self):
        env = {'FOUNDRY_WORLD_ID': 'modstest', 'MODSTEST_CLIENT_PROBE': 'true'}
        self.assertEqual(live_test_config.test_metadata(env)['MODSTEST_ROUTE'], 'public')
        self.assertEqual(live_test_config.test_metadata({**env, 'MODSTEST_ROUTE': 'server-loopback'})['MODSTEST_ROUTE'], 'server-loopback')

    def test_arbitrary_test_routes_are_rejected_without_echoing_the_value(self):
        with self.assertRaisesRegex(ValueError, '^Invalid test connection route$'):
            live_test_config.test_metadata({'FOUNDRY_WORLD_ID': 'modstest', 'MODSTEST_CLIENT_PROBE': 'true',
                                          'MODSTEST_ROUTE': 'PRIVATE_SENTINEL'})

    def test_deployment_forces_acceptance_modes_even_if_diagnostic_environment_is_inherited(self):
        config = {**self.config, 'enabled': True, 'other_worlds_disabled_reviewed': True,
                  'test_state_dir': str(self.base)}
        with patch.object(orchestrator, 'load_config', return_value=config), \
             patch.object(orchestrator.os, 'geteuid', return_value=1000), \
             patch.object(sys, 'argv', ['deploy_modstest.py', '--recover-only']), \
             patch.dict(os.environ, {'MODSTEST_CLIENT_PROBE': 'true', 'MODSTEST_SOURCE_PROBE': 'true', 'MODSTEST_ROUTE': 'server-loopback'}), \
             patch.object(orchestrator, 'Peer') as peer, \
             patch.object(orchestrator, 'run_transaction', return_value={'status': 'no-pending-deployment', 'reason': 'none'}), \
             patch.object(orchestrator, 'report'):
            self.assertEqual(orchestrator.main(), 0)
            environment = peer.call_args_list[0].args[1]
            self.assertEqual(environment['MODSTEST_CLIENT_PROBE'], 'false')
            self.assertEqual(environment['MODSTEST_SOURCE_PROBE'], 'false')
            self.assertEqual(environment['MODSTEST_ROUTE'], 'public')

    def test_tests_only_metadata_rejects_snapshot_state_inside_checkout(self):
        with self.assertRaises(ValueError):
            live_test_config.test_metadata({'FOUNDRY_WORLD_ID': 'modstest',
                'MODSTEST_TOKEN_IDS': 'aaaaaaaaaaaaaaaa,bbbbbbbbbbbbbbbb'},
                {'test_state_dir': str(Path.cwd() / 'e2e/results')})

    def test_timed_out_peer_cannot_supply_stale_reply_as_a_new_safety_check(self):
        from unittest.mock import Mock
        peer = orchestrator.Peer.__new__(orchestrator.Peer)
        peer.broken = False
        peer.child = Mock(stdout=io.StringIO(), stdin=io.StringIO())
        with patch.object(orchestrator.select, 'select', return_value=([], [], [])):
            with self.assertRaises(orchestrator.Blocked):
                peer.read(timeout=0)
        with self.assertRaises(orchestrator.Blocked):
            peer.call('check')
        self.assertEqual(peer.child.stdin.getvalue(), '')

    def test_old_instance_schema_is_not_silently_accepted(self):
        for changed in [{'schema': 1}, {'mode': 'dedicated-instance'}, {'dedicated_instance': True}, {'service': 'foundry'}]:
            with self.assertRaises(ValueError):
                self.read({**self.config, **changed})

    def test_runner_owned_or_writable_configuration_is_rejected(self):
        with self.assertRaises(ValueError):
            self.read(uid=1000)
        with self.assertRaises(ValueError):
            self.read(permissions=0o664)

    def test_paths_cannot_point_at_other_modules_worlds_or_privileged_runner_state(self):
        for changed in [
            {'module_dir': str(self.base / 'existing/Data/modules/another-module')},
            {'state_dir': str(self.base / 'existing/Data/worlds/ModsTest')},
            {'test_state_dir': str(self.base / 'private/snapshots')},
            {'url': 'https://different.example/'}
        ]:
            with self.assertRaises(ValueError):
                self.read({**self.config, **changed})


if __name__ == '__main__':
    unittest.main()
