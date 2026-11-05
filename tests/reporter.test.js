import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('live reporter excludes credentials, errors and attachments and never passes an unexecuted suite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bg3-report-'));
  try {
    const reporter = new URL('../e2e/safe-reporter.mjs', import.meta.url).href;
    const script = `
      import Reporter from ${JSON.stringify(reporter)};
      const empty = new Reporter(); empty.onEnd({ status: 'passed' });
      const { readFileSync } = await import('node:fs');
      if (JSON.parse(readFileSync('results/report.json')).status !== 'not-run') process.exit(1);
      const report = new Reporter();
      report.onTestEnd({ title: 'controlled scenario' }, {
        status: 'failed', duration: 5, annotations: [{ type: 'verified', description: 'HP' }],
        error: { message: 'SENTINEL_PASSWORD' },
        attachments: [{ body: 'SENTINEL_PASSWORD' }], stdout: ['SENTINEL_PASSWORD']
      });
      report.onEnd({ status: 'failed' });
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(join(directory, 'results/report.json'), 'utf8');
    assert.equal(text.includes('SENTINEL_PASSWORD'), false);
    assert.equal(result.stdout.includes('SENTINEL_PASSWORD'), false);
    assert.deepEqual(JSON.parse(text).tests[0].assertions, ['HP']);
    assert.equal(JSON.parse(text).status, 'failed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
