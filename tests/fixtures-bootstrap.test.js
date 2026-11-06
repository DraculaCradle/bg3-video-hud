import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocuments, removeDocuments, recoverCreatedFixtures, recoverOnlyFixtures } from '../e2e/fixtures.mjs';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleId = 'bg3-video-hud';
function setup(t, { noScene = false, failImport = 0, failToken = 0 } = {}) {
  const prior = Object.fromEntries(['game', 'canvas', 'CONFIG', 'foundry'].map(key => [key, globalThis[key]]));
  t.after(() => { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const users = [{ id: 'gm', name: 'Gamemaster', isGM: true, active: true }, { id: 'pc', name: 'Player1', isGM: false, active: false }];
  for (const user of users) {
    user.layouts = null;
    user.getFlag = () => user.layouts;
    user.unsetFlag = async () => { user.layouts = null; };
    user.setFlag = async (_module, _key, value) => { user.layouts = value; };
  }
  users.get = id => users.find(u => u.id === id);
  const actors = new Map(), scenes = new Map(), writes = [];
  let imports = 0, tokenWrites = 0;
  const withFlags = document => ({ ...document, getFlag: (_module, key) => document.flags?.[moduleId]?.[key] });
  function scene(data) {
    const result = withFlags({ id: data.id, width: 1000, height: 1000, dimensions: { sceneX: 0, sceneY: 0 }, grid: { size: 100 }, ...data });
    result.tokens = new Map();
    result.createEmbeddedDocuments = async (_type, [data]) => {
      if (++tokenWrites === failToken) throw Error('injected token failure');
      const token = withFlags({ ...data, id: `token${tokenWrites}` });
      result.tokens.set(token.id, token); writes.push(`create-token:${token.id}`); return [token];
    };
    result.deleteEmbeddedDocuments = async (_type, ids) => { for (const id of ids) { result.tokens.delete(id); writes.push(`delete-token:${id}`); } };
    result.activate = async () => { scenes.active = result; result.active = true; globalThis.canvas.scene = result; };
    result.view = async () => { globalThis.canvas.scene = result; };
    result.update = async update => { if (update.active === false) { result.active = false; if (scenes.active === result) scenes.active = null; } };
    result.delete = async () => { scenes.delete(result.id); writes.push(`delete-scene:${result.id}`); };
    scenes.set(result.id, result); return result;
  }
  const original = scene({ id: 'original', active: !noScene });
  original.tokens.set('original-token', withFlags({ id: 'original-token', actorId: 'original-actor', x: 100, y: 100, width: 1, height: 1 }));
  scenes.active = noScene ? null : original;
  actors.set('original-actor', withFlags({ id: 'original-actor', name: 'Untouched' }));
  const source = (id, name, caster = false) => ({ id, name, system: { attributes: { hp: { max: 20 } }, spells: caster ? { spell1: { max: 2, value: 2 } } : {} },
    items: new Map([['a', { type: 'spell', system: { level: 0 } }], ['b', { type: 'spell', system: { level: 1 } }]]) });
  const sources = [source('mage', 'Mage', true), source('guard', 'Guard')];
  const actorPack = { collection: 'dnd5e.monsters', documentName: 'Actor', getIndex: async () => sources.map(s => ({ _id: s.id, name: s.name })), getDocument: async id => sources.find(s => s.id === id) };
  const spellPack = { collection: 'dnd5e.spells', documentName: 'Item', getIndex: async () => [0, 1].map(level => ({ _id: String(level), type: 'spell', system: { level } })),
    getDocument: async id => ({ toObject: () => ({ _id: id, type: 'spell', system: { level: Number(id) } }) }) };
  actors.importFromCompendium = async (_pack, id, update) => {
    if (++imports === failImport) throw Error('injected import failure');
    const actor = withFlags({ ...source(id, update.name, id === 'mage'), ...update, id: `actor${imports}`,
      ownership: { default: 0, gm: 3 } }); // V14's default clearOwnership import behavior.
    actor.items.some = callback => [...actor.items.values()].some(callback);
    actor.delete = async () => { actors.delete(actor.id); writes.push(`delete-actor:${actor.id}`); };
    actor.getTokenDocument = async () => ({ toObject: () => ({ width: 1, height: 1 }) });
    actor.createEmbeddedDocuments = async () => {};
    actor.update = async update => {
      for (const [key, value] of Object.entries(update)) {
        const parts = key.split('.'); let target = actor;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts.at(-1)] = value;
      }
    };
    actors.set(actor.id, actor); writes.push(`import:${actor.id}`); return actor;
  };
  globalThis.game = { world: { id: 'modstest', title: 'ModsTest' }, user: users[0], users, socket: { connected: true }, actors, scenes,
    packs: new Map([[actorPack.collection, actorPack], [spellPack.collection, spellPack]]) };
  globalThis.canvas = { ready: true, scene: noScene ? null : original };
  globalThis.CONFIG = { Scene: { documentClass: { create: async data => { const created = scene({ ...data, id: 'temporary' }); writes.push('create-scene'); return created; } } } };
  globalThis.foundry = { utils: { deepClone: value => structuredClone(value) } };
  const lease = { marker: 'bg3-hud-test:00000000-0000-4000-8000-000000000000', world: 'modstest', users: users.map(u => ({ id: u.id, layouts: null })) };
  return { actors, scenes, original, writes, lease };
}

test('SRD imports create two owned linked tokens without moving the existing token', async t => {
  const s = setup(t); const result = await createDocuments({ lease: s.lease });
  assert.equal(result.ok, true); assert.equal(result.tokens.length, 2);
  for (const actor of [...s.actors.values()].filter(a => a.id !== 'original-actor')) assert.equal(actor.ownership.pc, 3);
  for (const id of result.tokens) assert.equal(s.original.tokens.get(id).actorLink, true);
  assert.equal(s.original.tokens.get('original-token').x, 100);
  await removeDocuments({ lease: s.lease });
  assert.deepEqual([...s.actors.keys()], ['original-actor']);
  assert.deepEqual([...s.original.tokens.keys()], ['original-token']);
});
test('a partial native import is recoverable using only the unique fixture marker', async t => {
  const s = setup(t, { failImport: 2 });
  const result = await createDocuments({ lease: s.lease });
  assert.equal(result.ok, false); assert.equal(result.phase, 'actor-import');
  assert.equal(s.actors.size, 2);
  await removeDocuments({ lease: s.lease });
  assert.deepEqual([...s.actors.keys()], ['original-actor']);
});
test('a partial token creation is cleaned without deleting existing scene contents', async t => {
  const s = setup(t, { failToken: 2 });
  const result = await createDocuments({ lease: s.lease });
  assert.equal(result.ok, false); assert.equal(result.phase, 'token-placement');
  assert.equal(s.original.tokens.size, 2);
  await removeDocuments({ lease: s.lease });
  assert.deepEqual([...s.original.tokens.keys()], ['original-token']);
  assert.deepEqual([...s.actors.keys()], ['original-actor']);
});
test('absence of an active scene creates and removes only a marked temporary scene', async t => {
  const s = setup(t, { noScene: true });
  assert.equal((await createDocuments({ lease: s.lease })).ok, true);
  assert.equal(s.scenes.active.id, 'temporary');
  await removeDocuments({ lease: s.lease });
  assert.equal(s.scenes.active, null); assert.deepEqual([...s.scenes.keys()], ['original']);
});
test('foreign token references block cleanup before any deletion', async t => {
  const s = setup(t); await createDocuments({ lease: s.lease });
  s.original.tokens.set('user-copy', { actorId: 'actor1', getFlag: () => undefined });
  const previous = s.writes.length;
  await assert.rejects(removeDocuments({ lease: s.lease }), /foreign-token-reference/);
  assert.equal(s.writes.length, previous);
});
test('invalid saved users are rejected before deleting marked fixtures', async t => {
  const s = setup(t); await createDocuments({ lease: s.lease }); const previous = s.writes.length;
  await assert.rejects(removeDocuments({ lease: { ...s.lease, users: [] } }), /user-mismatch/);
  assert.equal(s.writes.length, previous);
});
test('cleanup is idempotent after an interrupted already-completed deletion', async t => {
  const s = setup(t); await createDocuments({ lease: s.lease });
  await removeDocuments({ lease: s.lease }); await removeDocuments({ lease: s.lease });
  assert.deepEqual([...s.actors.keys()], ['original-actor']);
});
test('a different world or a non-test session prevents all fixture writes', async t => {
  const s = setup(t); game.world.id = 'campaign';
  assert.equal((await createDocuments({ lease: s.lease })).reason, 'fixture-guard-denied');
  assert.equal(s.writes.length, 0);
});
test('missing rulebook packs fail without creating homemade replacement actors', async t => {
  const s = setup(t); game.packs.clear();
  assert.equal((await createDocuments({ lease: s.lease })).reason, 'fixture-srd-actor-pack-unavailable');
  assert.equal(s.writes.length, 0);
});
test('a stalled source index times out before importing or mutating world documents', async t => {
  const s = setup(t);
  game.packs.get('dnd5e.monsters').getIndex = () => new Promise(() => {});
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => schedule(callback, delay === 30_000 ? 1 : delay));
  const result = await createDocuments({ lease: s.lease });
  assert.deepEqual(result, { ok: false, reason: 'fixture-source-read-timeout', phase: 'actor-pack-index' });
  assert.equal(s.writes.length, 0);
  assert.deepEqual([...s.actors.keys()], ['original-actor']);
});

