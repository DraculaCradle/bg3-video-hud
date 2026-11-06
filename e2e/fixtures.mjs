import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { GuardError } from './live-guard.mjs';

function persist(path, value) {
  const temporary = path + '.tmp';
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  const file = openSync(temporary, 'r');
  try { fsyncSync(file); } finally { closeSync(file); }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

// These functions execute in the authenticated Foundry client, never on a
// world database or compendium file. Only system-owned SRD packs are read.
export async function createDocuments({ lease }) {
  let phase = 'source-selection';
  const moduleId = 'bg3-video-hud';
  const progress = async value => {
    phase = value;
    if (typeof globalThis.bg3FixtureProgress === 'function') {
      await globalThis.bg3FixtureProgress({ marker: lease.marker, phase });
    }
  };
  const readSource = async promise => {
    let timer;
    try {
      return await Promise.race([promise,
        new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Error('fixture-source-read-timeout')), 30_000); })]);
    } finally { clearTimeout(timer); }
  };
  const assertSafe = () => {
    if (!game.user.isGM || game.user.name !== 'Gamemaster' || game.world.id !== lease.world
        || game.world.title !== 'ModsTest' || !game.socket.connected
        || game.users.some(u => u.active && !['Gamemaster', 'Player1'].includes(u.name))) throw Error('fixture-guard-denied');
  };
  try {
    assertSafe();
    const player = game.users.find(u => u.name === 'Player1');
    if (!player || player.isGM) throw Error('fixture-player-unavailable');
    const packs = [...game.packs.values()].filter(p => p.documentName === 'Actor' && p.collection.startsWith('dnd5e.'));
    if (!packs.length) throw Error('fixture-srd-actor-pack-unavailable');
    let caster, martial, fallback;
    for (const pack of packs) {
      await progress('actor-pack-index');
      const index = [...(await readSource(pack.getIndex())).values()];
      const prioritized = index.sort((a, b) => Number(/mage|priest|acolyte|druid|wizard|guard|bandit/i.test(b.name))
        - Number(/mage|priest|acolyte|druid|wizard|guard|bandit/i.test(a.name)));
      for (const entry of prioritized.slice(0, 50)) {
        await progress('actor-source-document');
        const actor = await readSource(pack.getDocument(entry._id));
        if (!(actor?.system?.attributes?.hp?.max > 0) || actor.items.size < 2) continue;
        const choice = { pack: pack.collection, id: actor.id };
        fallback ??= choice;
        if (!caster && ((actor.system.spells?.spell1?.max ?? 0) > 0 || /mage|priest|acolyte|druid|wizard/i.test(actor.name))) caster = choice;
        if (!martial && /guard|bandit|fighter|warrior/i.test(actor.name)) martial = choice;
        if (caster && martial && (caster.pack !== martial.pack || caster.id !== martial.id)) break;
      }
      if (caster && martial && (caster.pack !== martial.pack || caster.id !== martial.id)) break;
    }
    caster ??= fallback;
    if (!caster) throw Error('fixture-srd-actors-unsuitable');
    martial ??= fallback; // Distinct world documents are created even from one source profile.
    const spellPacks = [...game.packs.values()].filter(p => p.documentName === 'Item' && p.collection.startsWith('dnd5e.'));
    const spells = [];
    for (const level of [0, 1]) {
      let spell;
      for (const pack of spellPacks) {
        await progress('spell-pack-index');
        const index = [...(await readSource(pack.getIndex({ fields: ['type', 'system.level'] }))).values()];
        const entry = index.find(i => i.type === 'spell' && Number(i.system?.level ?? i['system.level']) === level);
        if (entry) { await progress('spell-source-document'); spell = await readSource(pack.getDocument(entry._id)); break; }
      }
      if (!spell) throw Error('fixture-srd-spells-unavailable');
      spells.push(spell.toObject());
    }
    const actors = [];
    for (const [position, source] of [caster, martial].entries()) {
      await progress('actor-import');
      assertSafe();
      const role = position === 0 ? 'caster' : 'martial';
      const actor = await game.actors.importFromCompendium(game.packs.get(source.pack), source.id, {
        name: `BG3 HUD Test ${role} ${lease.marker.slice(-6)}`, folder: null,
        flags: { [moduleId]: { testFixture: { marker: lease.marker, role } } }
      }, { keepId: false, renderSheet: false });
      if (actor.getFlag(moduleId, 'testFixture')?.marker !== lease.marker) throw Error('fixture-import-marker-missing');
      // V14 clears source ownership during import and grants the importer OWNER.
      // Grant Player1 only after the uniquely marked world actor exists.
      await progress('actor-ownership');
      assertSafe();
      await actor.update({ [`ownership.${player.id}`]: 3 });
      if (actor.ownership[player.id] !== 3) throw Error('fixture-player-ownership-failed');
      actors.push(actor);
    }
    await progress('spell-fixture-setup');
    const additions = spells.filter(spell => !actors[0].items.some(i => i.type === 'spell' && i.system.level === spell.system.level));
    if (additions.length) {
      assertSafe();
      await actors[0].createEmbeddedDocuments('Item', additions.map(item => { const copy = foundry.utils.deepClone(item); delete copy._id; return copy; }));
    }
    // This initializes only a disposable fixture's display resources. It is not
    // spell consumption and never changes a real actor or system-use workflow.
    if (!(actors[0].system.spells?.spell1?.max > 0)) {
      assertSafe();
      await actors[0].update({ 'system.spells.spell1.override': 2, 'system.spells.spell1.max': 2, 'system.spells.spell1.value': 2 });
    }
    if (!(actors[0].system.spells?.spell1?.max > 0)) throw Error('fixture-slot-setup-unsupported');
    await progress('scene-setup');
    let scene = game.scenes.active;
    if (!scene) {
      assertSafe();
      scene = await CONFIG.Scene.documentClass.create({ name: `BG3 HUD Test ${lease.marker.slice(-6)}`,
        width: 2000, height: 1200, tokenVision: false, active: false,
        flags: { [moduleId]: { testFixture: { marker: lease.marker, role: 'scene' } } }
      }, { renderSheet: false });
      assertSafe();
      await scene.activate();
    }
    await progress('token-placement');
    const placed = [...scene.tokens.values()].map(t => ({ x: t.x, y: t.y, width: t.width, height: t.height }));
    const size = scene.grid.size || 100;
    const originX = scene.dimensions?.sceneX ?? 0, originY = scene.dimensions?.sceneY ?? 0;
    const tokenIds = [];
    for (const [index, actor] of actors.entries()) {
      assertSafe();
      const token = await actor.getTokenDocument({ actorLink: true, hidden: false });
      const data = token.toObject();
      delete data._id;
      const width = data.width || 1, height = data.height || 1;
      let position;
      for (let y = originY + size; y + height * size <= originY + scene.height && !position; y += size) {
        for (let x = originX + size; x + width * size <= originX + scene.width; x += size) {
          if (!placed.some(t => x < t.x + t.width * size && x + width * size > t.x && y < t.y + t.height * size && y + height * size > t.y)) {
            position = { x, y }; break;
          }
        }
      }
      if (!position) throw Error('fixture-scene-space-unavailable');
      data.actorId = actor.id; data.actorLink = true; data.hidden = false;
      Object.assign(data, position);
      data.sight = { ...data.sight, enabled: true, range: 30 };
      data.flags = { ...data.flags, [moduleId]: { testFixture: { marker: lease.marker, role: index ? 'martial' : 'caster' } } };
      const [created] = await scene.createEmbeddedDocuments('Token', [data]);
      tokenIds.push(created.id);
      placed.push({ ...position, width, height });
    }
    if (canvas.scene?.id !== scene.id) { assertSafe(); await scene.view(); }
    return { ok: true, tokens: tokenIds, scene: scene.id, sources: [caster.pack, martial.pack] };
  } catch (error) {
    const allowed = /^fixture-[a-z-]+$/;
    return { ok: false, reason: allowed.test(error.message) ? error.message : 'fixture-create-failed', phase };
  }
}

