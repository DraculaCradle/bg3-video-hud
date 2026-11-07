import test from 'node:test';
import assert from 'node:assert/strict';
import { clientBrowserOptions } from '../e2e/browser-client.mjs';

test('native client uses full Chromium headless without arbitrary launch overrides', () => {
  assert.deepEqual(clientBrowserOptions({}), { channel: 'chromium', headless: true, args: [] });
  assert.deepEqual(clientBrowserOptions({ MODSTEST_ROUTE: 'public',
    CHROMIUM_CHANNEL: 'PRIVATE_SENTINEL', CHROMIUM_ARGS: '--ignore-certificate-errors' }),
  { channel: 'chromium', headless: true, args: [] });
});

test('full Chromium retains the verified route policy and rejects unsupported routes', () => {
  assert.deepEqual(clientBrowserOptions({ MODSTEST_ROUTE: 'server-loopback' }), {
    channel: 'chromium', headless: true, args: ['--host-resolver-rules=MAP redmagic.club 127.0.0.1']
  });
  assert.throws(() => clientBrowserOptions({ MODSTEST_ROUTE: 'invalid --ignore-certificate-errors' }),
    /invalid-test-connection-route/);
  const options = clientBrowserOptions({});
  options.args.push('arbitrary');
  assert.deepEqual(clientBrowserOptions({}).args, []);
});