function recovery(t, state, lease) {
  const directory = mkdtempSync(join(tmpdir(), 'bg3-fixture-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = { world: 'modstest', fixtureJournal: join(directory, 'fixtures.json'), journal: join(directory, 'snapshot.json') };
  writeFileSync(config.fixtureJournal, JSON.stringify(lease), { mode: 0o600 });
  return { config, check: async () => {}, gm: { evaluate: async (fn, args) => fn(args) } };
}
test('an interruption after the first token deletion resumes only the marked cleanup', async t => {
  const s = setup(t); const result = await createDocuments({ lease: s.lease });
  const live = recovery(t, s, { ...s.lease, scene: result.scene });
  const original = s.original.deleteEmbeddedDocuments;
  let once = true;
  s.original.deleteEmbeddedDocuments = async (...args) => {
    await original(...args);
    if (once) { once = false; throw Error('simulated process interruption'); }
  };
  await assert.rejects(recoverCreatedFixtures(live, async () => {}), /interruption/);
  assert.equal(JSON.parse(readFileSync(live.config.fixtureJournal)).phase, 'deleting');
  await recoverCreatedFixtures(live, async () => {});
  assert.equal(existsSync(live.config.fixtureJournal), false);
  assert.deepEqual([...s.actors.keys()], ['original-actor']);
});
test('a completed deletion can restore saved layouts and clear a retained snapshot', async t => {
  const s = setup(t);
  const live = recovery(t, s, { ...s.lease, phase: 'deleting' });
  game.users[0].layouts = { temporary: { order: ['fixture'] } };
  writeFileSync(live.config.journal, '{}');
  await recoverCreatedFixtures(live, async () => assert.fail('deleted actors cannot be restored'));
  assert.equal(game.users[0].layouts, null);
  assert.equal(existsSync(live.config.journal), false);
  assert.equal(existsSync(live.config.fixtureJournal), false);
});
test('unexplained missing fixture actors never discard an existing recovery snapshot', async t => {
  const s = setup(t);
  const live = recovery(t, s, s.lease);
  writeFileSync(live.config.journal, '{}');
  await assert.rejects(recoverCreatedFixtures(live, async () => {}), /fixture-documents-missing/);
  assert.equal(existsSync(live.config.journal), true);
  assert.equal(existsSync(live.config.fixtureJournal), true);
});
test('a foreign-world fixture journal cannot delete any current-world documents', async t => {
  const s = setup(t); await createDocuments({ lease: s.lease });
  const live = recovery(t, s, { ...s.lease, world: 'campaign' });
  const previous = s.writes.length;
  await assert.rejects(recoverCreatedFixtures(live, async () => {}), /foreign-fixture-journal/);
  assert.equal(s.writes.length, previous);
});
test('normal recovery restores the actor snapshot before removing temporary documents', async t => {
  const s = setup(t); const result = await createDocuments({ lease: s.lease });
  const live = recovery(t, s, { ...s.lease, scene: result.scene });
  writeFileSync(live.config.journal, '{}');
  let restored = false;
  await recoverCreatedFixtures(live, async context => {
    assert.equal(s.actors.size, 3);
    assert.deepEqual(context.config.tokens, result.tokens);
    unlinkSync(context.config.journal); restored = true;
  });
  assert.equal(restored, true);
  assert.deepEqual([...s.actors.keys()], ['original-actor']);
});
test('recovery-only removes a partial import without creating replacement documents', async t => {
  const s = setup(t, { failImport: 2 });
  await createDocuments({ lease: s.lease });
  const live = recovery(t, s, s.lease);
  const before = s.writes.length;
  await recoverOnlyFixtures(live, async () => assert.fail('no actor snapshot exists'));
  assert.deepEqual([...s.actors.keys()], ['original-actor']);
  assert.ok(s.writes.slice(before).every(write => write.startsWith('delete-')));
  assert.equal(existsSync(live.config.fixtureJournal), false);
  assert.equal(existsSync(live.config.journal), false);
});
test('recovery-only preserves an unmarked actor snapshot when token metadata is missing', async t => {
  const s = setup(t), live = recovery(t, s, s.lease);
  unlinkSync(live.config.fixtureJournal);
  writeFileSync(live.config.journal, '{}');
  await assert.rejects(recoverOnlyFixtures(live, async () => assert.fail('must not guess actors')),
    error => error.reason === 'recovery-token-metadata-required');
  assert.equal(existsSync(live.config.journal), true);
  assert.equal(s.writes.length, 0);
});
