import test from 'node:test';
import assert from 'node:assert/strict';
import { targetPlan, targetsInBox, visibleTargets, TargetWorkflow } from '../scripts/targeting.js';
import { actor, item } from './fixtures.js';

test('target plans read prepared data, separating self, single, multi, unlimited and native area', () => {
  assert.deepEqual(targetPlan({ target: { affects: { type: 'creature', count: 1 } } }), { mode: 'single', max: 1 });
  assert.deepEqual(targetPlan({ target: { affects: { type: 'creature', count: 3 } } }), { mode: 'multi', max: 3 });
  for (const count of [null, '', undefined, 0]) {
    assert.deepEqual(targetPlan({ target: { affects: { type: 'creature', count } } }), { mode: 'multi', max: null });
  }
  for (const count of ['@scaling + 3', '1d6', -1, Infinity, 1.5]) {
    assert.deepEqual(targetPlan({ target: { affects: { type: 'creature', count } } }), { mode: 'native' });
  }
  for (const type of ['self', 'space', '']) assert.deepEqual(targetPlan({ target: { affects: { type, count: 1 } } }), { mode: 'native' });
  assert.deepEqual(targetPlan({ target: { template: { type: 'cone' }, affects: { count: null } } }), { mode: 'area' });
  assert.deepEqual(targetPlan(null), { mode: 'native' });
});

test('selection uses token centres, includes boundaries and works in reverse drag directions', () => {
  const tokens = [[2, 2], [10, 10], [20, 20]].map(([x, y], id) => ({ id, center: { x, y } }));
  for (const [start, end] of [[{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 10, y: 10 }, { x: 0, y: 0 }]]) {
    assert.deepEqual(targetsInBox(tokens, start, end).map(t => t.id), [0, 1]);
  }
  assert.deepEqual(targetsInBox(tokens, { x: 5, y: 5 }, { x: 6, y: 6 }), []);
});

function fixture() {
  const scene = { id: 'scene' };
  const targets = [0, 1, 2].map(id => ({ id: String(id), center: { x: id * 10, y: id * 10 }, visible: true,
    document: { uuid: `Scene.scene.Token.${id}`, parent: scene, _source: { level: 'floor' }, elevation: 0 },
    actor: { uuid: `Actor.target${id}`, system: {} } }));
  const selected = [];
  const canvas = { ready: true, scene, level: { id: 'floor' }, tokens: { placeables: targets,
    setTargets(ids, options) { selected.push({ ids, options }); } } };
  const handlers = new Set();
  const hooks = { on(name, fn) { assert.equal(name, 'dnd5e.postUseActivity'); handlers.add(fn); },
    off(name, fn) { handlers.delete(fn); } };
  const a = { id: 'use', canUse: true, target: { template: { type: 'sphere' } } };
  const spell = item('spell', 'spell', { activities: new Map([['use', a]]) }, { uuid: 'Actor.caster.Item.spell' });
  const hero = actor('caster', [spell]);
  const errors = [], statuses = [];
  const controller = new TargetWorkflow({ user: { id: 'test' }, getCanvas: () => canvas, hooks,
    current: current => current === hero, onError: e => errors.push(e), onStatus: s => statuses.push(s) });
  return { scene, targets, selected, canvas, handlers, hooks, a, spell, hero, errors, statuses, controller };
}

test('hidden, fog-hidden, nonrendered, foreign-scene and other-floor tokens are excluded even for GM', () => {
  const f = fixture(), original = f.targets[0];
  for (const patch of [{ visible: false }, { isVisible: false }, { renderable: false }, { actor: null },
    { document: { ...original.document, hidden: true } }, { document: { ...original.document, parent: { id: 'other' } } },
    { document: { ...original.document, _source: { level: 'other-floor' } } }]) {
    f.canvas.tokens.placeables = [{ ...original, ...patch }];
    assert.deepEqual(visibleTargets(f.canvas), []);
  }
  f.canvas.tokens.placeables = [original]; assert.deepEqual(visibleTargets(f.canvas), [original]);
});

test('native area is placed once; exact-use hook selects visible covered targets before native rolls', async () => {
  const f = fixture(), updates = [], observed = [];
  const region = { parent: f.scene, testPoint: ({ x, elevation }) => x <= 10 && elevation === 0 };
  f.a.use = async function(config) {
    assert.equal(this, f.a); assert.equal(config.create, undefined); assert.equal(config.consume, undefined);
    const results = { templates: [region], message: { update: async data => updates.push(data) } };
    for (const handler of f.handlers) handler({ id: 'use', item: f.spell }, { bg3VideoHUD: 'unrelated' }, results);
    assert.equal(f.selected.length, 0);
    for (const handler of f.handlers) handler({ id: 'use', item: f.spell }, config, results);
    observed.push(f.selected.at(-1).ids); // Simulate the next native roll reading current targets.
    return results;
  };
  await f.controller.use(f.hero, 'spell', {});
  assert.deepEqual(observed, [['0', '1']]); assert.equal(updates.length, 1);
  assert.deepEqual(updates[0]['system.targets'].map(t => t.token), ['Scene.scene.Token.0', 'Scene.scene.Token.1']);
  assert.equal(f.handlers.size, 0); assert.equal(f.errors.length, 0);
  assert.equal(f.selected.length, 1); // Never restore early over an outstanding native roll.
});

test('cancelled or rejected native area workflows never fabricate targets and always remove scoped hook', async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    f.a.use = async () => { if (fail) throw new Error('native rejected'); return undefined; };
    if (fail) await assert.rejects(f.controller.use(f.hero, 'spell', {}), /native rejected/);
    else assert.equal(await f.controller.use(f.hero, 'spell', {}), undefined);
    assert.deepEqual(f.selected, []); assert.equal(f.handlers.size, 0);
  }
});

