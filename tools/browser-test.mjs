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
    if (process.env.BG3_BROWSER_TRACE === 'true' && message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args?.map(a => a.value ?? '').join(' ');
      if (text?.startsWith('BG3 TEST')) console.log(text);
    }
    if (message.method === 'Page.javascriptDialogOpening') {
      console.error(`Unexpected test browser dialog: ${message.params.type}`);
      send('Page.handleJavaScriptDialog', { accept: false }, message.sessionId).catch(() => {});
    }
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
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
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
      if (process.env.BG3_BROWSER_TRACE === 'true') console.log(`BG3 INTERACTION ${name}`);
      try { await callback(); outcomes.push({ name, passed: true }); }
      catch (error) { outcomes.push({ name, passed: false, error: error.message }); }
    };
    const measurements = [];
    const measure = () => evaluate(`new Promise((resolve, reject) => requestAnimationFrame(() => {
      try { resolve((${measureHUD.toString()})()); } catch (error) { reject(error); }
    }))`);
    const focusMenu = async action => {
      if (!await evaluate('!!document.querySelector(".bg3-video-hud-more[open]")')) {
        await evaluate('document.querySelector("#bg3-video-hud [data-action=more]").focus()');
        await press('Enter', 'Enter', 13);
      }
      await evaluate(`document.querySelector('.bg3-video-hud-more [data-action="${action}"]').focus()`);
    };
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
        assert.ok(layout.scrollWidth <= layout.clientWidth + 1, JSON.stringify(layout));
        assert.ok(layout.controlsFit, 'Edit, Original HUD and rests must stay within the dock');
        assert.ok(layout.noFooter && layout.conditionsFit, 'No bottom bar; conditions remain inside portrait ring');
        assert.equal(layout.lists.length, 4);
        assert.ok(layout.lists.every(list => list.square), 'All item buttons must remain square at this viewport');
        assert.ok(layout.lists.every(list => Math.abs(list.tail) < 1), JSON.stringify(layout.lists));
        await evaluate('window.bg3LayoutTest.crowded()');
        const crowdedWidth = (await measure()).width;
        assert.ok(Math.abs(crowdedWidth - layout.width) < .6, 'Actor counts must not change total HUD width');
        await evaluate('window.bg3LayoutTest.reset()');
        assert.ok(Math.abs((await measure()).width - layout.width) < .6);
        assert.ok(layout.lists.every(list => list.height > 0 && list.firstFits && list.left >= layout.left && list.right <= layout.right), JSON.stringify(layout));
        assert.ok(layout.height <= Math.max(145, height * .4), 'Dock leaves useful map height even in short zoomed viewports');
        assert.equal(layout.dpr, deviceScaleFactor);
        // Whole columns fit the fixed width with a small downward adjustment,
        // rather than leaving fractional strips or growing beyond two rows.
        assert.ok(layout.cell >= layout.nominalCell * .9 - .5 && layout.cell <= layout.nominalCell + .5
          && layout.font >= 11 && layout.font <= 24, JSON.stringify({ cell: layout.cell, nominal: layout.nominalCell }));
        if (height <= 720 && width > 650) assert.ok(layout.height <= 228, '720P dock stays compact');
      });
    }
    await test('native 720P to 4K sizes grow smoothly and stop growing beyond the cap', async () => {
      const native = SCREEN_SIZES.map(([w, h]) => measurements.find(m => m.screenWidth === w && m.screenHeight === h && m.zoom === 1));
      for (let i = 1; i < native.length; i++) {
        for (const property of ['height', 'width', 'cell', 'font', 'gap', 'portrait']) assert.ok(native[i][property] > native[i - 1][property], property);
      }
      assert.ok(native[4].height > native[0].height * 1.5 && native[4].height < 420);
      assert.ok(native[4].cell > native[0].cell * 1.5);
      assert.ok(native.every(layout => layout.lists.every(list => list.twoRowsFit)), 'Native 720P–4K must show two full skill rows');
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
        await focusMenu('edit');
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
        await focusMenu('disable');
        await press('Enter', 'Enter', 13);
        assert.ok(await evaluate('!document.getElementById("bg3-video-hud") && getComputedStyle(document.getElementById("bg3-hotbar")).display !== "none"'));
      } finally {
        await evaluate('window.bg3LayoutTest.reset()');
        await evaluate('window.bg3LayoutTest.enable()');
      }
    });
    mkdirSync('e2e/results', { recursive: true });
    writeFileSync('e2e/results/layout-metrics.json', JSON.stringify({ scope: 'Synthetic viewport/DPR emulation; not real hardware or Foundry acceptance', measurements }, null, 2) + '\n');
    await test('crowded 720P dock keeps fixed height and all four groups reachable by real wheel scrolling', async () => {
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
      assert.ok(await evaluate('!!document.getElementById("bg3-video-hud")'),
        JSON.stringify(await evaluate('window.bg3LayoutTest.notifications()')));
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
      assert.ok(await evaluate('document.getElementById("bg3-video-hud").getBoundingClientRect().height <= 228'));
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
      await focusMenu('edit'); await press('Enter', 'Enter', 13);
      assert.ok(await evaluate('document.getElementById("bg3-video-hud").getBoundingClientRect().height <= 228'));
      const controlsFit = await evaluate(`[...document.querySelectorAll('#bg3-video-hud .bg3-video-hud-items')].every(list => {
        const controls = list.querySelector('.bg3-video-hud-edit-controls');
        const a = controls.getBoundingClientRect(), b = list.getBoundingClientRect();
        return a.left >= b.left && a.right <= b.right;
      })`);
      assert.equal(controlsFit, true);
      await evaluate('window.bg3LayoutTest.reset()');
      assert.ok(await evaluate('[...document.querySelectorAll("#bg3-video-hud .bg3-video-hud-items")].every(list => list.scrollTop === 0)'));
    });
    await test('focused item explanations survive the real browser input phase without executable HTML', async () => {
      await evaluate('document.querySelector("#bg3-video-hud [data-action=use]").focus()');
      await evaluate('new Promise(resolve => setTimeout(resolve, 180))');
      const tooltip = await evaluate(`(() => {
        const root = document.querySelector('.bg3-video-hud-tooltip');
        return { present: !!root, unsafe: !!root?.querySelector('script,img[onerror],[onclick]') };
      })()`);
      assert.equal(tooltip.present, true); assert.equal(tooltip.unsafe, false);
    });
    await test('real Enter key activates the focused Edit button', async () => {
      await focusMenu('edit');
      await press('Enter', 'Enter', 13);
      assert.equal(await evaluate('document.querySelector("#bg3-video-hud").classList.contains("bg3-video-hud-editing")'), true);
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
      await focusMenu('edit');
      await press('Tab', 'Tab', 9);
      const focused = await evaluate('({ action: document.activeElement.dataset.action, label: document.activeElement.getAttribute("aria-label") })');
      assert.equal(focused.action, 'disable');
      assert.ok(focused.label?.length);
    });
    await test('keyboard-only return restores the original HUD', async () => {
      await press('Enter', 'Enter', 13);
      assert.equal(await evaluate('document.getElementById("bg3-video-hud") === null && getComputedStyle(document.getElementById("bg3-hotbar")).display !== "none"'), true);
    });
    for (const [width, height, deviceScaleFactor] of [[1280,720,1], [1366,768,1], [1920,1080,1],
      [2560,1440,1], [3840,2160,1], [640,360,2], [390,844,1]]) {
      await test(`choice dialogs fit ${width}x${height} DPR ${deviceScaleFactor} without replacing or enlarging HUD lists`, async () => {
        await setViewport({ width, height, deviceScaleFactor });
        for (const kind of ['casting', 'activity', 'allocation']) {
          await evaluate(`window.bg3ChoiceTest.start(${JSON.stringify(kind)})`);
          const state = await evaluate('window.bg3ChoiceTest.snapshot()');
          assert.equal(state.open, true); assert.equal(state.outsideHUD, true); assert.equal(state.hudContainsChoices, false);
          assert.ok(state.dialog.left >= 0 && state.dialog.right <= width && state.dialog.top >= 0 && state.dialog.bottom <= height, JSON.stringify(state));
          assert.ok(state.bodyOverflow <= 1); assert.equal(state.dockNow.height, state.dock.height);
          assert.ok(state.activeInside); assert.equal(state.writes, 0);
          await evaluate('window.bg3ChoiceTest.revealLast()');
          const after = await evaluate('window.bg3ChoiceTest.snapshot()');
          if (height <= 768) assert.ok(after.bodyScrollTop > 0, 'long choices must scroll inside the window');
          await press('Escape', 'Escape', 27);
          // Native dialog cancel is queued by Chromium after key dispatch.
          // Observe completion with a bound; never send a second Escape.
          const cancelled = await evaluate(`new Promise(resolve => {
            const deadline = performance.now() + 1000;
            const poll = () => {
              const state = window.bg3ChoiceTest.snapshot();
              if (state.result !== 'waiting' || performance.now() >= deadline) resolve(state);
              else setTimeout(poll, 10);
            };
            poll();
          })`);
          assert.equal(cancelled.result, 'cancelled'); assert.equal(cancelled.open, false);
        }
      });
    }
    await test('focused popup option remains visible after 4K to 200% 720P resize', async () => {
      await setViewport({ width: 3840, height: 2160 });
      await evaluate('window.bg3ChoiceTest.start("casting"); document.querySelector(".bg3-video-hud-choice-dialog [data-action=source-manager]").focus()');
      await setViewport({ width: 640, height: 360, deviceScaleFactor: 2 });
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const state = await evaluate('window.bg3ChoiceTest.snapshot()');
      assert.equal(state.activeInside, true);
      assert.ok(state.activeBox.top >= state.body.top - 1 && state.activeBox.bottom <= state.body.bottom + 1);
      await press('Escape', 'Escape', 27);
    });
    await test('trusted Tab stays in the choice dialog and Enter closes it before its consumer continues', async () => {
      await setViewport({ width: 1280, height: 720 });
      await evaluate('window.bg3ChoiceTest.start("casting")');
      await press('Tab', 'Tab', 9);
      assert.equal((await evaluate('window.bg3ChoiceTest.snapshot()')).activeInside, true);
      await evaluate('document.querySelector(".bg3-video-hud-choice-dialog [data-slot=spell3]").focus()');
      await press('Enter', 'Enter', 13);
      const state = await evaluate('window.bg3ChoiceTest.snapshot()');
      assert.equal(state.result, 'accepted'); assert.equal(state.open, false); assert.equal(state.closedAtResolution, true);
    });
    await test('nested source dialog Escape preserves parent; closing parent restores item focus', async () => {
      await evaluate('window.bg3ChoiceTest.start("casting"); document.querySelector(".bg3-video-hud-choice-dialog [data-action=source-manager]").focus()');
      await press('Enter', 'Enter', 13);
      assert.equal((await evaluate('window.bg3ChoiceTest.snapshot()')).childDialog, true);
      await press('Escape', 'Escape', 27);
      let state = await evaluate('window.bg3ChoiceTest.snapshot()');
      assert.equal(state.childDialog, false); assert.equal(state.open, true); assert.equal(state.result, 'waiting');
      await evaluate('document.querySelector(".bg3-video-hud-choice-dialog [data-action=close-modal]").focus()');
      await press('Enter', 'Enter', 13);
      await evaluate('new Promise(resolve => setTimeout(resolve, 20))');
      state = await evaluate('window.bg3ChoiceTest.snapshot()');
      assert.equal(state.result, 'cancelled'); assert.equal(state.focusedItem, 'dialog-spell');
    });
    await test('queued close and refresh cannot reopen dialogs; actor/token changes cancel safely', async () => {
      await evaluate('window.bg3ChoiceTest.start("casting"); window.bg3ChoiceTest.start("activity")');
      await evaluate('new Promise(resolve => setTimeout(resolve, 0))');
      let state = await evaluate('window.bg3ChoiceTest.snapshot()');
      assert.equal(state.open, true); assert.equal(state.result, 'waiting');
      await evaluate('window.bg3ChoiceTest.closeAndRefresh()');
      state = await evaluate('window.bg3ChoiceTest.snapshot()');
      assert.equal(state.open, false); assert.equal(state.result, 'cancelled');
      await evaluate('window.bg3ChoiceTest.start("activity")');
      await evaluate('window.bg3ChoiceTest.switchActor()');
      state = await evaluate('window.bg3ChoiceTest.snapshot()');
      assert.equal(state.open, false); assert.equal(state.result, 'cancelled'); assert.equal(state.writes, 0);
      await evaluate('window.bg3ChoiceTest.start("casting"); window.bg3ChoiceTest.switchToken()');
      state = await evaluate('window.bg3ChoiceTest.snapshot()');
      assert.equal(state.open, false); assert.equal(state.result, 'cancelled');
      await evaluate('window.bg3ChoiceTest.dispose()');
    });
    const mouse = async (type, x, y, button = 'left') => {
      await send('Input.dispatchMouseEvent', { type, x, y, button,
        buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 }, sessionId);
      await evaluate('new Promise(resolve => setTimeout(resolve, 0))');
    };
    await test('trusted divider drag and keyboard resize persist once; Escape restores without a write', async () => {
      await setViewport({ width: 1280, height: 720 });
      await evaluate('window.bg3LayoutTest.enable(); window.bg3LayoutTest.crowded()');
      const snapshot = () => evaluate(`(() => {
        const root = document.getElementById('bg3-video-hud');
        return { widths: [...root.querySelectorAll('.bg3-video-hud-panel')].map(el => el.getBoundingClientRect().width),
          writes: window.bg3LayoutTest.writes(), focused: document.activeElement.dataset.divider };
      })()`);
      const before = await snapshot();
      await evaluate('document.querySelector("[data-divider]").focus()');
      await press('ArrowRight', 'ArrowRight', 39);
      const keyboard = await snapshot(); assert.ok(keyboard.widths[0] > before.widths[0]); assert.equal(keyboard.focused, '0');
      const point = await evaluate(`(() => { const b = document.querySelector('[data-divider]').getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; })()`);
      await mouse('mousePressed', point.x, point.y); await mouse('mouseMoved', point.x + 30, point.y); await mouse('mouseReleased', point.x + 30, point.y);
      const dragged = await snapshot(); assert.ok(dragged.widths[0] > keyboard.widths[0]); assert.equal(dragged.writes, keyboard.writes + 1);
      const again = await evaluate(`(() => { const b = document.querySelector('[data-divider]').getBoundingClientRect(); return { x: b.x + b.width/2, y: b.y + b.height/2 }; })()`);
      await mouse('mousePressed', again.x, again.y); await mouse('mouseMoved', again.x - 30, again.y);
      await press('Escape', 'Escape', 27); await mouse('mouseReleased', again.x - 30, again.y);
      const cancelled = await snapshot(); assert.equal(cancelled.writes, dragged.writes);
      assert.ok(cancelled.widths.every((n,i) => Math.abs(n - dragged.widths[i]) < 1));
      await evaluate('document.querySelector("[data-divider]").focus()'); await press('Home', 'Home', 36);
    });
    await test('third divider resizes features and spells without changing weapon or item widths', async () => {
      await setViewport({ width: 1280, height: 720 });
      await evaluate('window.bg3LayoutTest.enable(); window.bg3LayoutTest.crowded()');
      const widths = () => evaluate(`[...document.querySelectorAll('#bg3-video-hud .bg3-video-hud-panel')].map(el => el.getBoundingClientRect().width)`);
      const before = await widths();
      await evaluate(`document.querySelector('[data-divider="2"]').focus()`);
      await press('ArrowRight', 'ArrowRight', 39);
      const after = await widths();
      assert.ok(Math.abs(after[0] - before[0]) < 1 && Math.abs(after[1] - before[1]) < 1);
      assert.ok(after[2] > before[2] && after[3] < before[3]);
      await press('Home', 'Home', 36);
    });
    await test('sidebar geometry changes reserve actual width and reopening restores a bounded dock', async () => {
      await evaluate(`(() => { const sidebar = document.createElement('aside'); sidebar.id='sidebar'; sidebar.style.cssText='position:fixed;right:0;top:0;width:280px;height:100vh'; document.body.append(sidebar); })()`);
      await evaluate('window.bg3LayoutTest.refresh()');
      const first = await measure(); assert.ok(first.right <= 1000);
      await evaluate('document.getElementById("sidebar").style.width="350px"');
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const resized = await measure(); assert.ok(resized.right <= 930); assert.ok(resized.width < first.width);
      await evaluate('document.getElementById("sidebar").remove(); window.bg3LayoutTest.refresh()');
      assert.ok((await measure()).width > resized.width);
    });
    await test('trusted group editor opens outside HUD and Escape discards checkbox changes', async () => {
      const before = await evaluate('window.bg3LayoutTest.writes()');
      await evaluate('document.querySelector("[data-action=edit-group]").focus()'); await press('Enter', 'Enter', 13);
      assert.equal(await evaluate('!!document.querySelector(".bg3-video-hud-editor-dialog[open]")'), true);
      await evaluate('document.querySelector(".bg3-video-hud-editor-dialog [data-action=visibility]").focus()'); await press('Enter', 'Enter', 13);
      await press('Escape', 'Escape', 27);
      assert.equal(await evaluate('!!document.querySelector(".bg3-video-hud-editor-dialog[open]")'), false);
      assert.equal(await evaluate('window.bg3LayoutTest.writes()'), before);
    });
    await test('trusted map click targets once without controlling the clicked token', async () => {
      await setViewport({ width: 1280, height: 720 });
      await evaluate('window.bg3TargetTest.start("single")');
      assert.equal((await evaluate('window.bg3TargetTest.snapshot()')).calls, 0);
      await mouse('mousePressed', 260, 240); await mouse('mouseReleased', 260, 240);
      const state = await evaluate('window.bg3TargetTest.snapshot()');
      assert.equal(state.calls, 1); assert.deepEqual(state.targets, ['one']);
      assert.equal(state.actor, 'Actor.target-caster'); assert.equal(state.nativePresses, 0);
      assert.equal(state.nativeReleases, 0); assert.equal(state.nativeClicks, 0);
      assert.equal(state.picking, false); assert.equal(state.box, false); assert.equal(state.writes, 0);
      // After this gesture drains, ordinary map control must resume.
      await mouse('mousePressed', 260, 240); await mouse('mouseReleased', 260, 240);
      const normal = await evaluate('window.bg3TargetTest.snapshot()');
      assert.equal(normal.nativePresses, 1); assert.equal(normal.nativeReleases, 1);
      assert.equal(normal.nativeClicks, 1); assert.equal(normal.calls, 1);
      await evaluate('window.bg3TargetTest.dispose()');
    });
    await test('trusted drag with pointer capture selects the visible range and automatically delegates once', async () => {
      await evaluate('window.bg3TargetTest.start("multi")');
      await mouse('mousePressed', 160, 140); await mouse('mouseMoved', 560, 340);
      const preview = await evaluate('window.bg3TargetTest.snapshot()');
      assert.equal(preview.calls, 0); assert.equal(preview.picking, true); assert.equal(preview.box, true);
      if (process.env.BG3_CAPTURE_TARGETING === 'true') {
        await evaluate('document.body.style.background = "#101916"');
        const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }, sessionId);
        mkdirSync('e2e/results', { recursive: true });
        writeFileSync('e2e/results/targeting-range.jpg', Buffer.from(shot.data, 'base64'));
      }
      await mouse('mouseReleased', 560, 340);
      const state = await evaluate('window.bg3TargetTest.snapshot()');
      assert.equal(state.calls, 1); assert.deepEqual(state.targets, ['one', 'two']);
      assert.equal(state.nativePresses, 0); assert.equal(state.picking, false); assert.equal(state.box, false);
      await evaluate('window.bg3TargetTest.dispose()');
    });
    await test('trusted Escape cancels a dragged selection with no use or target mutation', async () => {
      await evaluate('window.bg3TargetTest.start("multi")');
      await mouse('mousePressed', 160, 140); await mouse('mouseMoved', 560, 340);
      await press('Escape', 'Escape', 27); await mouse('mouseReleased', 560, 340);
      const state = await evaluate('window.bg3TargetTest.snapshot()');
      assert.equal(state.calls, 0); assert.equal(state.selections, 0); assert.equal(state.box, false);
      assert.equal(state.picking, false); assert.equal(state.cursor, 'grab');
      await evaluate('window.bg3TargetTest.dispose()');
    });
    await test('trusted targeting works at 200% effective 720P, DPR 2 and CSS-scaled canvas', async () => {
      await setViewport({ width: 640, height: 360, deviceScaleFactor: 2 });
      // Emulation sends a real resize event. Finish it before starting a new
      // selection, which correctly cancels if resized while already pending.
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await evaluate('window.bg3TargetTest.start("single"); document.getElementById("board").style.width="400px"; document.getElementById("board").style.height="200px"');
      await mouse('mousePressed', 140, 130); await mouse('mouseReleased', 140, 130);
      const state = await evaluate('window.bg3TargetTest.snapshot()');
      assert.equal(state.calls, 1); assert.deepEqual(state.targets, ['one']);
      assert.equal(state.nativePresses, 0); assert.equal(state.box, false);
      await evaluate('window.bg3TargetTest.dispose()');
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
