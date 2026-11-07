import { defineConfig } from '@playwright/test';
import { clientBrowserOptions } from './browser-client.mjs';

const { channel, headless, ...launchOptions } = clientBrowserOptions();

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
    channel,
    headless,
    launchOptions,
    ignoreHTTPSErrors: false,
    screenshot: 'off',
    video: 'off',
    trace: 'off'
  }
});
