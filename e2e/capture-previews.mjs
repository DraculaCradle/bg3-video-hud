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
  await page.setViewportSize({ width: 1280, height: 720 });
  const fresh = () => page.goto(`http://127.0.0.1:${server.address().port}/tests/compact-preview.html`);
  await fresh(); await page.locator('#bg3-video-hud').waitFor();
  await page.evaluate(() => {
    const { hud, hero } = window.compactPreview;
    hud.busy.add(`${hero.uuid}:spell-2`); void hud.chooseUse(hero, hero.items.get('spell-2'));
  });
  await page.locator('[data-action="choose-activity"]').click();
  await page.screenshot({ path: join(output, 'complete-casting-720p.jpg'), type: 'jpeg', quality: 85 });
  await page.locator('[data-action="source-manager"]').click();
  await page.screenshot({ path: join(output, 'complete-source-720p.jpg'), type: 'jpeg', quality: 85 });
  await fresh(); await page.locator('#bg3-video-hud').waitFor();
  await page.locator('[data-action="edit-group"][data-value="Spells"]').click();
  await page.screenshot({ path: join(output, 'complete-edit-720p.jpg'), type: 'jpeg', quality: 85 });
  await fresh(); await page.locator('#bg3-video-hud').waitFor();
  await page.locator('[data-action="use"][data-item-id="spell-2"]').hover();
  await page.locator('.bg3-video-hud-tooltip').waitFor();
  await page.screenshot({ path: join(output, 'complete-tooltip-720p.jpg'), type: 'jpeg', quality: 85 });
  await fresh(); await page.locator('#bg3-video-hud').waitFor();
  await page.evaluate(() => {
    const { hud, hero } = window.compactPreview;
    hud.busy.add(`${hero.uuid}:spell-2`);
    void hud.allocate({ item: hero.items.get('spell-2'), count: 3, consumed: false,
      selected: [{ id: 'preview-a', document: { name: '模拟目标甲' } }, { id: 'preview-b', document: { name: '模拟目标乙' } }] });
  });
  await page.locator('[data-action="allocate-plus"][data-value="preview-a"]').click();
  await page.locator('[data-action="allocate-plus"][data-value="preview-b"]').click();
  await page.screenshot({ path: join(output, 'complete-allocation-720p.jpg'), type: 'jpeg', quality: 85 });
  await writeFile(join(output, 'measurements.json'), JSON.stringify({
    scope: 'Original synthetic preview; not Foundry or physical display acceptance', browser: browser.version(), measurements
  }, null, 2) + '\n');
  console.log(JSON.stringify(measurements.map(({ viewport, width, height, cell, font }) => ({ viewport, width, height, cell, font })), null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
