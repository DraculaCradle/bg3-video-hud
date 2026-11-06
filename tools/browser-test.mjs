import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, extname, sep, join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { SCREEN_SIZES, ZOOM_CASES, measureHUD } from './layout-viewports.mjs';

const base = process.cwd();
const server = createServer(async (request, response) => {
  try {
    const path = resolve(base, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(base + sep)) { response.writeHead(403).end(); return; }
    const data = await readFile(path);
    response.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' }[extname(path)] ?? 'application/octet-stream');
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
const profile = mkdtempSync(join(tmpdir(), 'bg3-video-hud-browser-'));
let child, socket;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const executable = process.env.CHROMIUM_PATH || 'chromium';
  child = spawn(executable, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--disable-background-networking', `--user-data-dir=${profile}`,
    '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let errors = '';
    const timer = setTimeout(() => reject(new Error(`Chromium DevTools startup timed out; ${errors.slice(-2048)}`)), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited before DevTools startup (${code ?? signal}); ${errors.slice(-2048)}`));
    });
    child.stderr.on('data', data => {
      errors = (errors + data).slice(-8192);
      const match = errors.match(/DevTools listening on (ws:\/\/\S+)[\r\n]/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer); pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`DevTools timed out: ${method}`)); }, 10000);
    pending.set(key, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  console.log(`Browser: ${(await send('Browser.getVersion')).product}`);
  const { targetInfos } = await send('Target.getTargets');
  const targetId = targetInfos.find(target => target.type === 'page')?.targetId;
  if (!targetId) throw new Error('Chromium created no page');
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  };
  const press = async (key, code, virtualKey) => {
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey,
        ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) }, sessionId);
    }
    await evaluate('new Promise(resolve => setTimeout(resolve, 0))');
  };
  const interactions = async () => {
    const outcomes = [];
    const test = async (name, callback) => {
      try { await callback(); outcomes.push({ name, passed: true }); }
      catch (error) { outcomes.push({ name, passed: false, error: error.message }); }
    };
    const measurements = [];
    const measure = () => evaluate(`new Promise(resolve => requestAnimationFrame(() => resolve((${measureHUD.toString()})())))`);
    const setViewport = ({ width, height, deviceScaleFactor = 1 }) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false }, sessionId);
    const extras = [[390, 844], [650, 900], [1024, 576], [1024, 600], [1280, 600], [1366, 720], [1440, 900], [3440, 1440], [2560, 720]];
    const cases = [...extras.map(([width, height]) => ({ width, height, deviceScaleFactor: 1, label: `${width}x${height} viewport` })), ...ZOOM_CASES];
    for (const viewport of cases) {
      const { width, height, deviceScaleFactor } = viewport;
      await test(`HUD fits ${viewport.label} with reachable controls and items`, async () => {
        await setViewport(viewport);
        const layout = await measure();
        measurements.push({ ...viewport, viewportWidth: width, viewportHeight: height, ...layout });
        assert.ok(layout.left >= -1 && layout.right <= width + 1 && layout.top >= 0 && layout.bottom <= height, JSON.stringify(layout));
        assert.ok(layout.scrollWidth <= layout.clientWidth + 1, 'HUD overflows horizontally');
        assert.ok(layout.controlsFit, 'Edit, Original HUD and rests must stay within the dock');
        assert.equal(layout.lists.length, 3);
        assert.ok(layout.lists.every(list => list.height > 0 && list.firstFits && list.left >= layout.left && list.right <= layout.right), JSON.stringify(layout));
        assert.ok(layout.height <= Math.max(145, height * .4), 'Dock leaves useful map height even in short zoomed viewports');
        assert.equal(layout.dpr, deviceScaleFactor);
        assert.ok(layout.cell >= 31.5 && layout.cell <= 72 && layout.font >= 11 && layout.font <= 24);
        if (height <= 720 && width > 650) assert.ok(layout.height <= 190, '720P dock stays compact');
      });
    }
    await test('native 720P to 4K sizes grow smoothly and stop growing beyond the cap', async () => {
      const native = SCREEN_SIZES.map(([w, h]) => measurements.find(m => m.screenWidth === w && m.screenHeight === h && m.zoom === 1));
      for (let i = 1; i < native.length; i++) {
        for (const property of ['height', 'width', 'cell', 'font', 'gap', 'portrait']) assert.ok(native[i][property] > native[i - 1][property], property);
      }
      assert.ok(native[4].height > native[0].height * 1.5 && native[4].height < 400);
      assert.ok(native[4].cell > native[0].cell * 1.5);
      await setViewport({ width: 5120, height: 2880 });
      const capped = await measure();
      for (const key of ['width', 'height', 'cell', 'font']) assert.ok(Math.abs(capped[key] - native[4][key]) < 1, key);
    });
    await test('DPR-only change preserves CSS size instead of multiplying it twice', async () => {
      await setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
      const before = await measure();
      for (const deviceScaleFactor of [1.25, 1.5, 2, 4]) {
        await setViewport({ width: 1280, height: 720, deviceScaleFactor });
        const after = await measure();
        for (const key of ['left', 'width', 'height', 'cell', 'font']) assert.ok(Math.abs(before[key] - after[key]) < .1, key);
        assert.equal(after.dpr, deviceScaleFactor);
      }
    });
    await test('focused level-9 filter stays visible across live 4K to 200% 720P resizing without flag writes', async () => {
      await setViewport({ width: 3840, height: 2160 });
      await evaluate('window.bg3LayoutTest.crowded()');
      await evaluate(`document.querySelector('#bg3-video-hud [data-action=filter-level][data-value="9"]').focus()`);
      await press('Enter', 'Enter', 13);
      const writes = await evaluate('window.bg3LayoutTest.writes()');
      for (const viewport of [{ width: 640, height: 360, deviceScaleFactor: 2 }, { width: 1920, height: 1080 }]) {
        await setViewport(viewport);
        await measure();
        const focused = await evaluate(`(() => {
          const button = document.activeElement, b = button.getBoundingClientRect();
          return { value: button.dataset.value, pressed: button.getAttribute('aria-pressed'), hit: button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) };
        })()`);
        assert.deepEqual(focused, { value: '9', pressed: 'true', hit: true });
      }
      assert.equal(await evaluate('window.bg3LayoutTest.writes()'), writes);
      await evaluate('window.bg3LayoutTest.reset()');
    });
    await test('200% 720P effective viewport retains keyboard ordering, focus and Original HUD access', async () => {
      await setViewport({ width: 640, height: 360, deviceScaleFactor: 2 });
      await evaluate('window.bg3LayoutTest.crowded()');
      try {
        await evaluate('document.querySelector("#bg3-video-hud [data-action=edit]").focus()');
        await press('Enter', 'Enter', 13);
        const before = await evaluate(`(() => {
          const list = document.querySelector('#bg3-video-hud .bg3-video-hud-items');
          list.querySelector('[data-action=move][data-direction="1"]').focus();
          return [...list.children].map(item => item.dataset.itemId);
        })()`);
        await press('Enter', 'Enter', 13);
        const after = await evaluate(`(() => {
          const button = document.activeElement, b = button.getBoundingClientRect();
          const region = button.closest('[data-scroll-group]'), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
          return { ids: [...document.querySelector('#bg3-video-hud .bg3-video-hud-items').children].map(item => item.dataset.itemId),
            item: button.dataset.itemId, hit: button.contains(hit),
            geometry: { button: b.toJSON(), region: region.getBoundingClientRect().toJSON(), scrollTop: region.scrollTop, hitTag: hit?.tagName, hitClass: hit?.className } };
        })()`);
        assert.deepEqual(after.ids, [before[1], before[0], ...before.slice(2)]);
        assert.equal(after.item, before[0]);
        assert.equal(after.hit, true, JSON.stringify(after.geometry));
        assert.ok((await measure()).controlsFit);
        await evaluate('document.querySelector("#bg3-video-hud [data-action=disable]").focus()');
        await press('Enter', 'Enter', 13);
        assert.ok(await evaluate('!document.getElementById("bg3-video-hud") && getComputedStyle(document.getElementById("bg3-hotbar")).display !== "none"'));
      } finally {
        await evaluate('window.bg3LayoutTest.reset()');
        await evaluate('window.bg3LayoutTest.enable()');
      }
    });
    mkdirSync('e2e/results', { recursive: true });
    writeFileSync('e2e/results/layout-metrics.json', JSON.stringify({ scope: 'Synthetic viewport/DPR emulation; not real hardware or Foundry acceptance', measurements }, null, 2) + '\n');
    await test('crowded 720P dock keeps fixed height and all three groups reachable by real wheel scrolling', async () => {
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
      await evaluate('window.bg3LayoutTest.crowded()');
      await evaluate('document.querySelector("#bg3-video-hud .bg3-video-hud-items li:first-child button").focus()');
      const lists = await evaluate(`[...document.querySelectorAll('#bg3-video-hud .bg3-video-hud-items')].map(list => {
        const b = list.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2,
          overflows: list.scrollHeight > list.clientHeight };
      })`);
      assert.ok(lists.every(list => list.overflows));
      for (const { x, y } of lists) {
        await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 2000 }, sessionId);
        await evaluate('new Promise(resolve => setTimeout(resolve, 80))');
      }
      const before = await evaluate('[...document.querySelectorAll("#bg3-video-hud .bg3-video-hud-items")].map(list => list.scrollTop)');
      assert.ok(before.every(top => top > 0), JSON.stringify(before));
      await evaluate('window.bg3LayoutTest.refresh()');
      assert.deepEqual(await evaluate('[...document.querySelectorAll("#bg3-video-hud .bg3-video-hud-items")].map(list => list.scrollTop)'), before);
      for (let index = 0; index < 3; index++) {
        const reachable = await evaluate(`(() => {
          const list = document.querySelectorAll('#bg3-video-hud .bg3-video-hud-items')[${index}];
          const button = list.querySelector('li:last-child button');
          button.focus(); const b = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
        })()`);
        assert.equal(reachable, true, `Last item in group ${index} must be clickable`);
      }
      assert.ok(await evaluate('document.getElementById("bg3-video-hud").getBoundingClientRect().height <= 190'));
    });
    await test('high-level spell filters remain keyboard reachable without enlarging the 720P dock', async () => {
      await evaluate(`document.querySelector('#bg3-video-hud [data-action=filter-level][data-value="9"]').focus()`);
      await press('Enter', 'Enter', 13);
      assert.equal(await evaluate(`document.querySelector('#bg3-video-hud [data-action=filter-level][data-value="9"]').getAttribute('aria-pressed')`), 'true');
      const hit = await evaluate(`(() => {
        const button = document.querySelector('#bg3-video-hud [data-action=filter-level][data-value="9"]');
        const b = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
      })()`);
      assert.equal(hit, true);
    });
    await test('720P edit controls remain reachable without returning to a tall item list', async () => {
      await evaluate('document.querySelector("#bg3-video-hud [data-action=edit]").click()');
      assert.ok(await evaluate('document.getElementById("bg3-video-hud").getBoundingClientRect().height <= 190'));
      const controlsFit = await evaluate(`[...document.querySelectorAll('#bg3-video-hud .bg3-video-hud-items')].every(list => {
        const controls = list.querySelector('.bg3-video-hud-edit-controls');
        const a = controls.getBoundingClientRect(), b = list.getBoundingClientRect();
        return a.left >= b.left && a.right <= b.right;
      })`);
      assert.equal(controlsFit, true);
      await evaluate('window.bg3LayoutTest.reset()');
      assert.ok(await evaluate('[...document.querySelectorAll("#bg3-video-hud .bg3-video-hud-items")].every(list => list.scrollTop === 0)'));
    });
    await test('real Enter key activates the focused Edit button', async () => {
      await evaluate('document.querySelector("#bg3-video-hud button[data-action=edit]").focus()');
      await press('Enter', 'Enter', 13);
      assert.equal(await evaluate('document.querySelector("#bg3-video-hud button[data-action=edit]").getAttribute("aria-pressed")'), 'true');
    });
    await test('real Enter reorders items and restores keyboard focus after rendering', async () => {
      const before = await evaluate(`(() => {
        const items = [...document.querySelectorAll('#bg3-video-hud .bg3-video-hud-panel:first-child li')];
        items[0].querySelector('button[data-action=move][data-direction="1"]').focus();
        return items.map(item => item.dataset.itemId);
      })()`);
      await press('Enter', 'Enter', 13);
      const after = await evaluate(`({
        items: [...document.querySelectorAll('#bg3-video-hud .bg3-video-hud-panel:first-child li')].map(item => item.dataset.itemId),
        focused: { ...document.activeElement.dataset }
      })`);
      const expected = [...before];
      [expected[0], expected[1]] = [expected[1], expected[0]];
      assert.deepEqual(after.items, expected);
      assert.equal(after.focused.action, 'move');
      assert.equal(after.focused.itemId, before[0]);
      assert.equal(after.focused.direction, '1');
    });
    await test('real Tab reaches Original HUD with an accessible name', async () => {
      await evaluate('document.querySelector("#bg3-video-hud button[data-action=edit]").focus()');
      await press('Tab', 'Tab', 9);
      const focused = await evaluate('({ action: document.activeElement.dataset.action, label: document.activeElement.getAttribute("aria-label") })');
      assert.equal(focused.action, 'disable');
      assert.ok(focused.label?.length);
    });
    await test('keyboard-only return restores the original HUD', async () => {
      await press('Enter', 'Enter', 13);
      assert.equal(await evaluate('document.getElementById("bg3-video-hud") === null && getComputedStyle(document.getElementById("bg3-hotbar")).display !== "none"'), true);
    });
    await evaluate(`window.finishBG3BrowserInteractions(${JSON.stringify(outcomes)})`);
  };
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tests/browser.html` }, sessionId);
  let result;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const response = await send('Runtime.evaluate', { expression: `(() => {
      const element = document.getElementById('test-results');
      return element ? { status: element.dataset.status, count: Number(element.dataset.count), text: element.textContent } : null;
    })()`, returnByValue: true }, sessionId);
    result = response.result?.value;
    if (result?.status === 'interactive') { await interactions(); continue; }
    if (result && result.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  console.log(result?.text || 'Browser tests did not finish.');
  if (result?.status !== 'passed' || !(result.count > 0)) process.exitCode = 1;
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise(resolve => child.once('close', resolve));
  }
  await new Promise(resolve => server.close(resolve));
  rmSync(profile, { recursive: true, force: true });
}
