import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { openGuard, GuardError } from './live-guard.mjs';
import { settings, cleanup, runScenario } from './scenario.mjs';

let browser, guard;
const reply = value => process.stdout.write(JSON.stringify(value) + '\n');
function failure(error) {
  return { ok: false, status: error instanceof GuardError ? error.status : 'failed',
    reason: error instanceof GuardError ? error.reason : 'live-check-or-fixture-restoration-failed' };
}
try {
  const config = settings();
  browser = await chromium.launch();
  guard = await openGuard(browser, config);
  reply({ ok: true, value: await guard.check() });
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      const request = JSON.parse(line);
      let value;
      if (request.op === 'check') value = await guard.check();
      else if (request.op === 'assets') { await guard.assets(request.assets); value = { verified: true }; }
      else if (request.op === 'cleanup') { await cleanup(guard); value = { restored: true }; }
      else if (request.op === 'test') {
        const info = { annotations: [] };
        const started = Date.now();
        let status = 'passed';
        try { await runScenario(guard, info); }
        catch (error) { status = 'failed'; throw error; }
        finally {
          mkdirSync('e2e/results', { recursive: true });
          writeFileSync('e2e/results/report.json', JSON.stringify({
            status, commit: process.env.GITHUB_SHA ?? null, executedAt: new Date().toISOString(),
            scope: 'Existing Foundry instance / ModsTest / Gamemaster and Player1',
            tests: [{ check: 'HUD and fixture restoration', status, durationMs: Date.now() - started,
              lastStage: info.annotations.filter(a => a.type === 'stage').at(-1)?.description,
              assertions: info.annotations.filter(a => a.type === 'verified').map(a => a.description) }]
          }, null, 2) + '\n');
        }
        value = { passed: true };
      } else throw new GuardError('blocked', 'unsupported-guard-operation');
      reply({ ok: true, value });
    } catch (error) { reply(failure(error)); }
  }
} catch (error) { reply(failure(error)); process.exitCode = 1; }
finally { await guard?.close(); await browser?.close(); }
