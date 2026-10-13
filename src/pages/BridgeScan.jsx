import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { Copy, Check, ExternalLink, Search, ChevronDown } from "lucide-react";
import Alert from "../components/Alert";
import CustomChainForm from "../components/CustomChainForm";
import useCustomChains from "../hooks/useCustomChains";
import { CHAINS, CHAIN_LIST, getRpcs, explorerAddressUrl, chainName } from "../lib/chains";
import { getCustomChain, removeCustomChain } from "../lib/customChains";
import { scanToken, PROTOCOL_KEYS } from "../lib/bridgeScan";

const PROXY = process.env.REACT_APP_OKLINK_PROXY ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : "");

const ICON_COLORS = {
  1: "bg-blue-500", 56: "bg-yellow-500", 137: "bg-purple-500",
  43114: "bg-red-500", 42161: "bg-sky-500", 10: "bg-red-400", 8453: "bg-blue-600",
};

const PROTOCOL_APPS = {
  "LayerZero": null, // handled by bridgeLink → /bridge
  "Chainlink CCIP": "https://app.transporter.io/",
  "Wormhole": "https://portalbridge.com/",
  "Hyperlane": null, // handled by bridgeLink → /nexus
};

const RPC_TAB_LABELS = ["Def", "Fb1", "Fb2", "Fb3", "Cus"];
const CUSTOM_RPC_TAB = 4;

const SCAN_CHAIN_KEY = "scan_chain";
const knownChain = (id) => !!(CHAINS[id] || getCustomChain(id));
const loadScanChain = () => {
  try {
    const id = parseInt(localStorage.getItem(SCAN_CHAIN_KEY), 10);
    return knownChain(id) ? id : 1;
  } catch {
    return 1;
  }
};

const isAddr = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="text-gray-400 hover:text-gray-700 transition flex-shrink-0"
      title="Copy"
    >
      {done ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function Address({ value, chainId }) {
  const href = explorerAddressUrl(chainId, value);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="font-mono break-all">{value}</span>
      <CopyButton text={value} />
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-700 flex-shrink-0" title="Open in explorer">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </span>
  );
}

const CONFIDENCE_STYLE = {
  high: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-gray-100 text-gray-500",
};

