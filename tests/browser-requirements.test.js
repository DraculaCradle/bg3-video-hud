import test from 'node:test';
import assert from 'node:assert/strict';
import { requireFoundryChromium } from '../e2e/browser-requirements.mjs';

test('Foundry Chromium gate rejects the previous browser and unknown versions', () => {
  for (const version of ['141.0.7390.37', '145.0.0.0', '', 'unknown', '146']) {
    assert.throws(() => requireFoundryChromium(version), /stopped before Foundry login/);
  }
});
test('Foundry Chromium gate accepts the minimum and newer pinned browsers', () => {
  for (const version of ['146.0.0.0', '158.0.8127.18']) assert.equal(requireFoundryChromium(version), version);
});