export async function removeDocuments({ lease }) {
  const moduleId = 'bg3-video-hud';
  const assertSafe = () => {
    if (!game.user.isGM || game.user.name !== 'Gamemaster' || game.world.id !== lease.world || game.world.title !== 'ModsTest' || !game.socket.connected
        || game.users.some(u => u.active && !['Gamemaster', 'Player1'].includes(u.name))) throw Error('fixture-cleanup-guard-denied');
  };
  assertSafe();
  const marked = document => document.getFlag(moduleId, 'testFixture')?.marker === lease.marker;
  const actors = [...game.actors.values()].filter(marked);
  const scenes = [...game.scenes.values()].filter(marked);
  const tokens = [...game.scenes.values()].flatMap(scene => [...scene.tokens.values()].filter(marked).map(token => ({ scene, token })));
  if (actors.length > 2 || scenes.length > 1 || tokens.length > 2) throw Error('fixture-cleanup-ambiguous');
  if (!Array.isArray(lease.users) || lease.users.length !== 2 || new Set(lease.users.map(u => u.id)).size !== 2) throw Error('fixture-cleanup-user-mismatch');
  for (const saved of lease.users) {
    const user = game.users.get(saved.id);
    if (!user || !['Gamemaster', 'Player1'].includes(user.name)) throw Error('fixture-cleanup-user-mismatch');
  }
  for (const actor of actors) {
    if (!['caster', 'martial'].includes(actor.getFlag(moduleId, 'testFixture').role)) throw Error('fixture-cleanup-ambiguous');
  }
  if (new Set(actors.map(a => a.getFlag(moduleId, 'testFixture').role)).size !== actors.length
      || new Set(tokens.map(({ token }) => token.getFlag(moduleId, 'testFixture').role)).size !== tokens.length
      || scenes.some(s => s.getFlag(moduleId, 'testFixture').role !== 'scene')) throw Error('fixture-cleanup-ambiguous');
  for (const scene of game.scenes.values()) {
    if ([...scene.tokens.values()].some(t => actors.some(a => a.id === t.actorId) && !marked(t))) throw Error('fixture-has-foreign-token-reference');
  }
  for (const { scene, token } of tokens) { assertSafe(); await scene.deleteEmbeddedDocuments('Token', [token.id]); }
  for (const actor of actors) { assertSafe(); await actor.delete(); }
  for (const scene of scenes) {
    assertSafe();
    if (scene.active) await scene.update({ active: false });
    assertSafe(); await scene.delete();
  }
  for (const saved of lease.users) {
    assertSafe();
    const user = game.users.get(saved.id);
    if (!user || !['Gamemaster', 'Player1'].includes(user.name)) throw Error('fixture-cleanup-user-mismatch');
    if (JSON.stringify(user.getFlag(moduleId, 'layouts') ?? null) !== JSON.stringify(saved.layouts)) {
      await user.unsetFlag(moduleId, 'layouts');
      if (saved.layouts !== null) { assertSafe(); await user.setFlag(moduleId, 'layouts', saved.layouts); }
    }
    if (JSON.stringify(user.getFlag(moduleId, 'layouts') ?? null) !== JSON.stringify(saved.layouts)) throw Error('fixture-layout-cleanup-failed');
  }
  if ([...game.actors.values(), ...game.scenes.values()].some(marked)
      || [...game.scenes.values()].some(s => [...s.tokens.values()].some(marked))) throw Error('fixture-cleanup-incomplete');
  return { removed: true };
}

