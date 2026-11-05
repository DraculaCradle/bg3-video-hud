import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'modstest.spec.mjs',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['./safe-reporter.mjs']],
  use: {
    browserName: 'chromium',
    headless: true,
    ignoreHTTPSErrors: false,
    screenshot: 'off',
    video: 'off',
    trace: 'off'
  }
});
