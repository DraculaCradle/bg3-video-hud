import { test } from '@playwright/test';
import { openGuard } from './live-guard.mjs';
import { settings, runScenario } from './scenario.mjs';

test('Gamemaster and Player1: HUD, shared-instance safety and fixture restoration', async ({ browser }, info) => {
  const guard = await openGuard(browser, settings());
  try { await runScenario(guard, info); }
  finally { await guard.close(); }
});
