/* global BigInt */
// Live transfer limits of a detected bridge, read straight from the contracts
// (and the Wormhole Governor API). Each protocol caps transfers differently:
//   LayerZero  OFT RateLimiter (getAmountCanBeSent / rateLimits / outbound+inboundRateLimits),
//              quoteOFT max per tx, and the liquidity locked in an adapter (lockbox)
//   CCIP       token pool rate limiter per remote chain (outbound + inbound), lock/release liquidity
//   Wormhole   NTT manager outbound / per-chain inbound capacity; Portal → Governor USD cap per chain
//   Hyperlane  RateLimited router / hook / ISM, collateral liquidity
import { ethers } from "ethers";
import { CHAINS, CHAIN_LIST, chainName, anyChainName, chainIdFromLzKey } from "./chains";
import { cached, fetchJson } from "./http";
import { multicall, ERC20 } from "./onchain";
import { pickWorkingRpc } from "./bridgeScan";

const lc = (s) => (typeof s === "string" ? s.toLowerCase() : "");
const ZERO32 = ethers.ZeroHash;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT256_MAX = ethers.MaxUint256;

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms))]);

// One working provider per chain for the page's lifetime (RPCs, not bridge data).
const providers = new Map();
export function providerFor(chainId, preferredUrl) {
  if (!providers.has(chainId)) {
    const p = pickWorkingRpc(chainId, preferredUrl).then((r) => r?.provider || null);
    p.then((v) => { if (!v) providers.delete(chainId); });
    providers.set(chainId, p);
  }
  return providers.get(chainId);
}

// ─── Formatting / status ─────────────────────────────────────────────────────

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 });
export const fmtAmount = (raw, decimals) => {
  if (raw == null) return "—";
  if (raw >= UINT64_MAX * 10n ** 12n) return "∞";
  const n = Number(ethers.formatUnits(raw, decimals ?? 18));
  return n > 0 && n < 0.01 ? n.toPrecision(2) : compact.format(n);
};
export const fmtUsd = (n) => (n == null ? "—" : `$${compact.format(n)}`);
export const fmtWindow = (sec) => {
  const s = Number(sec);
  if (!s) return null;
  if (s % 86400 === 0) return s === 86400 ? "per day" : `per ${s / 86400}d`;
  if (s > 172800) return `per ${(s / 86400).toFixed(1)}d`;
  if (s % 3600 === 0) return s === 3600 ? "per hour" : `per ${s / 3600}h`;
  if (s % 60 === 0) return `per ${s / 60}min`;
  return `per ${s}s`;
};

// ok | low (<10% left) | blocked (nothing can pass) | unlimited
function statusOf(available, capacity) {
  if (capacity == null) return "unlimited";
  if (capacity === 0n || available === 0n) return "blocked";
  if (available != null && available * 10n < capacity) return "low";
  return "ok";
}

// ─── LayerZero ───────────────────────────────────────────────────────────────

// chainKey → v2 mainnet eid (and back), from LayerZero's deployments registry.
const loadLzEids = () => cached("lz-eids", async () => {
  const json = await fetchJson("https://metadata.layerzero-api.com/v1/metadata/deployments", { timeout: 25000 });
  const byKey = new Map();
  for (const [key, v] of Object.entries(json)) {
    if (/testnet|sandbox/i.test(key)) continue;
    const d = (v.deployments || []).find((x) => x.version === 2 && x.stage === "mainnet");
    if (d?.eid) byKey.set(v.chainKey || key, Number(d.eid));
  }
  const byEid = new Map([...byKey].map(([k, e]) => [e, k]));
  return { byKey, byEid };
});
const lzChainLabel = (key) => {
  const id = chainIdFromLzKey(key);
  if (id) return chainName(id);
  if (key === "solana") return "Solana";
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "?";
};

