// Bridge protocol detection for an EVM token.
//
// Every protocol is checked by (a) its official, structured registry and
// (b) on-chain evidence. Registries go stale or change shape; on-chain
// evidence doesn't — so one failing source degrades the result instead of
// breaking it, and the UI shows which source produced each finding.
import { ethers } from "ethers";
import {
  CHAINS, CHAIN_LIST, getRpcs, chainName, chainIdFromLzKey, chainIdFromWormholeId, anyChainName,
} from "./chains";
import { cached, fetchJson, fetchWithTimeout } from "./http";
import { makeProvider, multicall, probeContracts, classify, ERC20 } from "./onchain";
import { discoverHolders } from "./holders";
import { nativeBridgeChecks } from "./nativeBridges";

export const PROTOCOL_KEYS = ["LayerZero", "Chainlink CCIP", "Wormhole", "Hyperlane", "Native bridge"];

const lc = (s) => (typeof s === "string" ? s.toLowerCase() : "");
const CG_TO_NAME = Object.fromEntries(CHAIN_LIST.map((c) => [c.cgPlatform, c.name]));
const LZ_KEY_NAME = (k) => (chainIdFromLzKey(k) ? chainName(chainIdFromLzKey(k)) : k);

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), ms))]);

// ─── Registries ──────────────────────────────────────────────────────────────

export const loadLzMetadata = () => cached("lz-meta", async () => {
  const json = await fetchJson("https://metadata.layerzero-api.com/v1/metadata/experiment/ofts/list", { timeout: 20000 });
  const index = new Map();
  const add = (a, entry) => {
    if (!a) return;
    const k = lc(a);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(entry);
  };
  for (const [symbol, list] of Object.entries(json)) {
    for (const oft of list) {
      for (const [chainKey, d] of Object.entries(oft.deployments || {})) {
        const entry = { symbol, chainKey, deployment: d, deployments: oft.deployments, endpointVersion: oft.endpointVersion };
        add(d.address, entry);
        add(d.innerTokenAddress, entry);
      }
    }
  }
  return index;
});

export const loadLzTransfer = () => cached("lz-transfer", async () => {
  const json = await fetchJson("https://transfer.layerzero-api.com/v1/tokens", { timeout: 20000 });
  return json.tokens || [];
});

// chain_id narrows the directory server-side to tokens live on that chain (~10× smaller).
export const loadCcip = (chainId) => cached(`ccip:${chainId ?? "all"}`, async () => {
  const q = chainId ? `&chain_id=${chainId}` : "";
  const json = await fetchJson(`https://docs.chain.link/api/ccip/v1/tokens?environment=mainnet${q}`, { timeout: 20000 });
  return json.data || {};
});

export const loadWormholeScan = () => cached("wh-secured", () =>
  fetchJson("https://api.wormholescan.io/api/v1/wormhole/assets/secured-tokens", { timeout: 20000 })
);

export const loadHyperlane = () => cached("hyperlane", async () => {
  const resp = await fetchWithTimeout(
    "https://raw.githubusercontent.com/hyperlane-xyz/hyperlane-registry/main/deployments/warp_routes/warpRouteConfigs.yaml",
    { timeout: 20000 }
  );
  if (!resp.ok) throw new Error(`Hyperlane registry HTTP ${resp.status}`);
  return parseWarpRoutes(await resp.text());
});

