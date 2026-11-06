import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSources } from '../e2e/source-probe.mjs';

function setup(t) {
  for (const key of ['game', 'foundry']) {
    const prior = globalThis[key];
    t.after(() => { if (prior === undefined) delete globalThis[key]; else globalThis[key] = prior; });
  }
  const requests = [], reads = [];
  const id = 'aaaaaaaaaaaaaaaa';
  const pack = { documentName: 'Actor', getIndex: async () => { reads.push('index'); return [{ _id: id, name: 'Acolyte' }]; },
    getDocument: async () => { reads.push('wrapped'); return { name: 'PRIVATE_SOURCE_TEXT' }; } };
  globalThis.game = { world: { id: 'modstest', title: 'ModsTest' },
    user: { id: 'gm', isGM: true, name: 'Gamemaster' }, users: [], actors: new Map(),
    socket: { connected: true, session: { userId: 'gm' } },
    packs: new Map([['dnd5e.monsters', pack]]) };
  globalThis.foundry = { helpers: { SocketInterface: { dispatch: async (event, request) => {
    requests.push({ event, request });
    return { result: request.operation.pack ? [{ _id: id, name: 'PRIVATE_SOURCE_TEXT' }] : [] };
  } } } };
  return { requests, reads, id };
}

test('source inspection sends only a scoped read and never returns document content', async t => {
  const s = setup(t), result = await inspectSources();
  assert.equal(result.rawGet, 'ok'); assert.equal(result.wrappedGet, 'ok');
  assert.equal(result.rawCount, 1); assert.equal(result.wrappedFound, true);
  assert.equal(result.worldReadCount, 0); assert.equal(result.socketSessionMatchesUser, true);
  assert.equal(s.requests.length, 3);
  for (const { event, request } of s.requests) {
    assert.equal(event, 'modifyDocument'); assert.equal(request.action, 'get');
    assert.equal(request.type, 'Actor'); assert.equal(request.operation.broadcast, false);
    if (request.operation.pack) assert.equal(request.operation.pack, 'dnd5e.monsters');
    else assert.equal(game.actors.has(request.operation.query._id), false);
  }
  const full = s.requests.find(r => r.request.operation.pack && !r.request.operation.index).request;
  assert.deepEqual(full.operation.query, { _id: s.id });
  assert.equal(JSON.stringify(result).includes('PRIVATE_SOURCE_TEXT'), false);
  assert.equal(JSON.stringify(result).includes(s.id), false);
});
test('a foreign active session prevents source inspection before any query', async t => {
  const s = setup(t);
  game.users.push({ name: 'Other', active: true });
  await assert.rejects(inspectSources(), /source-probe-guard-denied/);
  assert.deepEqual(s.reads, []); assert.deepEqual(s.requests, []);
});
