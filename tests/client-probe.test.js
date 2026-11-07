import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectClient, observeControlFrames, controlFrame } from '../e2e/client-probe.mjs';

async function clientFixture(callback, run) {
  const names = ['game', 'foundry', 'CONFIG'];
  const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const calls = [];
  const socket = { connected: true, sendBuffer: [], flags: {},
    io: { engine: { readyState: 'open', transport: { name: 'websocket', writable: true }, writeBuffer: [] } },
    emit: (event, reply) => { calls.push(event); assert.equal(event, 'time'); callback?.(reply); } };
  const backend = { get() {}, _getDocuments() {} };
  const game = { world: { id: 'modstest', title: 'ModsTest' },
    user: { name: 'Gamemaster', isGM: true, id: 'PRIVATE_USER_ID' },
    users: [{ name: 'Gamemaster', active: true }], socket, modules: new Map() };
  Object.defineProperties(game, {
    actors: { get: () => assert.fail('must not access world document collections') },
    packs: { get: () => assert.fail('must not access compendium documents or indexes') }
  });
  globalThis.game = game;
  globalThis.foundry = { helpers: { SocketInterface: { dispatch() { throw Error('must not dispatch document RPC'); } } },
    documents: { collections: { CompendiumCollection: class { getDocument() {} getDocuments() {} } } } };
  globalThis.CONFIG = { Actor: { documentClass: { database: backend } }, DatabaseBackend: backend };
  try { await run({ calls, game }); }
  finally { names.forEach((name, i) => saved[i] ? Object.defineProperty(globalThis, name, saved[i]) : delete globalThis[name]); }
}

test('client inspection emits exactly one native clock read and exports only interface fingerprints', async () => {
  await clientFixture(reply => reply({ serverTime: 10, worldTime: 20 }), async ({ calls }) => {
    const result = await inspectClient();
    assert.deepEqual(calls, ['time']);
    assert.equal(result.status.status, 'ok'); assert.equal(result.status.validTime, true);
    assert.ok(!Object.hasOwn(result.status, 'serverTime')); assert.ok(!Object.hasOwn(result.status, 'worldTime'));
    assert.match(result.api.databaseGet.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.before.transport, 'websocket'); assert.equal(result.before.configuredBackendMatches, true);
    const json = JSON.stringify(result);
    assert.ok(!json.includes('PRIVATE_USER_ID')); assert.ok(!json.includes('must not dispatch document RPC'));
    assert.ok(!json.includes('function dispatch')); assert.ok(!json.includes('https://'));
  });
});

test('unexpected acknowledgement data and timeouts stay sanitized and never retry', async () => {
  await clientFixture(reply => reply({ secret: 'PRIVATE_SENTINEL' }), async ({ calls }) => {
    const result = await inspectClient();
    assert.equal(result.status.status, 'unexpected-type'); assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
  });
  await clientFixture(null, async ({ calls }) => {
    assert.equal((await inspectClient({ timeoutMs: 1 })).status.status, 'timeout');
    assert.equal(calls.length, 1);
  });
});

test('foreign users and context changes block inspection without a document or status retry', async () => {
  await clientFixture(reply => reply({ serverTime: 10, worldTime: 20 }), async ({ game, calls }) => {
    game.users.push({ name: 'Other', active: true });
    await assert.rejects(inspectClient(), /client-probe-guard-denied/); assert.equal(calls.length, 0);
  });
  await clientFixture(reply => { game.world.id = 'other-world'; reply({ serverTime: 10, worldTime: 20 }); }, async ({ calls }) => {
    await assert.rejects(inspectClient(), /client-probe-guard-denied/); assert.equal(calls.length, 1);
  });
});

