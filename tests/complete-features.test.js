import test from 'node:test';
import assert from 'node:assert/strict';
import { averageFormula, hitChance, combatEstimate } from '../scripts/estimates.js';
import { sourceData, saveCastingSource, nativeCastingOptions, castingSources, scaledActivity, sequencePlan, SOURCE_ACTIVITY } from '../scripts/casting.js';
import { TargetWorkflow } from '../scripts/targeting.js';
import { TurnLedger } from '../scripts/turn-ledger.js';
import { actor, item } from './fixtures.js';

test('formula previews support arithmetic and dice means without evaluating code or rolling dice', () => {
  assert.equal(averageFormula('2d6 + 3'), 10);
  assert.equal(averageFormula('-(1d4+1)*2'), -7);
  assert.equal(averageFormula('1d10 + 4'), 9.5);
  for (const formula of ['alert(1)', '2d6kh1', '@unknown', '1/0', '1 +', '(2', '1001d6', '1d0', '1; globalThis.x=1']) assert.equal(averageFormula(formula), null, formula);
});

test('hit probability respects natural ones, criticals, advantage/disadvantage and unknown data', () => {
  assert.equal(hitChance(5, 15), .55);
  assert.ok(Math.abs(hitChance(5, 15, { advantage: true }) - .7975) < .000001);
  assert.equal(hitChance(5, 15, { advantage: true, disadvantage: true }), .55);
  assert.equal(hitChance(100, 1), .95); assert.equal(hitChance(-100, 100), .05);
  assert.equal(hitChance(null, 15), null); assert.equal(hitChance(5, undefined), null);
});

test('preview never exposes target AC-derived probabilities without OBSERVER permission', () => {
  const activity = { getAttackData: () => ({ parts: ['5'], data: {} }) };
  const target = { actor: actor('secret', [], { isOwner: false, testUserPermission: () => false,
    system: { attributes: { ac: { value: 13 } } } }) };
  assert.equal(combatEstimate(activity, target, null, {}, { isGM: false }).chance, null);
  assert.equal(combatEstimate(activity, target, null, {}, { isGM: true }).chance, .65);
});

function sourceFixture() {
  const spell = item('spell', 'spell', { level: 1 }, { uuid: 'Actor.a.Item.spell' });
  const hero = actor('a', [spell]); spell.actor = hero;
  const source = item('source', 'feat', { uses: { max: 2, spent: 0 }, activities: new Map() }, {
    flags: { 'bg3-video-hud': { castingSource: { spell: spell.uuid, enabled: true } } }
  });
  const cast = { id: SOURCE_ACTIVITY, type: 'cast', canUse: true, relativeUUID: '.Item.source.Activity.cast', spell: { uuid: spell.uuid, level: 1 } };
  source.system.activities.set(cast.id, cast); hero.items.set(source.id, source);
  return { hero, spell, source, cast };
}

test('free casting sources encode native charges and short/long-rest recovery instead of a custom debit', () => {
  const { spell } = sourceFixture();
  const input = { name: '测试来源', max: 3, remaining: 2, level: 1, period: 'sr', enabled: true };
  const data = sourceData(spell, input);
  assert.deepEqual(data.system.uses, { max: '3', spent: 1, recovery: [{ period: 'sr', type: 'recoverAll' }] });
  assert.deepEqual(data.system.activities[SOURCE_ACTIVITY].consumption.targets, [{ type: 'itemUses', target: '', value: '1' }]);
  assert.equal(data.system.activities[SOURCE_ACTIVITY].spell.uuid, spell.uuid);
  assert.equal(data.system.activities[SOURCE_ACTIVITY].consumption.spellSlot, false);
  const unlimited = sourceData(spell, { ...input, max: 0, remaining: 0 });
  assert.equal(unlimited.system.activities[SOURCE_ACTIVITY].consumption.targets.length, 0);
  assert.equal(unlimited.system.uses.recovery.length, 0);
});

test('invalid source quantities, recovery keys and wrong-actor edits are rejected without writes', async () => {
  const f = sourceFixture(), good = { name: '来源', max: 1, remaining: 1, level: 1, period: 'lr' };
  for (const patch of [{ name: '' }, { max: -1 }, { remaining: 2 }, { period: 'foreign' }, { level: 0 }, { max: 10000 }]) {
    assert.throws(() => sourceData(f.spell, { ...good, ...patch }));
  }
  f.hero.isOwner = false; await assert.rejects(saveCastingSource(f.hero, 'spell', {}, good), /拥有权限/);
  f.hero.isOwner = true; delete f.source.flags['bg3-video-hud'];
  await assert.rejects(saveCastingSource(f.hero, 'spell', {}, good, 'source'), /只能编辑/);
});

