import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, extname, sep, join } from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

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
    const timer = setTimeout(() => reject(new Error('Chromium DevTools startup timed out')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    let errors = '';
    child.stderr.on('data', data => {
      errors += data;
      const match = errors.match(/DevTools listening on (ws:\/\/\S+)/);
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
    for (const [width, height] of [[390, 844], [650, 900], [1440, 900]]) {
      await test(`HUD remains within ${width}x${height} viewport with reachable panels`, async () => {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
        const layout = await evaluate(`new Promise(resolve => requestAnimationFrame(() => {
          const root = document.getElementById('bg3-video-hud');
          const rect = root.getBoundingClientRect();
          const panels = root.querySelector('.bg3-video-hud-panels');
          resolve({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
            width: root.clientWidth, scrollWidth: root.scrollWidth,
            panelHeight: panels.clientHeight, panelOverflow: getComputedStyle(panels).overflowY,
            columns: getComputedStyle(panels).gridTemplateColumns.split(' ').length });
        }))`);
        assert.ok(layout.left >= 0 && layout.right <= width && layout.top >= 0 && layout.bottom <= height, JSON.stringify(layout));
        assert.ok(layout.scrollWidth <= layout.width + 1, 'HUD overflows horizontally');
        assert.ok(layout.panelHeight > 0 && layout.panelOverflow === 'auto', 'Panels must have a reachable scroll area');
        assert.equal(layout.columns, width <= 650 ? 1 : 3);
      });
    }
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
  const deadline = Date.now() + 15000;
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
