// Chain directory from Chainlist (ethereum-lists/chains, served by chainid.network).
// CORS-enabled, ~1.2 MB: fetched once per page load, and only when the user starts searching.
const CHAINLIST_URL = "https://chainid.network/chains.json";
let cached = null;

export function loadChainlist() {
  if (!cached) {
    cached = fetch(CHAINLIST_URL)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((list) => list
        .filter((c) => c.status !== "deprecated")
        .map((c) => ({
          chainId: c.chainId,
          name: c.name,
          symbol: c.nativeCurrency?.symbol || "ETH",
          // public HTTPS endpoints only: no websockets, no ${API_KEY} templates
          rpcs: (c.rpc || []).filter((u) => /^https:\/\//i.test(u) && !u.includes("${")),
          explorer: c.explorers?.[0]?.url || "",
          testnet: /test|sepolia|holesky|hoodi|goerli|devnet/i.test(c.name),
        }))
        .filter((c) => c.rpcs.length))
      .catch((e) => { cached = null; throw e; });
  }
  return cached;
}

// Name or chain id match: exact id first, then mainnets, then shorter names.
export function searchChains(list, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = (c) => String(c.chainId) === q;
  return list
    .filter((c) => exact(c) || c.name.toLowerCase().includes(q))
    .sort((a, b) => exact(b) - exact(a) || a.testnet - b.testnet || a.name.length - b.name.length)
    .slice(0, limit);
}

// Fastest of the first few RPCs that answers with the chain's own id (probe = url → chainId).
export function pickWorkingRpc(chain, probe) {
  return Promise.any(chain.rpcs.slice(0, 6).map(async (url) => {
    if ((await probe(url)) !== chain.chainId) throw new Error("wrong chain");
    return url;
  }));
}