const LZ = new ethers.Interface([
  "function peers(uint32) view returns (bytes32)",
  "function getAmountCanBeSent(uint32) view returns (uint256 currentAmountInFlight, uint256 amountCanBeSent)",
  "function rateLimits(uint32) view returns (uint256 amountInFlight, uint256 lastUpdated, uint256 limit, uint256 window)",
  "function outboundRateLimits(uint32) view returns (uint256 amountInFlight, uint256 lastUpdated, uint256 limit, uint256 window)",
  "function inboundRateLimits(uint32) view returns (uint256 amountInFlight, uint256 lastUpdated, uint256 limit, uint256 window)",
  "function quoteOFT((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd)) view returns ((uint256 minAmountLD, uint256 maxAmountLD), (int256 feeAmountLD, string description)[], (uint256 amountSentLD, uint256 amountReceivedLD))",
  "function paused() view returns (bool)",
  "function token() view returns (address)",
]);

// LayerZero RateLimiter: in-flight amount decays linearly over the window.
function lzAvailable(rl, now) {
  if (!rl) return null;
  const [inFlight, lastUpdated, limit, window] = rl.map((x) => BigInt(x));
  const elapsed = BigInt(now) > lastUpdated ? BigInt(now) - lastUpdated : 0n;
  const decay = window ? (limit * elapsed) / window : limit;
  const cur = inFlight <= decay ? 0n : inFlight - decay;
  return { available: limit <= cur ? 0n : limit - cur, capacity: limit, window };
}

async function lzLimits({ address, chainId, provider, decimals, rpcUrl }) {
  const { byKey, byEid } = await loadLzEids();
  const srcKey = CHAINS[chainId]?.lzKey;
  const srcEid = byKey.get(srcKey);
  const eids = [...byEid.keys()].filter((e) => e !== srcEid);
  const peers = await multicall(provider, eids.map((e) => ({ target: address, iface: LZ, fn: "peers", args: [e] })));
  const routes = eids.map((e, i) => ({ eid: e, peer: peers[i] })).filter((r) => r.peer && r.peer !== ZERO32);
  if (!routes.length) return { rows: [], notes: ["No peers set on this OFT"] };

  const one = 10n ** BigInt(decimals ?? 18);
  const now = Math.floor(Date.now() / 1000);
  const perRoute = ["getAmountCanBeSent", "rateLimits", "outboundRateLimits", "quoteOFT"];
  const calls = routes.flatMap((r) => perRoute.map((fn) => ({
    target: address, iface: LZ, fn,
    args: fn === "quoteOFT" ? [[r.eid, ethers.zeroPadValue("0x000000000000000000000000000000000000dEaD", 32), one, 0n, "0x", "0x", "0x"]] : [r.eid],
  })));
  calls.push({ target: address, iface: LZ, fn: "paused" });
  const res = await multicall(provider, calls);
  const paused = res[res.length - 1];

  const rows = await Promise.all(routes.map(async (r, i) => {
    const [canSend, rl, outRl, quote] = res.slice(i * perRoute.length, (i + 1) * perRoute.length);
    const key = byEid.get(r.eid);
    const row = { route: `→ ${lzChainLabel(key)}`, dir: "out" };
    const lim = lzAvailable(rl || outRl, now);
    if (lim) {
      row.capacity = lim.capacity;
      row.available = canSend ? BigInt(canSend[1]) : lim.available;
      row.refill = fmtWindow(lim.window);
    }
    const maxTx = quote ? BigInt(quote[0][1]) : null;
    if (maxTx != null && maxTx !== UINT64_MAX && maxTx !== UINT256_MAX) row.maxTx = maxTx;
    row.status = paused === true ? "blocked" : statusOf(row.available, row.capacity);
    if (paused === true) row.note = "OFT paused";

    // Destination side (chains we have RPCs for): inbound limiter + adapter liquidity
    const dstId = chainIdFromLzKey(key);
    if (dstId && CHAINS[dstId]) {
      try {
        const dp = await withTimeout(providerFor(dstId), 10000, "rpc");
        const peerAddr = ethers.getAddress("0x" + r.peer.slice(26));
        if (dp && srcEid) {
          const [inRl, inner] = await withTimeout(multicall(dp, [
            { target: peerAddr, iface: LZ, fn: "inboundRateLimits", args: [srcEid] },
            { target: peerAddr, iface: LZ, fn: "token" },
          ]), 10000, "dst");
          const inLim = lzAvailable(inRl, now);
          if (inLim) {
            row.inbound = { available: inLim.available, capacity: inLim.capacity, refill: fmtWindow(inLim.window) };
            if (statusOf(inLim.available, inLim.capacity) === "blocked") row.status = "blocked";
            else if (statusOf(inLim.available, inLim.capacity) === "low" && row.status === "ok") row.status = "low";
          }
          if (inner && lc(inner) !== lc(peerAddr)) {
            // Adapter (lockbox) on the destination: it can only release what it holds
            const [bal] = await withTimeout(multicall(dp, [{ target: inner, iface: ERC20, fn: "balanceOf", args: [peerAddr] }]), 10000, "dst");
            // Informational only: a mint/burn adapter holds nothing yet is not limited by it
            if (bal != null) row.liquidity = BigInt(bal);
          }
        }
      } catch { /* destination unreachable: outbound info still stands */ }
    }
    return row;
  }));

  // This chain's own adapter liquidity = most that can come back here
  const notes = [];
  const [inner] = await multicall(provider, [{ target: address, iface: LZ, fn: "token" }]);
  if (inner && lc(inner) !== lc(address)) {
    const [bal] = await multicall(provider, [{ target: inner, iface: ERC20, fn: "balanceOf", args: [address] }]);
    if (bal != null) notes.push(`Held by this adapter: ${fmtAmount(BigInt(bal), decimals)} (if it is a lockbox, the most that can be bridged back to ${chainName(chainId)})`);
  }
  return { rows, notes, rpcUrl };
}

