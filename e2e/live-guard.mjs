import { createHash } from 'node:crypto';

export class GuardError extends Error {
  constructor(status, reason) { super(reason); this.status = status; this.reason = reason; }
}

function assertWorld(world, title, expected) {
  if (title !== 'ModsTest') throw new GuardError('skipped', 'active-world-not-modstest');
  if (world !== expected) {
    // Only the public ID of a world with the exact test title can enter reports.
    // Never adopt an observed ID automatically or dump the world document.
    const observed = typeof world === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(world) ? world : 'unavailable';
    throw new GuardError('skipped', `modstest-world-id-mismatch:${observed}`);
  }
}

export function validateState(state, world) {
  if (!state.connected || !state.ready) throw new GuardError('blocked', 'live-session-not-connected');
  assertWorld(state.world, state.title, world);
  if (!state.gm || state.gmName !== 'Gamemaster' || !state.testAccountsValid) throw new GuardError('blocked', 'test-account-identity-invalid');
  if (state.foreignActive) throw new GuardError('blocked', 'non-test-account-active');
  if (state.unsafe) throw new GuardError('blocked', 'world-or-session-guard-latched');
  if (state.generation !== '14' || state.system !== 'dnd5e' || state.systemVersion !== '6.0.6'
      || !state.dependenciesValid) throw new GuardError('maintenance-required', 'foundry-or-dependency-version-mismatch');
  if (!state.moduleActive) throw new GuardError('maintenance-required', 'module-not-enabled-in-modstest');
  return state;
}

export async function publicWorld(page, config) {
  const response = await page.goto(new URL('join', config.url).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  if (!response || response.status() !== 200) throw new GuardError('blocked', 'join-endpoint-unavailable');
  if (await page.title() !== 'ModsTest') throw new GuardError('skipped', 'active-world-not-modstest');
  // Do not enter credentials when a different world is active. No Setup request,
  // world switch, reload-world socket message or module-enable write is used.
}

export async function login(page, config, name, password) {
  await publicWorld(page, config);
  if (!password && name !== 'Player1') throw new GuardError('blocked', 'missing-test-secret');
  // V14 renders an ApplicationV2 form after the initial /join document arrives.
  // Scope every control to login so the adjacent return-to-setup form is never submitted.
  const user = page.locator('#join-game-form select[name="userId"]');
  try { await user.waitFor({ state: 'visible', timeout: 30_000 }); }
  catch { throw new GuardError('blocked', 'v14-login-form-unavailable'); }
  const advertised = await page.evaluate(() => ({ world: game.world?.id, title: game.world?.title }));
  assertWorld(advertised.world, advertised.title, config.world);
  const options = await page.locator('#join-game-form select[name="userId"] option').evaluateAll((nodes, name) => nodes
    .filter(node => node.label.trim() === name || node.label.trim().startsWith(`${name} `))
    .map(node => ({ value: node.value, disabled: node.disabled })), name);
  if (options.length !== 1) throw new GuardError('blocked', 'test-account-option-unavailable');
  if (options[0].disabled) throw new GuardError('blocked', 'test-account-already-active');
  await user.selectOption(options[0].value);
  await page.locator('#join-game-form input[name="password"]').fill(password ?? '');
  await page.locator('#join-game-form button[type="submit"]').click();
  try { await page.waitForFunction(() => globalThis.game?.ready && globalThis.game?.user, undefined, { timeout: 60_000 }); }
  catch { throw new GuardError('blocked', 'test-login-or-world-initialization-failed'); }
  const actual = await page.evaluate(() => ({ world: game.world.id, title: game.world.title, name: game.user.name, gm: game.user.isGM }));
  assertWorld(actual.world, actual.title, config.world);
  if (actual.name !== name || actual.gm !== (name === 'Gamemaster')) {
    throw new GuardError('blocked', 'authenticated-world-or-user-mismatch');
  }
}

export async function openGuard(browser, config) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await freshModuleRequests(context);
  const gm = await context.newPage();
  try {
    await login(gm, config, 'Gamemaster', process.env.FOUNDRY_GM_PASSWORD);
    await gm.evaluate(() => {
      const allowed = new Set(game.users.filter(u => ['Gamemaster', 'Player1'].includes(u.name)).map(u => u.id));
      globalThis.bg3DeploymentUnsafe = false;
      const check = () => {
        if (game.users.some(u => u.active && !allowed.has(u.id))) globalThis.bg3DeploymentUnsafe = true;
      };
      Hooks.on('updateUser', check);
      Hooks.on('userConnected', (user, connected) => {
        if (connected && !allowed.has(user.id)) globalThis.bg3DeploymentUnsafe = true;
        check();
      });
      Hooks.on('createUser', check);
      game.socket.on('disconnect', () => { globalThis.bg3DeploymentUnsafe = true; });
      setInterval(check, 100);
      check();
    });
    const guard = {
      browser, context, gm, config, unsafe: false,
      async check() {
        if (this.unsafe) throw new GuardError('blocked', 'world-or-session-guard-latched');
        try {
          const state = await gm.evaluate(() => {
            const accounts = ['Gamemaster', 'Player1'].map(name => game.users.filter(u => u.name === name));
            const allowed = new Set(accounts.flat().map(u => u.id));
            const registered = game.modules.get('bg3-video-hud')?.toObject();
            return { connected: game.socket.connected === true, unsafe: globalThis.bg3DeploymentUnsafe,
              ready: game.ready, world: game.world.id, title: game.world.title, gm: game.user.isGM, gmName: game.user.name,
              testAccountsValid: accounts.every(users => users.length === 1) && accounts[0][0]?.isGM && !accounts[1][0]?.isGM,
              foreignActive: game.users.some(u => u.active && !allowed.has(u.id)),
              generation: String(game.version).split('.')[0], system: game.system.id, systemVersion: game.system.version,
              dependenciesValid: ['bg3-hud-core', 'bg3-hud-dnd5e'].every(id => {
                const module = game.modules.get(id);
                const parts = String(module?.version ?? '').match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
                return module?.active === true && parts && (parts[0] > 0 || parts[1] >= 8);
              }),
              moduleActive: game.modules.get('bg3-video-hud')?.active === true,
              moduleVersion: game.modules.get('bg3-video-hud')?.version,
              entrypoints: { esmodules: registered?.esmodules ?? [], styles: registered?.styles ?? [] },
              moduleApi: typeof game.modules.get('bg3-video-hud')?.api?.refresh === 'function'
            };
          });
          return validateState(state, config.world);
        } catch (error) {
          this.unsafe = true;
          throw error instanceof GuardError ? error : new GuardError('blocked', 'live-world-or-session-unavailable');
        }
      },
      async assets(assets) {
        await this.check();
        for (const [name, expected] of Object.entries(assets)) {
          if (!/^[a-f0-9]{64}$/.test(expected) || name.split('/').some(p => ['..', '.', ''].includes(p)) || !/\.(js|css)$/.test(name)) {
            throw new GuardError('blocked', 'invalid-asset-proof');
          }
          const url = new URL(`modules/bg3-video-hud/${name}`, config.url);
          url.searchParams.set('bg3Deployment', expected);
          const response = await context.request.get(url.href, { timeout: 15_000 });
          if (response.status() !== 200 || createHash('sha256').update(await response.body()).digest('hex') !== expected) {
            throw new GuardError('blocked', 'served-assets-do-not-match-installed-files');
          }
        }
        await this.check();
      },
      async close() { await closeOwnContext(context, gm, 'Gamemaster'); }
    };
    gm.on('framenavigated', frame => { if (frame === gm.mainFrame()) guard.unsafe = true; });
    gm.on('close', () => { guard.unsafe = true; });
    await guard.check();
    return guard;
  } catch (error) {
    await closeOwnContext(context, gm, 'Gamemaster');
    throw error;
  }
}

