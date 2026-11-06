#!/usr/bin/env python3
"""Prepare a tests-only client; never calls the deployment helper or checks its enable switch."""
import os
import json
from pathlib import Path
import re
import stat

CONFIG = Path('/etc/bg3-modstest.json')


def read_test_config(path=CONFIG):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise ValueError('Test metadata configuration must be root-owned and not runner-writable')
    config = json.loads(path.read_text())
    if config.get('schema') != 2 or config.get('mode') != 'existing-instance' or config.get('url') != 'https://redmagic.club/':
        raise ValueError('Expected existing-instance test metadata for redmagic.club')
    return config


def test_metadata(environment, config=None):
    world = environment.get('FOUNDRY_WORLD_ID') or (config or {}).get('world_id', '')
    tokens = environment.get('MODSTEST_TOKEN_IDS', '').strip()
    probe = environment.get('MODSTEST_SOURCE_PROBE') == 'true'
    recover = environment.get('MODSTEST_RECOVER_ONLY') == 'true' and not probe
    create = environment.get('MODSTEST_CREATE_FIXTURES') == 'true' and not (recover or probe)
    if not re.fullmatch(r'[A-Za-z0-9_-]+', world):
        raise ValueError('Configure FOUNDRY_WORLD_ID in modstest Environment or workflow input')
    if not create and not ((recover or probe) and not tokens) and (not re.fullmatch(r'[A-Za-z0-9]{16}\s*,\s*[A-Za-z0-9]{16}', tokens) or len(set(part.strip() for part in tokens.split(','))) != 2):
        raise ValueError('Configure MODSTEST_TOKEN_IDS: two different linked fixture token IDs, caster first')
    state = (config or {}).get('test_state_dir', '/srv/bg3deploy/modstest-state')
    path = Path(state)
    if not path.is_absolute() or '\n' in state or '\r' in state or path.is_symlink() or path.resolve() != path:
        raise ValueError('Expected the private persistent test-state directory')
    if Path.cwd().resolve() == path or Path.cwd().resolve() in path.parents:
        raise ValueError('Test snapshots must persist outside the checkout')
    return {'FOUNDRY_URL': 'https://redmagic.club/', 'FOUNDRY_WORLD_ID': world,
            'MODSTEST_TOKEN_IDS': '' if create else ','.join(part.strip() for part in tokens.split(',')),
            'MODSTEST_CREATE_FIXTURES': 'true' if create else 'false',
            'MODSTEST_RECOVER_ONLY': 'true' if recover else 'false',
            'MODSTEST_SOURCE_PROBE': 'true' if probe else 'false',
            'MODSTEST_STATE_DIR': state}


if __name__ == '__main__':
    try:
        if os.geteuid() == 0:
            raise ValueError('Run the test runner as the restricted non-root account')
        values = test_metadata(os.environ, read_test_config() if CONFIG.exists() else None)
        with open(os.environ['GITHUB_ENV'], 'a') as stream:
            for key, value in values.items():
                stream.write(f'{key}={value}\n')
        print('Tests-only metadata ready; Foundry deployment and service control remain unused')
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(str(error))
