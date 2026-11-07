import { test } from '@playwright/test';
import { openGuard, GuardError, validateModuleVersion } from './live-guard.mjs';
import { settings, cleanup, runScenario } from './scenario.mjs';
import { prepareCreatedFixtures, recoverCreatedFixtures, recoverOnlyFixtures } from './fixtures.mjs';
import { inspectSources } from './source-probe.mjs';
import { inspectClient, observeControlFrames } from './client-probe.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const expectedVersion = JSON.parse(readFileSync(new URL('../module.json', import.meta.url))).version;
function checkoutAssets() {
  return Object.fromEntries(['scripts', 'styles'].flatMap(dir =>
    readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(name => /\.(js|css)$/.test(name)).map(name => {
      const path = `${dir}/${name}`;
      return [path, createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')];
    })));
}

test(process.env.MODSTEST_CLIENT_PROBE === 'true' ? 'ModsTest read-only client inspection (no document RPC or HUD acceptance)'
  : process.env.MODSTEST_SOURCE_PROBE === 'true' ? 'ModsTest SRD read-only inspection (no HUD acceptance)'
  : process.env.MODSTEST_RECOVER_ONLY === 'true' ? 'ModsTest fixture recovery only (no HUD acceptance)'
  : 'Gamemaster and Player1: HUD, shared-instance safety and fixture restoration', async ({ browser }, info) => {
  let guard, observer;
  info.annotations.push({ type: 'stage', description: 'Authenticate existing GM and verify world/session guard' });
  try {
    const config = settings();
    guard = await openGuard(browser, config, { beforeLogin: async page => {
      if (config.clientProbeOnly) {
        try { observer = await observeControlFrames(page); }
        catch { throw new GuardError('blocked', 'client-control-observer-unavailable'); }
      }
    } });
    info.annotations.push({ type: 'verified', description: 'Own anonymous join connection closed before GM authentication' });
    const installed = await guard.check();
    // Recovery must remain possible across upgrades. Diagnostics/acceptance may
    // never turn an older installed module into a result for the new release.
    if (!guard.config.recoveryOnly) {
      validateModuleVersion(installed, expectedVersion);
      info.annotations.push({ type: 'verified', description: `Installed module matches checkout v${expectedVersion}` });
    }
    if (guard.config.clientProbeOnly) {
      if (existsSync(guard.config.journal) || existsSync(guard.config.fixtureJournal)) {
        throw new GuardError('blocked', 'recover-pending-fixtures-before-client-inspection');
      }
      info.annotations.push({ type: 'stage', description: 'Wait for native canvas readiness when a scene is active; no document request' });
      const readyStart = Date.now();
      try { await guard.gm.waitForFunction(() => globalThis.canvas?.ready === true || !game.scenes?.active, undefined, { timeout: 60_000 }); }
      catch { throw new GuardError('blocked', 'client-canvas-initialization-unfinished'); }
      const readyWaitMs = Date.now() - readyStart;
      await guard.check();
      info.annotations.push({ type: 'stage', description: 'Inspect client interfaces and one native read-only clock acknowledgement; no document request' });
      const framesBeforeInspection = observer.read();
      observer.reset();
      let result;
      try { result = await guard.gm.evaluate(inspectClient); }
      catch (error) {
        const reason = ['client-rendering-idle-unavailable', 'client-rendering-restoration-unconfirmed',
          'client-probe-guard-denied'].find(value => error.message?.includes(value));
        throw new GuardError('blocked', reason ?? 'client-readonly-inspection-failed');
      }
      // Retain only passive counts from login/initialization. A successful
      // bootstrap reply must not make the explicit post-ready query pass.
      result.framesBeforeInspection = framesBeforeInspection;
      result.readyWaitMs = readyWaitMs;
      result.canvasState = await guard.gm.evaluate(() => ({ ready: globalThis.canvas?.ready === true, activeScene: !!game.scenes?.active }));
      result.framesAtResolution = observer.read();
      // Passive drain only: an expired page timer may have run late under load.
      // Preserve timeout status and expose late frames instead of retrying.
      await guard.gm.waitForTimeout(1000);
      result.frames = observer.read();
      info.annotations.push({ type: 'observation', description: JSON.stringify(result) });
      await guard.check();
      if (result.status.status !== 'ok' || result.status.validTime !== true) {
        throw new GuardError('blocked', 'readonly-native-clock-ack-unavailable');
      }
      return;
    }
    if (guard.config.sourceProbeOnly) {
      if (existsSync(guard.config.journal) || existsSync(guard.config.fixtureJournal)) {
        throw new GuardError('blocked', 'recover-pending-fixtures-before-source-inspection');
      }
      info.annotations.push({ type: 'stage', description: 'Inspect installed SRD sources without world writes' });
      const names = new Set(), allowedNames = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError']);
      const onError = error => names.add(allowedNames.has(error.name) ? error.name : 'OtherError');
      guard.gm.on('pageerror', onError);
      let result;
      try { result = await guard.gm.evaluate(inspectSources); }
      finally { guard.gm.off('pageerror', onError); }
      result.clientErrorNames = [...names];
      info.annotations.push({ type: 'observation', description: JSON.stringify(result) });
      await guard.check();
      if (result.indexRpc !== 'ok' || result.worldRead !== 'ok' || result.worldReadCount !== 0
          || !result.socketSessionMatchesUser || result.rawGet !== 'ok' || result.wrappedGet !== 'ok'
          || result.rawAckArgs !== 1 || result.rawFirstKind !== 'object' || result.rawErrorPresent
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
      await guard.assets(checkoutAssets());
      info.annotations.push({ type: 'verified', description: 'Served runtime JS/CSS match this checkout before fixture creation' });
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
    } finally { await observer?.close(); }
  }
});