test('source editor creates only an explicit marked native item and updates only owned managed fields', async () => {
  const f = sourceFixture(); let created, update;
  f.hero.createEmbeddedDocuments = async (type, data) => { assert.equal(type, 'Item'); created = data; return [{ id: 'new' }]; };
  f.source.update = async data => { update = data; };
  const input = { name: '来源', max: 2, remaining: 1, level: 1, period: 'lr' };
  assert.equal((await saveCastingSource(f.hero, 'spell', {}, input)).id, 'new');
  assert.equal(created.length, 1); assert.equal(created[0].flags['bg3-video-hud'].castingSource.spell, f.spell.uuid);
  await saveCastingSource(f.hero, 'spell', {}, input, 'source');
  assert.equal(update['system.uses'].spent, 1); assert.ok(!('system.activities' in update));
  assert.deepEqual(f.spell.system, { level: 1 });
});

test('native free-cast options link native consumption exactly once; depleted or disabled sources fail', () => {
  const f = sourceFixture();
  const config = nativeCastingOptions(f.hero, f.spell, {}, { sourceId: 'source' });
  assert.deepEqual(config.cause, { activity: f.cast.relativeUUID, resources: true });
  assert.deepEqual(config.consume, { spellSlot: false, resources: [] }); assert.equal(f.source.system.uses.spent, 0);
  f.source.system.uses.spent = 2;
  assert.throws(() => nativeCastingOptions(f.hero, f.spell, {}, { sourceId: 'source' }), /停用、耗尽/);
  f.source.system.uses.spent = 0; f.source.flags['bg3-video-hud'].castingSource.enabled = false;
  assert.throws(() => nativeCastingOptions(f.hero, f.spell, {}, { sourceId: 'source' }), /停用、耗尽/);
  assert.throws(() => nativeCastingOptions(f.hero, f.spell, {}, { sourceId: 'source', slot: 'spell1' }), /一种/);
});

test('a selected free source replaces only the original personal charges and preserves material costs', () => {
  const f = sourceFixture();
  const a = { consumption: { targets: [{ type: 'itemUses', target: '' }, { type: 'material', target: 'gem' },
    { type: 'itemUses', target: 'focus' }, { type: 'activityUses', target: '' }] } };
  const config = nativeCastingOptions(f.hero, f.spell, a, { sourceId: 'source' });
  assert.deepEqual(config.consume.resources, [1, 2]); assert.equal(config.cause.resources, true);
  assert.equal(f.source.system.uses.spent, 0);
});

function sequenceFixture({ nativeLevel = 2, cancelAt = null, cancelUse = false } = {}) {
  const scene = { id: 's' }, user = { id: 'u' }, hooks = new Set(), records = [], stages = [];
  const hero = actor('a', [], { system: { details: { level: 7 }, spells: { spell2: { value: 3 } } } });
  const targets = [1, 2].map(id => ({ id: String(id), actor: actor(`t${id}`), visible: true,
    center: { x: id, y: id }, document: { parent: scene } }));
  const canvas = { ready: true, scene, tokens: { placeables: targets, setTargets: ids => records.push(['targets', ids]) } };
  const cast = { id: 'cast', type: 'utility', canUse: true, consumption: { spellSlot: true }, target: { affects: { type: 'creature', count: 3 } } };
  let attacks = 0;
  const attack = { id: 'attack', type: 'attack', canUse: true, consumption: { spellSlot: false },
    use: () => assert.fail('per-ray activation must not run a second resource workflow'),
    rollAttack: async () => { records.push(['attack', ++attacks]); return attacks === cancelAt ? [] : [{ isCritical: attacks === 1 }]; },
    rollDamage: async config => { records.push(['damage', config]); return [{ total: 7 }]; } };
  const spell = item('spell', 'spell', { level: 2, identifier: 'scorching-ray', activities: new Map([['cast', cast], ['attack', attack]]) },
    { uuid: 'Actor.a.Item.spell', actor: hero, flags: { dnd5e: {} } });
  hero.items.set(spell.id, spell);
  for (const a of [cast, attack]) { a.item = spell; a.actor = hero; }
  cast.getRollData = () => ({ item: { level: nativeLevel } });
  cast.use = async config => {
    records.push(['use', config]); if (cancelUse) return;
    hero.system.spells.spell2.value--;
    const result = { message: { id: 'native-use' } };
    for (const fn of hooks) fn(cast, config, result);
    return result;
  };
  const workflow = new TargetWorkflow({ user, current: a => a === hero, getCanvas: () => canvas,
    hooks: { on: (_n, fn) => hooks.add(fn), off: (_n, fn) => hooks.delete(fn) },
    chooseUse: async () => ({ activityId: 'cast' }), onProgress: p => stages.push(p), onStatus: () => {} });
  workflow.pick = async () => targets;
  return { hero, spell, cast, attack, targets, records, stages, workflow, hooks };
}

