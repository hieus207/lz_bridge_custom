// User-added EVM chains, persisted in localStorage and shared by every page.
// Shape: { id: number, name: string, rpc: string, symbol: string, explorer?: string }

const KEY = "custom_chains";
const LEGACY_KEY = "lz_custom_chain"; // single chain saved by the old Bridge page
const EVENT = "custom-chains-changed";

const read = () => {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "null");
    if (Array.isArray(list)) return list;
  } catch { /* corrupted or blocked storage */ }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    if (legacy?.id && legacy?.rpc) {
      const migrated = [{ id: Number(legacy.id), name: legacy.name || `Chain ${legacy.id}`, rpc: legacy.rpc, symbol: "ETH" }];
      write(migrated);
      return migrated;
    }
  } catch { /* ignore */ }
  return [];
};

const write = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* storage full / blocked: keep working in-memory for this session */ }
  window.dispatchEvent(new Event(EVENT));
};

export const loadCustomChains = read;

export const getCustomChain = (id) => read().find((c) => c.id === Number(id)) || null;

export function saveCustomChain(chain) {
  const list = read().filter((c) => c.id !== chain.id);
  list.push(chain);
  list.sort((a, b) => a.name.localeCompare(b.name));
  write(list);
  return list;
}

export function removeCustomChain(id) {
  const list = read().filter((c) => c.id !== Number(id));
  write(list);
  return list;
}

// Same-tab updates via a custom event, other tabs via the native storage event.
export function subscribeCustomChains(cb) {
  const handler = () => cb(read());
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// Raw eth_chainId with a hard timeout. Deliberately not ethers' getNetwork():
// on an unreachable RPC ethers v6 keeps retrying forever and never rejects.
export async function probeRpc(url, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json?.result) throw new Error(json?.error?.message || "invalid JSON-RPC response");
    return parseInt(json.result, 16);
  } catch (err) {
    if (err.name === "AbortError") throw new Error(`no response in ${timeout / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