// warpRouteConfigs.yaml is auto-generated with a fixed layout:
//   <routeId>:
//     tokens:
//       - addressOrDenom: "0x…"
//         chainName: bsc
//         connections:
//           - token: ethereum|eni|0x…
export function parseWarpRoutes(yaml) {
  const tokens = [];
  let route = null;
  let cur = null;
  const unq = (v) => v.trim().replace(/^["']|["']$/g, "");
  for (const line of yaml.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    let m;
    if ((m = line.match(/^(\S.*):\s*$/))) { route = m[1]; cur = null; continue; }
    if ((m = line.match(/^ {4}- (\w+):\s*(.*)$/))) {
      cur = { route, connections: [], [m[1]]: unq(m[2]) };
      tokens.push(cur);
      continue;
    }
    if (!cur) continue;
    if ((m = line.match(/^ {8}- token:\s*(.*)$/))) { cur.connections.push(unq(m[1])); continue; }
    if ((m = line.match(/^ {6}(\w+):\s*(.+)$/))) cur[m[1]] = unq(m[2]);
  }
  return tokens;
}

// ─── Per-protocol registry checks ────────────────────────────────────────────

async function lzRegistry(token, chain) {
  const [meta, transfer] = await Promise.allSettled([loadLzMetadata(), loadLzTransfer()]);
  const findings = [];
  const errors = [];

  if (meta.status === "fulfilled") {
    for (const e of meta.value.get(lc(token)) || []) {
      if (chain && e.chainKey !== chain.lzKey) continue;
      const d = e.deployment;
      const isAdapter = lc(d.innerTokenAddress) === lc(token);
      const srcId = chainIdFromLzKey(e.chainKey);
      findings.push({
        protocol: "LayerZero",
        title: isAdapter ? "OFT Adapter" : d.type === "OFT" ? "Token is an OFT itself" : d.type,
        address: d.address,
        confidence: "high",
        source: "LayerZero metadata API",
        details: [
          ["Symbol", e.symbol],
          ["Type", d.type],
          ...(d.approvalRequired != null ? [["Approval required", d.approvalRequired ? "yes" : "no"]] : []),
          ...(!chain ? [["Chain", LZ_KEY_NAME(e.chainKey)]] : []),
        ],
        destinations: Object.keys(e.deployments).filter((k) => k !== e.chainKey).map(LZ_KEY_NAME),
        bridgeLink: srcId ? `/bridge?oftadr=${d.address}&chainId=${srcId}&auto=true` : null,
      });
    }
  } else errors.push(`LZ metadata: ${meta.reason.message}`);

  if (transfer.status === "fulfilled") {
    const hit = transfer.value.find((t) => lc(t.address) === lc(token) && (!chain || t.chainKey === chain.lzKey));
    if (hit && !findings.length) {
      findings.push({
        protocol: "LayerZero",
        title: "Listed in LayerZero Transfer API",
        confidence: "medium",
        source: "LayerZero Transfer API",
        details: [["Symbol", hit.symbol], ["Chain", LZ_KEY_NAME(hit.chainKey)]],
      });
    }
  } else errors.push(`LZ Transfer API: ${transfer.reason.message}`);

  if (meta.status === "rejected" && transfer.status === "rejected") throw new Error(errors.join(" | "));
  return { findings, errors };
}

async function ccipRegistry(token, chainId) {
  const data = await loadCcip(chainId);
  const findings = [];
  for (const [symbol, perChain] of Object.entries(data)) {
    for (const [cid, e] of Object.entries(perChain)) {
      if (lc(e.tokenAddress) !== lc(token)) continue;
      if (CHAINS[chainId] && cid !== String(chainId)) continue;
      // Schema drifted from flat poolAddress/poolType to a nested `pool` object; accept both.
      const poolAddress = e.pool?.address || e.poolAddress || null;
      const poolType = e.pool?.rawType || e.pool?.type || e.poolType;
      findings.push({
        protocol: "Chainlink CCIP",
        title: `Token pool (${[poolType, e.pool?.version].filter(Boolean).join(" ") || "unknown type"})`,
        address: poolAddress,
        confidence: "high",
        source: "Chainlink CCIP directory",
        details: [["Symbol", symbol], ...(e.chainName ? [["Chain", e.chainName]] : [])],
        destinations: (e.destinations || []).map(anyChainName),
      });
    }
  }
  return { findings };
}

async function wormholeRegistry(token, chain) {
  const list = await loadWormholeScan();
  const findings = [];
  for (const t of Array.isArray(list) ? list : []) {
    const platforms = t.platforms || {};
    const match = Object.entries(platforms).find(([cg, a]) =>
      lc(a) === lc(token) && (!chain || cg === chain.cgPlatform)
    );
    if (!match) continue;
    findings.push({
      protocol: "Wormhole",
      title: t.type === "NATIVE_TOKEN_TRANSFER" ? "Native Token Transfers (NTT)" : "Portal Token Bridge asset",
      confidence: "high",
      source: "WormholeScan",
      details: [["Symbol", (t.symbol || "").toUpperCase()], ["Type", t.type]],
      destinations: Object.keys(platforms).filter((cg) => cg !== match[0]).map((cg) => CG_TO_NAME[cg] || cg),
    });
  }
  return { findings };
}

const TB_IFACE = new ethers.Interface([
  "function isWrappedAsset(address) view returns (bool)",
  "function wrappedAsset(uint16 tokenChainId, bytes32 tokenAddress) view returns (address)",
]);
const WRAPPED_IFACE = new ethers.Interface([
  "function chainId() view returns (uint16)",
  "function nativeContract() view returns (bytes32)",
]);

// Where a token from Wormhole chain `originWh` (32-byte address) has a Portal-wrapped
// version, asked directly to each EVM Token Bridge.
export async function wormholeAttestations(originWh, token32, excludeChainId) {
  const others = CHAIN_LIST.filter((c) => c.id !== excludeChainId && c.wormhole);
  const checks = await Promise.all(others.map(async (c) => {
    for (const rpc of getRpcs(c.id).slice(0, 2)) {
      try {
        const p = makeProvider(rpc, c.id);
        const [wrapped] = await withTimeout(
          multicall(p, [{ target: c.wormhole.tokenBridge, iface: TB_IFACE, fn: "wrappedAsset", args: [originWh, token32] }]),
          8000, c.name
        );
        return wrapped && wrapped !== ethers.ZeroAddress ? { chain: c, wrapped } : null;
      } catch { /* next rpc */ }
    }
    return null;
  }));
  return checks.filter(Boolean);
}

// Authoritative Portal check straight from the Token Bridge contracts.
async function wormholeOnchain(token, chain, provider) {
  const findings = [];
  const tb = chain.wormhole.tokenBridge;

  const [isWrapped] = await multicall(provider, [{ target: tb, iface: TB_IFACE, fn: "isWrappedAsset", args: [token] }]);
  if (isWrapped) {
    const [originWh, nativeRaw] = await multicall(provider, [
      { target: token, iface: WRAPPED_IFACE, fn: "chainId" },
      { target: token, iface: WRAPPED_IFACE, fn: "nativeContract" },
    ]);
    const originId = chainIdFromWormholeId(Number(originWh));
    findings.push({
      protocol: "Wormhole",
      title: "Wormhole-wrapped token (Portal)",
      address: token,
      confidence: "high",
      source: "on-chain Token Bridge",
      details: [
        ["Origin chain", originId ? chainName(originId) : `Wormhole chain ${originWh}`],
        ...(nativeRaw ? [["Origin token", "0x" + nativeRaw.slice(26)]] : []),
      ],
    });
    return { findings };
  }

  // Native token: has it been attested (wrapped) on other chains?
  const attested = await wormholeAttestations(chain.wormhole.chainId, ethers.zeroPadValue(token, 32), chain.id);
  if (attested.length) {
    findings.push({
      protocol: "Wormhole",
      title: "Native token attested on Portal Token Bridge",
      address: tb,
      confidence: "high",
      source: "on-chain Token Bridge",
      details: attested.map((a) => [`Wrapped on ${a.chain.name}`, a.wrapped]),
      destinations: attested.map((a) => a.chain.name),
    });
  }
  return { findings };
}

async function hyperlaneRegistry(token, chain) {
  const routes = await loadHyperlane();
  const findings = [];
  for (const t of routes) {
    const isRouter = lc(t.addressOrDenom) === lc(token);
    const isCollateral = lc(t.collateralAddressOrDenom) === lc(token);
    if (!isRouter && !isCollateral) continue;
    if (chain && t.chainName !== chain.hyperlane) continue;
    const srcId = Object.values(CHAINS).find((c) => c.hyperlane === t.chainName)?.id;
    findings.push({
      protocol: "Hyperlane",
      title: `Warp route · ${t.standard || "router"}`,
      address: t.addressOrDenom,
      confidence: "high",
      source: "Hyperlane registry",
      details: [
        ["Route", t.route],
        ...(t.symbol ? [["Symbol", t.symbol]] : []),
        ...(t.collateralAddressOrDenom ? [["Collateral token", t.collateralAddressOrDenom]] : []),
        ...(!chain ? [["Chain", t.chainName]] : []),
      ],
      destinations: t.connections.map((c) => c.split("|")[1] || c),
      bridgeLink: srcId ? `/bridge?proto=hyperlane&nexusadr=${t.addressOrDenom}&chainId=${srcId}` : null,
    });
  }
  return { findings };
}

// ─── On-chain holder analysis ────────────────────────────────────────────────

async function onchainAnalysis({ token, chainId, chain, provider, rpcUrl, proxyBase, setMeta }) {
  const tokenBridge = chain?.wormhole?.tokenBridge;
  const findings = [];

  const self = await probeContracts(provider, [token]);
  findings.push(...classify(token, self.get(lc(token)), token, { chainId, tokenBridge }));

  const { holders, source, attempts } = await discoverHolders({
    provider, chainId, token, proxyBase,
    fallbackRpcs: getRpcs(chainId).filter((u) => u !== rpcUrl),
    onProgress: (msg) => setMeta({ progress: msg }),
  });
  setMeta({ holderSource: source, holderAttempts: attempts, holderCount: holders.length });

  const candidates = holders.filter((h) => lc(h.address) !== lc(token) && h.isContract !== false);
  if (candidates.length) {
    setMeta({ progress: `Fingerprinting ${candidates.length} addresses…` });
    const probes = await probeContracts(provider, candidates.map((h) => h.address));
    for (const h of candidates) {
      const r = probes.get(lc(h.address));
      findings.push(...classify(h.address, r, token, { chainId, tokenBridge, holder: h }));
    }
  }
  return { findings: findings.map((f) => ({ ...f, source: f.source || `on-chain (${source ? `holders via ${source}` : "self-check"})` })) };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

// Preferred RPC first, then the chain's list; first one that answers wins.
// Public RPCs die regularly — a dead one must not silently zero out the scan.
export async function pickWorkingRpc(chainId, preferred) {
  const urls = [...new Set([preferred, ...getRpcs(chainId)].filter(Boolean))];
  for (const url of urls) {
    const provider = makeProvider(url, chainId);
    try {
      await withTimeout(provider.getBlockNumber(), 6000, hostOf(url));
      return { provider, url };
    } catch { /* try next */ }
  }
  return null;
}

const CONF_RANK = { low: 0, medium: 1, high: 2 };

export function mergeFinding(list, f) {
  const key = lc(f.address) || f.title;
  const existing = list.find((x) => (lc(x.address) || x.title) === key);
  if (!existing) {
    list.push({ ...f, sources: [f.source].filter(Boolean), destinations: f.destinations || [] });
    return;
  }
  if (f.source && !existing.sources.includes(f.source)) existing.sources.push(f.source);
  for (const [k, v] of f.details || []) {
    if (!existing.details.some(([ek]) => ek === k)) existing.details.push([k, v]);
  }
  existing.destinations = [...new Set([...existing.destinations, ...(f.destinations || [])])];
  if (CONF_RANK[f.confidence] > CONF_RANK[existing.confidence]) {
    existing.confidence = f.confidence;
    existing.title = f.title;
  }
  existing.bridgeLink = existing.bridgeLink || f.bridgeLink;
}

export function emptyScanState() {
  const protocols = {};
  for (const k of PROTOCOL_KEYS) protocols[k] = { pending: 0, findings: [], errors: [] };
  return { protocols, meta: { progress: "Starting…", token: null } };
}

// Shared progress plumbing for the EVM and Solana scanners.
export function createScan(onState) {
  const state = emptyScanState();

  // Hand React a fresh snapshot each time (state is mutated in place below).
  const snapshot = () => ({
    meta: { ...state.meta },
    protocols: Object.fromEntries(Object.entries(state.protocols).map(([k, v]) => [k, {
      ...v,
      errors: [...v.errors],
      findings: v.findings.map((f) => ({ ...f, details: [...f.details], sources: [...f.sources], destinations: [...f.destinations] })),
    }])),
  });
  const emit = () => onState(snapshot());
  const setMeta = (patch) => { Object.assign(state.meta, patch); emit(); };

  const run = async (protocols, fn) => {
    protocols.forEach((p) => { state.protocols[p].pending++; });
    try {
      const { findings = [], errors = [] } = await fn();
      for (const f of findings) mergeFinding(state.protocols[f.protocol].findings, f);
      for (const e of errors) protocols.forEach((p) => state.protocols[p].errors.push(e));
    } catch (err) {
      const msg = err?.shortMessage || err?.message || String(err);
      protocols.forEach((p) => state.protocols[p].errors.push(msg.slice(0, 160)));
    } finally {
      protocols.forEach((p) => { state.protocols[p].pending--; });
      emit();
    }
  };

  return { state, emit, setMeta, run };
}

export async function scanToken({ token, chainId, rpcUrl, proxyBase, onState }) {
  token = ethers.getAddress(token);
  const chain = CHAINS[chainId] || null;
  const { state, emit, setMeta, run } = createScan(onState);
  emit();

  const tasks = [
    run(["LayerZero"], () => lzRegistry(token, chain)),
    run(["Chainlink CCIP"], () => ccipRegistry(token, chainId)),
    run(["Wormhole"], () => wormholeRegistry(token, chain)),
    run(["Hyperlane"], () => hyperlaneRegistry(token, chain)),
  ];

  setMeta({ progress: "Connecting to RPC…" });
  const picked = await pickWorkingRpc(chainId, rpcUrl);
  const provider = picked?.provider || null;
  setMeta({
    rpc: picked ? hostOf(picked.url) : null,
    rpcNote: rpcUrl && picked && picked.url !== rpcUrl ? `${hostOf(rpcUrl)} unreachable, switched` : null,
  });
  if (picked) rpcUrl = picked.url;

  if (provider) {
    multicall(provider, ["symbol", "name", "decimals"].map((fn) => ({ target: token, iface: ERC20, fn })))
      .then(([symbol, name, decimals]) => setMeta({ token: { symbol, name, decimals: decimals != null ? Number(decimals) : null } }))
      .catch(() => {});
    if (chain?.wormhole) tasks.push(run(["Wormhole"], () => wormholeOnchain(token, chain, provider)));
    tasks.push(run(["Native bridge"], () => nativeBridgeChecks(token, chainId, provider)));
    tasks.push(run(PROTOCOL_KEYS, () => onchainAnalysis({ token, chainId, chain, provider, rpcUrl, proxyBase, setMeta })));
  } else {
    const msg = "No RPC reachable — on-chain checks skipped";
    PROTOCOL_KEYS.forEach((k) => state.protocols[k].errors.push(msg));
    setMeta({ progress: msg });
  }

  await Promise.all(tasks);
  setMeta({ progress: null, done: true });
  return state;
}
