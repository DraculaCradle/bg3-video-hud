import { expect } from '@playwright/test';
import { login, freshModuleRequests } from './live-guard.mjs';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const moduleId = 'bg3-video-hud';

export function settings() {
  if (process.env.MODSTEST_LIVE_ENABLED !== 'true') throw Error('Live tests are not explicitly enabled');
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
  for (const key of ['FOUNDRY_GM_PASSWORD']) {
    if (!process.env[key]) throw Error('Missing dedicated test secret');
  }
  mkdirSync(state, { recursive: true, mode: 0o700 });
  if (lstatSync(state).isSymbolicLink() || (lstatSync(state).mode & 0o077)) throw Error('Private state directory required');
  return { url: url.href, world, tokens, journal: join(state, 'hud-snapshot.json') };
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
  await gm.evaluate(async ({ snapshot, moduleId, tokens }) => {
    if (!game.user.isGM || game.world.title !== 'ModsTest' || game.world.id !== snapshot.world) throw Error('Cleanup scope rejected');
    const fixture = tokens.map(id => canvas.tokens.get(id)?.actor?.id);
    const users = ['Gamemaster', 'Player1'].map(name => game.users.find(u => u.name === name)?.id);
    if (snapshot.actors.length !== 2 || snapshot.users.length !== 2 || fixture.some(id => !id)
        || new Set(snapshot.actors.map(a => a.id)).size !== 2 || new Set(snapshot.users.map(u => u.id)).size !== 2
        || snapshot.slot.id !== fixture[0]
        || snapshot.actors.some(saved => !fixture.includes(saved.id) || !Number.isFinite(saved.hp))
        || snapshot.users.some(saved => !users.includes(saved.id)) || !Number.isFinite(snapshot.slot.value)) {
      throw Error('Cleanup snapshot is not for these fixtures and accounts');
    }
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
  }, { snapshot, moduleId, tokens: config.tokens });
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

export async function cleanup(live) {
  await live.check();
  const config = live.config;
  if (existsSync(config.journal)) await restore(live.gm, config, JSON.parse(readFileSync(config.journal, 'utf8')));
}

export async function runScenario(live, info) {
  const { browser, config } = live;
  const stage = description => info.annotations.push({ type: 'stage', description });
  await live.check();
  // The guard loaded the previous version; refresh its routing nonce before the
  // new GM test page so a proxy cannot serve preflight assets under the old key.
  await freshModuleRequests(live.context);
  const playerContext = await browser.newContext({ serviceWorkers: 'block' });
  await freshModuleRequests(playerContext);
  // Reuse the authenticated GM cookie, without a second login, while preserving
  // the original GM page as an uninterrupted session/world monitor.
  const gm = await live.context.newPage();
  const player = await playerContext.newPage();
  const browserErrors = [];
  for (const page of [gm, player]) {
    page.on('pageerror', () => browserErrors.push('pageerror'));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push('console-error'); });
  }
  let snapshot;
  const verified = description => info.annotations.push({ type: 'verified', description });
  const click = async locator => { await live.check(); await locator.click(); };
  try {
    stage('Existing GM guard and exact world/version check');
    await live.check();
    await gm.goto(live.gm.url(), { waitUntil: 'domcontentloaded' });
    await gm.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, undefined, { timeout: 60_000 });
    await live.check();
    // Complete a previous interrupted test before taking a new snapshot.
    await cleanup(live);
    stage('Player1 login and exact world/version guard');
    await login(player, config, 'Player1', process.env.FOUNDRY_PLAYER_PASSWORD);
    const actual = await guard(gm, config);
    verified(`Foundry ${await gm.evaluate(() => game.version)}; D&D5e ${actual.version}; ` + actual.modules.map(m => `${m.id} ${m.version}`).join('; '));
    stage('Validate fixtures and persist recovery snapshot');
    await live.check();
    snapshot = await capture(gm, config);
    await live.check();
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
      for (const token of [config.tokens[0], config.tokens[1], config.tokens[0]]) { await live.check(); await select(page, token); }
      verified(`${role}: real canvas token switching, actor name, HP and AC`);
    }
    // Both independent sessions select the caster. A GM resource edit must
    // propagate through real Foundry sockets and rerender the Player1 HUD.
    stage('Two-session HP and slot synchronization');
    await live.check();
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
      await live.check();
      const root = page.locator('#bg3-video-hud');
      await click(root.locator('[data-action="filter-level"][data-value="0"]'));
      const spellIds = await page.evaluate(() => game.actors.get(canvas.tokens.controlled[0].actor.id).items.filter(i => i.type === 'spell' && i.system.level === 0).map(i => i.id));
      const shown = await root.locator('.bg3-video-hud-panel').nth(2).locator('li').evaluateAll(nodes => nodes.map(n => n.dataset.itemId));
      // Fixture layouts must begin without hidden/pinned-only spells.
      expect(shown.sort()).toEqual(spellIds.sort());
      await click(root.locator('[data-action="filter-level"][data-value="all"]'));
      await click(root.locator('[data-action="edit"]'));
      const row = root.locator('.bg3-video-hud-panel').nth(2).locator('li').first();
      const itemId = await row.getAttribute('data-item-id');
      await click(row.locator('[data-action="visibility"]'));
      await expect(root.locator(`li[data-item-id="${itemId}"]`)).toHaveClass(/bg3-video-hud-item-hidden/);
      await click(root.locator('[data-action="edit"]'));
      await expect(root.locator(`li[data-item-id="${itemId}"]`)).toHaveCount(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready, undefined, { timeout: 60_000 });
      await guard(page, config);
      await select(page, config.tokens[0]);
      await expect(root.locator(`li[data-item-id="${itemId}"]`)).toHaveCount(0);
      await click(root.locator('[data-action="edit"]'));
      await click(root.locator(`li[data-item-id="${itemId}"] [data-action="visibility"]`));
      const panel = root.locator('.bg3-video-hud-panel').nth(2);
      const before = await panel.locator('li').evaluateAll(nodes => nodes.map(n => n.dataset.itemId));
      expect(before.length).toBeGreaterThanOrEqual(2);
      await live.check();
      await click(panel.locator('li').first().locator('[data-action="move"][data-direction="1"]'));
      await expect.poll(() => panel.locator('li').evaluateAll(nodes => nodes.map(n => n.dataset.itemId))).toEqual([before[1], before[0], ...before.slice(2)]);
      await click(root.locator('[data-action="edit"]'));
      verified(`${role}: cantrip filter, quickbar visibility persisted after reload, item ordering`);
      await click(root.locator('[data-action="disable"]'));
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
        await live.check();
        await restore(gm, config, snapshot);
        verified('Fixture HP, spell slots and both user layout flags restored and verified');
      }
    } finally {
      await playerContext.close();
      await gm.close();
    }
  }
}
