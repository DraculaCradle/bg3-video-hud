import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';
import { chromium } from 'playwright';
import { SCREEN_SIZES, measureHUD } from '../tools/layout-viewports.mjs';

// Local, original synthetic fixtures only. No Foundry login or world requests.
const base = resolve(import.meta.dirname, '..');
const output = resolve(process.env.BG3_PREVIEW_DIR ?? join(base, 'e2e/results/responsive-previews'));
const server = createServer(async (request, response) => {
  try {
    const path = resolve(base, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!['tests', 'scripts', 'styles'].some(dir => path.startsWith(join(base, dir) + sep))) {
      response.writeHead(403).end(); return;
    }
    const data = await readFile(path);
    response.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream');
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  await mkdir(output, { recursive: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const measurements = [];
  for (const [width, height] of SCREEN_SIZES) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/compact-preview.html`);
    await page.locator('#bg3-video-hud').waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const layout = await page.evaluate(measureHUD);
    const file = `responsive-${width}x${height}.jpg`;
    await page.screenshot({ path: join(output, file), type: 'jpeg', quality: 85 });
    measurements.push({ viewport: { width, height }, file, ...layout });
  }
  await writeFile(join(output, 'measurements.json'), JSON.stringify({
    scope: 'Original synthetic preview; not Foundry or physical display acceptance', browser: browser.version(), measurements
  }, null, 2) + '\n');
  console.log(JSON.stringify(measurements.map(({ viewport, width, height, cell, font }) => ({ viewport, width, height, cell, font })), null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
