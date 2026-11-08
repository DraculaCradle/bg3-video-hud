import test from 'node:test';
import assert from 'node:assert/strict';
import { actor, item } from './fixtures.js';
import { activationTypes, actorStats, canUseActor, groupFor, itemsFor, normalizeLayout,
  reorder, selectActor, slotPools, spellLevels, toggleId, usesLabel } from '../scripts/model.js';

test('taxonomy includes all owned equipment, features and spells with stable IDs', () => {
  const items = [item('blade', 'weapon'), item('armor', 'equipment'), item('bag', 'container'), item('feat'), item('light', 'spell')];
  const hero = actor('a', items);
  assert.deepEqual(items.map(groupFor), ['Equipment', 'Equipment', 'Equipment', 'Features', 'Spells']);
  assert.deepEqual(new Set(itemsFor(hero, {}).map(i => i.id)), new Set(items.map(i => i.id)));
  assert.equal(itemsFor(actor('a', [item(null)]), {}).length, 0);
});

test('character records never enter combat groups or edit mode, including pinned and ordered legacy entries', () => {
  const records = ['class', 'subclass', 'background', 'race', 'species', 'facility', 'unknown'].map(type => item(type, type));
  const hero = actor('a', records);
  const prefs = { order: records.map(i => i.id), pinned: records.map(i => i.id), pinnedOnly: true };
  const before = structuredClone({ items: [...hero.items.values()], prefs });
  assert.deepEqual(records.map(groupFor), records.map(() => null));
  assert.equal(groupFor(null), null);
  for (const options of [{}, { edit: true }, { level: 0 }, { action: 'action' }]) {
    assert.deepEqual(itemsFor(hero, prefs, options), []);
  }
  assert.deepEqual({ items: [...hero.items.values()], prefs }, before);
});

test('racial and background granted feats stay visible along with ordinary inventory, regardless of names', () => {
  const gear = ['weapon', 'equipment', 'consumable', 'tool', 'loot', 'container'].map(type => item(type, type));
  const feats = [item('racial-action', 'feat', { activation: { type: 'action' } }, { name: '精灵' }),
    item('background-passive', 'feat', {}, { name: '农民' })];
  const hero = actor('a', [...gear, ...feats, item('background', 'background', {}, { name: '农民' })]);
  assert.deepEqual(gear.map(groupFor), gear.map(() => 'Equipment'));
  assert.deepEqual(feats.map(groupFor), ['Features', 'Features']);
  assert.deepEqual(new Set(itemsFor(hero, {}).map(i => i.id)), new Set([...gear, ...feats].map(i => i.id)));
  assert.deepEqual(itemsFor(hero, {}, { action: 'action' }).map(i => i.id), ['racial-action']);
});

test('custom order wins over system sort and does not mutate actor items', () => {
  const hero = actor('a', [item('z', 'feat', {}, { sort: 1 }), item('a', 'feat', {}, { sort: 2 }), item('b')]);
  const before = [...hero.items.values()];
  assert.deepEqual(itemsFor(hero, { order: ['a', 'z'] }).map(i => i.id), ['a', 'z', 'b']);
  assert.deepEqual([...hero.items.values()], before);
});

test('hidden/pinned/level filters compose and edit mode exposes every item', () => {
  const hero = actor('a', [item('blade', 'weapon'), item('light', 'spell', { level: 0 }), item('hex', 'spell', { level: 1 })]);
  const prefs = { hidden: ['blade'], pinned: ['light'], pinnedOnly: true };
  assert.deepEqual(itemsFor(hero, prefs, { level: 0 }).map(i => i.id), ['light']);
  assert.deepEqual(itemsFor(hero, prefs, { level: 1 }), []);
  assert.equal(itemsFor(hero, prefs, { edit: true, level: 9, action: 'reaction' }).length, 3);
});

test('action filters recognize all activities, not only the first', () => {
  const versatile = item('versatile', 'feat', { activities: new Map([
    ['a', { activation: { type: 'action' } }], ['b', { activation: { type: 'reaction' } }]
  ]) });
  assert.deepEqual(activationTypes(versatile), ['action', 'reaction']);
  assert.deepEqual(itemsFor(actor('a', [versatile, item('passive')]), {}, { action: 'reaction' }).map(i => i.id), ['versatile']);
});

test('reorder handles missing IDs, deduplicates and moves relative to target', () => {
  assert.deepEqual(reorder(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(reorder(['a', 'b', 'c'], 'a', 'c'), ['b', 'a', 'c']);
  assert.deepEqual(reorder(['a', 'a', 'b'], 'unknown', 'a'), ['a', 'b']);
  assert.deepEqual(toggleId(['a'], 'a'), []);
  assert.deepEqual(toggleId([], 'b'), ['b']);
});

test('malformed stored preferences are safely normalized', () => {
  assert.deepEqual(normalizeLayout(null), { version: 1, order: [], hidden: [], pinned: [], pinnedOnly: false });
  assert.deepEqual(normalizeLayout({ order: ['a', 'a', 1, ''], hidden: {}, pinnedOnly: 'yes' }).order, ['a']);
});

test('actor selection respects player ownership, GM permissions and missing canvas', () => {
  const hero = actor(), enemy = actor('enemy', [], { isOwner: false });
  const user = { character: hero };
  assert.equal(selectActor([], user), hero);
  assert.equal(selectActor([{ actor: enemy }], user), null);
  assert.equal(selectActor([{ actor: null }, { actor: hero }], user), hero);
  assert.equal(selectActor([], user, false), null);
  assert.equal(canUseActor(null, user), false);
  const privileged = actor('privileged', [], { testUserPermission: (u, p) => u.isGM && p === 'OWNER' });
  assert.equal(canUseActor(privileged, { isGM: true }), true);
  assert.equal(canUseActor(privileged, user), false);
});

test('HP/AC/resources tolerate missing attributes and preserve zero', () => {
  assert.deepEqual(actorStats(null), { hp: '—', maxHp: '—', tempHp: 0, ac: '—', resources: [] });
  assert.equal(actorStats(actor('a', [], { system: { attributes: { hp: { value: 0, max: 12 }, ac: { value: 0 } } } })).hp, 0);
});

test('slot pools display depleted regular slots and pact slots separately', () => {
  const hero = actor('a', [item('light', 'spell', { level: 0 })], { system: { spells: {
    spell1: { value: 0, max: 4 }, spell2: { value: 2, max: 3 },
    spell3: { value: 0, max: 0 }, pact: { level: 3, value: 1, max: 2 }
  } } });
  const pools = slotPools(hero);
  assert.deepEqual(pools.map(p => p.key), ['spell1', 'spell2', 'pact']);
  assert.equal(pools[0].value, 0);
  assert.equal(pools[2].label, '契约3环');
  assert.deepEqual(spellLevels(hero), [0, 1, 2, 3]);
  assert.deepEqual(slotPools(null), []);
  assert.deepEqual(spellLevels(null), [0]);
});

test('spell tabs include known high-level spells even without slots', () => {
  assert.deepEqual(spellLevels(actor('a', [item('wish', 'spell', { level: 9 })])), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('limited uses read modern spent and legacy value without consumption', () => {
  const feature = item('feature', 'feat', { uses: { spent: 1, max: 3 } });
  assert.equal(usesLabel(feature), '2/3 次');
  assert.equal(feature.system.uses.spent, 1);
  assert.equal(usesLabel(item('x', 'feat', { uses: { value: 0, max: 2 } })), '0/2 次');
  assert.equal(usesLabel(item('x')), '');
});
