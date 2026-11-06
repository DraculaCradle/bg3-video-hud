import { mkdirSync, writeFileSync } from 'node:fs';

// Default Playwright errors/attachments can contain credentials or world data.
// Persist only controlled test titles, status, versions and assertion counts.
export default class SafeReporter {
  results = [];
  onBegin(_config, suite) {
    process.stdout.write(`ModsTest: ${suite.allTests().length} live scenario(s) discovered\n`);
  }
  onTestEnd(test, result) {
    this.results.push({ check: test.title, status: result.status,
      durationMs: result.duration,
      lastStage: result.annotations.filter(a => a.type === 'stage').at(-1)?.description,
      guardReason: result.annotations.filter(a => a.type === 'guard').at(-1)?.description,
      cleanupReason: result.annotations.filter(a => a.type === 'cleanup').at(-1)?.description,
      observations: result.annotations.filter(a => a.type === 'observation').map(a => a.description),
      assertions: result.annotations
        .filter(a => a.type === 'verified').map(a => a.description) });
    process.stdout.write(`ModsTest: ${result.status}\n`);
  }
  onEnd(result) {
    mkdirSync('results', { recursive: true });
    writeFileSync('results/report.json', JSON.stringify({
      status: this.results.length ? result.status : 'not-run', executedAt: new Date().toISOString(),
      mode: process.env.MODSTEST_CLIENT_PROBE === 'true' ? 'client-inspection'
        : process.env.MODSTEST_SOURCE_PROBE === 'true' ? 'source-inspection'
        : process.env.MODSTEST_RECOVER_ONLY === 'true' ? 'recovery-only' : 'acceptance',
      commit: process.env.GITHUB_SHA ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      scope: 'Existing Foundry instance / ModsTest / Gamemaster and Player1', tests: this.results
    }, null, 2) + '\n');
  }
}