test('canonical rays allocate repeats across range targets and use the native resource workflow once', async () => {
  const f = sequenceFixture(); await f.workflow.use(f.hero, 'spell', {});
  assert.equal(f.records.filter(r => r[0] === 'use').length, 1);
  assert.equal(f.hero.system.spells.spell2.value, 2);
  assert.equal(f.records.filter(r => r[0] === 'attack').length, 3);
  assert.equal(f.records.filter(r => r[0] === 'damage').length, 3);
  assert.equal(f.records.find(r => r[0] === 'use')[1].subsequentActions, false);
  assert.deepEqual(f.stages[0].allocation.map(t => t.id), ['1', '2', '1']);
  assert.equal(f.records.find(r => r[0] === 'damage')[1].isCritical, true);
  assert.equal(f.stages.at(-1).stage, 'done'); assert.equal(f.hooks.size, 0);
});

test('a normal single-target attack coordinates native attack and damage after one activation', async () => {
  const f = sequenceFixture(); f.spell.type = 'weapon'; f.spell.system.identifier = 'fixture-weapon';
  f.attack.target = { affects: { type: 'creature', count: 1 } };
  f.attack.use = async config => {
    f.records.push(['use', config]); const result = { message: { id: 'native-weapon' } };
    for (const fn of f.hooks) fn(f.attack, config, result);
    return result;
  };
  f.workflow.chooseUse = async () => ({ activityId: 'attack' });
  f.workflow.pick = async () => [f.targets[0]];
  await f.workflow.use(f.hero, 'spell', {});
  assert.equal(f.records.filter(r => r[0] === 'use').length, 1);
  assert.equal(f.records.filter(r => r[0] === 'attack').length, 1);
  assert.equal(f.records.filter(r => r[0] === 'damage').length, 1);
  assert.equal(f.hero.system.spells.spell2.value, 3);
});

test('context loss while the final damage roll is open stops completion feedback without another native use', async () => {
  const f = sequenceFixture(); let calls = 0;
  f.attack.rollDamage = async () => {
    if (++calls === 3) f.workflow.current = () => false;
    return [{ total: 7 }];
  };
  await f.workflow.use(f.hero, 'spell', {});
  assert.equal(f.stages.at(-1).stage, 'stopped');
  assert.equal(f.records.filter(r => r[0] === 'use').length, 1);
});

test('native scaled-clone preview is prepared once and never adds a second final-attribute preparation', () => {
  const original = { id: 'a', item: {} }, prepared = { id: 'a' }; let calls = 0;
  original.item.clone = () => assert.fail('native scaledClone must be preferred');
  original.item.scaledClone = (n, options) => {
    assert.equal(n, 2); assert.equal(options.keepId, true); calls++;
    return { system: { activities: new Map([['a', prepared]]) },
      prepareFinalAttributes: () => assert.fail('clone is already prepared') };
  };
  assert.equal(scaledActivity(original, 2), prepared); assert.equal(calls, 1);
  assert.equal(scaledActivity(original, 0), original);
});

test('native casting cancellation spends nothing and never creates a second use or rolls', async () => {
  const f = sequenceFixture({ cancelUse: true }); await f.workflow.use(f.hero, 'spell', {});
  assert.equal(f.hero.system.spells.spell2.value, 3);
  assert.equal(f.records.filter(r => r[0] === 'attack').length, 0); assert.equal(f.hooks.size, 0);
});

test('cancelled ray stops remaining rolls while preserving a single native resource debit', async () => {
  const f = sequenceFixture({ cancelAt: 2 }); await f.workflow.use(f.hero, 'spell', {});
  assert.equal(f.records.filter(r => r[0] === 'attack').length, 2);
  assert.equal(f.records.filter(r => r[0] === 'damage').length, 1);
  assert.equal(f.hero.system.spells.spell2.value, 2); assert.equal(f.stages.at(-1).stage, 'stopped');
});