export async function recoverCreatedFixtures(live, restoreSnapshot) {
  const path = live.config.fixtureJournal;
  if (!existsSync(path)) return;
  await live.check();
  const lease = JSON.parse(readFileSync(path, 'utf8'));
  if (lease.world !== live.config.world || !/^bg3-hud-test:[a-f0-9-]{36}$/.test(lease.marker)) throw new GuardError('blocked', 'foreign-fixture-journal');
  const documents = await live.gm.evaluate(({ lease }) => ({
    actors: [...game.actors.values()].filter(a => a.getFlag('bg3-video-hud', 'testFixture')?.marker === lease.marker).map(a => a.id),
    tokens: [...game.scenes.values()].flatMap(s => [...s.tokens.values()].filter(t => t.getFlag('bg3-video-hud', 'testFixture')?.marker === lease.marker).map(t => t.id))
  }), { lease });
  let discardCompletedSnapshot = false;
  if (existsSync(live.config.journal) && documents.actors.length === 2 && documents.tokens.length === 2) {
    live.config.tokens = await live.gm.evaluate(({ lease }) => {
      const scene = game.scenes.get(lease.scene);
      if (!scene || canvas.scene?.id !== scene.id) throw Error('fixture-recovery-scene-not-viewed');
      return ['caster', 'martial'].map(role => [...scene.tokens.values()].find(t => {
        const flag = t.getFlag('bg3-video-hud', 'testFixture'); return flag?.marker === lease.marker && flag.role === role;
      })?.id);
    }, { lease });
    await restoreSnapshot(live);
  }
  else if (existsSync(live.config.journal) && (documents.actors.length || documents.tokens.length)) {
    throw new GuardError('blocked', 'fixture-partial-recovery-needs-review');
  }
  else if (existsSync(live.config.journal)) {
    // Only a prior cleanup that recorded its deletion phase can explain absent
    // documents. An external deletion is never silently treated as recovery.
    if (lease.phase !== 'deleting') throw new GuardError('blocked', 'fixture-documents-missing-before-cleanup');
    discardCompletedSnapshot = true;
  }
  await live.check();
  persist(path, { ...lease, phase: 'deleting' });
  await live.gm.evaluate(removeDocuments, { lease });
  if (discardCompletedSnapshot) unlinkSync(live.config.journal);
  unlinkSync(path);
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export async function prepareCreatedFixtures(live, info) {
  await live.check();
  const lease = { world: live.config.world, marker: `bg3-hud-test:${randomUUID()}`,
    users: await live.gm.evaluate(() => ['Gamemaster', 'Player1'].map(name => {
      const user = game.users.find(u => u.name === name);
      return { id: user.id, layouts: user.getFlag('bg3-video-hud', 'layouts') ?? null };
    })) };
  persist(live.config.fixtureJournal, lease); // Durable intent precedes the first document write.
  let lastPhase;
  const phases = new Set(['actor-pack-index', 'actor-source-document', 'spell-pack-index', 'spell-source-document',
    'actor-import', 'actor-ownership', 'spell-fixture-setup', 'scene-setup', 'token-placement']);
  await live.gm.exposeBinding('bg3FixtureProgress', async (_source, update) => {
    if (update.marker !== lease.marker || !phases.has(update.phase)) throw Error('Invalid fixture progress');
    if (lastPhase === update.phase) return;
    lastPhase = update.phase;
    persist(live.config.fixtureJournal, { ...lease, phase: update.phase });
    info.annotations.push({ type: 'stage', description: `Prepare temporary SRD fixtures: ${update.phase}` });
  });
  const result = await live.gm.evaluate(createDocuments, { lease });
  if (!result.ok) throw new GuardError('blocked', `${result.reason}:${result.phase}`);
  live.config.tokens = result.tokens;
  persist(live.config.fixtureJournal, { ...lease, scene: result.scene });
  await live.gm.waitForFunction(id => globalThis.canvas?.ready && canvas.scene?.id === id, result.scene, { timeout: 30_000 });
  info.annotations.push({ type: 'verified', description: 'Two temporary actors imported from existing D&D5e SRD packs; Player1 ownership and linked tokens created' });
}

export async function recoverOnlyFixtures(live, restoreSnapshot) {
  await recoverCreatedFixtures(live, restoreSnapshot);
  await live.check();
  if (existsSync(live.config.journal)) {
    if (live.config.tokens?.length !== 2) throw new GuardError('blocked', 'recovery-token-metadata-required');
    await restoreSnapshot(live);
  }
  if (existsSync(live.config.journal) || existsSync(live.config.fixtureJournal)) {
    throw new GuardError('blocked', 'fixture-recovery-incomplete');
  }
}
