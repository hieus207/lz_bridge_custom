import { useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import chainRpcsData from "../chainRpcs.json";
import Alert from "../components/Alert";

const CHAIN_RPCS = chainRpcsData;

const SUPPORTED_CHAINS = {
  1:     { name: "Ethereum",  hex: "0x1",    icon: "E" },
  56:    { name: "BNB",       hex: "0x38",   icon: "B" },
  137:   { name: "Polygon",   hex: "0x89",   icon: "P" },
  43114: { name: "Avalanche", hex: "0xa86a", icon: "A" },
  42161: { name: "Arbitrum",  hex: "0xa4b1", icon: "A" },
  10:    { name: "Optimism",  hex: "0xa",    icon: "O" },
  8453:  { name: "Base",      hex: "0x2105", icon: "B" },
};

// Map EVM chain ID → LayerZero chainKey used in transfer API
const LZ_CHAIN_KEY = {
  1:     "ethereum",
  56:    "bsc",
  137:   "polygon",
  43114: "avalanche",
  42161: "arbitrum",
  10:    "optimism",
  8453:  "base",
};

// Session-level cache for LZ token list
let lzTokenCache = null;

async function fetchLzTokens() {
  if (lzTokenCache) return lzTokenCache;
  const resp = await fetch("https://transfer.layerzero-api.com/v1/tokens");
  if (!resp.ok) throw new Error(`LZ API error: ${resp.status}`);
  const json = await resp.json();
  lzTokenCache = json.tokens || [];
  return lzTokenCache;
}

function checkLayerZero(tokens, address, chainId) {
  const chainKey = LZ_CHAIN_KEY[chainId];
  const addrLower = address.toLowerCase();
  const matches = tokens.filter(t =>
    t.address?.toLowerCase() === addrLower &&
    (!chainKey || t.chainKey === chainKey)
  );
  return matches;
}

// Session-level cache for CCIP token list
let ccipTokenCache = null;

async function fetchCcipTokens() {
  if (ccipTokenCache) return ccipTokenCache;
  const resp = await fetch("https://docs.chain.link/api/ccip/v1/tokens?environment=mainnet");
  if (!resp.ok) throw new Error(`CCIP API error: ${resp.status}`);
  const json = await resp.json();
  ccipTokenCache = json.data || {};
  return ccipTokenCache;
}

function checkCcip(data, address, chainId) {
  const addrLower = address.toLowerCase();
  const matches = [];
  for (const symbol of Object.keys(data)) {
    const chainEntry = data[symbol][String(chainId)];
    if (chainEntry && chainEntry.tokenAddress?.toLowerCase() === addrLower) {
      matches.push(chainEntry);
    }
  }
  return matches;
}

// Session-level cache for Wormhole sources
let wormholePortalCache = null;  // raw JS text from Portal Bridge chunk
let wormholeScanCache = null;    // JSON from WormholeScan API

// Session-level cache for Hyperlane warp route registry
let hyperlaneRegistryCache = null;

const PROXY = process.env.REACT_APP_OKLINK_PROXY ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : "");

function proxied(url) {
  return `${PROXY}/api/fetch-proxy?url=${encodeURIComponent(url)}`;
}

async function fetchWormholeSources() {
  const [portal, scan] = await Promise.allSettled([
    wormholePortalCache
      ? Promise.resolve(wormholePortalCache)
      : fetch(proxied("https://portalbridge.com/_next/static/chunks/51c19307a7942953.js"))
          .then(r => { if (!r.ok) throw new Error(`Portal Bridge ${r.status}`); return r.text(); })
          .then(t => { wormholePortalCache = t; return t; }),
    wormholeScanCache
      ? Promise.resolve(wormholeScanCache)
      : fetch("https://api.wormholescan.io/api/v1/wormhole/assets/secured-tokens")
          .then(r => { if (!r.ok) throw new Error(`WormholeScan ${r.status}`); return r.json(); })
          .then(j => { wormholeScanCache = j; return j; }),
  ]);
  return { portal, scan };
}

