// Serialized into this test's new page before entering credentials. End only
// the task-owned anonymous join connection, never an authenticated session.
// V14's native join form submits HTTP independently of this public socket.
export async function closeAnonymousJoin({ world, timeoutMs = 5000 }) {
  const current = globalThis.game, socket = current?.socket;
  const anonymous = () => current === globalThis.game && current?.socket === socket
    && current?.view === 'join' && current.world?.id === world && current.world?.title === 'ModsTest'
    && !current.user && !current.userId && !socket?.session?.userId;
  if (!anonymous() || socket?.connected !== true || typeof socket.disconnect !== 'function') {
    throw Error('anonymous-join-handoff-denied');
  }
  socket.disconnect();
  const started = Date.now(), limit = Math.max(1, Math.min(10_000, timeoutMs));
  while (true) {
    if (!anonymous()) throw Error('anonymous-join-handoff-denied');
    if (socket.connected === false && socket.active === false && socket.io?.engine?.readyState === 'closed') return;
    if (Date.now() - started >= limit) throw Error('anonymous-join-handoff-unconfirmed');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