export async function closeOwnContext(context, page, account) {
  let ownSession = false;
  try {
    ownSession = await page.evaluate(name => globalThis.game?.user?.name === name
      && typeof game.logOut === 'function', account);
  } catch { /* A closed/unauthenticated page has no proven owned session. */ }
  try {
    if (ownSession) {
      // Every page in this context belongs to this task. Close sibling sockets
      // first, keeping our authenticated page until native logout is confirmed.
      for (const sibling of context.pages()) if (sibling !== page) await sibling.close();
      try {
        // V14 logOut() returns immediately after assigning window.location.
        // Awaiting its return does not wait for the server's /join request.
        await Promise.all([
          page.waitForURL(url => /\/join\/?$/.test(url.pathname), { waitUntil: 'domcontentloaded', timeout: 30_000 }),
          page.evaluate(() => { game.logOut(); })
        ]);
        await page.locator('#join-game-form').waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForFunction(name => {
          const options = [...document.querySelectorAll('#join-game-form select[name="userId"] option')]
            .filter(node => node.label.trim() === name || node.label.trim().startsWith(`${name} `));
          return options.length === 1 && !options[0].disabled;
        }, account, { timeout: 15_000 });
      } catch { throw new GuardError('blocked', 'test-session-release-unconfirmed'); }
    }
  } finally { await context.close(); }
}

export async function freshModuleRequests(context) {
  // Routing disables the browser HTTP cache; the nonce also avoids a stale
  // reverse-proxy cache for each imported JS/CSS asset without changing the proxy.
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await context.unroute('**/modules/bg3-video-hud/**');
  await context.route('**/modules/bg3-video-hud/**', async route => {
    const url = new URL(route.request().url());
    url.searchParams.set('bg3TestClient', nonce);
    await route.continue({ url: url.href });
  });
}
