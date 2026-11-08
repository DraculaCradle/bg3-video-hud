import test from 'node:test';
import assert from 'node:assert/strict';
import { targetPlan, TargetWorkflow } from '../scripts/targeting.js';
import { normalizeLayout, resizeColumns } from '../scripts/model.js';
import { canEndTurn, endTurn } from '../scripts/actions.js';
import { reactionResources } from '../scripts/reactions.js';
import { deleteCastingSource, sequencePlan, SOURCE_ACTIVITY } from '../scripts/casting.js';
import { saveFailureChance, combatEstimate } from '../scripts/estimates.js';
import { actor, item } from './fixtures.js';

test('prepared weapon attack with blank target type requires one token; self, areas and enchantment retain precedence', () => {
  for (const target of [undefined, {}, { affects: {} }, { affects: { type: '', count: '' } }, { affects: { type: '', count: 1 } }]) {
    assert.deepEqual(targetPlan({ type: 'attack', target }), { mode: 'single', max: 1 });
  }
  assert.deepEqual(targetPlan({ type: 'utility', target: {} }), { mode: 'native' });
  for (const type of ['self', 'space', 'object']) assert.deepEqual(targetPlan({ type: 'attack', target: { affects: { type } } }), { mode: 'native' });
  assert.deepEqual(targetPlan({ type: 'enchant', target: { affects: { type: 'creature', count: 1 } } }), { mode: 'native' });
  assert.deepEqual(targetPlan({ type: 'attack', target: { template: { type: 'cone' } } }), { mode: 'area' });
});

test('blank-type weapon waits for map selection before native use; cancellation consumes nothing', async () => {
  for (const cancel of [true, false]) {
    const hero = actor(), selected = [], uses = [], scene = { id: 's' };
    const target = { id: 'enemy', visible: true, actor: actor('enemy'), document: { parent: scene } };
    const a = { id: 'attack', type: 'attack', canUse: true, target: { affects: { type: '', count: '' } },
      use: async config => { uses.push(config); return { native: true }; } };
    const blade = item('blade', 'weapon', { activities: new Map([['attack', a]]) }); hero.items.set('blade', blade);
    const canvas = { ready: true, scene, tokens: { placeables: [target], setTargets: ids => selected.push(ids) } };
    let finish;
    const workflow = new TargetWorkflow({ user: { id: 'u' }, current: x => x === hero, getCanvas: () => canvas,
      chooseUse: async () => ({ activityId: 'attack' }) });
    workflow.pick = (_canvas, plan) => { assert.equal(plan.mode, 'single'); return new Promise(resolve => { finish = resolve; }); };
    const pending = workflow.use(hero, 'blade', {}); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(uses.length, 0); assert.equal(selected.length, 0);
    finish(cancel ? null : [target]); await pending;
    assert.equal(uses.length, cancel ? 0 : 1); assert.deepEqual(selected, cancel ? [] : [['enemy']]);
    assert.equal(a.target.affects.type, '');
  }
});

test('column resizing retains unaffected column, positive minimum and user layout data', () => {
  const base = [200, 200, 300, 500];
  assert.deepEqual(resizeColumns(base, 0, 50), [250, 150, 300, 500]);
  assert.deepEqual(resizeColumns(base, 1, -10000), [200, 56, 444, 500]);
  assert.deepEqual(resizeColumns([30, 30, 40, 40], 0, 999), [40, 20, 40, 40]);
  assert.deepEqual(resizeColumns(base, 2, 20), [200, 200, 320, 480]);
  assert.deepEqual(base, [200, 200, 300, 500]);
  const prefs = normalizeLayout({ hidden: ['secret'], ratios: [2, 3, 5] });
  assert.deepEqual(prefs.ratios, [1, 1, 3, 5]); assert.deepEqual(prefs.hidden, ['secret']);
  for (const ratios of [null, [0, 2, 5], [1, Infinity, 3], [1, 2], 'abc']) assert.equal(normalizeLayout({ ratios }).ratios, undefined);
});

test('end turn invokes native combat only for matching owned current actor/token', async () => {
  const hero = actor(), user = {}, token = { id: 'one' }; let calls = 0;
  const combat = { started: true, combatant: { actor: hero, tokenId: token.id, isOwner: true }, nextTurn: async () => { calls++; } };
  assert.ok(canEndTurn(hero, token, user, combat)); await endTurn(hero, token, user, combat); assert.equal(calls, 1);
  await assert.rejects(endTurn(hero, { id: 'other' }, user, combat));
  combat.combatant.actor = actor('other'); await assert.rejects(endTurn(hero, token, { isGM: true }, combat));
  combat.combatant.actor = hero; hero.isOwner = false; await assert.rejects(endTurn(hero, token, user, combat));
  hero.isOwner = true; combat.started = false; await assert.rejects(endTurn(hero, token, user, combat)); assert.equal(calls, 1);
});

function sourceFixture() {
  const hero = actor(), spell = item('shield', 'spell', { identifier: 'shield', level: 1 }, { uuid: 'Actor.hero.Item.shield' });
  hero.items.set(spell.id, spell); spell.actor = hero;
  const source = item('source', 'feat', { uses: { max: 2, spent: 0 }, activities: new Map([[SOURCE_ACTIVITY, {
    id: SOURCE_ACTIVITY, type: 'cast', relativeUUID: '.Item.source.Activity.cast', canUse: true, spell: { uuid: spell.uuid, level: 1 }
  }]]) }, { flags: { 'bg3-video-hud': { castingSource: { spell: spell.uuid, enabled: true } } } });
  hero.items.set(source.id, source);
  const activity = { actor: hero, item: spell, consumption: { targets: [{ type: 'material', target: 'gem' }] } };
  const usage = { midiOptions: { isReaction: true }, consume: { ammunition: true } };
  return { hero, spell, source, activity, usage };
}

