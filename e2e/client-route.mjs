// Ephemeral client routing only. Never changes a server listener/proxy/service.
export function routeSettings(environment = process.env) {
  const mode = environment.MODSTEST_ROUTE || 'public';
  if (!['public', 'server-loopback'].includes(mode)) throw Error('invalid-test-connection-route');
  return { mode, args: mode === 'server-loopback'
    ? ['--host-resolver-rules=MAP redmagic.club 127.0.0.1'] : [] };
}

export async function verifiedLoopbackResponse(response, targetUrl) {
  try {
    const target = new URL(targetUrl), actual = new URL(response.url());
    if (target.origin !== 'https://redmagic.club' || actual.origin !== target.origin
      || actual.username || actual.password || !['/join', '/join/'].includes(actual.pathname)) return false;
    const peer = await response.serverAddr();
    return peer?.port === 443 && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer.ipAddress);
  } catch { return false; }
}

// Serialized into the authenticated page: use the same browser/DNS/TLS path
// as the UI. APIRequestContext would resolve the public host independently.
export async function browserAssetProof(url) {
  const target = new URL(url);
  if (target.origin !== location.origin || target.origin !== 'https://redmagic.club'
    || !target.pathname.startsWith('/modules/bg3-video-hud/') || !/\.(js|css)$/.test(target.pathname)) {
    throw Error('invalid-browser-asset-proof');
  }
  const response = await fetch(target.href, { method: 'GET', credentials: 'same-origin',
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (response.status !== 200) return { status: response.status, sha256: null };
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 2_000_000) throw Error('runtime-asset-too-large');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return { status: 200, sha256: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('') };
}
