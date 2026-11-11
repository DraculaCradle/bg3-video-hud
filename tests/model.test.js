import test from 'node:test';
import assert from 'node:assert/strict';
import { actor, item } from './fixtures.js';
import { activationTypes, actorStats, canUseActor, groupFor, itemsFor, normalizeLayout,
  reorder, selectActor, slotPools, spellLevels, toggleId, usesLabel, autoColumnWidths } from '../scripts/model.js';

test('four combat groups separate weapons and active items; passive inventory never enters editing', () => {
  const items = [item('blade', 'weapon'), item('armor', 'equipment'), item('bag', 'container'),
    item('potion', 'consumable', { activities: [{ type: 'heal', activation: { type: 'action' } }] }),
    item('feat'), item('light', 'spell')];
  const hero = actor('a', items);
  assert.deepEqual(items.map(groupFor), ['Weapons', null, null, 'Items', 'Features', 'Spells']);
  for (const edit of [false, true]) assert.deepEqual(new Set(itemsFor(hero, {}, { edit }).map(i => i.id)),
    new Set(['blade', 'potion', 'feat', 'light']));
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

test('only active granted feats remain visible and filtering never guesses from translated names', () => {
  const feats = [item('racial-action', 'feat', { activation: { type: 'action' } }, { name: '精灵' }),
    item('background-passive', 'feat', { activation: { type: '' } }, { name: '农民' })];
  const hero = actor('a', [...feats, item('background', 'background', {}, { name: '农民' })]);
  assert.deepEqual(feats.map(groupFor), ['Features', null]);
  assert.deepEqual(itemsFor(hero, {}).map(i => i.id), ['racial-action']);
});

test('native free actions, reactions, linked spells and depleted active items remain while ammo and helpers are excluded', () => {
  const active = type => ({ activation: { type } });
  for (const type of ['action', 'bonus', 'reactiondamage', 'none', 'special', 'minute', 'legendary']) {
    assert.equal(groupFor(item(type, 'feat', { activities: [active(type)] })), 'Features');
  }
  const raw = [item('shield', 'equipment'), item('gem', 'loot'), item('paper', 'loot'),
    item('passive', 'feat', { activities: [active('')] }),
    item('ammo', 'consumable', { type: { value: 'ammo' }, activities: [active('action')] }),
    item('auto', 'feat', { activities: [{ ...active('action'), midiProperties: { automationOnly: true } }] }),
    item('hidden', 'feat', { activities: [{ ...active('action'), isHidden: true }] })];
  assert.deepEqual(raw.map(groupFor), raw.map(() => null));
  assert.equal(groupFor(item('scroll', 'consumable', { activities: [{ type: 'cast' }] })), 'Items');
  assert.equal(groupFor(item('charged', 'equipment', { activities: [active('action')], uses: { max: 1, spent: 1 } })), 'Items');
  assert.equal(groupFor(item('mixed', 'feat', { activities: [active(''), active('bonus')] })), 'Features');
  const cpr = item('cpr', 'feat', { activities: [{ id: 'helper', ...active('action') }] },
    { flags: { 'chris-premades': { hiddenActivities: ['helperKey'], activityIdentifiers: { helperKey: 'helper' } } } });
  assert.equal(groupFor(cpr), null);
});

test('automatic widths reserve full icon columns and give the crowded category most space', () => {
  const geometry = { width: 1150, cell: 50, gap: 6, frame: [20, 20, 20, 20], rows: 2 };
  const spells = autoColumnWidths([4, 4, 4, 40], geometry);
  assert.deepEqual(spells.columns.slice(0, 3), [2, 2, 2]);
  assert.ok(spells.widths[3] > spells.widths[0] * 2);
  const items = autoColumnWidths([4, 40, 4, 4], geometry);
  assert.equal(items.widths[1], spells.widths[3]); assert.equal(items.widths[3], spells.widths[1]);
  assert.ok(Math.abs(spells.used - geometry.width) < 1e-8);
  for (let i = 0; i < 4; i++) assert.ok(Math.abs(spells.widths[i] - (20 + spells.columns[i] * spells.cell + (spells.columns[i] - 1) * 6)) < 1e-8);
});

test('a header minimum reserves pact filter space without changing counts, uniform tiles or the fixed total', () => {
  const counts = [0, 120, 0, 1], original = [...counts];
  const options = { width: 800, cell: 50, gap: 4, frame: [20, 20, 20, 20] };
  assert.equal(autoColumnWidths(counts, options).columns[3], 1);
  const plan = autoColumnWidths(counts, { ...options, minimumColumns: [1, 1, 1, 2] });
  assert.ok(plan.columns[3] >= 2); assert.ok(Math.abs(plan.used - options.width) < 1e-8);
  plan.widths.forEach((w, i) => assert.ok(Math.abs(w - 20 - plan.columns[i] * plan.cell - (plan.columns[i] - 1) * 4) < 1e-8));
  assert.deepEqual(counts, original);
  assert.throws(() => autoColumnWidths(counts, { ...options, minimumColumns: [1, 1, 1, 0] }));
});

test('three or more items reserve at least two columns even beside a much larger category or in a narrow budget', () => {
  const options = { width: 1000, cell: 50, gap: 6, frame: [20, 20, 20, 20] };
  for (const width of [1000, 300]) {
    const plan = autoColumnWidths([3, 4, 3, 500], { ...options, width });
    assert.ok(plan.columns.every(count => count >= 2));
    assert.ok(Math.abs(plan.used - width) < 1e-8);
  }
  const small = autoColumnWidths([0, 1, 2, 3], options);
  assert.ok(small.columns.slice(0, 3).every(count => count >= 1)); assert.ok(small.columns[3] >= 2);
});

test('fixed total width is entirely whole square slots, including sparse actors and uneven screenshot counts', () => {
  for (const counts of [[3, 16, 3, 3], [0, 0, 0, 0], [0, 1, 2, 1], [3, 500, 3, 3]]) {
    for (const width of [300, 792.5, 1150, 1827.25]) {
      const options = { width, cell: 70, gap: 5.25, frame: [16.5, 16.5, 16.5, 16.5] };
      const plan = autoColumnWidths(counts, options);
      assert.ok(plan.cell > 0 && plan.cell <= options.cell);
      assert.ok(Math.abs(plan.used - width) < 1e-8);
      plan.widths.forEach((w, i) => {
        assert.ok(plan.columns[i] >= (counts[i] >= 3 ? 2 : 1));
        assert.ok(Math.abs(w - options.frame[i] - plan.columns[i] * plan.cell - (plan.columns[i] - 1) * options.gap) < 1e-8);
      });
    }
  }
});

test('automatic layout keeps its full width for sparse, empty or crowded actors and rejects invalid geometry', () => {
  const options = { width: 1000, cell: 50, gap: 6, frame: [20, 20, 20, 20] };
  const counts = [0, 1, 2, 1], before = [...counts];
  const sparse = autoColumnWidths(counts, options);
  assert.ok(sparse.columns.every(count => count >= 1)); assert.ok(Math.abs(sparse.used - options.width) < 1e-8);
  const empty = autoColumnWidths([0, 0, 0, 0], options);
  const crowded = autoColumnWidths([60, 80, 30, 100], options);
  for (const plan of [empty, crowded]) assert.ok(Math.abs(plan.used - sparse.used) < 1e-8);
  assert.ok(Math.max(...empty.columns) - Math.min(...empty.columns) <= 1);
  assert.deepEqual(counts, before);
  const narrow = autoColumnWidths([0, 100, 2, 30], { ...options, width: 100 });
  assert.ok(narrow.widths.every(w => w > 0)); assert.ok(narrow.used <= 100);
  assert.deepEqual(autoColumnWidths([NaN, -1, Infinity, null], options), empty);
  assert.throws(() => autoColumnWidths(counts, { ...options, cell: 0 }));
});

test('only explicit new manual sizing overrides automatic layout; legacy ratios and unrelated preferences survive reads', () => {
  const legacy = { ratios: [2, 3, 5], hidden: ['a'], order: ['b', 'a'] };
  const before = structuredClone(legacy), prefs = normalizeLayout(legacy);
  assert.deepEqual(prefs.ratios, [1, 1, 3, 5]); assert.equal(prefs.columnSizing, undefined);
  assert.deepEqual(normalizeLayout({ ...legacy, columnSizing: 'manual' }).ratios, [1, 1, 3, 5]);
  assert.equal(normalizeLayout({ ...legacy, columnSizing: 'manual' }).columnSizing, 'manual');
  assert.equal(normalizeLayout({ columnSizing: 'manual', ratios: [0, 0] }).columnSizing, undefined);
  assert.deepEqual(legacy, before);
});

test('custom order wins over system sort and does not mutate actor items', () => {
  const hero = actor('a', [item('z', 'feat', {}, { sort: 1 }), item('a', 'feat', {}, { sort: 2 }), item('b')]);
  const before = [...hero.items.values()];
  assert.deepEqual(itemsFor(hero, { order: ['a', 'z'] }).map(i => i.id), ['a', 'z', 'b']);
  assert.deepEqual([...hero.items.values()], before);
});

test('native hidden items and inactive dependent copies stay out of display and editing without document changes', () => {
  const entries = [item('real', 'spell', { level: 1 }), item('shadow', 'spell', { level: 1 }, { isHidden: true }),
    item('actor-hidden', 'spell', { level: 9 }), item('inactive', 'spell', {}, { dependentOrigin: { active: false } }),
    item('hidden-weapon', 'weapon', {}, { isHidden: true })];
  const npc = actor('npc', entries, { hiddenItems: new Set(['actor-hidden']) }), before = JSON.stringify(entries);
  for (const edit of [false, true]) assert.deepEqual(itemsFor(npc, { order: ['shadow', 'actor-hidden'], pinned: ['shadow'] }, { edit }).map(i => i.id), ['real']);
  assert.deepEqual(spellLevels(npc), [0, 1]);
  assert.equal(JSON.stringify(entries), before); assert.deepEqual([...npc.hiddenItems], ['actor-hidden']);
});

test('cached cast spells follow native displayInSpellbook rather than hiding every cache or merging same-name sources', () => {
  const cache = (id, visible) => item(id, 'spell', { level: 3, ...(visible === undefined ? {} : { linkedActivity: { displayInSpellbook: visible } }) },
    { name: '同名法术', flags: { dnd5e: { cachedFor: `Item.source.Activity.${id}` } } });
  const entries = [item('learned', 'spell', { level: 3 }, { name: '同名法术' }),
    item('innate', 'spell', { level: 3 }, { name: '同名法术' }), cache('internal', false), cache('orphan', undefined), cache('book', true)];
  const npc = actor('npc', entries), before = JSON.stringify(entries);
  for (const edit of [false, true]) assert.deepEqual(new Set(itemsFor(npc, {}, { edit }).map(i => i.id)), new Set(['learned', 'innate', 'book']));
  assert.equal(JSON.stringify(entries), before);
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
  assert.deepEqual(itemsFor(actor('a', [versatile, item('passive', 'feat', { activation: { type: '' } })]), {}, { action: 'reaction' }).map(i => i.id), ['versatile']);
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
  assert.deepEqual(spellLevels(hero), [0, 1, 2]);
  assert.deepEqual(slotPools(null), []);
  assert.deepEqual(spellLevels(null), [0]);
});

test('pact-only pools preserve depleted and unknown counts without adding normal spell levels or mutating slots', () => {
  const hero = actor('pact', [], { system: { spells: { pact: { level: 5, value: 0, max: 2 } } } });
  const before = structuredClone(hero.system.spells);
  assert.deepEqual(slotPools(hero).map(p => [p.key, p.value, p.max, p.level]), [['pact', 0, 2, 5]]);
  assert.deepEqual(spellLevels(hero), [0]);
  assert.deepEqual(hero.system.spells, before);
  hero.items.set('known', item('known', 'spell', { level: 3 }));
  assert.deepEqual(spellLevels(hero), [0, 1, 2, 3]);
  hero.system.spells.pact.value = undefined;
  assert.equal(slotPools(hero)[0].value, null);
  hero.system.spells.pact = { level: 0, value: 0, max: 0 };
  assert.deepEqual(slotPools(hero), []);
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