// ─── Chainlink CCIP ──────────────────────────────────────────────────────────

const loadCcipSelectors = () => cached("ccip-chains", async () => {
  const json = await fetchJson("https://docs.chain.link/api/ccip/v1/chains?environment=mainnet", { timeout: 20000 });
  const map = new Map();
  for (const family of Object.values(json.data || {})) {
    for (const c of Object.values(family)) if (c.selector) map.set(String(c.selector), c.displayName);
  }
  return map;
});

const BUCKET = "(uint128 tokens, uint32 lastUpdated, bool isEnabled, uint128 capacity, uint128 rate)";
const CCIP = new ethers.Interface([
  "function typeAndVersion() view returns (string)",
  "function getToken() view returns (address)",
  "function getSupportedChains() view returns (uint64[])",
  `function getCurrentOutboundRateLimiterState(uint64) view returns (${BUCKET})`,
  `function getCurrentInboundRateLimiterState(uint64) view returns (${BUCKET})`,
  `function getCurrentRateLimiterState(uint64, bool) view returns (${BUCKET}, ${BUCKET})`,
]);

const bucket = (b) => {
  if (!b) return null;
  const enabled = b.isEnabled ?? b[2];
  if (!enabled) return { capacity: null };
  const rate = BigInt(b.rate ?? b[4]);
  return { available: BigInt(b.tokens ?? b[0]), capacity: BigInt(b.capacity ?? b[3]), rate };
};

async function ccipLimits({ address, provider, decimals }) {
  const [tv, token, sels] = await multicall(provider, [
    { target: address, iface: CCIP, fn: "typeAndVersion" },
    { target: address, iface: CCIP, fn: "getToken" },
    { target: address, iface: CCIP, fn: "getSupportedChains" },
  ]);
  if (!sels?.length) return { rows: [], notes: ["Pool has no remote chains configured"] };
  const names = await loadCcipSelectors().catch(() => new Map());
  const calls = sels.flatMap((s) => [
    { target: address, iface: CCIP, fn: "getCurrentOutboundRateLimiterState", args: [s] },
    { target: address, iface: CCIP, fn: "getCurrentInboundRateLimiterState", args: [s] },
    { target: address, iface: CCIP, fn: "getCurrentRateLimiterState", args: [s, false] },
  ]);
  const res = await multicall(provider, calls);
  const refill = (b) => (b?.rate != null && b.capacity ? `+${fmtAmount(b.rate, decimals)}/s (full in ${fmtDuration(b.capacity / (b.rate || 1n))})` : null);

  const rows = sels.map((s, i) => {
    const [o1, i1, v2] = res.slice(i * 3, i * 3 + 3);
    const out = bucket(o1 ?? v2?.[0]);
    const inn = bucket(i1 ?? v2?.[1]);
    const name = names.get(String(s)) || `selector ${s}`;
    const row = { route: `⇄ ${name}`, dir: "both" };
    if (out) Object.assign(row, { available: out.available, capacity: out.capacity, refill: refill(out) });
    if (inn) row.inbound = { available: inn.available, capacity: inn.capacity, refill: refill(inn) };
    const st = [statusOf(row.available, row.capacity), statusOf(inn?.available, inn?.capacity)];
    row.status = st.includes("blocked") ? "blocked" : st.includes("low") ? "low" : st.every((x) => x === "unlimited") ? "unlimited" : "ok";
    return row;
  });

  const notes = [];
  if (tv) notes.push(tv);
  if (/LockRelease/i.test(tv || "") && token) {
    const [bal] = await multicall(provider, [{ target: token, iface: ERC20, fn: "balanceOf", args: [address] }]);
    if (bal != null) notes.push(`Liquidity in this lock/release pool: ${fmtAmount(BigInt(bal), decimals)} (max that can arrive here)`);
  }
  return { rows, notes, legend: "→ out of this chain · ← into this chain" };
}

