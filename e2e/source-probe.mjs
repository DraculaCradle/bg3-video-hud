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
  const missingId = crypto.randomUUID().replaceAll('-', '').slice(0, 16);
  if (game.actors.has(missingId)) throw Error('source-probe-missing-id-collision');
  // Exact read-only request shape used by V14's native database backend.
  // The empty world query uses an ID verified absent from this world's cache.
  const request = operation => foundry.helpers.SocketInterface.dispatch('modifyDocument', {
    type: 'Actor', action: 'get', operation: { action: 'get', documentName: 'Actor',
      parent: null, modifiedTime: Date.now(), broadcast: false, ...operation }
  });
  const wireGet = () => new Promise(resolve => {
    game.socket.emit('modifyDocument', { type: 'Actor', action: 'get', operation: {
      action: 'get', documentName: 'Actor', parent: null, modifiedTime: Date.now(), broadcast: false,
      query: { _id: entry._id }, pack: 'dnd5e.monsters'
    } }, (...args) => resolve(args));
  });
  const [indexRpc, worldRead, raw] = await Promise.all([
    read(() => request({ query: {}, pack: 'dnd5e.monsters', index: true, indexFields: ['name', 'type'] })),
    read(() => request({ query: { _id: missingId } })),
    read(wireGet)
  ]);
  const wrapped = await read(() => pack.getDocument(entry._id));
  safe();
  const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const rawArgs = raw.status === 'ok' ? raw.value : [];
  const rawResponse = rawArgs.find(value => value && typeof value === 'object' && Array.isArray(value.result));
  return { index: 'ok', indexMs: index.durationMs, entryCount: entries.length,
    socketSessionMatchesUser: game.socket.session?.userId === game.user.id,
    indexRpc: indexRpc.status, indexRpcMs: indexRpc.durationMs,
    indexRpcCount: indexRpc.status === 'ok' && Array.isArray(indexRpc.value?.result) ? indexRpc.value.result.length : null,
    worldRead: worldRead.status, worldReadMs: worldRead.durationMs,
    worldReadCount: worldRead.status === 'ok' && Array.isArray(worldRead.value?.result) ? worldRead.value.result.length : null,
    rawGet: raw.status, rawGetMs: raw.durationMs,
    rawAckArgs: raw.status === 'ok' ? rawArgs.length : null,
    rawFirstKind: raw.status === 'ok' ? kind(rawArgs[0]) : null,
    rawSecondKind: raw.status === 'ok' && rawArgs.length > 1 ? kind(rawArgs[1]) : null,
    rawErrorPresent: raw.status === 'ok' ? rawArgs.some(value => !!value?.error) : null,
    rawCount: rawResponse ? rawResponse.result.length : null,
    wrappedGet: wrapped.status, wrappedGetMs: wrapped.durationMs,
    wrappedFound: wrapped.status === 'ok' ? !!wrapped.value : null };
}
