// Runs in the existing authenticated ModsTest GM client. Never returns source
// documents, account IDs, error messages, cookies or request bodies.
export async function inspectSources() {
  const safe = () => {
    if (game.world.id !== 'modstest' || game.world.title !== 'ModsTest' || !game.user.isGM
        || game.user.name !== 'Gamemaster' || !game.socket.connected
        || game.users.some(u => u.active && !['Gamemaster', 'Player1'].includes(u.name))) throw Error('source-probe-guard-denied');
  };
  const read = async callback => {
    safe(); let timer;
    const start = Date.now();
    try {
      const value = await Promise.race([callback(), new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Error('source-probe-timeout')), 30_000);
      })]);
      return { status: 'ok', durationMs: Date.now() - start, value };
    } catch (error) {
      return { status: error.message === 'source-probe-timeout' ? 'timeout' : 'error', durationMs: Date.now() - start };
    } finally { clearTimeout(timer); }
  };
  safe();
  const pack = game.packs.get('dnd5e.monsters');
  if (pack?.documentName !== 'Actor') return { index: 'pack-unavailable' };
  const index = await read(() => pack.getIndex());
  if (index.status !== 'ok') return { index: index.status, indexMs: index.durationMs };
  const entries = [...index.value.values()];
  const entry = entries.find(i => /^(acolyte|mage|bandit|guard)$/i.test(i.name)) ?? entries[0];
  if (!/^[A-Za-z0-9]{16}$/.test(entry?._id ?? '')) return { index: 'no-valid-source-id' };
  // Exact read-only request shape used by V14's native database backend.
  const raw = await read(() => foundry.helpers.SocketInterface.dispatch('modifyDocument', {
    type: 'Actor', action: 'get', operation: { action: 'get', documentName: 'Actor',
      query: { _id: entry._id }, pack: 'dnd5e.monsters', parent: null,
      modifiedTime: Date.now(), broadcast: false }
  }));
  const wrapped = await read(() => pack.getDocument(entry._id));
  safe();
  return { index: 'ok', indexMs: index.durationMs, entryCount: entries.length,
    rawGet: raw.status, rawGetMs: raw.durationMs,
    rawCount: raw.status === 'ok' && Array.isArray(raw.value?.result) ? raw.value.result.length : null,
    wrappedGet: wrapped.status, wrappedGetMs: wrapped.durationMs,
    wrappedFound: wrapped.status === 'ok' ? !!wrapped.value : null };
}
