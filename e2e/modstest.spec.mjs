import { test } from '@playwright/test';
import { openGuard, GuardError } from './live-guard.mjs';
import { settings, cleanup, runScenario } from './scenario.mjs';
import { prepareCreatedFixtures, recoverCreatedFixtures, recoverOnlyFixtures } from './fixtures.mjs';
import { inspectSources } from './source-probe.mjs';
import { existsSync } from 'node:fs';

test(process.env.MODSTEST_SOURCE_PROBE === 'true' ? 'ModsTest SRD read-only inspection (no HUD acceptance)'
  : process.env.MODSTEST_RECOVER_ONLY === 'true' ? 'ModsTest fixture recovery only (no HUD acceptance)'
  : 'Gamemaster and Player1: HUD, shared-instance safety and fixture restoration', async ({ browser }, info) => {
  let guard;
  info.annotations.push({ type: 'stage', description: 'Authenticate existing GM and verify world/session guard' });
  try {
    guard = await openGuard(browser, settings());
    if (guard.config.sourceProbeOnly) {
      if (existsSync(guard.config.journal) || existsSync(guard.config.fixtureJournal)) {
        throw new GuardError('blocked', 'recover-pending-fixtures-before-source-inspection');
      }
      info.annotations.push({ type: 'stage', description: 'Inspect installed SRD sources without world writes' });
      const result = await guard.gm.evaluate(inspectSources);
      info.annotations.push({ type: 'observation', description: JSON.stringify(result) });
      await guard.check();
      if (result.indexRpc !== 'ok' || result.worldRead !== 'ok' || result.worldReadCount !== 0
          || !result.socketSessionMatchesUser || result.rawGet !== 'ok' || result.wrappedGet !== 'ok'
          || result.rawCount !== 1 || !result.wrappedFound) {
        throw new GuardError('blocked', 'srd-source-inspection-unavailable');
      }
      return;
    }
    if (guard.config.recoveryOnly) {
      info.annotations.push({ type: 'stage', description: 'Recover marked temporary documents and saved fixture data only' });
      await recoverOnlyFixtures(guard, cleanup);
      info.annotations.push({ type: 'verified', description: 'Pending fixture journals recovered and absent; no new actors or HUD test started' });
      return;
    }
    await recoverCreatedFixtures(guard, cleanup);
    try {
      if (guard.config.createFixtures) {
        info.annotations.push({ type: 'stage', description: 'Import temporary SRD actors and create marked tokens' });
        await prepareCreatedFixtures(guard, info);
      }
      await runScenario(guard, info);
    } finally {
      await recoverOnlyFixtures(guard, cleanup);
      info.annotations.push({ type: 'verified', description: 'Fixture recovery completed; both private recovery journals absent' });
    }
  } catch (error) {
    if (error instanceof GuardError) info.annotations.push({ type: 'guard', description: error.reason });
    if (error.cleanupReason) info.annotations.push({ type: 'cleanup', description: error.cleanupReason });
    throw error;
  } finally {
    try { await guard?.close(); }
    catch (error) {
      info.annotations.push({ type: 'cleanup', description: error instanceof GuardError ? error.reason : 'test-session-release-unconfirmed' });
      throw error;
    }
  }
});
