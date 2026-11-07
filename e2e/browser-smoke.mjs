import { chromium } from 'playwright';
import { requireFoundryChromium } from './browser-requirements.mjs';
import { clientBrowserOptions } from './browser-client.mjs';

// No login, secrets, world writes or server requests. Launch alone does not
// prove that a headless browser can render Foundry's WebGL2 canvas.
const browser = await chromium.launch({ ...clientBrowserOptions(),
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  const version = requireFoundryChromium(browser.version());
  const page = await browser.newPage();
  const supported = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const supported = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return supported;
  });
  console.log(`ModsTest browser: channel=chromium (full), Chromium=${version}, WebGL2=${supported}`);
  if (!supported) throw Error('Chromium WebGL2 unavailable; stopped before Foundry login');
} finally { await browser.close(); }
