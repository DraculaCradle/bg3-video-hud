import { defineConfig } from '@playwright/test';
import { routeSettings } from './client-route.mjs';

export default defineConfig({
  testDir: '.',
  testMatch: 'modstest.spec.mjs',
  workers: 1,
  retries: 0,
  // Multiple real Foundry clients/reloads plus confirmed native logout need
  // their own bounded startup windows on the shared server.
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: [['./safe-reporter.mjs']],
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: { args: routeSettings().args },
    ignoreHTTPSErrors: false,
    screenshot: 'off',
    video: 'off',
    trace: 'off'
  }
});
