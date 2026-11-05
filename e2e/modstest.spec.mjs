import { test } from '@playwright/test';
import { openGuard, GuardError } from './live-guard.mjs';
import { settings, cleanup, runScenario } from './scenario.mjs';
import { prepareCreatedFixtures, recoverCreatedFixtures } from './fixtures.mjs';

test('Gamemaster and Player1: HUD, shared-instance safety and fixture restoration', async ({ browser }, info) => {
  let guard;
  info.annotations.push({ type: 'stage', description: 'Authenticate existing GM and verify world/session guard' });
  try {
    guard = await openGuard(browser, settings());
    await recoverCreatedFixtures(guard, cleanup);
    try {
      if (guard.config.createFixtures) {
        info.annotations.push({ type: 'stage', description: 'Import temporary SRD actors and create marked tokens' });
        await prepareCreatedFixtures(guard, info);
      }
      await runScenario(guard, info);
    } finally { await recoverCreatedFixtures(guard, cleanup); }
  } catch (error) {
    if (error instanceof GuardError) info.annotations.push({ type: 'guard', description: error.reason });
    throw error;
  } finally { await guard?.close(); }
});
