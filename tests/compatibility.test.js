import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsHUD } from '../scripts/compatibility.js';

test('Foundry 14.370 accepts D&D5e 6.1.1 and prior supported stable versions', () => {
  for (const version of ['6.0.6', '6.1.0', '6.1.1']) assert.equal(supportsHUD('14.370', 'dnd5e', version), true);
  assert.equal(supportsHUD('14.367', 'dnd5e', '6.1.1'), true);
});

test('unsupported Foundry or system versions keep the native interface', () => {
  for (const core of ['14', '14.366', '14.370-rc1', '15.371', undefined]) {
    assert.equal(supportsHUD(core, 'dnd5e', '6.1.1'), false);
  }
  for (const system of ['6.0.5', '6.1.2', '6.1.1-rc1', undefined]) {
    assert.equal(supportsHUD('14.370', 'dnd5e', system), false);
  }
  assert.equal(supportsHUD('14.370', 'other', '6.1.1'), false);
});