test('CDP status correlation ignores unrelated frames and never exports payloads or socket IDs', async () => {
  const handlers = new Map(); let detached = 0;
  const observer = await observeControlFrames({ context: () => ({ newCDPSession: async () => ({
    on: (name, cb) => handlers.set(name, cb), send: async name => assert.equal(name, 'Network.enable'),
    detach: async () => { detached++; }
  }) }) });
  const sent = (id, payload) => handlers.get('Network.webSocketFrameSent')({ requestId: id, response: { opcode: 1, payloadData: payload } });
  const received = (id, payload) => handlers.get('Network.webSocketFrameReceived')({ requestId: id, response: { opcode: 1, payloadData: payload } });
  handlers.get('Network.webSocketCreated')({ requestId: 'PRIVATE_SOCKET', url: 'wss://redmagic.club/socket.io/?session=PRIVATE_SENTINEL' });
  received('PRIVATE_SOCKET', '2'); sent('PRIVATE_SOCKET', '3');
  const lifecycle = { opened: 1, closed: 0, errors: 0, pings: 1, pongs: 1 };
  sent('PRIVATE_SOCKET', '421["modifyDocument",{"secret":"PRIVATE_SENTINEL"}]');
  received('PRIVATE_SOCKET', '431[true]'); assert.equal(observer.read().matchingAckFrames, 0);
  sent('PRIVATE_SOCKET', '422["time"]'); received('OTHER_SOCKET', '432[{"serverTime":10,"worldTime":20}]');
  assert.equal(observer.read().matchingAckFrames, 0);
  received('PRIVATE_SOCKET', '432[{"serverTime":10,"worldTime":20}]');
  assert.deepEqual(observer.read(), { requestFrames: 1, matchingAckFrames: 1, validTimeAckFrames: 1, lifecycle });
  const bootstrap = observer.read();
  observer.reset();
  assert.equal(observer.read().matchingAckFrames, 0);
  sent('PRIVATE_SOCKET', '423["time"]'); received('PRIVATE_SOCKET', '433[{"secret":"PRIVATE_SENTINEL"}]');
  assert.deepEqual(observer.read(), { requestFrames: 1, matchingAckFrames: 1, validTimeAckFrames: 0, lifecycle });
  assert.equal(bootstrap.validTimeAckFrames, 1);
  assert.ok(!JSON.stringify(observer.read()).includes('PRIVATE'));
  assert.ok(!JSON.stringify(observer.read()).includes('worldTime'));
  assert.equal(controlFrame('x'.repeat(5000)), null); assert.equal(controlFrame('43not-json'), null);
  await observer.close(); assert.equal(detached, 1);
});

test('control observer rejects other origins, lookalike paths and frames from unregistered sockets', async () => {
  const handlers = new Map();
  const observer = await observeControlFrames({ context: () => ({ newCDPSession: async () => ({
    on: (name, cb) => handlers.set(name, cb), send: async () => {}, detach: async () => {}
  }) }) });
  const frame = (direction, id, data) => handlers.get(`Network.webSocketFrame${direction}`)({
    requestId: id, response: { opcode: 1, payloadData: data }
  });
  for (const [id, url] of [
    ['other', 'wss://example.invalid/socket.io/'],
    ['path', 'wss://redmagic.club/socket.io-other/'],
    ['scheme', 'ws://redmagic.club/socket.io/'],
    ['port', 'wss://redmagic.club:8443/socket.io/']
  ]) handlers.get('Network.webSocketCreated')({ requestId: id, url });
  for (const id of ['other', 'path', 'scheme', 'port', 'not-registered']) {
    frame('Sent', id, '421["time"]');
    frame('Received', id, '431[{"serverTime":10,"worldTime":20}]');
    frame('Received', id, '2'); frame('Sent', id, '3');
    handlers.get('Network.webSocketFrameError')({ requestId: id });
    handlers.get('Network.webSocketClosed')({ requestId: id });
  }
  assert.deepEqual(observer.read(), { requestFrames: 0, matchingAckFrames: 0, validTimeAckFrames: 0,
    lifecycle: { opened: 0, closed: 0, errors: 0, pings: 0, pongs: 0 } });
  for (const [id, path] of [['canonical', '/socket.io/'], ['no-slash', '/socket.io']]) {
    handlers.get('Network.webSocketCreated')({ requestId: id, url: `wss://redmagic.club${path}?private=omitted` });
    frame('Sent', id, '422["time"]');
    frame('Received', id, '432[{"serverTime":10,"worldTime":20}]');
  }
  assert.deepEqual(observer.read(), { requestFrames: 2, matchingAckFrames: 2, validTimeAckFrames: 2,
    lifecycle: { opened: 2, closed: 0, errors: 0, pings: 0, pongs: 0 } });
  await observer.close();
});
