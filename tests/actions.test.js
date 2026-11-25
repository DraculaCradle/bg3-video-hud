import test from 'node:test';
import assert from 'node:assert/strict';
import { useOwnedItem, restActor } from '../scripts/actions.js';
import { actor, item } from './fixtures.js';

test('item use preserves receiver/event and returns official result without local consumption', async () => {
  const spell = item('spell', 'spell', { uses: { spent: 0, max: 1 } });
  const hero = actor('a', [spell], { system: { spells: { spell1: { value: 2, max: 4 } } } });
  const event = { shiftKey: false };
  let calls = 0;
  spell.use = async function(config) { assert.equal(this, spell); assert.equal(config.event, event); calls++; return { official: true }; };
  assert.deepEqual(await useOwnedItem(hero, spell.id, {}, event), { official: true });
  assert.equal(calls, 1);
  assert.equal(hero.system.spells.spell1.value, 2);
  assert.equal(spell.system.uses.spent, 0);
});

test('canceled official use returns no fabricated success and never retries another workflow', async () => {
  let calls = 0;
  const spell = item('spell', 'spell', {}, { use: async () => { calls++; return undefined; } });
  assert.equal(await useOwnedItem(actor('a', [spell]), 'spell', {}), undefined);
  assert.equal(calls, 1);
});

test('system error is propagated with no fallback or manual mutation', async () => {
  let calls = 0;
  const blade = item('blade', 'weapon', {}, { use: async () => { calls++; throw new Error('No valid activity'); } });
  await assert.rejects(useOwnedItem(actor('a', [blade]), 'blade', {}), /No valid activity/);
  assert.equal(calls, 1);
});

test('ownership is checked at action time, including revoked permission', async () => {
  const hero = actor('a', [item('blade', 'weapon', {}, { use: () => assert.fail('unowned item used') })], { isOwner: false });
  await assert.rejects(useOwnedItem(hero, 'blade', {}), /拥有权限/);
  await assert.rejects(restActor(hero, 'short', {}), /拥有权限/);
  await assert.rejects(useOwnedItem(null, 'blade', {}), /拥有权限/);
});

test('deleted, foreign and unsupported items produce actionable errors', async () => {
  const hero = actor('a', [item('bag')]);
  await assert.rejects(useOwnedItem(hero, 'foreign', {}), /不属于/);
  await assert.rejects(useOwnedItem(hero, 'bag', {}), /系统使用流程/);
});

test('explicit activity delegates to current embedded activity only', async () => {
  const event = {};
  const activity = { id: 'attack', use(config) { assert.equal(this, activity); assert.equal(config.event, event); return 'attack-result'; } };
  const weapon = item('blade', 'weapon', { activities: new Map([['attack', activity]]) });
  const hero = actor('a', [weapon]);
  assert.equal(await useOwnedItem(hero, 'blade', {}, event, 'attack'), 'attack-result');
  await assert.rejects(useOwnedItem(hero, 'blade', {}, event, 'foreign'), /无法使用/);
});

test('rest delegates to official methods and preserves dialogs/cancellation', async () => {
  let short = 0, long = 0;
  const hero = actor('a', [], { shortRest() { assert.equal(this, hero); short++; return undefined; }, longRest() { long++; return 'rest-result'; } });
  assert.equal(await restActor(hero, 'short', {}), undefined);
  assert.equal(await restActor(hero, 'long', {}), 'rest-result');
  assert.equal(short, 1); assert.equal(long, 1);
  await assert.rejects(restActor(hero, 'fake', {}), /不支持/);
  await assert.rejects(restActor(actor(), 'short', {}), /不支持休息/);
});

test('D&D5e 6.1 antimagic blocks a magical activity without consuming an action or resource', async () => {
  let calls = 0;
  const cast = { id: 'cast', visibility: { requireMagic: true }, canUse: false, isHidden: true, use: () => { calls++; } };
  const spell = item('spell', 'spell', { activities: [cast], magicAvailable: false, uses: { spent: 0, max: 1 } },
    { use: () => { calls++; } });
  const hero = actor('mage', [spell]);
  await assert.rejects(useOwnedItem(hero, 'spell', {}), /当前无法使用/);
  await assert.rejects(useOwnedItem(hero, 'spell', {}, {}, 'cast'), /当前无法使用/);
  assert.equal(calls, 0);
  assert.equal(spell.system.uses.spent, 0);

  spell.system.magicAvailable = true;
  cast.canUse = true;
  cast.isHidden = false;
  await useOwnedItem(hero, 'spell', {}, {}, 'cast');
  assert.equal(calls, 1);
});
