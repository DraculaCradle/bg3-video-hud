#!/usr/bin/env python3
"""Read only browser process metadata owned by this restricted runner account."""
import json
import os
import re
from pathlib import Path
import subprocess


def inventory():
    uid = os.getuid()
    if uid == 0:
        raise SystemExit('Run diagnostics as the restricted non-root runner account')
    listing = subprocess.check_output(
        ['ps', '-u', str(uid), '-o', 'pid=,ppid=,comm=,etimes='], text=True)
    browsers = []
    for line in listing.splitlines():
        fields = line.split()
        if len(fields) != 4 or not (fields[2] == 'headless_shell'
                                   or any(word in fields[2].lower() for word in ['chrome', 'chromium'])):
            continue
        pid, parent, name, age = fields
        # Command arguments are inspected only for fixed Playwright markers;
        # they are never returned, printed, persisted or used to send a signal.
        marked = False
        try:
            process = Path('/proc') / pid
            if process.stat().st_uid != uid:
                continue
            args = process.joinpath('cmdline').read_bytes().decode('utf8', errors='replace').split('\0')
            marked = (bool(args) and '/.cache/ms-playwright/' in args[0]
                      and Path(args[0]).name in ['chrome', 'chrome-headless-shell', 'headless_shell']
                      and '--remote-debugging-pipe' in args
                      and any(arg.startswith('--user-data-dir=/tmp/playwright_chromiumdev_profile-') for arg in args))
        except (OSError, ValueError):
            pass  # A process may exit while being inventoried.
        browsers.append({'pid': int(pid), 'parentPid': int(parent), 'name': name,
                         'ageSeconds': int(age), 'playwrightBrowser': marked})
    version = None
    try:
        result = subprocess.run(['/usr/bin/node', '--version'], capture_output=True, text=True, timeout=5)
        value = result.stdout.strip()
        if result.returncode == 0 and re.fullmatch(r'v\d+\.\d+\.\d+', value):
            version = value
    except (OSError, subprocess.TimeoutExpired):
        pass
    # Reference version of the system binary, not proof of a running PID's version.
    return {'readOnly': True, 'runnerUid': uid, 'systemNodeVersion': version, 'browsers': browsers}


if __name__ == '__main__':
    report = inventory()
    directory = Path('e2e/results')
    directory.mkdir(parents=True, exist_ok=True)
    directory.joinpath('runner-browser-inventory.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, separators=(',', ':')))