function checkWormhole(portalText, scanData, address) {
  const addrLower = address.toLowerCase();
  const inPortal = portalText?.status === "fulfilled" &&
    typeof portalText.value === "string" &&
    portalText.value.toLowerCase().includes(addrLower);

  let inScan = false;
  if (scanData?.status === "fulfilled") {
    const raw = scanData.value;
    // handle array or object with tokens/data field
    const list = Array.isArray(raw) ? raw
      : Array.isArray(raw?.tokens) ? raw.tokens
      : Array.isArray(raw?.data) ? raw.data
      : [];
    inScan = list.some(t => {
      const addr = t.tokenAddress || t.address || t.nativeAddress || "";
      return addr.toLowerCase() === addrLower;
    });
    // fallback: raw text search if structure unknown
    if (!inScan) {
      inScan = JSON.stringify(raw).toLowerCase().includes(addrLower);
    }
  }

  const sources = [];
  if (inPortal) sources.push("Portal Bridge token list");
  if (inScan) sources.push("WormholeScan secured-tokens");
  return sources;
}

async function fetchHyperlaneRegistry() {
  if (hyperlaneRegistryCache) return hyperlaneRegistryCache;
  const resp = await fetch(
    "https://raw.githubusercontent.com/hyperlane-xyz/hyperlane-registry/main/deployments/warp_routes/warpRouteConfigs.yaml"
  );
  if (!resp.ok) throw new Error(`Hyperlane registry ${resp.status}`);
  const text = await resp.text();
  hyperlaneRegistryCache = text;
  return text;
}

function checkHyperlaneInRegistry(yamlText, address, chainId) {
  const chainName = LZ_CHAIN_KEY[chainId] || null;
  const addrLower = address.toLowerCase();
  const lines = yamlText.split('\n');
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/addressOrDenom/i.test(lines[i])) continue;
    const val = lines[i].replace(/.*addressOrDenom\s*:\s*/i, '').replace(/["']/g, '').trim();
    if (val.toLowerCase() !== addrLower) continue;

    // Walk backward to find block start ( "    - ") and route name
    let blockStart = i;
    let routeName = null;
    for (let j = i - 1; j >= 0; j--) {
      if (/^ {4}- /.test(lines[j])) { blockStart = j; break; }
    }
    for (let j = blockStart - 1; j >= 0; j--) {
      if (/^\S/.test(lines[j]) && lines[j].includes(':')) {
        routeName = lines[j].replace(/:$/, '').trim();
        break;
      }
    }

    // Walk forward to end of this token block
    let blockEnd = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^ {4}- /.test(lines[j]) || /^\S/.test(lines[j])) { blockEnd = j - 1; break; }
      blockEnd = j;
    }

    const blockLines = lines.slice(blockStart, blockEnd + 1);
    const getField = (name) => {
      for (const bl of blockLines) {
        const m = bl.match(new RegExp(`^\\s+${name}\\s*:\\s*["']?([^"']+)["']?\\s*$`, 'i'));
        if (m) return m[1].trim();
      }
      return null;
    };

    const tokenChain = getField('chainName');
    if (chainName && tokenChain && tokenChain !== chainName) continue;

    const connections = blockLines
      .filter(bl => /- token:/.test(bl))
      .map(bl => bl.replace(/.*- token:\s*/, '').trim());

    results.push({
      symbol:                    getField('symbol') || '',
      name:                      getField('name') || '',
      standard:                  getField('standard') || '',
      chainName:                 tokenChain || '',
      collateralAddressOrDenom:  getField('collateralAddressOrDenom') || null,
      connections,
      routeName,
    });
  }
  return results;
}

const NEXUS_CHECK_ABI = [
  "function mailbox() view returns (address)",
  "function domains() view returns (uint32[])",
  "function localDomain() view returns (uint32)",
  "function PACKAGE_VERSION() view returns (string)",
];

async function checkNexusOnChain(address, chainId, customRpc) {
  const rpcs = customRpc ? [customRpc] : (CHAIN_RPCS[String(chainId)] || []);
  if (!rpcs.length) return null;
  const p = new ethers.JsonRpcProvider(rpcs[0]);
  const c = new ethers.Contract(address, NEXUS_CHECK_ABI, p);
  const [mailbox, domains, localDomain, version] = await Promise.all([
    c.mailbox().catch(() => null),
    c.domains().catch(() => null),
    c.localDomain().catch(() => null),
    c.PACKAGE_VERSION().catch(() => null),
  ]);
  if (!mailbox && !domains && localDomain == null) return null;
  return {
    mailbox,
    domains: domains ? domains.map(d => Number(d)) : null,
    localDomain: localDomain != null ? Number(localDomain) : null,
    version,
  };
}

