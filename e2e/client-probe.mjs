// This function is serialized into the guarded GM page. Inspect interfaces;
// emit one documented read-only clock query, never a document operation.
export async function inspectClient({ timeoutMs = 10_000 } = {}) {
  const safe = () => {
    if (game.world.id !== 'modstest' || game.world.title !== 'ModsTest'
      || !game.user.isGM || game.user.name !== 'Gamemaster' || !game.socket.connected
      || game.users.some(u => u.active && !['Gamemaster', 'Player1'].includes(u.name))) {
      throw Error('client-probe-guard-denied');
    }
  };
  safe();
  const socket = game.socket, engine = socket.io?.engine;
  const fingerprint = async fn => {
    if (typeof fn !== 'function') return { available: false };
    const source = Function.prototype.toString.call(fn);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
    // Do not export commercial client source, literals, account data or URLs.
    return { available: true, chars: source.length,
      sha256: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join(''),
      mentionsDocumentEvent: /["']modifyDocument["']/.test(source),
      mentionsStatusEvent: /["']getWorldStatus["']/.test(source),
      mentionsTimeEvent: /["']time["']/.test(source),
      mentionsSocketEmit: /\.emit\s*\(/.test(source) };
  };
  const backend = CONFIG.Actor?.documentClass?.database;
  const packPrototype = foundry.documents?.collections?.CompendiumCollection?.prototype;
  const api = Object.fromEntries(await Promise.all(Object.entries({
    dispatch: foundry.helpers?.SocketInterface?.dispatch,
    databaseGet: backend?.get, databaseGetDocuments: backend?._getDocuments,
    databaseConstructor: backend?.constructor,
    compendiumGetDocument: packPrototype?.getDocument,
    compendiumGetDocuments: packPrototype?.getDocuments,
    worldStatus: game.constructor?.getWorldStatus,
    timeSync: game.time?.sync,
    socketEmit: socket.emit
  }).map(async ([name, fn]) => [name, await fingerprint(fn)])));
  safe();
  const before = { connected: socket.connected === true,
    transport: ['websocket', 'polling'].includes(engine?.transport?.name) ? engine.transport.name : 'unknown',
    engineOpen: engine?.readyState === 'open', transportWritable: engine?.transport?.writable === true,
    socketEmitOwnProperty: Object.hasOwn(socket, 'emit'),
    sendBufferCount: Array.isArray(socket.sendBuffer) ? socket.sendBuffer.length : null,
    engineWriteBufferCount: Array.isArray(engine?.writeBuffer) ? engine.writeBuffer.length : null,
    volatileFlag: socket.flags?.volatile === true,
    configuredBackendMatches: backend === CONFIG.DatabaseBackend };
  const started = Date.now();
  let timer;
  const status = await new Promise(resolve => {
    let complete = false;
    const finish = result => { if (!complete) { complete = true; clearTimeout(timer); resolve(result); } };
    timer = setTimeout(() => finish({ status: 'timeout' }), Math.max(1, Math.min(15_000, timeoutMs)));
    try {
      socket.emit('time', value => finish(value && typeof value === 'object' && !Array.isArray(value)
        && Number.isFinite(value.serverTime) && Number.isFinite(value.worldTime)
        ? { status: 'ok', validTime: true } : { status: 'unexpected-type' }));
    } catch { finish({ status: 'error' }); }
  });
  safe();
  return { control: 'time', api, before, status: { ...status, durationMs: Date.now() - started },
    integrations: Object.fromEntries(['lib-wrapper', 'socketlib', 'midi-qol', 'dae'].map(id =>
      [id, game.modules.get(id)?.active === true])) };
}

// Engine.IO message + Socket.IO event/ack, default namespace only. Unknown or
// oversized payloads never enter the report. IDs are internal correlation only.
export function controlFrame(payload) {
  if (typeof payload !== 'string' || payload.length > 4096) return null;
  const sent = /^42(\d{1,12})\["time"\]$/.exec(payload);
  if (sent) return { kind: 'request', id: sent[1] };
  const ack = /^43(\d{1,12})(\[.*\])$/.exec(payload);
  if (!ack) return null;
  try {
    const args = JSON.parse(ack[2]);
    const time = args[0];
    return { kind: 'ack', id: ack[1], validTime: args.length === 1 && !!time
      && typeof time === 'object' && !Array.isArray(time)
      && Number.isFinite(time.serverTime) && Number.isFinite(time.worldTime) };
  } catch { return null; }
}

export async function observeControlFrames(page) {
  const session = await page.context().newCDPSession(page);
  const sockets = new Set();
  const lifecycle = { opened: 0, closed: 0, errors: 0, pings: 0, pongs: 0 };
  session.on('Network.webSocketCreated', event => {
    try {
      const url = new URL(event.url);
      if (url.origin !== 'wss://redmagic.club' || !url.pathname.startsWith('/socket.io')) return;
      sockets.add(event.requestId); lifecycle.opened++;
    } catch { /* No raw endpoint or session identifiers enter the report. */ }
  });
  session.on('Network.webSocketClosed', event => { if (sockets.has(event.requestId)) lifecycle.closed++; });
  session.on('Network.webSocketFrameError', event => { if (sockets.has(event.requestId)) lifecycle.errors++; });
  let summary, pending;
  const reset = () => {
    summary = { requestFrames: 0, matchingAckFrames: 0, validTimeAckFrames: 0 };
    pending = new Set();
  };
  reset();
  const receive = (event, direction) => {
    if (event.response.opcode !== 1) return;
    if (sockets.has(event.requestId)) {
      if (direction === 'received' && event.response.payloadData === '2') lifecycle.pings++;
      if (direction === 'sent' && event.response.payloadData === '3') lifecycle.pongs++;
    }
    const frame = controlFrame(event.response.payloadData);
    if (!frame) return;
    const key = `${event.requestId}:${frame.id}`;
    if (direction === 'sent' && frame.kind === 'request') { summary.requestFrames++; pending.add(key); }
    if (direction === 'received' && frame.kind === 'ack' && pending.delete(key)) {
      summary.matchingAckFrames++;
      if (frame.validTime) summary.validTimeAckFrames++;
    }
  };
  session.on('Network.webSocketFrameSent', event => receive(event, 'sent'));
  session.on('Network.webSocketFrameReceived', event => receive(event, 'received'));
  await session.send('Network.enable');
  return { reset, read: () => ({ ...summary, lifecycle: { ...lifecycle } }), close: async () => {
    try { await session.detach(); } catch { /* The owned context may already be closed. */ }
  } };
}