test('reaction resource choice links one native source without changing owned spell or decrementing charges', async () => {
  const f = sourceFixture();
  await reactionResources({ workflow: { activity: f.activity }, usage: f.usage }, {
    user: {}, current: a => a === f.hero, choose: async () => 'source'
  });
  assert.deepEqual(f.usage.cause, { activity: '.Item.source.Activity.cast', resources: true });
  assert.deepEqual(f.usage.consume, { ammunition: true, spellSlot: false, resources: [0] });
  assert.equal(f.source.system.uses.spent, 0); assert.equal(f.activity.consumption.targets.length, 1);
  await reactionResources({ workflow: { activity: f.activity }, usage: f.usage }, { current: () => true, choose: () => assert.fail('duplicate dialog') });
});

test('reaction cancellation, stale context and depleted sources stop use before changing consumption', async () => {
  for (const mode of ['cancel', 'context', 'depleted', 'slot']) {
    const f = sourceFixture(); let current = true;
    const operation = reactionResources({ workflow: { activity: f.activity }, usage: f.usage }, { user: {}, current: () => current,
      choose: async () => { if (mode === 'context') current = false; if (mode === 'depleted') f.source.system.uses.spent = 2;
        return mode === 'cancel' ? null : mode === 'slot' ? 'slot' : 'source'; } });
    if (mode === 'depleted') await assert.rejects(operation); else assert.equal(await operation, mode === 'slot' ? undefined : false);
    assert.equal(f.usage.cause, undefined); assert.equal(f.usage.consume.spellSlot, undefined);
  }
});

test('reaction hook ignores ordinary uses, other spells, other actors and foreign UUIDs', async () => {
  for (const mode of ['ordinary', 'other', 'actor', 'uuid']) {
    const f = sourceFixture();
    if (mode === 'ordinary') f.usage.midiOptions.isReaction = false;
    if (mode === 'other') f.spell.system.identifier = 'other';
    if (mode === 'uuid') f.activity.item = { ...f.spell, uuid: 'Actor.foreign.Item.shield' };
    await reactionResources({ workflow: { activity: f.activity }, usage: f.usage }, {
      user: {}, current: () => mode !== 'actor', choose: () => assert.fail('unexpected dialog')
    });
    assert.equal(f.usage.cause, undefined);
  }
});

test('source deletion is limited to the owned marked source; foreign item/spell and revoked permission rejected', async () => {
  const f = sourceFixture(); let deletes = 0; f.source.delete = async () => { deletes++; };
  await deleteCastingSource(f.hero, f.spell.id, {}, f.source.id); assert.equal(deletes, 1);
  f.source.flags['bg3-video-hud'].castingSource.spell = 'Actor.other.Item.spell';
  await assert.rejects(deleteCastingSource(f.hero, f.spell.id, {}, f.source.id));
  await assert.rejects(deleteCastingSource(f.hero, f.spell.id, {}, f.spell.id));
  f.hero.isOwner = false; await assert.rejects(deleteCastingSource(f.hero, f.spell.id, {}, f.source.id)); assert.equal(deletes, 1);
});

test('SRD magic missile allocates level+2 native single-dart damage rolls without an attack roll', () => {
  const a = { id: 'dart', type: 'damage', canUse: true, use() {}, rollDamage() {} };
  const spell = item('missile', 'spell', { identifier: 'magic-missile', level: 1, activities: new Map([['dart', a]]) });
  for (const level of [1, 3, 9]) assert.deepEqual(sequencePlan(spell, a, { level }),
    { count: level + 2, rollerId: 'dart', method: 'damage', standard: true, damageScaling: 0 });
  spell.system.identifier = 'unrecognized'; assert.equal(sequencePlan(spell, a), null);
});

test('save estimate uses failure probability without attack natural-one/twenty rules and respects privacy', () => {
  assert.equal(saveFailureChance(100, 1), 0); assert.equal(saveFailureChance(-100, 100), 1);
  assert.ok(Math.abs(saveFailureChance(5, 15) - .45) < 1e-8);
  const ability = { mod: 2, save: { prof: { hasProficiency: true, term: '3' } } };
  const target = { actor: actor('enemy', [], { testUserPermission: () => false, system: { abilities: { wis: ability } } }) };
  const a = { type: 'save', save: { ability: new Set(['wis']), dc: { value: 15 } } };
  assert.equal(combatEstimate(a, target, null, {}, {}).chance, null);
  const estimate = combatEstimate(a, target, null, {}, { isGM: true });
  assert.equal(estimate.kind, 'save'); assert.ok(Math.abs(estimate.chance - .45) < 1e-8); assert.equal(estimate.difficulty, '困难');
});

test('automated helper activities are excluded from the manual chooser without hiding native public activities', async () => {
  const { usableActivities } = await import('../scripts/casting.js');
  const { activationTypes } = await import('../scripts/model.js');
  const make = id => ({ id, canUse: true, use() {} });
  const spell = item('spell', 'spell', { activities: new Map([
    ['public', make('public')], ['hidden', make('hidden')], ['auto', { ...make('auto'), midiProperties: { automationOnly: true } }]
  ]) }, { flags: { 'chris-premades': { hiddenActivities: ['bolt'], activityIdentifiers: { bolt: 'hidden' } } } });
  assert.deepEqual(usableActivities(spell).map(a => a.id), ['public']);
  assert.deepEqual(activationTypes(item('reaction', 'feat', { activities: [{ activation: { type: 'reactiondamage' } }] })), ['reactiondamage', 'reaction']);
});
