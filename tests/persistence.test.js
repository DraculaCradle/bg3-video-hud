import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutStore, actorKey } from '../scripts/persistence.js';
import { MODULE_ID, toggleId } from '../scripts/model.js';
import { actor, userWithFlags } from './fixtures.js';

test('layouts are isolated by user and full actor UUID including synthetic tokens', async () => {
  const first = userWithFlags(), second = userWithFlags();
  const store = new LayoutStore(first), other = new LayoutStore(second);
  const hero = actor('a'), synthetic = { uuid: 'Scene.s.Token.t.Actor.a' };
  await store.update(hero, p => ({ ...p, hidden: ['sword'] }));
  assert.deepEqual(store.read(hero).hidden, ['sword']);
  assert.deepEqual(store.read(synthetic).hidden, []);
  assert.deepEqual(other.read(hero).hidden, []);
  assert.match(actorKey(synthetic), /^[a-f0-9]+$/);
  assert.notEqual(actorKey({ uuid: 'Actor.a.b' }), actorKey({ uuid: 'Actor.a_b' }));
  assert.throws(() => actorKey({}), /UUID/);
});

test('writes leave upstream flags, sibling actors and actor documents untouched', async () => {
  const user = userWithFlags();
  user.flags['bg3-hud-core'] = { hotbar: { private: ['keep'] } };
  user.flags['bg3-hud-dnd5e'] = { configuration: { keep: true } };
  const before = structuredClone(user.flags);
  const store = new LayoutStore(user), hero = actor('a'), other = actor('b');
  await store.update(other, p => ({ ...p, order: ['x'] }));
  await store.update(hero, p => ({ ...p, pinned: ['spell'] }));
  assert.deepEqual(user.flags['bg3-hud-core'], before['bg3-hud-core']);
  assert.deepEqual(user.flags['bg3-hud-dnd5e'], before['bg3-hud-dnd5e']);
  assert.deepEqual(store.read(other).order, ['x']);
  assert.equal(hero.flags, undefined);
  assert.ok(user.writes.every(w => w.scope === MODULE_ID && w.key.startsWith('layouts.')));
});

test('rapid edits serialize and survive a new store instance', async () => {
  const user = userWithFlags(), store = new LayoutStore(user), hero = actor();
  await Promise.all([
    store.update(hero, p => ({ ...p, hidden: toggleId(p.hidden, 'a') })),
    store.update(hero, p => ({ ...p, hidden: toggleId(p.hidden, 'b') })),
    store.update(hero, p => ({ ...p, pinned: ['spell'] }))
  ]);
  assert.deepEqual(new LayoutStore(user).read(hero).hidden, ['a', 'b']);
  assert.deepEqual(store.read(hero).pinned, ['spell']);
});

test('a rejected flag write is reported and does not poison later saves', async () => {
  const user = userWithFlags(), store = new LayoutStore(user), hero = actor();
  const setFlag = user.setFlag.bind(user);
  user.setFlag = async () => { throw new Error('Permission denied'); };
  await assert.rejects(store.update(hero, p => ({ ...p, hidden: ['a'] })), /Permission denied/);
  user.setFlag = setFlag;
  await store.update(hero, p => ({ ...p, hidden: ['b'] }));
  assert.deepEqual(store.read(hero).hidden, ['b']);
});
