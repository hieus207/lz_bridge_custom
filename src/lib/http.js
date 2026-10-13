// Fetch helpers: hard timeouts (a dead API must never hang the scan) and
// in-memory caching with request de-duplication for large registry files.

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

const cache = new Map(); // key -> { at, promise }
const DEFAULT_TTL = 30 * 60 * 1000;

// Runs `loader` once per key per TTL; concurrent callers share the same promise.
// Failures are not cached so the next scan retries.
export function cached(key, loader, ttl = DEFAULT_TTL) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.promise;
  const promise = loader().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}
