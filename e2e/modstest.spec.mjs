import { test, expect } from '@playwright/test';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const moduleId = 'bg3-video-hud';

function settings() {
  const url = new URL(process.env.FOUNDRY_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid URL');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  const world = process.env.FOUNDRY_WORLD_ID;
  const tokens = process.env.MODSTEST_TOKEN_IDS?.split(',').map(v => v.trim());
  if (!world || tokens?.length !== 2 || tokens.some(v => !/^[a-zA-Z0-9]{16}$/.test(v)) || tokens[0] === tokens[1]) {
    throw Error('Configure the exact ModsTest world ID and two fixture token IDs');
  }
  const state = process.env.MODSTEST_STATE_DIR;
  if (!state || !state.startsWith('/')) throw Error('Configure persistent private test state directory');
  for (const key of ['FOUNDRY_GM_PASSWORD', 'FOUNDRY_PLAYER_PASSWORD']) {
    if (!process.env[key]) throw Error('Missing dedicated test secret');
  }
  mkdirSync(state, { recursive: true, mode: 0o700 });
  if (lstatSync(state).isSymbolicLink() || (lstatSync(state).mode & 0o077)) throw Error('Private state directory required');
  return { url: url.href, world, tokens, journal: join(state, 'hud-snapshot.json') };
}

async function login(page, config, name, password) {
  await page.goto(new URL('join', config.url).href, { waitUntil: 'domcontentloaded' });
  await page.locator('select[name="userid"]').selectOption({ label: name });
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[name="join"]').click();
  await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, undefined, { timeout: 60_000 });
  const identity = await page.evaluate(() => ({ name: game.user.name, gm: game.user.isGM }));
  expect(identity).toEqual({ name, gm: name === 'Gamemaster' });
  await guard(page, config);
}

async function guard(page, config) {
  const actual = await page.evaluate(() => ({
    world: game.world.id, title: game.world.title,
    generation: String(game.version).split('.')[0], system: game.system.id, version: game.system.version,
    modules: ['bg3-hud-core', 'bg3-hud-dnd5e', 'bg3-video-hud'].map(id => ({
      id, active: game.modules.get(id)?.active === true, version: game.modules.get(id)?.version
    }))
  }));
  expect(actual.world).toBe(config.world);
  expect(actual.title).toBe('ModsTest');
  expect(actual.generation).toBe('14');
  expect(actual.system).toBe('dnd5e');
  expect(actual.version).toBe('6.0.6');
  expect(actual.modules.every(m => m.active)).toBe(true);
  return actual;
}

