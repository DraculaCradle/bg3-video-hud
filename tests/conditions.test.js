import test from 'node:test';
import assert from 'node:assert/strict';
import { portraitConditions, conditionRing } from '../scripts/conditions.js';

const registry = [{ id: 'poisoned', name: 'Condition.Poisoned', img: 'poison.svg' },
  { id: 'prone', name: 'Condition.Prone', img: 'prone.svg' }];
const localize = key => ({ 'Condition.Poisoned': '中毒', 'Condition.Prone': '倒地' })[key] ?? key;

test('portrait combines active native temporary effects and conditions once, excluding disabled/suppressed effects without mutation', () => {
  const actor = { temporaryEffects: [
    { id: 'poison', name: '中毒', img: 'poison.svg', statuses: new Set(['poisoned']) },
    { id: 'buff', name: '祝福', img: 'bless.svg' },
    { id: 'no-icon', name: '无图标状态' },
    { id: 'off', name: '停用', img: 'off.svg', disabled: true },
    { id: 'suppressed', name: '抑制', img: 'off.svg', isSuppressed: true }
  ], statuses: new Set(['poisoned', 'prone']) };
  const before = structuredClone(actor);
  const entries = portraitConditions(actor, { document: { overlayEffect: 'poison.svg' } }, registry, localize);
  assert.deepEqual(entries.map(e => e.name), ['中毒', '祝福', '无图标状态', '倒地']);
  assert.deepEqual(actor, before);
});

test('native temporary collection is authoritative; fallback excludes passive effects but keeps distinct buffs sharing an icon', () => {
  const passive = { id: 'passive', img: 'passive.svg', isTemporary: false };
  assert.deepEqual(portraitConditions({ temporaryEffects: [], effects: [passive] }), []);
  const actor = { appliedEffects: [passive, { id: 'a', name: '效果A', img: 'same.svg' }, { id: 'b', name: '效果B', img: 'same.svg' }] };
  assert.deepEqual(portraitConditions(actor).map(e => e.name), ['效果A', '效果B']);
});

test('token overlay belongs to the current token, with registry and unknown-status name fallbacks', () => {
  const actor = { statuses: new Set(['unknown']) };
  const a = portraitConditions(actor, { document: { overlayEffect: 'prone.svg' } }, registry, localize);
  const b = portraitConditions(actor, { document: { overlayEffect: 'other.svg' } }, registry, localize);
  assert.deepEqual(a.map(e => e.name), ['unknown', '倒地']);
  assert.equal(b[1].img, 'other.svg');
  assert.deepEqual(portraitConditions(null), []);
});

test('ring overflow retains all names in a reachable badge and circular slots never overlap or leave the portrait bounds', () => {
  const entries = Array.from({ length: 18 }, (_, i) => ({ key: String(i), name: `状态${i}` }));
  const ring = conditionRing(entries);
  assert.equal(ring.length, 10); assert.equal(ring.at(-1).count, 9);
  assert.equal(ring.at(-1).name, entries.slice(9).map(e => e.name).join('、'));
  for (const [i, a] of ring.entries()) {
    assert.ok(a.x >= 8 && a.x <= 92 && a.y >= 8 && a.y <= 92);
    for (const b of ring.slice(i + 1)) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 16);
  }
  assert.deepEqual(conditionRing([]), []);
});

test('the whole neighboring arc is centred over the portrait for odd, even and overflowing condition counts', () => {
  const entries = Array.from({ length: 18 }, (_, i) => ({ key: String(i), name: `状态${i}` }));
  for (let n = 1; n <= 18; n++) {
    const ring = conditionRing(entries.slice(0, n));
    if (n <= 5) assert.ok(ring.every(p => p.y < 50), 'Small groups belong above the portrait centre');
    assert.ok(Math.abs(ring.reduce((sum, p) => sum + p.x, 0) / ring.length - 50) < 1e-8);
    ring.forEach((p, i) => {
      const other = ring[ring.length - 1 - i];
      assert.ok(Math.abs(p.x + other.x - 100) < 1e-8 && Math.abs(p.y - other.y) < 1e-8);
    });
    if (ring.length % 2) assert.ok(Math.abs(ring[Math.floor(ring.length / 2)].x - 50) < 1e-8);
    if (n > 1) assert.ok(Math.hypot(ring[0].x - ring[1].x, ring[0].y - ring[1].y) < 28, 'Two conditions must be adjacent, not opposite');
  }
});
