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
  await assert.rejects(useOwnedItem(hero, 'blade', {}), /own/);
  await assert.rejects(restActor(hero, 'short', {}), /own/);
  await assert.rejects(useOwnedItem(null, 'blade', {}), /own/);
});

test('deleted, foreign and unsupported items produce actionable errors', async () => {
  const hero = actor('a', [item('bag')]);
  await assert.rejects(useOwnedItem(hero, 'foreign', {}), /no longer belongs/);
  await assert.rejects(useOwnedItem(hero, 'bag', {}), /no system use workflow/);
});

test('explicit activity delegates to current embedded activity only', async () => {
  const event = {};
  const activity = { id: 'attack', use(config) { assert.equal(this, activity); assert.equal(config.event, event); return 'attack-result'; } };
  const weapon = item('blade', 'weapon', { activities: new Map([['attack', activity]]) });
  const hero = actor('a', [weapon]);
  assert.equal(await useOwnedItem(hero, 'blade', {}, event, 'attack'), 'attack-result');
  await assert.rejects(useOwnedItem(hero, 'blade', {}, event, 'foreign'), /cannot be used/);
});

test('rest delegates to official methods and preserves dialogs/cancellation', async () => {
  let short = 0, long = 0;
  const hero = actor('a', [], { shortRest() { assert.equal(this, hero); short++; return undefined; }, longRest() { long++; return 'rest-result'; } });
  assert.equal(await restActor(hero, 'short', {}), undefined);
  assert.equal(await restActor(hero, 'long', {}), 'rest-result');
  assert.equal(short, 1); assert.equal(long, 1);
  await assert.rejects(restActor(hero, 'fake', {}), /Unsupported/);
  await assert.rejects(restActor(actor(), 'short', {}), /does not support/);
});
