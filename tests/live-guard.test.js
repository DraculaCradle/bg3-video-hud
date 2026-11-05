import test from 'node:test';
import assert from 'node:assert/strict';
import { GuardError, validateState, login, freshModuleRequests } from '../e2e/live-guard.mjs';

const state = { connected: true, ready: true, world: 'modstest', title: 'ModsTest', gm: true,
  gmName: 'Gamemaster', testAccountsValid: true, foreignActive: false, generation: '14',
  system: 'dnd5e', systemVersion: '6.0.6', dependenciesValid: true, moduleActive: true };
test('shared-instance guard permits only the exact world and test-account session set', () => {
  assert.equal(validateState(state, 'modstest'), state);
});
test('a different world id or title is explicitly skipped', () => {
  for (const changed of [{ world: 'campaign' }, { title: 'Campaign' }]) {
    assert.throws(() => validateState({ ...state, ...changed }, 'modstest'), error => error.status === 'skipped');
  }
});
test('a non-test active user, disconnect or mismatched identity blocks deployment', () => {
  for (const changed of [{ foreignActive: true }, { connected: false }, { testAccountsValid: false }, { gm: false }]) {
    assert.throws(() => validateState({ ...state, ...changed }, 'modstest'), error => error.status === 'blocked');
  }
});
test('missing discovery, wrong versions and disabled modules require a maintenance window', () => {
  for (const changed of [{ generation: '13' }, { systemVersion: '6.0.5' }, { dependenciesValid: false }, { moduleActive: false }]) {
    assert.throws(() => validateState({ ...state, ...changed }, 'modstest'), error => error.status === 'maintenance-required');
  }
});
test('another active world is rejected before entering either account credential', async () => {
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'Campaign',
    locator: () => assert.fail('must not fill a credential or submit a form') };
  await assert.rejects(login(page, { url: 'https://example.invalid/', world: 'modstest' }, 'Gamemaster', 'TEST_SENTINEL'),
    error => error instanceof GuardError && error.status === 'skipped');
});
test('GM test pages receive a new cache key instead of reusing preflight module assets', async t => {
  let sequence = 0, handler;
  t.mock.method(Math, 'random', () => ++sequence / 10);
  const context = { unroute: async () => { handler = undefined; }, route: async (_pattern, callback) => { handler = callback; } };
  const urls = [];
  const request = { request: () => ({ url: () => 'https://example.invalid/modules/bg3-video-hud/scripts/module.js' }),
    continue: async options => urls.push(new URL(options.url)) };
  await freshModuleRequests(context); await handler(request);
  await freshModuleRequests(context); await handler(request);
  assert.notEqual(urls[0].searchParams.get('bg3TestClient'), urls[1].searchParams.get('bg3TestClient'));
  assert.equal(urls[0].pathname, urls[1].pathname);
  assert.equal(urls[0].origin, 'https://example.invalid');
});
