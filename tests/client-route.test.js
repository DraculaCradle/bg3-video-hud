import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { routeSettings, verifiedLoopbackResponse, browserAssetProof } from '../e2e/client-route.mjs';
import { login } from '../e2e/live-guard.mjs';

test('client routes use only a fixed DNS rule and reject arbitrary hosts or browser arguments', () => {
  assert.deepEqual(routeSettings({}), { mode: 'public', args: [] });
  assert.deepEqual(routeSettings({ MODSTEST_ROUTE: 'server-loopback' }), { mode: 'server-loopback',
    args: ['--host-resolver-rules=MAP redmagic.club 127.0.0.1'] });
  for (const value of ['127.0.0.1', 'http://redmagic.club', 'server-loopback --ignore-certificate-errors']) {
    assert.throws(() => routeSettings({ MODSTEST_ROUTE: value }), /invalid-test-connection-route/);
  }
});

test('loopback proof requires the canonical HTTPS origin, join path and an actual loopback peer on 443', async () => {
  const response = (url, ipAddress, port = 443) => ({ url: () => url, serverAddr: async () => ({ ipAddress, port }) });
  assert.equal(await verifiedLoopbackResponse(response('https://redmagic.club/join', '127.0.0.1'), 'https://redmagic.club/'), true);
  for (const [url, ip, port] of [['http://redmagic.club/join', '127.0.0.1', 443],
    ['https://other.invalid/join', '127.0.0.1', 443], ['https://redmagic.club/game', '127.0.0.1', 443],
    ['https://redmagic.club/join', '203.0.113.1', 443], ['https://redmagic.club/join', '127.0.0.1', 30000]]) {
    assert.equal(await verifiedLoopbackResponse(response(url, ip, port), 'https://redmagic.club/'), false);
  }
});

test('unverified local endpoints and TLS failures are rejected before a credential or account control is touched', async () => {
  const page = { goto: async () => ({ status: () => 200, url: () => 'https://redmagic.club/join',
    serverAddr: async () => ({ ipAddress: '203.0.113.1', port: 443 }) }), title: async () => 'ModsTest',
    locator: () => assert.fail('credentials must not be entered') };
  const config = { url: 'https://redmagic.club/', world: 'modstest', connectionRoute: 'server-loopback' };
  await assert.rejects(login(page, config, 'Gamemaster', 'TEST_SENTINEL'),
    e => e.reason === 'local-proxy-peer-or-origin-unverified');
  page.goto = async () => { throw Error('TLS failure PRIVATE_SENTINEL'); };
  await assert.rejects(login(page, config, 'Gamemaster', 'TEST_SENTINEL'),
    e => e.reason === 'local-proxy-https-unavailable' && !e.message.includes('PRIVATE_SENTINEL'));
});

test('local-route asset proofs fetch through the browser with redirects disabled and export only a hash', async () => {
  const names = ['fetch', 'location'], saved = names.map(n => Object.getOwnPropertyDescriptor(globalThis, n));
  const bytes = new TextEncoder().encode('original fixture runtime'); let calls = 0;
  globalThis.location = { origin: 'https://redmagic.club' };
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://redmagic.club/modules/bg3-video-hud/scripts/module.js');
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    return { status: 200, arrayBuffer: async () => bytes.buffer };
  };
  try {
    assert.deepEqual(await browserAssetProof('https://redmagic.club/modules/bg3-video-hud/scripts/module.js'),
      { status: 200, sha256: createHash('sha256').update(bytes).digest('hex') });
    await assert.rejects(browserAssetProof('https://other.invalid/modules/bg3-video-hud/scripts/module.js'), /invalid-browser-asset-proof/);
    assert.equal(calls, 1);
  } finally { names.forEach((n, i) => saved[i] ? Object.defineProperty(globalThis, n, saved[i]) : delete globalThis[n]); }
});