function FindingCard({ f, chainId, protocol }) {
  const app = PROTOCOL_APPS[protocol];
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2.5 flex flex-col gap-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-800 text-sm">{f.title}</span>
          <span className={`px-1.5 py-0.5 rounded font-medium ${CONFIDENCE_STYLE[f.confidence]}`}>{f.confidence}</span>
        </div>
        {f.bridgeLink ? (
          <Link to={f.bridgeLink} className="flex-shrink-0 bg-gray-900 text-white px-2.5 py-1 rounded-lg font-medium hover:bg-gray-700 transition">
            Bridge →
          </Link>
        ) : app && f.confidence !== "low" ? (
          <a href={app} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 border border-gray-300 text-gray-700 px-2.5 py-1 rounded-lg font-medium hover:bg-gray-50 transition">
            Open app ↗
          </a>
        ) : null}
      </div>

      {f.address && (
        <div className="text-gray-700"><Address value={f.address} chainId={chainId} /></div>
      )}

      {f.details?.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {f.details.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-400 whitespace-nowrap">{k}</dt>
              <dd className="text-gray-700 min-w-0">{isAddr(v) ? <Address value={v} chainId={chainId} /> : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {f.destinations?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-gray-400 mr-1">Routes to</span>
          {f.destinations.map((d) => (
            <span key={d} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{d}</span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 text-[10px] text-gray-400">
        {f.sources.map((s) => <span key={s} className="border border-gray-200 rounded px-1.5 py-0.5">{s}</span>)}
      </div>
    </div>
  );
}

function ProtocolCard({ name, r, chainId }) {
  const [showLow, setShowLow] = useState(false);
  const checking = r.pending > 0;
  const strong = r.findings.filter((f) => f.confidence !== "low");
  const weak = r.findings.filter((f) => f.confidence === "low");
  const detected = strong.length > 0;
  const failedOnly = !checking && !detected && r.errors.length > 0;

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2.5 ${
      detected ? "bg-green-50/60 border-green-200" : failedOnly ? "bg-red-50/50 border-red-200" : "bg-gray-50 border-gray-200"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {checking && (
            <svg className="animate-spin w-3.5 h-3.5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          <span className="font-semibold text-sm text-gray-800">{name}</span>
        </div>
        {detected ? (
          <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full font-medium">✓ Detected</span>
        ) : checking ? (
          <span className="text-xs text-gray-400">Checking…</span>
        ) : failedOnly ? (
          <span className="text-xs bg-red-400 text-white px-2 py-0.5 rounded-full font-medium">Check failed</span>
        ) : (
          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">Not found</span>
        )}
      </div>

      {strong.map((f) => <FindingCard key={f.address || f.title} f={f} chainId={chainId} protocol={name} />)}

      {weak.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowLow((v) => !v)} className="text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showLow ? "rotate-180" : ""}`} />
            {weak.length} low-confidence match{weak.length > 1 ? "es" : ""}
          </button>
          {showLow && (
            <div className="mt-2 flex flex-col gap-2">
              {weak.map((f) => <FindingCard key={f.address || f.title} f={f} chainId={chainId} protocol={name} />)}
            </div>
          )}
        </div>
      )}

      {r.errors.length > 0 && (
        <p className={`text-xs ${failedOnly ? "text-red-600" : "text-amber-700"}`}>
          {failedOnly ? "All sources failed: " : "Some sources failed: "}
          {r.errors.join(" · ")}
        </p>
      )}
    </div>
  );
}

export default function BridgeScan() {
  const [tokenAddress, setTokenAddress] = useState("");
  const [chainId, setChainIdRaw] = useState(loadScanChain);
  const customChains = useCustomChains();
  const [showAddChain, setShowAddChain] = useState(false);
  const [scan, setScan] = useState(null); // { protocols, meta } from scanToken
  const [scanCtx, setScanCtx] = useState(null); // chain/token the current result belongs to
  const [alert, setAlert] = useState(null);
  const [rpcTab, setRpcTab] = useState(0);
  const [rpcShowDetail, setRpcShowDetail] = useState(false);
  const [customRpcScan, setCustomRpcScan] = useState("");
  const [rpcTabInput, setRpcTabInput] = useState("");
  const [rpcStatus, setRpcStatus] = useState("unchecked"); // "unchecked"|"working"|"error"
  const scanIdRef = useRef(0);

  const setChainId = (id) => {
    setChainIdRaw(id);
    try { localStorage.setItem(SCAN_CHAIN_KEY, String(id)); } catch { /* ignore */ }
  };
  const isCustom = !CHAINS[chainId];
  const activeChainId = chainId;
  const activeChainName = chainName(chainId);
  const scanning = !!scan && !scan.meta.done;
  const validToken = ethers.isAddress(tokenAddress.trim());

  const getActiveRpc = () => {
    if (isCustom) return getRpcs(chainId)[0] || null;
    if (rpcTab === CUSTOM_RPC_TAB) return customRpcScan || null;
    return getRpcs(chainId)[rpcTab] || null;
  };

  const testRpc = async (url, label) => {
    try {
      await new ethers.JsonRpcProvider(url).getNetwork();
      setRpcStatus("working");
      setAlert({ type: "success", message: `RPC ${label} connected!` });
    } catch (err) {
      setRpcStatus("error");
      setAlert({ type: "error", message: `RPC ${label} failed: ${err?.message?.substring(0, 80) || "Unknown"}` });
    }
  };

  const runScan = async (addrInput = tokenAddress, cid = activeChainId) => {
    const addr = addrInput.trim();
    if (!ethers.isAddress(addr)) {
      setAlert({ type: "error", message: "Invalid token address" });
      return;
    }
    if (!cid) {
      setAlert({ type: "error", message: "Please configure a custom chain first" });
      return;
    }
    setAlert(null);

    // Shareable URL for this scan
    window.history.replaceState(null, "", `${window.location.pathname}?token=${addr}&chainId=${cid}`);

    const id = ++scanIdRef.current;
    setScanCtx({ chainId: cid, token: addr });
    try {
      await scanToken({
        token: addr,
        chainId: cid,
        rpcUrl: cid === activeChainId ? getActiveRpc() : getRpcs(cid)[0],
        proxyBase: PROXY,
        // Ignore updates from a scan that has been superseded by a newer one.
        onState: (s) => { if (scanIdRef.current === id) setScan(s); },
      });
    } catch (err) {
      if (scanIdRef.current === id) setAlert({ type: "error", message: "Scan failed: " + err.message });
    }
  };

  // ?token=0x…&chainId=56 → prefill and scan
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("token");
    const c = parseInt(p.get("chainId"), 10);
    if (t && ethers.isAddress(t) && knownChain(c)) {
      setTokenAddress(t);
      setChainId(c);
      runScan(t, c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detected = scan ? PROTOCOL_KEYS.filter((k) => scan.protocols[k].findings.some((f) => f.confidence !== "low")) : [];
  const meta = scan?.meta;

  return (
    <div className="min-h-screen bg-[#f5f0e6] font-sans px-4 py-8 flex items-start justify-center">
      <div className="w-full max-w-5xl flex flex-col gap-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Bridge Scan</h1>
          <span className="text-sm text-gray-400">Detect which bridge protocol a token uses</span>
        </div>

        {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

        <div className="grid grid-cols-1 md:grid-cols-[18rem_1fr] gap-4 items-start">
          {/* ── Left panel ── */}
          <form
            onSubmit={(e) => { e.preventDefault(); if (!scanning) runScan(); }}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4 md:sticky md:top-4"
          >
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Setup Scan</p>

            {/* Chain selector */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Source chain</label>
              <div className="border border-gray-200 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${isCustom ? "bg-gray-500" : (ICON_COLORS[chainId] || "bg-gray-400")}`}>
                    {activeChainName.charAt(0)}
                  </span>
                  <span className="font-semibold text-sm text-gray-900 truncate">{activeChainName}</span>
                  {activeChainId && <span className="text-xs text-gray-400">ID: {activeChainId}</span>}
                </div>
                <select
                  value={chainId}
                  onChange={(e) => {
                    if (e.target.value === "__add") {
                      setShowAddChain(true);
                      return;
                    }
                    setShowAddChain(false);
                    setChainId(parseInt(e.target.value, 10));
                    setRpcTab(0);
                    setRpcStatus("unchecked");
                  }}
                  className="bg-transparent text-gray-400 text-sm outline-none cursor-pointer max-w-[7rem]"
                >
                  {CHAIN_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {customChains.length > 0 && (
                    <optgroup label="Custom">
                      {customChains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  )}
                  <option value="__add">+ Add custom chain…</option>
                </select>
              </div>

              {isCustom && getCustomChain(chainId) && (
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-gray-400">
                  <span className="font-mono truncate">{getCustomChain(chainId).rpc}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Remove ${chainName(chainId)} from saved chains?`)) return;
                      removeCustomChain(chainId);
                      setChainId(1);
                    }}
                    className="text-red-400 hover:text-red-600 flex-shrink-0"
                  >
                    Remove
                  </button>
                </div>
              )}
              {isCustom && (
                <p className="mt-1 text-[11px] text-gray-400">Custom chain: registries + on-chain log scan only.</p>
              )}

              {showAddChain && (
                <CustomChainForm
                  onCancel={() => setShowAddChain(false)}
                  onAdded={(c) => {
                    setShowAddChain(false);
                    setChainId(c.id);
                    setAlert({ type: "success", message: `${c.name} (chain ${c.id}) saved` });
                  }}
                />
              )}
            </div>

            {/* Token address */}
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Token contract address</label>
              <input
                type="text"
                placeholder="0x..."
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
                spellCheck={false}
                className="w-full border border-gray-200 px-3 py-2 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-300"
              />
            </div>

            <button
              type="submit"
              disabled={scanning || !validToken}
              className={`w-full py-2.5 font-semibold rounded-xl transition text-sm ${
                scanning ? "bg-gray-200 text-gray-500 cursor-wait"
                  : !validToken ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-gray-900 text-white hover:bg-gray-800"
              }`}
            >
              {scanning ? "Scanning..." : "Scan"}
            </button>

            {/* RPC selector */}
            {!isCustom && getRpcs(chainId).length > 0 && (
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
                          const url = getRpcs(chainId)[idx];
                          if (url) testRpc(url, label); else setRpcStatus("unchecked");
                        }
                      }}
                      className={`px-2 py-1 rounded-lg text-xs font-medium transition ${
                        rpcTab === idx ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setRpcShowDetail((v) => !v)}
                    className="ml-auto text-gray-400 hover:text-gray-600 transition"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${rpcShowDetail ? "rotate-180" : ""}`} />
                  </button>
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      rpcStatus === "working" ? "bg-green-500" : rpcStatus === "error" ? "bg-red-500" : "bg-gray-300"
                    }`}
                    title={rpcStatus}
                  />
                </div>
                {rpcShowDetail && (
                  <div className="bg-gray-50 rounded-lg p-2 text-xs">
                    {rpcTab === CUSTOM_RPC_TAB ? (
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          placeholder="https://your-rpc-url..."
                          value={rpcTabInput}
                          onChange={(e) => setRpcTabInput(e.target.value)}
                          className="flex-1 border border-gray-200 px-2 py-1.5 rounded-md text-xs font-mono focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white min-w-0"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const url = rpcTabInput.trim();
                            if (!url) return;
                            setCustomRpcScan(url);
                            setRpcShowDetail(false);
                            testRpc(url, "Custom");
                          }}
                          className="px-2.5 py-1.5 bg-gray-900 text-white rounded-md text-xs hover:bg-gray-800 transition flex-shrink-0"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="font-mono text-gray-600 break-all">{getRpcs(chainId)[rpcTab] || "—"}</div>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Used for on-chain checks. If it rate-limits, log scanning rotates through the other RPCs automatically.
                </p>
              </div>
            )}
          </form>

          {/* ── Right panel ── */}
          <div className="min-h-[400px] bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6 flex flex-col gap-4 min-w-0">
            {!scan ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-gray-300 py-16">
                <Search className="w-14 h-14" strokeWidth={1.5} />
                <p className="text-gray-400 font-medium">Select chain & token, then scan</p>
                <p className="text-xs text-gray-400 text-center max-w-sm">
                  Checks LayerZero, Chainlink CCIP, Wormhole and Hyperlane using their official registries
                  and on-chain evidence (bridge contracts among the token's holders).
                </p>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="flex flex-col gap-2 pb-4 border-b border-gray-100">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-lg font-bold text-gray-900">
                      {meta.token?.symbol || "Token"}
                    </span>
                    {meta.token?.name && <span className="text-sm text-gray-500">{meta.token.name}</span>}
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {chainName(scanCtx?.chainId)}
                    </span>
                  </div>
                  {scanCtx && <div className="text-xs text-gray-600"><Address value={scanCtx.token} chainId={scanCtx.chainId} /></div>}

                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {detected.length > 0 ? (
                      <>
                        <span className="text-sm text-gray-500 mr-1">Uses</span>
                        {detected.map((k) => (
                          <span key={k} className="text-sm bg-green-600 text-white px-2.5 py-0.5 rounded-full font-medium">{k}</span>
                        ))}
                      </>
                    ) : (
                      <span className="text-sm text-gray-500">
                        {scanning ? "Scanning…" : "No bridge protocol detected"}
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
                    {meta.progress && <span>{meta.progress}</span>}
                    {meta.rpc && <span>RPC: {meta.rpc}{meta.rpcNote && <span className="text-amber-600"> ({meta.rpcNote})</span>}</span>}
                    {meta.holderSource && <span>Checked top {meta.holderCount} holder contracts via {meta.holderSource}</span>}
                    {meta.holderAttempts?.length > 0 && (
                      <span title={meta.holderAttempts.map((a) => `${a.source}: ${a.error}`).join("\n")}>
                        Skipped: {meta.holderAttempts.map((a) => a.source).join(", ")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Per-protocol results */}
                <div className="flex flex-col gap-3">
                  {PROTOCOL_KEYS.map((k) => (
                    <ProtocolCard key={k} name={k} r={scan.protocols[k]} chainId={scanCtx?.chainId} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
