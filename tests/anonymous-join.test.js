import test from 'node:test';
import assert from 'node:assert/strict';
import { closeAnonymousJoin } from '../e2e/anonymous-join.mjs';

async function fixture(run) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'game');
  let calls = 0;
  const socket = { connected: true, active: true, session: {}, io: { engine: { readyState: 'open' } },
    disconnect() { calls++; this.connected = false; this.active = false; this.io.engine.readyState = 'closed'; } };
  const game = { view: 'join', world: { id: 'modstest', title: 'ModsTest' }, socket };
  globalThis.game = game;
  try { await run({ game, socket, calls: () => calls }); }
  finally { saved ? Object.defineProperty(globalThis, 'game', saved) : delete globalThis.game; }
}

test('join handoff closes only its anonymous connection without emitting a document or auth event', async () => {
  await fixture(async ({ socket, calls }) => {
    socket.emit = () => assert.fail('must not emit a document, auth or eviction request');
    await closeAnonymousJoin({ world: 'modstest' });
    assert.equal(calls(), 1); assert.equal(socket.io.engine.readyState, 'closed');
  });
});

test('authenticated, replaced, foreign-world or non-join clients are never disconnected', async () => {
  for (const mutate of [g => { g.user = { id: 'PRIVATE_ID' }; }, g => { g.userId = 'PRIVATE_ID'; },
    g => { g.socket.session.userId = 'PRIVATE_ID'; }, g => { g.world.id = 'other'; },
    g => { g.world.title = 'Other'; }, g => { g.view = 'game'; }]) {
    await fixture(async ({ game, calls }) => {
      mutate(game);
      await assert.rejects(closeAnonymousJoin({ world: 'modstest' }), /anonymous-join-handoff-denied/);
      assert.equal(calls(), 0);
    });
  }
});

test('handoff refuses credential continuation when transport close is unconfirmed or context changes', async () => {
  await fixture(async ({ socket }) => {
    socket.disconnect = () => { socket.connected = false; socket.active = false; };
    await assert.rejects(closeAnonymousJoin({ world: 'modstest', timeoutMs: 1 }), /anonymous-join-handoff-unconfirmed/);
  });
  await fixture(async ({ socket, game }) => {
    socket.disconnect = () => { globalThis.game = { ...game }; };
    await assert.rejects(closeAnonymousJoin({ world: 'modstest' }), /anonymous-join-handoff-denied/);
  });
});
