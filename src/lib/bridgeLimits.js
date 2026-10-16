/* global BigInt */
// Live transfer limits of a detected bridge, read straight from the contracts
// (and the Wormhole Governor API). Each protocol caps transfers differently:
//   LayerZero  OFT RateLimiter (getAmountCanBeSent / rateLimits / outbound+inboundRateLimits),
//              quoteOFT max per tx, and the liquidity locked in an adapter (lockbox)
//   CCIP       token pool rate limiter per remote chain (outbound + inbound), lock/release liquidity
//   Wormhole   NTT manager outbound / per-chain inbound capacity; Portal → Governor USD cap per chain
//   Hyperlane  RateLimited router / hook / ISM, collateral liquidity
import { ethers } from "ethers";
import { CHAINS, CHAIN_LIST, chainName, anyChainName, chainIdFromLzKey, SOLANA } from "./chains";
import { cached, fetchJson } from "./http";
import { multicall, ERC20, findNttManager } from "./onchain";
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
// A capacity below 0.0001 token is a lane switched off by setting a dust limit.
function statusOf(available, capacity, decimals) {
  if (capacity == null) return "unlimited";
  if (capacity === 0n || available === 0n) return "blocked";
  if (decimals != null && capacity < 10n ** BigInt(Math.max(decimals - 4, 0))) return "blocked";
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

const scaleDec = (x, from, to) => {
  if (x == null || from == null || to == null || from === to) return x;
  return to > from ? x * 10n ** BigInt(to - from) : x / 10n ** BigInt(from - to);
};
const worse = (a, b) => (STATUS_ORDER[b] > STATUS_ORDER[a] ? b : a);
const STATUS_ORDER = { unlimited: 0, ok: 1, low: 2, blocked: 3 };

// Receiving side of a lane into `key` (EVM chains we have RPCs for, and Solana):
// its inbound limiter for `srcEid` and what its adapter holds, in the sender's decimals.
async function lzDestSide({ key, peer32, srcEid, decimals, now }) {
  if (key === "solana") {
    const { makeSolana, resolveSolanaOft, getPeerLimits, escrowBalance } = await import("./solanaOft");
    const { PublicKey } = await import("@solana/web3.js");
    const sol = makeSolana(SOLANA_RPC_URLS[0]);
    const t = await resolveSolanaOft(sol, new PublicKey(ethers.getBytes(peer32)).toBase58());
    const [peer] = await getPeerLimits(sol, t, [srcEid]);
    const held = t.oftType === 1 ? await escrowBalance(sol, t).catch(() => null) : null;
    const inn = peer?.inbound;
    return {
      inbound: inn ? { available: scaleDec(inn.available, t.decimals, decimals), capacity: scaleDec(inn.capacity, t.decimals, decimals) } : null,
      liquidity: held != null ? scaleDec(held, t.decimals, decimals) : null,
    };
  }
  const dstId = chainIdFromLzKey(key);
  if (!dstId || !CHAINS[dstId]) return null;
  const dp = await withTimeout(providerFor(dstId), 10000, "rpc");
  if (!dp) return null;
  const peerAddr = ethers.getAddress("0x" + peer32.slice(26));
  const [inRl, inner] = await withTimeout(multicall(dp, [
    { target: peerAddr, iface: LZ, fn: "inboundRateLimits", args: [srcEid] },
    { target: peerAddr, iface: LZ, fn: "token" },
  ]), 10000, "dst");
  const tokenAddr = inner || peerAddr;
  const [dDec, bal] = await withTimeout(multicall(dp, [
    { target: tokenAddr, iface: ERC20, fn: "decimals" },
    ...(inner && lc(inner) !== lc(peerAddr) ? [{ target: inner, iface: ERC20, fn: "balanceOf", args: [peerAddr] }] : []),
  ]), 10000, "dst");
  const dd = dDec != null ? Number(dDec) : decimals;
  const inLim = lzAvailable(inRl, now);
  return {
    inbound: inLim ? { available: scaleDec(inLim.available, dd, decimals), capacity: scaleDec(inLim.capacity, dd, decimals), refill: fmtWindow(inLim.window) } : null,
    // Informational only: a mint/burn adapter holds nothing yet is not limited by it
    liquidity: bal != null ? scaleDec(BigInt(bal), dd, decimals) : null,
  };
}

async function attachDest(row, args) {
  try {
    const d = await withTimeout(lzDestSide(args), 20000, "dst");
    if (!d) return;
    if (d.inbound) {
      row.inbound = d.inbound;
      row.status = worse(row.status, statusOf(d.inbound.available, d.inbound.capacity, args.decimals));
    }
    if (d.liquidity != null) row.liquidity = d.liquidity;
  } catch { /* destination unreachable: outbound info still stands */ }
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
    row.status = paused === true ? "blocked" : statusOf(row.available, row.capacity, decimals);
    if (paused === true) row.note = "OFT paused";
    if (srcEid) await attachDest(row, { key, peer32: r.peer, srcEid, decimals, now });
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

// OFT on Solana: per-peer RateLimiter in the PeerConfig accounts (first-gen programs: outbound only)
async function lzSolanaLimits({ token }) {
  const { makeSolana, resolveSolanaOft, getPeerLimits, escrowBalance, SOLANA_EID } = await import("./solanaOft");
  const { byEid } = await loadLzEids();
  const sol = makeSolana(SOLANA_RPC_URLS[0]);
  const t = await resolveSolanaOft(sol, token);
  const decimals = t.decimals;
  const peers = await getPeerLimits(sol, t, [...byEid.keys()].filter((e) => e !== SOLANA_EID));
  if (!peers.length) return { rows: [], notes: ["No peers set on this OFT"] };
  const now = Math.floor(Date.now() / 1000);
  const rows = await Promise.all(peers.map(async (p) => {
    const key = byEid.get(p.eid);
    const row = { route: `→ ${lzChainLabel(key)}`, dir: "out" };
    if (p.outbound) {
      Object.assign(row, {
        available: p.outbound.available, capacity: p.outbound.capacity,
        refill: p.outbound.rate ? `+${fmtAmount(p.outbound.rate, decimals)}/s` : null,
      });
    }
    row.status = t.paused ? "blocked" : statusOf(row.available, row.capacity, decimals);
    if (t.paused) row.note = "OFT paused";
    await attachDest(row, { key, peer32: p.peer, srcEid: SOLANA_EID, decimals, now });
    if (p.inbound) {
      // Solana's own inbound limiter for this peer = cap on arrivals from that chain
      row.note = [row.note, `receive from ${lzChainLabel(key)}: ${fmtAmount(p.inbound.available, decimals)} / ${fmtAmount(p.inbound.capacity, decimals)}`]
        .filter(Boolean).join(" · ");
      row.status = worse(row.status, statusOf(p.inbound.available, p.inbound.capacity, decimals));
    }
    return row;
  }));
  const notes = [];
  if (t.legacy) notes.push("First-gen OFT program: only the outbound limiter is stored on Solana");
  if (t.oftType === 1) {
    const held = await escrowBalance(sol, t).catch(() => null);
    if (held != null) notes.push(`Held in the adapter escrow: ${fmtAmount(held, decimals)} (the most that can be bridged back to Solana)`);
  }
  return { rows, notes, decimals };
}

// ─── Chainlink CCIP ──────────────────────────────────────────────────────────
//
// A lane A → B is capped twice: A's pool outbound bucket for B and B's pool inbound bucket
// for A. Rows show the tighter of the two, per direction, read from both pools.

const CCIP_SOLANA = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"; // CCIP keys Solana by genesis hash

const loadCcipChains = () => cached("ccip-chains", async () => {
  const json = await fetchJson("https://docs.chain.link/api/ccip/v1/chains?environment=mainnet", { timeout: 20000 });
  const nameBySel = new Map();
  const selByChain = new Map(); // directory chain key (EVM id or Solana genesis) → selector
  for (const family of Object.values(json.data || {})) {
    for (const [key, c] of Object.entries(family)) {
      if (!c.selector) continue;
      nameBySel.set(String(c.selector), c.displayName);
      selByChain.set(String(key), BigInt(c.selector));
    }
  }
  return { nameBySel, selByChain };
});

// Same token on every chain, from the CCIP directory (keyed by directory chain key)
const loadCcipToken = (symbol) => cached(`ccip-token:${symbol}`, () =>
  fetchJson(`https://docs.chain.link/api/ccip/v1/tokens/${encodeURIComponent(symbol)}?environment=mainnet`, { timeout: 20000 })
    .then((j) => j.data || {}));

const BUCKET = "(uint128 tokens, uint32 lastUpdated, bool isEnabled, uint128 capacity, uint128 rate)";
const CCIP = new ethers.Interface([
  "function typeAndVersion() view returns (string)",
  "function getToken() view returns (address)",
  "function getSupportedChains() view returns (uint64[])",
  `function getCurrentOutboundRateLimiterState(uint64) view returns (${BUCKET})`,
  `function getCurrentInboundRateLimiterState(uint64) view returns (${BUCKET})`,
  `function getCurrentRateLimiterState(uint64, bool) view returns (${BUCKET}, ${BUCKET})`,
]);

// { available, capacity, rate } in the pool's own decimals; capacity null = limiter off
const bucket = (b) => {
  if (!b) return null;
  const enabled = b.isEnabled ?? b[2];
  if (!enabled) return { capacity: null };
  return { available: BigInt(b.tokens ?? b[0]), capacity: BigInt(b.capacity ?? b[3]), rate: BigInt(b.rate ?? b[4]) };
};
const rescale = (b, from, to) => {
  if (!b || b.capacity == null || from == null || to == null || from === to) return b;
  const f = (x) => (to > from ? x * 10n ** BigInt(to - from) : x / 10n ** BigInt(from - to));
  return { available: f(b.available), capacity: f(b.capacity), rate: f(b.rate) };
};
// Tighter of two buckets (null = not read, capacity null = unlimited)
const tighter = (a, b) => {
  if (!a || a.capacity == null) return b && b.capacity != null ? b : a || b;
  if (!b || b.capacity == null) return a;
  return b.available < a.available ? b : a;
};

// EVM pool: outbound + inbound buckets for one remote selector
async function evmPoolBuckets(provider, pool, sel) {
  const [o1, i1, v2] = await multicall(provider, [
    { target: pool, iface: CCIP, fn: "getCurrentOutboundRateLimiterState", args: [sel] },
    { target: pool, iface: CCIP, fn: "getCurrentInboundRateLimiterState", args: [sel] },
    { target: pool, iface: CCIP, fn: "getCurrentRateLimiterState", args: [sel, false] },
  ]);
  return { out: bucket(o1 ?? v2?.[0]), in: bucket(i1 ?? v2?.[1]) };
}

// Solana pool: per-remote-chain config PDA ["ccip_tokenpool_chainconfig", selector LE, mint].
// Borsh: disc 8 | pool_addresses Vec<Vec<u8>> | token_address Vec<u8> | decimals u8 |
//        inbound {tokens u64, last_updated u64, enabled u8, capacity u64, rate u64} | outbound {…}
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SOLANA_RPC_URLS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
async function solanaConnection() {
  const { Connection } = await import("@solana/web3.js");
  for (const url of SOLANA_RPC_URLS) {
    const c = new Connection(url, "confirmed");
    try { await withTimeout(c.getSlot(), 6000, "solana"); return c; } catch { /* next */ }
  }
  throw new Error("No Solana RPC reachable");
}

function decodeSolanaChainConfig(data, now) {
  let o = 8;
  const u32 = () => { const v = data.readUInt32LE(o); o += 4; return v; };
  const u64 = () => { const v = data.readBigUInt64LE(o); o += 8; return v; };
  const n = u32();
  const skip = () => { const len = u32(); o += len; };
  for (let i = 0; i < n; i++) skip();
  skip();
  o += 1;
  const readBucket = () => {
    const tokens = u64(); const last = u64(); const enabled = data[o++] === 1; const capacity = u64(); const rate = u64();
    if (!enabled) return { capacity: null };
    const elapsed = BigInt(now) > last ? BigInt(now) - last : 0n;
    const refilled = tokens + elapsed * rate;
    return { available: refilled > capacity ? capacity : refilled, capacity, rate };
  };
  const inbound = readBucket();
  const outbound = readBucket();
  return { out: outbound, in: inbound };
}

async function solanaPoolBuckets(conn, poolState, mint, sels) {
  const { PublicKey } = await import("@solana/web3.js");
  const info = await conn.getAccountInfo(new PublicKey(poolState));
  if (!info) throw new Error("CCIP pool account not found on Solana");
  const program = info.owner;
  const mintKey = new PublicKey(mint);
  const pdas = sels.map((sel) => {
    const s = new Uint8Array(8);
    new DataView(s.buffer).setBigUint64(0, sel, true);
    return PublicKey.findProgramAddressSync([new TextEncoder().encode("ccip_tokenpool_chainconfig"), s, mintKey.toBytes()], program)[0];
  });
  const accts = await conn.getMultipleAccountsInfo(pdas);
  const now = Math.floor(Date.now() / 1000);
  // Lock/release liquidity sits in the pool signer's token account
  const [signer] = PublicKey.findProgramAddressSync([new TextEncoder().encode("ccip_tokenpool_signer"), mintKey.toBytes()], program);
  const mintInfo = await conn.getAccountInfo(mintKey);
  const ata = mintInfo ? PublicKey.findProgramAddressSync(
    [signer.toBytes(), mintInfo.owner.toBytes(), mintKey.toBytes()], new PublicKey(ATA_PROGRAM)
  )[0] : null;
  const ataInfo = ata ? await conn.getAccountInfo(ata) : null;
  const held = ataInfo ? ataInfo.data.readBigUInt64LE(64) : null;
  return { buckets: accts.map((a) => (a ? decodeSolanaChainConfig(a.data, now) : null)), held };
}

async function ccipLimits({ address, chainId, token, provider, decimals, finding }) {
  const isSolana = chainId === SOLANA;
  const here = isSolana ? CCIP_SOLANA : String(chainId);
  const symbol = finding?.details?.find(([k]) => k === "Symbol")?.[1];
  const [{ nameBySel, selByChain }, directory] = await Promise.all([
    loadCcipChains(),
    symbol ? loadCcipToken(symbol).catch(() => ({})) : Promise.resolve({}),
  ]);
  // The directory entry for this exact token (symbols are not unique)
  const self = directory[here] && lc(directory[here].tokenAddress) === lc(token) ? directory[here] : null;
  const hereSel = selByChain.get(here);
  const notes = [];

  // This pool's buckets per remote selector
  let sels;
  let local;
  let tv = null;
  if (isSolana) {
    sels = (self?.destinations || []).map((d) => selByChain.get(String(d))).filter(Boolean);
    if (!sels.length) return { rows: [], notes: ["Remote chains unknown (token not in the CCIP directory)"] };
    const conn = await solanaConnection();
    const { buckets, held } = await solanaPoolBuckets(conn, address, token, sels);
    local = buckets;
    tv = finding?.title?.match(/\((.+)\)/)?.[1] || null;
    if (/LockRelease/i.test(tv || "") && held != null) notes.push(`Liquidity in this lock/release pool: ${fmtAmount(held, decimals)} (max that can arrive on Solana)`);
  } else {
    const [v, poolToken, s] = await multicall(provider, [
      { target: address, iface: CCIP, fn: "typeAndVersion" },
      { target: address, iface: CCIP, fn: "getToken" },
      { target: address, iface: CCIP, fn: "getSupportedChains" },
    ]);
    tv = v;
    sels = (s || []).map((x) => BigInt(x));
    if (!sels.length) return { rows: [], notes: ["Pool has no remote chains configured"] };
    local = await Promise.all(sels.map((sel) => evmPoolBuckets(provider, address, sel)));
    if (/LockRelease/i.test(tv || "") && poolToken) {
      const [bal] = await multicall(provider, [{ target: poolToken, iface: ERC20, fn: "balanceOf", args: [address] }]);
      if (bal != null) notes.push(`Liquidity in this lock/release pool: ${fmtAmount(BigInt(bal), decimals)} (max that can arrive on ${chainName(chainId)})`);
    }
  }
  if (tv) notes.unshift(tv);

  // Remote pools (from the directory) for the other half of each lane
  const remoteBySel = new Map();
  if (self && hereSel != null) {
    await Promise.all(Object.entries(directory).map(async ([key, e]) => {
      if (key === here || !e.pool?.address) return;
      const sel = selByChain.get(key);
      if (sel == null || !sels.includes(sel)) return;
      try {
        let b = null;
        if (key === CCIP_SOLANA) {
          const conn = await solanaConnection();
          b = (await solanaPoolBuckets(conn, e.pool.address, e.tokenAddress, [hereSel])).buckets[0];
        } else if (CHAINS[key]) {
          const p = await withTimeout(providerFor(Number(key)), 10000, "rpc");
          if (p) b = await withTimeout(evmPoolBuckets(p, e.pool.address, hereSel), 10000, "pool");
        }
        if (b) remoteBySel.set(sel, { out: rescale(b.out, e.decimals, decimals), in: rescale(b.in, e.decimals, decimals) });
      } catch { /* remote side unreadable: show this pool only */ }
    }));
  }

  const refill = (b) => (b?.rate && b.capacity ? `+${fmtAmount(b.rate, decimals)}/s (full in ${fmtDuration(b.capacity / b.rate)})` : null);
  const rows = sels.map((sel, i) => {
    const mine = local[i] || {};
    const remote = remoteBySel.get(sel);
    const name = nameBySel.get(String(sel)) || `selector ${sel}`;
    const out = tighter(mine.out, remote?.in);
    const inn = tighter(remote?.out, mine.in);
    const row = { route: `⇄ ${name}`, dir: "both" };
    if (out) Object.assign(row, { available: out.available, capacity: out.capacity, refill: refill(out) });
    if (inn) row.inbound = { available: inn.available, capacity: inn.capacity, refill: refill(inn) };
    const by = [];
    if (remote && out && out === remote.in && out.capacity != null) by.push(`send capped by ${name} pool`);
    if (remote && inn && inn === remote.out && inn.capacity != null) by.push(`receive capped by ${name} pool`);
    if (by.length) row.note = by.join(" · ");
    if (!remote) row.note = `${name} side not checked`;
    const st = [statusOf(row.available, row.capacity, decimals), statusOf(inn?.available, inn?.capacity, decimals)];
    row.status = st.includes("blocked") ? "blocked" : st.includes("low") ? "low" : st.every((x) => x === "unlimited") ? "unlimited" : "ok";
    return row;
  });
  return { rows, notes, legend: "Top = can send to that chain now · in = can receive from it (tighter of both pools)" };
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

async function nttLimits({ address, token, chainId, provider, decimals }) {
  let manager = address;
  if (!manager) {
    manager = await findNttManager(provider, token, { chainId, blockTime: CHAINS[chainId]?.blockTime });
    if (!manager) return { rows: [], notes: ["NTT manager not found on this chain — limits unknown"] };
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

const WH_ID_BY_NAME = Object.fromEntries([
  ...Object.entries(WH_NAMES).map(([id, n]) => [n, Number(id)]),
  ...CHAIN_LIST.filter((c) => c.wormhole).map((c) => [c.name, c.wormhole.chainId]),
]);

async function portalLimits({ token, chainId, provider, finding, attestedOn = [] }) {
  const { byChain, governed } = await loadGovernor();
  const isSolana = chainId === SOLANA;
  const here = isSolana ? 1 : CHAINS[chainId]?.wormhole?.chainId;
  let origin = null;
  if (isSolana) {
    const { PublicKey } = await import("@solana/web3.js");
    origin = `1:${lc(ethers.hexlify(new PublicKey(token).toBytes()))}`;
    // Wrapped mint: origin from the Token Bridge meta (shown in the finding)
    const oName = finding?.details?.find(([k]) => k === "Origin chain")?.[1];
    const oTok = finding?.details?.find(([k]) => k === "Origin token")?.[1];
    if (oName && oTok && WH_ID_BY_NAME[oName] != null) origin = `${WH_ID_BY_NAME[oName]}:${lc(ethers.zeroPadValue(oTok, 32))}`;
  } else {
    origin = here ? `${here}:${lc(ethers.zeroPadValue(token, 32))}` : null;
    const [oc, nc] = await multicall(provider, [
      { target: token, iface: WRAPPED, fn: "chainId" },
      { target: token, iface: WRAPPED, fn: "nativeContract" },
    ]);
    if (oc != null && nc) origin = `${Number(oc)}:${lc(nc)}`;
  }
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
    const r = chainRow(here, `→ out of ${isSolana ? "Solana" : chainName(chainId)}`);
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

async function hyperlaneSolanaLimits({ address, decimals }) {
  const { PublicKey } = await import("@solana/web3.js");
  const conn = await solanaConnection();
  const program = new PublicKey(address);
  const [escrow] = PublicKey.findProgramAddressSync(
    ["hyperlane_token", "-", "escrow"].map((x) => new TextEncoder().encode(x)), program
  );
  const info = await conn.getAccountInfo(escrow);
  const notes = ["Sealevel warp routes have no rate limiter"];
  if (info && info.data.length >= 72) {
    notes.push(`Collateral in the escrow: ${fmtAmount(info.data.readBigUInt64LE(64), decimals)} (max that can arrive on Solana)`);
  }
  return { rows: [], notes };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const PORTAL_TITLES = /Portal|Token Bridge/;

// Which findings have a limit worth reading (Solana: CCIP pools so far).
export function limitKind(protocol, f, chainId) {
  if (f.confidence === "low") return null;
  if (chainId === SOLANA) {
    if (protocol === "Chainlink CCIP" && f.address && /pool/i.test(f.title)) return "ccip";
    if (protocol === "LayerZero" && /OFT/.test(f.title)) return "lz";
    if (protocol === "Wormhole" && PORTAL_TITLES.test(f.title)) return "portal";
    if (protocol === "Hyperlane" && f.address) return "hyperlane";
    return null; // Solana NTT managers: not readable yet
  }
  if (protocol === "LayerZero" && f.address && /OFT/.test(f.title)) return "lz";
  if (protocol === "Chainlink CCIP" && f.address && /pool/i.test(f.title)) return "ccip";
  if (protocol === "Wormhole" && (/NTT/.test(f.title))) return "ntt";
  if (protocol === "Wormhole" && PORTAL_TITLES.test(f.title)) return "portal";
  if (protocol === "Hyperlane" && f.address) return "hyperlane";
  return null;
}

export async function readLimits({ kind, finding, token, chainId, rpcUrl, decimals }) {
  if (chainId === SOLANA) {
    const args = { address: finding.address, token, chainId, decimals, finding };
    switch (kind) {
      case "ccip": return ccipLimits(args);
      case "lz": return lzSolanaLimits(args);
      case "portal": return portalLimits({ ...args, attestedOn: finding.destinations || [] });
      case "hyperlane": return hyperlaneSolanaLimits(args);
      default: return { rows: [], notes: [] };
    }
  }
  const provider = await withTimeout(providerFor(chainId, rpcUrl), 15000, "rpc");
  if (!provider) throw new Error("No RPC reachable");
  const args = { address: finding.address, token, chainId, provider, decimals, rpcUrl, finding };
  switch (kind) {
    case "lz": return lzLimits(args);
    case "ccip": return ccipLimits(args);
    case "ntt": return nttLimits({ ...args, address: /Manager/.test(finding.title) ? finding.address : null });
    case "portal": return portalLimits({ ...args, attestedOn: finding.destinations || [] });
    case "hyperlane": return hyperlaneLimits(args);
    default: return { rows: [], notes: [] };
  }
}