async function capture(gm, config) {
  const snapshot = await gm.evaluate(({ tokens, moduleId }) => {
    const fixture = tokens.map(id => canvas.tokens.get(id));
    const player = game.users.find(u => u.name === 'Player1');
    if (!player || fixture.some(t => !t?.actor || !t.document.actorLink || !t.actor.testUserPermission(player, 'OWNER'))
        || fixture[0].actor.id === fixture[1].actor.id) throw Error('Two distinct linked Player1-owned fixture actors are required');
    if (game.users.some(u => u.active && !['Gamemaster', 'Player1'].includes(u.name))) throw Error('ModsTest must be idle');
    const caster = fixture[0].actor;
    const slot = caster.system.spells.spell1;
    if (!slot || !Number.isFinite(slot.value) || slot.value < 0 || slot.max < 1 || slot.value > slot.max
        || !caster.items.some(i => i.type === 'spell' && i.system.level === 0)
        || !caster.items.some(i => i.type === 'spell' && i.system.level === 1)) throw Error('Caster fixture requires L1 slots, cantrip and L1 spell');
    if (fixture.some(t => !Number.isFinite(t.actor.system.attributes.hp.value) || t.actor.system.attributes.hp.max < 1)) throw Error('Fixtures require numeric HP and positive maximum HP');
    if (fixture.some(t => t.actor.items.size < 2)) throw Error('Each fixture requires at least two items');
    return {
      world: game.world.id,
      actors: fixture.map(t => ({ id: t.actor.id, hp: t.actor.system.attributes.hp.value })),
      slot: { id: caster.id, value: slot.value },
      users: [game.user, player].map(u => ({ id: u.id, layouts: u.getFlag(moduleId, 'layouts') ?? null }))
    };
  }, { tokens: config.tokens, moduleId });
  const temporary = config.journal + '.tmp';
  writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
  const descriptor = openSync(temporary, 'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, config.journal);
  const directory = openSync(process.env.MODSTEST_STATE_DIR, 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return snapshot;
}

async function restore(gm, config, snapshot) {
  await guard(gm, config);
  if (snapshot.world !== config.world) throw Error('Foreign cleanup snapshot');
  await gm.evaluate(async ({ snapshot, moduleId }) => {
    if (!game.user.isGM || game.world.title !== 'ModsTest' || game.world.id !== snapshot.world) throw Error('Cleanup scope rejected');
    for (const saved of snapshot.actors) {
      const actor = game.actors.get(saved.id);
      if (!actor) throw Error('Missing cleanup actor');
      await actor.update({ 'system.attributes.hp.value': saved.hp });
    }
    await game.actors.get(snapshot.slot.id).update({ 'system.spells.spell1.value': snapshot.slot.value });
    for (const saved of snapshot.users) {
      const user = game.users.get(saved.id);
      await user.unsetFlag(moduleId, 'layouts');
      if (saved.layouts !== null) await user.setFlag(moduleId, 'layouts', saved.layouts);
      if (JSON.stringify(user.getFlag(moduleId, 'layouts') ?? null) !== JSON.stringify(saved.layouts)) throw Error('Layout cleanup failed');
    }
    for (const saved of snapshot.actors) {
      if (game.actors.get(saved.id).system.attributes.hp.value !== saved.hp) throw Error('HP cleanup failed');
    }
    if (game.actors.get(snapshot.slot.id).system.spells.spell1.value !== snapshot.slot.value) throw Error('Slot cleanup failed');
  }, { snapshot, moduleId });
  unlinkSync(config.journal);
}

async function select(page, tokenId) {
  const actor = await page.evaluate(async ({ tokenId, moduleId }) => {
    if (game.world.title !== 'ModsTest') throw Error('Wrong world');
    const token = canvas.tokens.get(tokenId);
    if (!token?.actor?.testUserPermission(game.user, 'OWNER')) throw Error('Fixture unavailable or unowned');
    token.control({ releaseOthers: true });
    await game.settings.set(moduleId, 'enabled', true);
    game.modules.get(moduleId).api.refresh();
    return { name: token.actor.name, hp: token.actor.system.attributes.hp.value,
      max: token.actor.system.attributes.hp.max, ac: token.actor.system.attributes.ac.value };
  }, { tokenId, moduleId });
  await expect(page.locator('#bg3-video-hud .bg3-video-hud-summary strong')).toHaveText(actor.name);
  await expect(page.locator('#bg3-video-hud .bg3-video-hud-summary span')).toContainText(`HP ${actor.hp}/${actor.max}`);
  await expect(page.locator('#bg3-video-hud .bg3-video-hud-summary span')).toContainText(`AC ${actor.ac}`);
}

test('Gamemaster and Player1: actor switching, HP, spell-slot synchronization, quickbar and restoration', async ({ browser, request }, info) => {
  const stage = description => info.annotations.push({ type: 'stage', description });
  stage('Validate configuration and join endpoint');
  const config = settings();
  // A 403 is terminal. Never retry a denial as if it were server startup delay.
  for (let attempt = 0; attempt < 20; attempt++) {
    let status;
    try { status = (await request.get(new URL('join', config.url).href, { timeout: 5000 })).status(); }
    catch { status = 0; }
    if (status === 403 || status === 401) throw Error('Endpoint denied test runner');
    if (status === 200) break;
    if (attempt === 19) throw Error('Join endpoint unavailable');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const contexts = [await browser.newContext(), await browser.newContext()];
  const gm = await contexts[0].newPage();
  const player = await contexts[1].newPage();
  const browserErrors = [];
  for (const page of [gm, player]) {
    page.on('pageerror', () => browserErrors.push('pageerror'));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push('console-error'); });
  }
  let snapshot;
  const verified = description => info.annotations.push({ type: 'verified', description });
  try {
    stage('Gamemaster login and exact world/version guard');
    await login(gm, config, 'Gamemaster', process.env.FOUNDRY_GM_PASSWORD);
    // Complete a previous interrupted test before taking a new snapshot.
    if (existsSync(config.journal)) await restore(gm, config, JSON.parse(readFileSync(config.journal, 'utf8')));
    stage('Player1 login and exact world/version guard');
    await login(player, config, 'Player1', process.env.FOUNDRY_PLAYER_PASSWORD);
    const actual = await guard(gm, config);
    verified(`Foundry ${await gm.evaluate(() => game.version)}; D&D5e ${actual.version}; ` + actual.modules.map(m => `${m.id} ${m.version}`).join('; '));
    stage('Validate fixtures and persist recovery snapshot');
    snapshot = await capture(gm, config);
    await gm.evaluate(async ({ tokens, moduleId }) => {
      for (const user of [game.user, game.users.find(u => u.name === 'Player1')]) {
        for (const token of tokens) {
          const key = [...new TextEncoder().encode(canvas.tokens.get(token).actor.uuid)]
            .map(n => n.toString(16).padStart(2, '0')).join('');
          // Only fixture leaves; original values are already in the private journal.
          await user.setFlag(moduleId, `layouts.${key}`, { version: 1, order: [], hidden: [], pinned: [], pinnedOnly: false });
        }
      }
    }, { tokens: config.tokens, moduleId });
    for (const [role, page] of [['Gamemaster', gm], ['Player1', player]]) {
      stage(`${role}: token switching and actor statistics`);
      for (const token of [config.tokens[0], config.tokens[1], config.tokens[0]]) await select(page, token);
      verified(`${role}: real canvas token switching, actor name, HP and AC`);
    }
    // Both independent sessions select the caster. A GM resource edit must
    // propagate through real Foundry sockets and rerender the Player1 HUD.
    stage('Two-session HP and slot synchronization');
    const changed = await gm.evaluate(async ({ tokens }) => {
      const actor = canvas.tokens.get(tokens[0]).actor;
      const hp = actor.system.attributes.hp.value > 0 ? actor.system.attributes.hp.value - 1 : 1;
      const slot = actor.system.spells.spell1.value > 0 ? actor.system.spells.spell1.value - 1 : 1;
      await actor.update({ 'system.attributes.hp.value': hp, 'system.spells.spell1.value': slot });
      return { hp, max: actor.system.attributes.hp.max, slot, slotsMax: actor.system.spells.spell1.max };
    }, { tokens: config.tokens });
    for (const page of [gm, player]) {
      await expect(page.locator('#bg3-video-hud .bg3-video-hud-summary span')).toContainText(`HP ${changed.hp}/${changed.max}`);
      await expect(page.locator('#bg3-video-hud .bg3-video-hud-spells small')).toContainText(`L1: ${changed.slot}/${changed.slotsMax}`);
    }
    verified('Both roles: live HP and L1 slot display after GM resource edit (does not prove spell consumption)');
    for (const [role, page] of [['Gamemaster', gm], ['Player1', player]]) {
      stage(`${role}: quickbar filtering, persistence, ordering and original HUD`);
      const root = page.locator('#bg3-video-hud');
      await root.locator('[data-action="filter-level"][data-value="0"]').click();
      const spellIds = await page.evaluate(() => game.actors.get(canvas.tokens.controlled[0].actor.id).items.filter(i => i.type === 'spell' && i.system.level === 0).map(i => i.id));
      const shown = await root.locator('.bg3-video-hud-panel').nth(2).locator('li').evaluateAll(nodes => nodes.map(n => n.dataset.itemId));
      // Fixture layouts must begin without hidden/pinned-only spells.
      expect(shown.sort()).toEqual(spellIds.sort());
      await root.locator('[data-action="filter-level"][data-value="all"]').click();
      await root.locator('[data-action="edit"]').click();
      const row = root.locator('.bg3-video-hud-panel').nth(2).locator('li').first();
      const itemId = await row.getAttribute('data-item-id');
      await row.locator('[data-action="visibility"]').click();
      await expect(root.locator(`li[data-item-id="${itemId}"]`)).toHaveClass(/bg3-video-hud-item-hidden/);
      await root.locator('[data-action="edit"]').click();
      await expect(root.locator(`li[data-item-id="${itemId}"]`)).toHaveCount(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, undefined, { timeout: 60_000 });
      await guard(page, config);
      await select(page, config.tokens[0]);
      await expect(root.locator(`li[data-item-id="${itemId}"]`)).toHaveCount(0);
      await root.locator('[data-action="edit"]').click();
      await root.locator(`li[data-item-id="${itemId}"] [data-action="visibility"]`).click();
      const panel = root.locator('.bg3-video-hud-panel').nth(2);
      const before = await panel.locator('li').evaluateAll(nodes => nodes.map(n => n.dataset.itemId));
      expect(before.length).toBeGreaterThanOrEqual(2);
      await panel.locator('li').first().locator('[data-action="move"][data-direction="1"]').click();
      await expect.poll(() => panel.locator('li').evaluateAll(nodes => nodes.map(n => n.dataset.itemId))).toEqual([before[1], before[0], ...before.slice(2)]);
      await root.locator('[data-action="edit"]').click();
      verified(`${role}: cantrip filter, quickbar visibility persisted after reload, item ordering`);
      await root.locator('[data-action="disable"]').click();
      await expect(root).toHaveCount(0);
      await expect(page.locator('body')).not.toHaveClass(/bg3-video-hud-active/);
      await expect(page.locator('#bg3-hotbar')).toBeVisible();
      verified(`${role}: original BG3 HUD restored`);
    }
    expect(browserErrors).toEqual([]);
    verified('No browser page errors or console errors in either session');
  } finally {
    try {
      if (snapshot) {
        await restore(gm, config, snapshot);
        verified('Fixture HP, spell slots and both user layout flags restored and verified');
      }
    } finally {
      await Promise.all(contexts.map(context => context.close()));
    }
  }
});