test('native final upcast level changes the actual ray count without charging another slot', async () => {
  const f = sequenceFixture({ nativeLevel: 4 }); await f.workflow.use(f.hero, 'spell', {});
  assert.equal(f.records.filter(r => r[0] === 'attack').length, 5);
  assert.equal(f.records.filter(r => r[0] === 'use').length, 1); assert.equal(f.hero.system.spells.spell2.value, 2);
});

test('revocation between native attack and damage prevents additional calls without reusing the resource workflow', async () => {
  const f = sequenceFixture();
  f.attack.rollAttack = async () => { f.hero.isOwner = false; return [{ isCritical: false }]; };
  await assert.rejects(f.workflow.use(f.hero, 'spell', {}), /操作权限/);
  assert.equal(f.records.filter(r => r[0] === 'damage').length, 0);
  assert.equal(f.records.filter(r => r[0] === 'use').length, 1);
  assert.equal(f.hero.system.spells.spell2.value, 2);
});

test('native misses skip damage and damage errors never trigger a second spell use', async () => {
  const miss = sequenceFixture();
  miss.attack.rollAttack = async () => [{ isSuccess: false, options: { target: 17 } }];
  await miss.workflow.use(miss.hero, 'spell', {});
  assert.equal(miss.records.filter(r => r[0] === 'damage').length, 0);
  const failure = sequenceFixture(); failure.attack.rollDamage = async () => { throw new Error('native damage failed'); };
  await assert.rejects(failure.workflow.use(failure.hero, 'spell', {}), /native damage failed/);
  assert.equal(failure.records.filter(r => r[0] === 'use').length, 1);
  assert.equal(failure.hero.system.spells.spell2.value, 2); assert.equal(failure.stages.at(-1).stage, 'error');
});

test('native attack mode and ammunition choices reach damage; an error retains its actual sequence position', async () => {
  const f = sequenceFixture(); let index = 0;
  f.attack.rollAttack = async () => [{ isCritical: false,
    options: { ability: 'dex', ammunition: 'native-ammo', attackMode: 'twoHanded' } }];
  f.attack.rollDamage = async config => {
    assert.equal(config.ability, 'dex'); assert.equal(config.ammunition, 'native-ammo');
    assert.equal(config.attackMode, 'twoHanded');
    if (++index === 2) throw Error('second native damage failed');
    return [{ total: 5 }];
  };
  await assert.rejects(f.workflow.use(f.hero, 'spell', {}), /second native damage failed/);
  assert.equal(f.stages.at(-1).index, 1); assert.equal(f.stages.at(-1).stage, 'error');
  assert.equal(f.records.filter(r => r[0] === 'use').length, 1);
});

test('extra attacks are explicit options; arbitrary multi-target data is not guessed to be multiple rays', () => {
  const f = sequenceFixture(); f.spell.system.identifier = 'homebrew';
  assert.equal(sequencePlan(f.spell, f.attack), null);
  f.attack.target = { affects: { type: 'creature', count: 1 } };
  assert.equal(sequencePlan(f.spell, f.attack).count, 1);
  f.attack.target.affects.count = 3;
  assert.equal(sequencePlan(f.spell, f.attack), null);
  assert.equal(sequencePlan(f.spell, f.attack, { count: 4 }).count, 4);
  assert.throws(() => sequencePlan(f.spell, f.attack, { count: 999 }), /1～20/);
  f.spell.system.identifier = 'eldritch-blast';
  assert.equal(sequencePlan(f.spell, f.attack).count, 2);
  delete f.attack.rollDamage;
  assert.throws(() => sequencePlan(f.spell, f.attack), /原生伤害接口/);
});

test('turn ledger counts observed successful native uses, deduplicates and resets without document writes', () => {
  const ledger = new TurnLedger(), hero = actor('a'), user = {}, combat = { id: 'c', started: true, round: 1, turn: 0 };
  const a = { actor: hero, activation: { type: 'action' } }, result = { message: { id: 'm' } };
  ledger.observe(a, {}, result, user, combat); ledger.observe(a, {}, result, user, combat);
  assert.equal(ledger.state(hero, 'action', combat).used, 1);
  ledger.observe(a, { cause: { activity: 'linked' } }, { message: { id: 'other' } }, user, combat);
  assert.equal(ledger.state(hero, 'action', combat).used, 2);
  ledger.observe(a, { cause: { activity: 'linked' } }, { message: { id: 'other' } }, user, combat);
  assert.equal(ledger.state(hero, 'action', combat).used, 2);
  assert.equal(ledger.state(hero, 'action', { ...combat, turn: 1 }).used, 0);
  assert.equal(ledger.state(hero, 'action', null).used, null);
});