const fmtDuration = (secBig) => {
  const s = Number(secBig);
  if (s < 120) return `${s}s`;
  if (s < 7200) return `${Math.round(s / 60)}min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
};

// ─── Wormhole ────────────────────────────────────────────────────────────────

const WH_NAMES = {
  1: "Solana", 2: "Ethereum", 4: "BNB", 5: "Polygon", 6: "Avalanche", 10: "Fantom", 13: "Kaia", 14: "Celo",
  16: "Moonbeam", 21: "Sui", 22: "Aptos", 23: "Arbitrum", 24: "Optimism", 30: "Base", 34: "Scroll",
  35: "Mantle", 36: "Blast", 37: "X Layer", 38: "Linea", 39: "Berachain", 40: "Sei EVM", 44: "Unichain",
  45: "World Chain", 47: "HyperEVM", 48: "Monad",
};
const whName = (id) => WH_NAMES[id] || CHAIN_LIST.find((c) => c.wormhole?.chainId === id)?.name || `Wormhole chain ${id}`;

const loadGovernor = () => cached("wh-governor", async () => {
  const [limits, tokens] = await Promise.all([
    fetchJson("https://api.wormholescan.io/api/v1/governor/limit", { timeout: 20000 }),
    fetchJson("https://api.wormholescan.io/v1/governor/token_list", { timeout: 20000 }).catch(() => null),
  ]);
  const byChain = new Map((limits.data || []).map((x) => [Number(x.chainId), x]));
  const governed = tokens ? new Set((tokens.entries || []).map((t) => `${t.originChainId}:${lc(t.originAddress)}`)) : null;
  return { byChain, governed };
});

const NTT = new ethers.Interface([
  "function minter() view returns (address)",
  "function getMode() view returns (uint8)",
  "function getCurrentOutboundCapacity() view returns (uint256)",
  "function getOutboundLimitParams() view returns ((uint72 limit, uint72 currentCapacity, uint64 lastTxTimestamp))",
  "function getCurrentInboundCapacity(uint16) view returns (uint256)",
  "function getInboundLimitParams(uint16) view returns ((uint72 limit, uint72 currentCapacity, uint64 lastTxTimestamp))",
  "function getPeer(uint16) view returns ((bytes32 peerAddress, uint8 tokenDecimals))",
  "function rateLimitDuration() view returns (uint64)",
]);
const WRAPPED = new ethers.Interface([
  "function chainId() view returns (uint16)",
  "function nativeContract() view returns (bytes32)",
]);

// TrimmedAmount = uint64 amount << 8 | uint8 decimals
const untrim = (v, decimals) => {
  const x = BigInt(v);
  const amt = x >> 8n;
  const d = Number(x & 0xffn);
  const to = decimals ?? d;
  return to >= d ? amt * 10n ** BigInt(to - d) : amt / 10n ** BigInt(d - to);
};

async function nttLimits({ address, token, provider, decimals }) {
  let manager = address;
  if (!manager) {
    // Burn-mode NTT tokens point at their manager through minter()
    const [m] = await multicall(provider, [{ target: token, iface: NTT, fn: "minter" }]);
    const [mode] = m ? await multicall(provider, [{ target: m, iface: NTT, fn: "getMode" }]) : [null];
    if (mode == null) return { rows: [], notes: ["NTT manager not found on this chain — limits unknown"] };
    manager = m;
  }
  const whIds = [...new Set([...Object.keys(WH_NAMES).map(Number), ...CHAIN_LIST.filter((c) => c.wormhole).map((c) => c.wormhole.chainId)])];
  const head = await multicall(provider, [
    { target: manager, iface: NTT, fn: "getCurrentOutboundCapacity" },
    { target: manager, iface: NTT, fn: "getOutboundLimitParams" },
    { target: manager, iface: NTT, fn: "rateLimitDuration" },
    ...whIds.map((id) => ({ target: manager, iface: NTT, fn: "getPeer", args: [id] })),
  ]);
  const [outCap, outParams, duration] = head;
  const peers = whIds.filter((_, i) => head[3 + i] && head[3 + i][0] !== ZERO32);
  const inRes = await multicall(provider, peers.flatMap((id) => [
    { target: manager, iface: NTT, fn: "getCurrentInboundCapacity", args: [id] },
    { target: manager, iface: NTT, fn: "getInboundLimitParams", args: [id] },
  ]));
  const refill = duration ? fmtWindow(duration) : null;
  const outLimit = outParams ? untrim(outParams[0], decimals) : null;
  const rows = [];
  if (outCap != null) {
    // Outbound capacity is shared by every destination
    rows.push({
      route: "→ all chains (shared)", dir: "out", available: BigInt(outCap), capacity: outLimit || null, refill,
      status: outLimit ? statusOf(BigInt(outCap), outLimit) : "unlimited",
      note: "Over the limit → queued 24h (or reverts if the sender opts out)",
    });
  }
  peers.forEach((id, i) => {
    const cap = inRes[i * 2];
    const params = inRes[i * 2 + 1];
    const limit = params ? untrim(params[0], decimals) : null;
    rows.push({
      route: `← ${whName(id)}`, dir: "in", available: cap != null ? BigInt(cap) : null, capacity: limit || null, refill,
      status: limit ? statusOf(BigInt(cap ?? 0), limit) : "unlimited",
    });
  });
  return { rows, notes: [`NTT manager ${manager}`], legend: "← = how much can arrive here from that chain" };
}

async function portalLimits({ token, chainId, provider, attestedOn = [] }) {
  const { byChain, governed } = await loadGovernor();
  const here = CHAINS[chainId]?.wormhole?.chainId;
  let origin = here ? `${here}:${lc(ethers.zeroPadValue(token, 32))}` : null;
  const [oc, nc] = await multicall(provider, [
    { target: token, iface: WRAPPED, fn: "chainId" },
    { target: token, iface: WRAPPED, fn: "nativeContract" },
  ]);
  if (oc != null && nc) origin = `${Number(oc)}:${lc(nc)}`;
  const notes = [];
  if (governed && origin && !governed.has(origin)) {
    notes.push("Token is not on the Governor's priced list → no USD cap applies to it");
  }
  const chainRow = (whId, label) => {
    const g = byChain.get(whId);
    if (!g) return null;
    const avail = Number(g.availableNotional);
    const limit = Number(g.notionalLimit);
    return {
      route: label, dir: "out", usd: true, availableUsd: avail, capacityUsd: limit,
      refill: "rolling 24h", maxTxUsd: Number(g.maxTransactionSize) || null,
      status: !limit ? "unlimited" : avail <= 0 ? "blocked" : avail * 10 < limit ? "low" : "ok",
    };
  };
  const rows = [];
  if (here) {
    const r = chainRow(here, `→ out of ${chainName(chainId)}`);
    if (r) rows.push(r);
  }
  for (const name of attestedOn) {
    const c = CHAIN_LIST.find((x) => x.name === name);
    const id = c?.wormhole?.chainId ?? (name === "Solana" ? 1 : null);
    if (id && id !== here) {
      const r = chainRow(id, `← back from ${name}`);
      if (r) rows.push(r);
    }
  }
  return {
    rows, notes,
    legend: "Governor: USD cap per source chain shared by all governed tokens · a single transfer above the big-tx size waits 24h",
  };
}

// ─── Hyperlane ───────────────────────────────────────────────────────────────

const HL = new ethers.Interface([
  "function maxCapacity() view returns (uint256)",
  "function calculateCurrentLevel() view returns (uint256)",
  "function refillRate() view returns (uint256)",
  "function hook() view returns (address)",
  "function interchainSecurityModule() view returns (address)",
  "function domains() view returns (uint32[])",
  "function wrappedToken() view returns (address)",
]);

async function hyperlaneLimits({ address, chainId, provider, decimals }) {
  const [hook, ism, domains, wrapped] = await multicall(provider, [
    { target: address, iface: HL, fn: "hook" },
    { target: address, iface: HL, fn: "interchainSecurityModule" },
    { target: address, iface: HL, fn: "domains" },
    { target: address, iface: HL, fn: "wrappedToken" },
  ]);
  const targets = [
    [address, "→ all routes (router)"],
    ...(hook && hook !== ethers.ZeroAddress ? [[hook, "→ all routes (rate-limited hook)"]] : []),
    ...(ism && ism !== ethers.ZeroAddress ? [[ism, "← all routes (rate-limited ISM)"]] : []),
  ];
  const res = await multicall(provider, targets.flatMap(([t]) => [
    { target: t, iface: HL, fn: "maxCapacity" },
    { target: t, iface: HL, fn: "calculateCurrentLevel" },
    { target: t, iface: HL, fn: "refillRate" },
  ]));
  const rows = [];
  targets.forEach(([, label], i) => {
    const [max, level, rate] = res.slice(i * 3, i * 3 + 3);
    if (max == null || level == null) return;
    const cap = BigInt(max);
    rows.push({
      route: label, dir: label.startsWith("←") ? "in" : "out",
      available: BigInt(level), capacity: cap,
      refill: rate != null ? `+${fmtAmount(BigInt(rate), decimals)}/s` : null,
      status: statusOf(BigInt(level), cap),
    });
  });
  const notes = [];
  if (!rows.length) notes.push("No rate limiter on this warp route");
  if (wrapped && lc(wrapped) !== lc(address)) {
    const [bal] = await multicall(provider, [{ target: wrapped, iface: ERC20, fn: "balanceOf", args: [address] }]);
    if (bal != null) notes.push(`Collateral held by this router: ${fmtAmount(BigInt(bal), decimals)} (max that can arrive on ${chainName(chainId)})`);
  }
  if (domains?.length) notes.push(`Remote domains: ${domains.map((d) => anyChainName(Number(d))).join(", ")}`);
  return { rows, notes };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const PORTAL_TITLES = /Portal|Token Bridge/;

// Which findings have a limit worth reading.
export function limitKind(protocol, f) {
  if (f.confidence === "low") return null;
  if (protocol === "LayerZero" && f.address && /OFT/.test(f.title)) return "lz";
  if (protocol === "Chainlink CCIP" && f.address && /pool/i.test(f.title)) return "ccip";
  if (protocol === "Wormhole" && (/NTT/.test(f.title))) return "ntt";
  if (protocol === "Wormhole" && PORTAL_TITLES.test(f.title)) return "portal";
  if (protocol === "Hyperlane" && f.address) return "hyperlane";
  return null;
}

export async function readLimits({ kind, finding, token, chainId, rpcUrl, decimals }) {
  const provider = await withTimeout(providerFor(chainId, rpcUrl), 15000, "rpc");
  if (!provider) throw new Error("No RPC reachable");
  const args = { address: finding.address, token, chainId, provider, decimals, rpcUrl };
  switch (kind) {
    case "lz": return lzLimits(args);
    case "ccip": return ccipLimits(args);
    case "ntt": return nttLimits({ ...args, address: /Manager/.test(finding.title) ? finding.address : null });
    case "portal": return portalLimits({ ...args, attestedOn: finding.destinations || [] });
    case "hyperlane": return hyperlaneLimits(args);
    default: return { rows: [], notes: [] };
  }
}
