import { routeSettings } from './client-route.mjs';

// Explicitly select full Chromium's headless mode. Playwright's default
// headless launch selects its separate headless-shell executable instead.
// Share the selection between pre-login smoke, live tests and deploy guard.
export function clientBrowserOptions(environment = process.env) {
  return { channel: 'chromium', headless: true, args: routeSettings(environment).args };
}
