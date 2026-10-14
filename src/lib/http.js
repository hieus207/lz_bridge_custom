// Fetch helpers: hard timeouts (a dead API must never hang the scan) and
// request de-duplication for the bridge registries.

const hostOf = (url) => {
  try { return new URL(url, window.location.href).host; } catch { return url; }
};

export async function fetchWithTimeout(url, { timeout = 15000, ...init } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`Timeout after ${timeout / 1000}s: ${hostOf(url)}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts) {
  const resp = await fetchWithTimeout(url, opts);
  if (!resp.ok) throw new Error(`${hostOf(url)} HTTP ${resp.status}`);
  return resp.json();
}

const inflight = new Map(); // key -> promise

// Concurrent callers within one scan share a request; nothing is kept afterwards,
// so every scan reads the bridges' APIs fresh (a pair added minutes ago shows up).
export function cached(key, loader) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = loader().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