const ICON_COLORS = {
  1: "bg-blue-500", 56: "bg-yellow-500", 137: "bg-purple-500",
  43114: "bg-red-500", 42161: "bg-sky-500", 10: "bg-red-400", 8453: "bg-blue-600",
};

const PROTOCOLS = [
  { key: "LayerZero",         label: "LayerZero",         link: "/bridge",                    internal: true  },
  { key: "Chainlink CCIP",    label: "Chainlink CCIP",    link: "https://app.transporter.io/", internal: false },
  { key: "Wormhole",          label: "Wormhole",          link: "https://portalbridge.com/",   internal: false },
  { key: "Nexus (Hyperlane)", label: "Nexus (Hyperlane)", link: "/nexus",                     internal: true  },
];

const RPC_TAB_LABELS = ["Def", "Fb1", "Fb2", "Fb3", "Cus"];
const CUSTOM_RPC_TAB = 4;

export default function BridgeScan() {
  const [tokenAddress, setTokenAddress] = useState("");
  const [chainId, setChainId] = useState(1);
  const [customChainInput, setCustomChainInput] = useState("");
  const [customRpcInput, setCustomRpcInput] = useState("");
  const [customChain, setCustomChain] = useState(null);
  const [isCustom, setIsCustom] = useState(false);
  const [protocolStatus, setProtocolStatus] = useState(null);
  const [alert, setAlert] = useState(null);
  const [rpcTab, setRpcTab] = useState(0);
  const [rpcShowDetail, setRpcShowDetail] = useState(false);
  const [customRpcScan, setCustomRpcScan] = useState("");
  const [rpcTabInput, setRpcTabInput] = useState("");
  const [rpcStatus, setRpcStatus] = useState("unchecked"); // "unchecked"|"working"|"error"

  const activeChainId = isCustom ? (customChain?.id || null) : chainId;
  const activeChainName = isCustom
    ? (customChain?.name || "Custom")
    : (SUPPORTED_CHAINS[chainId]?.name || "");
  const scanning = !!protocolStatus && Object.values(protocolStatus).some(s => !s.done);

  const getActiveRpc = () => {
    if (isCustom) return customChain?.rpc || null;
    if (rpcTab === CUSTOM_RPC_TAB) return customRpcScan || null;
    return CHAIN_RPCS[String(chainId)]?.[rpcTab] || null;
  };

  const applyRpcTab = async (idx) => {
    const rpcUrl = idx === CUSTOM_RPC_TAB ? customRpcScan : CHAIN_RPCS[String(chainId)]?.[idx];
    if (!rpcUrl) { setRpcStatus("unchecked"); return; }
    try {
      const p = new ethers.JsonRpcProvider(rpcUrl);
      await p.getNetwork();
      setRpcStatus("working");
      setAlert({ type: "success", message: `RPC ${RPC_TAB_LABELS[idx]} connected!` });
    } catch (err) {
      setRpcStatus("error");
      setAlert({ type: "error", message: `RPC ${RPC_TAB_LABELS[idx]} failed: ${err?.message?.substring(0, 80) || "Unknown"}` });
    }
  };

  const handleScan = async () => {
    if (!ethers.isAddress(tokenAddress.trim())) {
      setAlert({ type: "error", message: "Invalid token address" });
      return;
    }
    if (!activeChainId) {
      setAlert({ type: "error", message: "Please configure a custom chain first" });
      return;
    }

    setAlert(null);
    const init = {};
    PROTOCOLS.forEach(p => { init[p.key] = { done: false, found: false, data: [], error: null }; });
    setProtocolStatus(init);

    const addr = tokenAddress.trim();
    const update = (key, patch) =>
      setProtocolStatus(prev => ({ ...prev, [key]: { done: true, found: false, data: [], error: null, ...patch } }));

    Promise.all([
      // ── LayerZero ──
      fetchLzTokens()
        .then(tokens => {
          const matches = checkLayerZero(tokens, addr, activeChainId);
          update("LayerZero", { found: matches.length > 0, data: matches });
        })
        .catch(err => update("LayerZero", { error: err.message })),

      // ── Chainlink CCIP ──
      fetchCcipTokens()
        .then(data => {
          const matches = checkCcip(data, addr, activeChainId);
          update("Chainlink CCIP", { found: matches.length > 0, data: matches });
        })
        .catch(err => update("Chainlink CCIP", { error: err.message })),

      // ── Wormhole ──
      fetchWormholeSources()
        .then(({ portal, scan }) => {
          const sources = checkWormhole(portal, scan, addr);
          const portalErr = portal.status === "rejected" ? portal.reason?.message : null;
          const scanErr   = scan.status   === "rejected" ? scan.reason?.message   : null;
          update("Wormhole", {
            found: sources.length > 0,
            data: sources.length > 0 ? [{ sources }] : [],
            error: [portalErr, scanErr].filter(Boolean).join(" | ") || null,
          });
        })
        .catch(err => update("Wormhole", { error: err.message })),

      // ── Nexus (Hyperlane) ── registry first, on-chain fallback
      fetchHyperlaneRegistry()
        .then(yamlText => {
          const regMatches = checkHyperlaneInRegistry(yamlText, addr, activeChainId);
          if (regMatches.length > 0) {
            update("Nexus (Hyperlane)", { found: true, data: regMatches });
            return;
          }
          return checkNexusOnChain(addr, activeChainId, getActiveRpc())
            .then(result => update("Nexus (Hyperlane)", { found: !!result, data: result ? [result] : [] }));
        })
        .catch(err => update("Nexus (Hyperlane)", { error: err.message })),
    ]);
  };

  const handleConnectCustomChain = async () => {
    const id = parseInt(customChainInput, 10);
    const rpc = customRpcInput.trim();
    if (!id || !rpc) {
      setAlert({ type: "error", message: "Enter chain ID and RPC URL" });
      return;
    }
    try {
      const p = new ethers.JsonRpcProvider(rpc);
      await p.getNetwork();
      const cc = { id, rpc, name: `Chain ${id}` };
      setCustomChain(cc);
      setAlert({ type: "success", message: `Custom chain ${id} connected!` });
    } catch (err) {
      setAlert({ type: "error", message: "RPC failed: " + (err?.message?.substring(0, 60) || "") });
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f0e6] font-sans px-4 py-8 flex items-start justify-center">
      <div className="w-full max-w-4xl flex flex-col gap-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Bridge Scan</h1>
          <span className="text-sm text-gray-400">Detect which bridge protocol a token uses</span>
        </div>

        {alert && (
          <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />
        )}

        <div className="flex gap-4 items-start">
          {/* ── Left panel ── */}
          <div className="w-72 flex-shrink-0 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Setup Scan</p>

            {/* Chain selector */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Source chain</label>
              <div className="border border-gray-200 rounded-xl px-3 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold ${isCustom ? "bg-gray-500" : (ICON_COLORS[chainId] || "bg-gray-400")}`}>
                    {activeChainName.charAt(0)}
                  </span>
                  <span className="font-semibold text-sm text-gray-900">{activeChainName}</span>
                  {activeChainId && (
                    <span className="text-xs text-gray-400">ID: {activeChainId}</span>
                  )}
                </div>
                <select
                  value={isCustom ? "custom" : chainId}
                  onChange={e => {
                    if (e.target.value === "custom") {
                      setIsCustom(true);
                    } else {
                      setIsCustom(false);
                      setChainId(parseInt(e.target.value, 10));
                    }
                  }}
                  className="bg-transparent text-gray-400 text-sm outline-none cursor-pointer"
                >
                  {Object.entries(SUPPORTED_CHAINS).map(([id, chain]) => (
                    <option key={id} value={id}>{chain.name}</option>
                  ))}
                  <option value="custom">+ Custom</option>
                </select>
              </div>

              {/* Custom chain inputs */}
              {isCustom && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    <input
                      type="number"
                      placeholder="Chain ID"
                      value={customChainInput}
                      onChange={e => setCustomChainInput(e.target.value)}
                      className="w-24 border border-gray-200 px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-gray-300"
                    />
                    <input
                      type="text"
                      placeholder="RPC URL"
                      value={customRpcInput}
                      onChange={e => setCustomRpcInput(e.target.value)}
                      className="flex-1 border border-gray-200 px-2 py-1.5 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-gray-300 min-w-0"
                    />
                  </div>
                  <button
                    onClick={handleConnectCustomChain}
                    className="w-full py-1.5 bg-gray-800 text-white rounded-lg text-xs hover:bg-gray-700 transition"
                  >
                    Connect Chain
                  </button>
                  {customChain && (
                    <p className="text-xs text-green-600 text-center">✓ Connected: Chain {customChain.id}</p>
                  )}
                </div>
              )}
            </div>

            {/* Token address */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Token contract address</label>
              <input
                type="text"
                placeholder="0x..."
                value={tokenAddress}
                onChange={e => setTokenAddress(e.target.value)}
                className="w-full border border-gray-200 px-3 py-2 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>

            {/* Scan button */}
            <button
              onClick={handleScan}
              disabled={scanning || !ethers.isAddress(tokenAddress.trim())}
              className={`w-full py-2.5 font-semibold rounded-xl transition text-sm ${
                scanning
                  ? "bg-gray-200 text-gray-500 cursor-wait"
                  : !ethers.isAddress(tokenAddress.trim())
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-gray-900 text-white hover:bg-gray-800"
              }`}
            >
              {scanning ? "Scanning..." : "Scan"}
            </button>

            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              Detects bridge protocol (LayerZero OFT, Wormhole, etc.) used by the token.
            </p>

            {/* RPC selector */}
            {!isCustom && CHAIN_RPCS[String(chainId)] && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">RPC</p>
                <div className="flex items-center gap-1">
                  {RPC_TAB_LABELS.map((label, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setRpcTab(idx);
                        if (idx === CUSTOM_RPC_TAB) {
                          setRpcShowDetail(true);
                          setRpcTabInput(customRpcScan);
                        } else {
                          setRpcShowDetail(false);
                          applyRpcTab(idx);
                        }
                      }}
                      className={`px-2 py-1 rounded-lg text-xs font-medium transition ${
                        rpcTab === idx
                          ? "bg-gray-900 text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setRpcShowDetail(v => !v)}
                    className="ml-auto text-gray-400 hover:text-gray-600 transition"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-3.5 h-3.5 transition-transform ${rpcShowDetail ? "rotate-180" : ""}`}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    rpcStatus === "working" ? "bg-green-500"
                    : rpcStatus === "error" ? "bg-red-500"
                    : "bg-gray-300"
                  }`} title={rpcStatus} />
                </div>
                {rpcShowDetail && (
                  <div className="bg-gray-50 rounded-lg p-2 text-xs">
                    {rpcTab === CUSTOM_RPC_TAB ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="https://your-rpc-url..."
                          value={rpcTabInput}
                          onChange={e => setRpcTabInput(e.target.value)}
                          className="flex-1 border border-gray-200 px-2 py-1.5 rounded-md text-xs font-mono focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white min-w-0"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            const url = rpcTabInput.trim();
                            if (!url) return;
                            setCustomRpcScan(url);
                            setRpcShowDetail(false);
                            try {
                              const p = new ethers.JsonRpcProvider(url);
                              await p.getNetwork();
                              setRpcStatus("working");
                              setAlert({ type: "success", message: "Custom RPC connected!" });
                            } catch (err) {
                              setRpcStatus("error");
                              setAlert({ type: "error", message: "Custom RPC failed: " + (err?.message?.substring(0, 60) || "") });
                            }
                          }}
                          className="px-2.5 py-1.5 bg-gray-900 text-white rounded-md text-xs hover:bg-gray-800 transition flex-shrink-0"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="font-mono text-gray-600 break-all">
                        {CHAIN_RPCS[String(chainId)]?.[rpcTab] || "—"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right panel ── */}
          <div className="flex-1 min-h-[400px] bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col">
            {!protocolStatus ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-gray-300">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0016.803 15.803z" />
                </svg>
                <p className="text-gray-400 font-medium">Select chain & token, then scan</p>
                <p className="text-xs text-gray-300 text-center max-w-xs">
                  Enter a token contract address and select the source chain to detect which bridge protocol it uses.
                </p>
              </div>
            ) : (
              <div className="w-full flex flex-col gap-3">
                <p className="text-sm font-semibold text-gray-700">Scan Results</p>
                {PROTOCOLS.map(proto => {
                  const r = protocolStatus[proto.key];
                  return (
                    <div
                      key={proto.key}
                      className={`rounded-xl border p-4 flex flex-col gap-2 ${
                        !r.done
                          ? "bg-gray-50 border-gray-200"
                          : r.found
                          ? "bg-green-50 border-green-200"
                          : r.error
                          ? "bg-red-50 border-red-200"
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {!r.done && (
                            <svg className="animate-spin w-3.5 h-3.5 text-gray-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          )}
                          <span className="font-semibold text-sm text-gray-800">{proto.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {!r.done && (
                            <span className="text-xs text-gray-400">Checking...</span>
                          )}
                          {r.done && r.found && (
                            proto.internal
                              ? <Link to={proto.link} className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full font-medium hover:bg-green-700 transition">✓ Detected →</Link>
                              : <a href={proto.link} target="_blank" rel="noopener noreferrer" className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full font-medium hover:bg-green-700 transition">✓ Detected →</a>
                          )}
                          {r.done && !r.found && r.error && (
                            <span className="text-xs bg-red-400 text-white px-2 py-0.5 rounded-full font-medium">Error</span>
                          )}
                          {r.done && !r.found && !r.error && (
                            <span className="text-xs bg-gray-300 text-gray-600 px-2 py-0.5 rounded-full font-medium">Not found</span>
                          )}
                        </div>
                      </div>
                      {r.done && r.found && r.data?.map((t, j) => (
                        <div key={j} className="text-xs text-gray-600 bg-white rounded-lg px-3 py-2 border border-green-100 flex flex-wrap gap-x-4 gap-y-1">
                          {t.symbol && <span><span className="text-gray-400">Symbol:</span> <strong>{t.symbol}</strong></span>}
                          {t.name && <span><span className="text-gray-400">Name:</span> {t.name}</span>}
                          {/* LayerZero fields */}
                          {t.chainKey && <span><span className="text-gray-400">ChainKey:</span> {t.chainKey}</span>}
                          {t.decimals != null && <span><span className="text-gray-400">Decimals:</span> {t.decimals}</span>}
                          {t.price?.usd != null && (
                            <span><span className="text-gray-400">Price:</span> ${t.price.usd.toLocaleString()}</span>
                          )}
                          {/* CCIP fields */}
                          {t.chainName && <span><span className="text-gray-400">Chain:</span> {t.chainName}</span>}
                          {t.poolType && <span><span className="text-gray-400">Pool:</span> {t.poolType}</span>}
                          {t.poolAddress && (
                            <span className="w-full"><span className="text-gray-400">Pool addr:</span> <span className="font-mono">{t.poolAddress}</span></span>
                          )}
                          {/* Wormhole fields */}
                          {t.sources && (
                            <span className="w-full"><span className="text-gray-400">Found in:</span> {t.sources.join(", ")}</span>
                          )}
                          {!t.sources && t.destinations?.length > 0 && (
                            <span className="w-full"><span className="text-gray-400">Destinations ({t.destinations.length}):</span> {t.destinations.join(", ")}</span>
                          )}
                          {/* Nexus/Hyperlane registry fields */}
                          {t.standard && <span><span className="text-gray-400">Standard:</span> {t.standard}</span>}
                          {t.routeName && <span><span className="text-gray-400">Route:</span> {t.routeName}</span>}
                          {t.connections?.length > 0 && (
                            <span className="w-full">
                              <span className="text-gray-400">Destinations ({t.connections.length}):</span>{' '}
                              {t.connections.map(c => c.split('|')[1] || c).join(', ')}
                            </span>
                          )}
                          {t.collateralAddressOrDenom && (
                            <span className="w-full"><span className="text-gray-400">Collateral:</span> <span className="font-mono">{t.collateralAddressOrDenom}</span></span>
                          )}
                          {/* Nexus/Hyperlane on-chain fields */}
                          {t.mailbox && <span className="w-full"><span className="text-gray-400">Mailbox:</span> <span className="font-mono">{t.mailbox}</span></span>}
                          {t.localDomain != null && <span><span className="text-gray-400">Local domain:</span> {t.localDomain}</span>}
                          {t.domains?.length > 0 && <span className="w-full"><span className="text-gray-400">Remote domains ({t.domains.length}):</span> {t.domains.join(", ")}</span>}
                          {t.version && <span><span className="text-gray-400">Version:</span> {t.version}</span>}
                        </div>
                      ))}
                      {r.done && r.error && (
                        <p className="text-xs text-red-500">{r.error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
