import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, extname, sep, join } from 'node:path';
import { spawn } from 'node:child_process';

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
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/tests/browser.html` }, sessionId);
  let result;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await send('Runtime.evaluate', { expression: `(() => {
      const element = document.getElementById('test-results');
      return element ? { status: element.dataset.status, count: Number(element.dataset.count), text: element.textContent } : null;
    })()`, returnByValue: true }, sessionId);
    result = response.result?.value;
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