test('actor or scene changes prevent native subsequent rolls without closing native dialogs or redirecting the old use', async () => {
  const f = fixture(); let finish;
  f.a.use = () => new Promise(resolve => { finish = resolve; });
  const result = f.controller.use(f.hero, 'spell', {});
  assert.equal(f.handlers.size, 1);
  f.controller.cancel(); assert.equal(f.handlers.size, 1);
  finish(); await result; assert.deepEqual(f.selected, []); assert.equal(f.handlers.size, 0);
});

test('area chat update errors are reported without retrying or consuming a second time', async () => {
  const f = fixture(); let uses = 0;
  f.a.use = async config => {
    uses++;
    for (const fn of f.handlers) fn({ id: f.a.id, item: f.spell }, config, {
      templates: [{ parent: f.scene, testPoint: () => true }],
      message: { update: async () => { throw new Error('private payload'); } }
    });
  };
  await f.controller.use(f.hero, 'spell', {}); await Promise.resolve();
  assert.equal(uses, 1); assert.equal(f.errors.length, 1); assert.ok(!f.errors[0].includes('private payload'));
});

test('last-use consumption or automatic item deletion does not suppress area target selection', async () => {
  const f = fixture();
  f.a.use = async config => {
    f.a.canUse = false; f.hero.items.delete(f.spell.id);
    for (const fn of f.handlers) fn({ id: f.a.id, item: f.spell }, config, {
      templates: [{ parent: f.scene, testPoint: () => true }]
    });
  };
  await f.controller.use(f.hero, 'spell', {});
  assert.deepEqual(f.selected.at(-1).ids, ['0', '1', '2']); assert.deepEqual(f.errors, []);
});

test('native activity chooser cancellation is respected before any selection or use', async () => {
  const f = fixture(); let choices = 0;
  f.a.use = () => assert.fail('cancelled activity used');
  const other = { ...f.a, id: 'other' }; f.spell.system.activities.set(other.id, other);
  f.controller.getSystem = () => ({ applications: { activity: { ActivityChoiceDialog: {
    create: async chosen => { assert.equal(chosen, f.spell); choices++; return undefined; }
  } } } });
  await f.controller.use(f.hero, 'spell', {});
  assert.equal(choices, 1); assert.deepEqual(f.selected, []); assert.equal(f.handlers.size, 0);
});

test('permission revoked while native activity chooser is open prevents the selected activity', async () => {
  const f = fixture();
  f.a.use = () => assert.fail('unowned activity used');
  f.spell.system.activities.set('other', { ...f.a, id: 'other' });
  f.controller.getSystem = () => ({ applications: { activity: { ActivityChoiceDialog: {
    create: async () => { f.hero.isOwner = false; return f.a; }
  } } } });
  await assert.rejects(f.controller.use(f.hero, 'spell', {}), /拥有权限/);
  assert.deepEqual(f.selected, []); assert.equal(f.handlers.size, 0);
});

test('changed scene or foreign activity result is rejected after native activity choice', async () => {
  for (const changeScene of [false, true]) {
    const f = fixture(); f.a.use = () => assert.fail('wrong activity used');
    f.spell.system.activities.set('other', { ...f.a, id: 'other' });
    f.controller.getSystem = () => ({ applications: { activity: { ActivityChoiceDialog: {
      create: async () => {
        if (changeScene) f.canvas.scene = { id: 'other' };
        return { ...f.a };
      }
    } } } });
    if (changeScene) assert.equal(await f.controller.use(f.hero, 'spell', {}), undefined);
    else await assert.rejects(f.controller.use(f.hero, 'spell', {}), /活动已更改/);
    assert.deepEqual(f.selected, []);
  }
});

test('native completion after cancellation stops subsequent actions and never replaces new-context targets', async () => {
  const f = fixture(); let finish, marker;
  f.a.use = config => { marker = config; return new Promise(resolve => { finish = resolve; }); };
  const result = f.controller.use(f.hero, 'spell', {});
  f.controller.cancel();
  for (const handler of f.handlers) assert.equal(handler({ id: f.a.id, item: f.spell }, marker,
    { templates: [{ parent: f.scene, testPoint: () => true }] }), false);
  assert.deepEqual(f.selected, []); assert.equal(f.errors.length, 1);
  finish(); await result; assert.equal(f.handlers.size, 0);
});

test('missing or foreign-scene area templates stop subsequent native rolls without fabricating a refund', async () => {
  for (const templates of [[], [{ parent: { id: 'other' }, testPoint: () => true }]]) {
    const f = fixture(); let uses = 0;
    f.a.use = async config => {
      uses++;
      for (const handler of f.handlers) assert.equal(handler({ id: f.a.id, item: f.spell }, config, { templates }), false);
    };
    await f.controller.use(f.hero, 'spell', {});
    assert.equal(uses, 1); assert.deepEqual(f.selected, []); assert.equal(f.handlers.size, 0);
    assert.ok(f.statuses.at(-1).includes('核实系统消耗'));
  }
});

test('empty area clears stale targets; revoked ownership prevents any area selection and subsequent roll', async () => {
  for (const revoked of [false, true]) {
    const f = fixture();
    f.a.use = async config => {
      if (revoked) f.hero.isOwner = false;
      const results = { templates: [{ parent: f.scene, testPoint: () => false }] };
      for (const handler of f.handlers) assert.equal(handler({ id: f.a.id, item: f.spell }, config, results), false);
    };
    await f.controller.use(f.hero, 'spell', {});
    assert.deepEqual(f.selected, revoked ? [] : [{ ids: [], options: { mode: 'replace' } }]);
    assert.equal(f.handlers.size, 0);
  }
});
