import test from 'node:test';
import assert from 'node:assert/strict';
import { GuardError, validateState, validateModuleVersion, login, freshModuleRequests, closeOwnContext, openGuard } from '../e2e/live-guard.mjs';
import { closeAnonymousJoin } from '../e2e/anonymous-join.mjs';

const state = { connected: true, ready: true, world: 'modstest', title: 'ModsTest', gm: true,
  gmName: 'Gamemaster', testAccountsValid: true, foreignActive: false, generation: '14',
  system: 'dnd5e', systemVersion: '6.0.6', dependenciesValid: true, moduleActive: true };

test('release acceptance rejects older installed versions and sanitizes non-version metadata', () => {
  validateModuleVersion({ moduleVersion: '0.1.2' }, '0.1.2');
  for (const installed of ['0.1.1', undefined, 'PRIVATE_SENTINEL']) {
    assert.throws(() => validateModuleVersion({ moduleVersion: installed }, '0.1.2'),
      error => error.status === 'maintenance-required' && error.reason.includes('expected=0.1.2')
        && !error.reason.includes('PRIVATE_SENTINEL'));
  }
  assert.throws(() => validateModuleVersion({}, 'bad'), error => error.reason === 'invalid-checkout-module-version');
});

function anonymousReleaseProbe(onAvailability = () => {}) {
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'ModsTest',
    locator: () => ({ waitFor: async () => {} }), waitForFunction: async (_fn, account) => onAvailability(account) };
  return { newContext: async () => ({ newPage: async () => page, close: async () => {} }) };
}
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
test('version diagnostics include dependency enablement and exclude non-version data', () => {
  assert.throws(() => validateState({ ...state, dependenciesValid: false, version: '14.369', dependencies: [
    { id: 'bg3-hud-core', version: '0.8.0', active: false },
    { id: 'bg3-hud-dnd5e', version: 'PRIVATE_PASSWORD', active: true }
  ] }, 'modstest'), error => error.reason.includes('foundry=14.369;system=dnd5e@6.0.6')
    && error.reason.includes('bg3-hud-core=0.8.0(active=false)')
    && error.reason.includes('bg3-hud-dnd5e=unknown(active=true)') && !error.reason.includes('PRIVATE_PASSWORD'));
});
test('another active world is rejected before entering either account credential', async () => {
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'Campaign',
    locator: () => assert.fail('must not fill a credential or submit a form') };
  await assert.rejects(login(page, { url: 'https://example.invalid/', world: 'modstest' }, 'Gamemaster', 'TEST_SENTINEL'),
    error => error instanceof GuardError && error.status === 'skipped');
});
test('Player1 submits its intentionally empty password, while GM still requires a Secret', async () => {
  const filled = [];
  const controls = {
    '#join-game-form select[name="userId"]': { waitFor: async () => {}, selectOption: async () => {} },
    '#join-game-form select[name="userId"] option': { evaluateAll: async () => [{ value: 'player', disabled: false }] },
    '#join-game-form input[name="password"]': { fill: async value => filled.push(value) },
    '#join-game-form button[type="submit"]': { click: async () => {} }
  };
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'ModsTest',
    // The legacy lowercase userid and name=join selectors do not exist in V14.
    // Any unscoped control could select the separate setup form and must fail.
    locator: selector => { assert.ok(controls[selector], `Unexpected login control: ${selector}`); return controls[selector]; },
    waitForFunction: async () => {}, evaluate: async () => ({ world: 'modstest', title: 'ModsTest', name: 'Player1', gm: false }) };
  await login(page, { url: 'https://example.invalid/', world: 'modstest' }, 'Player1', '');
  assert.deepEqual(filled, ['']);
  await assert.rejects(login(page, { url: 'https://example.invalid/', world: 'modstest' }, 'Gamemaster', ''),
    error => error.reason === 'missing-test-secret');
});
test('an unconfirmed anonymous handoff stops before entering credentials and hides page errors', async () => {
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'ModsTest',
    locator: () => ({ waitFor: async () => {}, evaluateAll: async () => [{ value: 'gm', disabled: false }],
      selectOption: () => assert.fail('must not select'), fill: () => assert.fail('must not enter credentials'),
      click: () => assert.fail('must not authenticate') }),
    evaluate: async fn => {
      if (fn === closeAnonymousJoin) throw Error('PRIVATE_SENTINEL');
      return { world: 'modstest', title: 'ModsTest' };
    } };
  await assert.rejects(login(page, { url: 'https://example.invalid/', world: 'modstest' }, 'Gamemaster', 'SENTINEL'),
    error => error instanceof GuardError && error.reason === 'anonymous-join-handoff-unconfirmed'
      && !error.message.includes('PRIVATE_SENTINEL'));
});
test('a missing V14 login form reports a controlled reason before entering credentials', async () => {
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'ModsTest',
    locator: () => ({ waitFor: async () => { throw new Error('private page details'); },
      fill: () => assert.fail('must not fill'), selectOption: () => assert.fail('must not select') }) };
  await assert.rejects(login(page, { url: 'https://example.invalid/', world: 'modstest' }, 'Gamemaster', 'SENTINEL'),
    error => error instanceof GuardError && error.reason === 'v14-login-form-unavailable'
      && !error.message.includes('private page details'));
});
test('the public world ID mismatch is reported before credentials and is never adopted', async () => {
  const config = { url: 'https://example.invalid/', world: 'ModsTest' };
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'ModsTest',
    locator: () => ({ waitFor: async () => {}, evaluateAll: () => assert.fail('must not select an account') }),
    evaluate: async () => ({ world: 'modstest', title: 'ModsTest' }) };
  await assert.rejects(login(page, config, 'Gamemaster', 'SENTINEL'),
    error => error instanceof GuardError && error.status === 'skipped' && error.reason === 'modstest-world-id-mismatch:modstest');
  assert.equal(config.world, 'ModsTest');
  page.evaluate = async () => ({ world: 'private page\nSENTINEL', title: 'ModsTest' });
  await assert.rejects(login(page, config, 'Gamemaster', 'SENTINEL'),
    error => error.reason === 'modstest-world-id-mismatch:unavailable');
});
test('authentication or world initialization failure reports no password or page error', async () => {
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'ModsTest',
    locator: () => ({ waitFor: async () => {}, evaluateAll: async () => [{ value: 'gm', disabled: false }],
      selectOption: async () => {}, fill: async () => {}, click: async () => {} }),
    waitForFunction: async () => { throw new Error('private response SENTINEL'); },
    evaluate: async () => ({ world: 'modstest', title: 'ModsTest' }) };
  await assert.rejects(login(page, { url: 'https://example.invalid/', world: 'modstest' }, 'Gamemaster', 'SENTINEL'),
    error => error instanceof GuardError && error.reason === 'test-login-or-world-initialization-failed'
      && !error.message.includes('SENTINEL'));
});
test('an already-active GM option is reported without submitting a login or kicking it', async () => {
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'ModsTest',
    evaluate: async () => ({ world: 'modstest', title: 'ModsTest' }),
    locator: () => ({ waitFor: async () => {}, evaluateAll: async () => [{ value: 'gm', disabled: true }],
      selectOption: () => assert.fail('must not submit'), fill: () => assert.fail('must not fill') }) };
  await assert.rejects(login(page, { url: 'https://example.invalid/', world: 'modstest' }, 'Gamemaster', 'SENTINEL'),
    error => error.reason === 'test-account-already-active');
});
test('closing a test context logs out only its own authenticated account', async () => {
  let closed = 0, calls = 0;
  await closeOwnContext({ close: async () => { closed++; } }, { evaluate: async () => { calls++; return false; } }, 'Gamemaster');
  assert.equal(calls, 1); assert.equal(closed, 1);
  calls = 0;
  const page = { evaluate: async () => { calls++; return calls === 1; },
    url: () => 'https://example.invalid/join',
    waitForURL: async () => {}, locator: () => ({ waitFor: async () => {} }), waitForFunction: async () => {} };
  await closeOwnContext({ browser: () => anonymousReleaseProbe(), pages: () => [page], close: async () => { closed++; } }, page, 'Gamemaster');
  assert.equal(calls, 2); assert.equal(closed, 2);
});
test('native logout waits for navigation then verifies release after closing all authenticated sockets', async () => {
  let finishNavigation, closed = false, evaluations = 0;
  const events = [];
  const page = {
    url: () => 'https://example.invalid/join',
    evaluate: async () => { evaluations++; if (evaluations === 1) return true; events.push('native logout'); },
    waitForURL: async () => { events.push('wait navigation'); await new Promise(resolve => { finishNavigation = resolve; }); },
  };
  const context = { browser: () => anonymousReleaseProbe(name => {
    assert.equal(name, 'Gamemaster'); assert.equal(closed, true); events.push('anonymous release confirmed');
  }), pages: () => [page, { close: async () => { events.push('sibling closed'); } }],
    close: async () => { closed = true; events.push('context closed'); } };
  const closing = closeOwnContext(context, page, 'Gamemaster');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.deepEqual(events, ['sibling closed', 'wait navigation', 'native logout']);
  finishNavigation(); await closing;
  assert.deepEqual(events.slice(-2), ['context closed', 'anonymous release confirmed']);
});
test('unconfirmed native logout blocks a passing report while still closing our context', async () => {
  let closed = false;
  const page = { url: () => 'https://example.invalid/join', evaluate: async () => true, waitForURL: async () => { throw Error('private response'); } };
  await assert.rejects(closeOwnContext({ browser: () => anonymousReleaseProbe(), pages: () => [page], close: async () => { closed = true; } }, page, 'Player1'),
    error => error instanceof GuardError && error.reason === 'test-session-release-unconfirmed:native-navigation');
  assert.equal(closed, true);
});
test('an account that remains active after our sockets close is never evicted', async () => {
  let closed = false;
  const page = { url: () => 'https://example.invalid/join', evaluate: async () => true, waitForURL: async () => {} };
  const browser = anonymousReleaseProbe(() => { assert.equal(closed, true); throw Error('still active'); });
  await assert.rejects(closeOwnContext({ browser: () => browser, pages: () => [page], close: async () => { closed = true; } }, page, 'Gamemaster'),
    error => error.reason === 'test-session-release-unconfirmed:account-availability');
});
test('a logout failure preserves the original world/version guard failure for diagnosis', async t => {
  if (Object.hasOwn(process.env, 'FOUNDRY_GM_PASSWORD')) t.mock.property(process.env, 'FOUNDRY_GM_PASSWORD', 'SENTINEL');
  else {
    process.env.FOUNDRY_GM_PASSWORD = 'SENTINEL';
    t.after(() => { delete process.env.FOUNDRY_GM_PASSWORD; });
  }
  const replies = [{ world: 'modstest', title: 'ModsTest' }, undefined,
    { world: 'modstest', title: 'ModsTest', name: 'Gamemaster', gm: true }, undefined,
    { ...state, generation: '13' }, true];
  let closed = false;
  const page = { goto: async () => ({ status: () => 200 }), title: async () => 'ModsTest',
    locator: () => ({ waitFor: async () => {}, evaluateAll: async () => [{ value: 'gm', disabled: false }],
      selectOption: async () => {}, fill: async () => {}, click: async () => {} }),
    waitForFunction: async () => {}, evaluate: async () => replies.shift(), on: () => {},
    url: () => 'https://example.invalid/join', waitForURL: async () => { throw Error('private cleanup error'); } };
  const context = { unroute: async () => {}, route: async () => {}, newPage: async () => page,
    browser: () => anonymousReleaseProbe(),
    pages: () => [page], close: async () => { closed = true; } };
  await assert.rejects(openGuard({ newContext: async () => context }, { url: 'https://example.invalid/', world: 'modstest' }),
    error => error.reason.startsWith('foundry-or-dependency-version-mismatch:foundry=13;')
      && error.cleanupReason === 'test-session-release-unconfirmed:native-navigation');
  assert.equal(closed, true);
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
