import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { Copy, Check, ExternalLink, ChevronDown } from "lucide-react";
import Alert from "../components/Alert";
import CustomChainForm from "../components/CustomChainForm";
import useCustomChains from "../hooks/useCustomChains";
import { CHAINS, CHAIN_LIST, getRpcs, explorerAddressUrl, chainName, SOLANA, isBase58Address } from "../lib/chains";
import { getCustomChain, removeCustomChain } from "../lib/customChains";
import { scanToken, PROTOCOL_KEYS } from "../lib/bridgeScan";

const PROXY = process.env.REACT_APP_OKLINK_PROXY ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : "");

const ICON_COLORS = {
  1: "bg-blue-500", 56: "bg-yellow-500", 137: "bg-purple-500",
  43114: "bg-red-500", 42161: "bg-sky-500", 10: "bg-red-400", 8453: "bg-blue-600",
  4663: "bg-lime-500",
};

const PROTOCOL_APPS = {
  "LayerZero": null, // handled by bridgeLink → /bridge
  "Chainlink CCIP": "https://app.transporter.io/",
  "Wormhole": "https://portalbridge.com/",
  "Hyperlane": null, // handled by bridgeLink → /bridge?proto=hyperlane
  "Native bridge": null, // each finding carries its portal (f.appUrl)
};

const RPC_TAB_LABELS = ["Def", "Fb1", "Fb2", "Fb3", "Cus"];
const CUSTOM_RPC_TAB = 4;

const SCAN_CHAIN_KEY = "scan_chain";
const knownChain = (id) => id === SOLANA || !!(CHAINS[id] || getCustomChain(id));
const loadScanChain = () => {
  try {
    const raw = localStorage.getItem(SCAN_CHAIN_KEY);
    const id = raw === SOLANA ? SOLANA : parseInt(raw, 10);
    return knownChain(id) ? id : 1;
  } catch {
    return 1;
  }
};

const isAddr = (v) => typeof v === "string" && (/^0x[0-9a-fA-F]{40}$/.test(v) || isBase58Address(v));

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
  high: "bg-[var(--ink)] text-[var(--on-ink)]",
  medium: "border-[1.5px] border-[var(--warn)] text-[var(--warn)]",
  low: "border-[1.5px] border-[var(--line-2)] text-gray-400",
};

function FindingCard({ f, chainId, protocol }) {
  const app = f.appUrl || PROTOCOL_APPS[protocol];
  return (
    <div className="bg-[var(--surface)] border-[1.5px] border-[var(--line-2)] px-3 py-2.5 flex flex-col gap-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-gray-900 text-[13px]">{f.title}</span>
          <span className={`px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ${CONFIDENCE_STYLE[f.confidence]}`}>{f.confidence}</span>
        </div>
        {f.bridgeLink ? (
          <Link to={f.bridgeLink} className="btn-primary btn-sm flex-shrink-0 px-2.5 py-1 text-[11px]">
            Bridge →
          </Link>
        ) : app && f.confidence !== "low" ? (
          <a href={app} target="_blank" rel="noopener noreferrer" className="btn-outline flex-shrink-0 px-2.5 py-1 text-[11px]">
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
              <dt className="text-gray-400 whitespace-nowrap uppercase text-[10px] tracking-wider pt-px">{k}</dt>
              <dd className="text-gray-700 min-w-0">{isAddr(v) ? <Address value={v} chainId={chainId} /> : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {f.destinations?.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-gray-400 mr-1 uppercase text-[10px] tracking-wider">Routes to</span>
          {f.destinations.map((d) => (
            <span key={d} className="border-[1.5px] border-[var(--line-2)] text-gray-700 px-1.5 py-px uppercase text-[10px] tracking-wide">{d}</span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 text-[10px] text-gray-400">
        {f.sources.map((src) => <span key={src} className="border border-dashed border-[var(--line-2)] px-1.5 py-px">{src}</span>)}
      </div>
    </div>
  );
}

const COLLAPSED_FINDINGS = 3; // e.g. USDC has ~60 Hyperlane routes

function ProtocolCard({ name, r, chainId, index }) {
  const [showLow, setShowLow] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const checking = r.pending > 0;
  const strong = r.findings.filter((f) => f.confidence !== "low");
  const weak = r.findings.filter((f) => f.confidence === "low");
  const detected = strong.length > 0;
  const failedOnly = !checking && !detected && r.errors.length > 0;

  return (
    <div className={`tile-inset p-4 mb-4 break-inside-avoid flex flex-col gap-2.5 min-w-0 ${detected ? "scan-hit" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 tabular">{String(index + 1).padStart(2, "0")}</span>
          {checking && (
            <svg className="animate-spin w-3.5 h-3.5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          <span className="font-extrabold text-sm text-gray-900 uppercase tracking-[0.08em]">{name}</span>
        </div>
        {detected ? (
          <span className="chip-on text-[10px] px-2 py-0.5 font-extrabold uppercase tracking-wider border-[1.5px] border-[var(--line)]">✓ Detected</span>
        ) : checking ? (
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Checking…</span>
        ) : failedOnly ? (
          <span className="text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider text-white bg-[var(--down)]">Check failed</span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider text-gray-400 border-[1.5px] border-[var(--line-2)]">Not found</span>
        )}
      </div>

      {(showAll ? strong : strong.slice(0, COLLAPSED_FINDINGS)).map((f) => (
        <FindingCard key={f.address || f.title} f={f} chainId={chainId} protocol={name} />
      ))}
      {strong.length > COLLAPSED_FINDINGS && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="btn-outline text-[11px] py-1.5"
        >
          {showAll ? "Show less" : `Show all ${strong.length} (${strong.length - COLLAPSED_FINDINGS} more)`}
        </button>
      )}

      {weak.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowLow((v) => !v)} className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
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
        <p className={`text-[11px] ${failedOnly ? "text-[var(--down)]" : "text-[var(--warn)]"}`}>
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
  const isSolana = chainId === SOLANA;
  const isCustom = !isSolana && !CHAINS[chainId];
  const activeChainId = chainId;
  const activeChainName = chainName(chainId);
  const scanning = !!scan && !scan.meta.done;
  const validToken = isSolana ? isBase58Address(tokenAddress.trim()) : ethers.isAddress(tokenAddress.trim());

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

  const runScan = async (addrInput = tokenAddress, cid = activeChainId, { animate = true } = {}) => {
    const addr = addrInput.trim();
    if (cid === SOLANA ? !isBase58Address(addr) : !ethers.isAddress(addr)) {
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
    const ctx = { chainId: cid, token: addr };
    if (animate && !scanCtx && document.startViewTransition) {
      // First scan: morph the centred form into the left column, slide results in
      const vt = document.startViewTransition(() => flushSync(() => setScanCtx(ctx)));
      vt.ready.catch(() => {}); // skipped transitions reject; the state update still applies
      vt.finished.catch(() => {});
    } else {
      setScanCtx(ctx);
    }
    try {
      if (cid === SOLANA) {
        // Solana SDKs load only when a Solana scan is requested
        const { scanSolanaToken } = await import("../lib/solanaScan");
        const s = await scanSolanaToken({ mint: addr, onState: (st) => { if (scanIdRef.current === id) setScan(st); } });
        if (s.meta.error && scanIdRef.current === id) setAlert({ type: "error", message: s.meta.error });
        return;
      }
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
    const c = p.get("chainId") === SOLANA ? SOLANA : parseInt(p.get("chainId"), 10);
    if (t && (c === SOLANA ? isBase58Address(t) : ethers.isAddress(t)) && knownChain(c)) {
      setTokenAddress(t);
      setChainId(c);
      runScan(t, c, { animate: false }); // deep link: open straight in the split layout
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detected = scan ? PROTOCOL_KEYS.filter((k) => scan.protocols[k].findings.some((f) => f.confidence !== "low")) : [];
  const meta = scan?.meta;
  const split = !!scanCtx; // centred form until the first scan, then form left / results right

  const chainIcon = isSolana ? "bg-gradient-to-br from-purple-500 to-emerald-400" : isCustom ? "bg-gray-500" : (ICON_COLORS[chainId] || "bg-gray-400");

  const form = (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!scanning) runScan(); }}
      style={{ viewTransitionName: "scan-form" }}
      className={`tile relative flex flex-col gap-4 ${split ? "p-5 md:sticky md:top-28" : "p-6 md:p-7"}`}
    >
      <span className="tile-tab"><b>01</b>Setup scan</span>

      {/* Chain selector */}
      <div>
        <label className="label mb-1.5 block">Source chain</label>
        <div className="tile-inset px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-[var(--hover)] transition">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${chainIcon}`}>
              {activeChainName.charAt(0)}
            </span>
            <span className="font-bold text-sm text-gray-900 truncate uppercase tracking-wide">{activeChainName}</span>
            {activeChainId && !isSolana && <span className="text-[11px] text-gray-400">ID {activeChainId}</span>}
          </div>
          <select
            value={chainId}
            onChange={(e) => {
              if (e.target.value === "__add") {
                setShowAddChain(true);
                return;
              }
              setShowAddChain(false);
              setChainId(e.target.value === SOLANA ? SOLANA : parseInt(e.target.value, 10));
              setRpcTab(0);
              setRpcStatus("unchecked");
            }}
            aria-label="Source chain"
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          >
            {CHAIN_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <optgroup label="Non-EVM">
              <option value={SOLANA}>Solana</option>
            </optgroup>
            {customChains.length > 0 && (
              <optgroup label="Custom">
                {customChains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
            <option value="__add">+ Add custom chain…</option>
          </select>
          <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
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
              className="text-[var(--down)] hover:underline flex-shrink-0"
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
        <label className="label mb-1.5 block">{isSolana ? "Token mint" : "Token contract"}</label>
        <input
          type="text"
          placeholder={isSolana ? "Solana mint (base58)…" : "0x…"}
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value)}
          spellCheck={false}
          className="tile-inset w-full px-3 py-2.5 text-sm font-mono"
        />
      </div>

      <button type="submit" disabled={scanning || !validToken} className={`btn-primary w-full text-sm ${split ? "h-11" : "h-12"}`}>
        {scanning ? "Scanning…" : validToken || !tokenAddress.trim() ? "Scan" : isSolana ? "Invalid mint" : "Invalid address"}
      </button>

      {/* RPC selector */}
      {!isCustom && !isSolana && getRpcs(chainId).length > 0 && (
        <div className="flex flex-col gap-2 pt-3 border-t-[1.5px] border-dashed border-[var(--line-2)]">
          <div className="flex items-center gap-1">
            <span className="label mr-1">RPC</span>
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
                className={`px-1.5 py-0.5 text-[11px] font-bold uppercase border-[1.5px] transition ${
                  rpcTab === idx ? "chip-on border-[var(--line)]" : "border-[var(--line-2)] text-gray-500 hover:border-[var(--line)]"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRpcShowDetail((v) => !v)}
              className="ml-auto text-gray-400 hover:text-gray-900 transition"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${rpcShowDetail ? "rotate-180" : ""}`} />
            </button>
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                rpcStatus === "working" ? "bg-[var(--up)]" : rpcStatus === "error" ? "bg-[var(--down)]" : "bg-gray-300"
              }`}
              title={rpcStatus}
            />
          </div>
          {rpcShowDetail && (
            <div className="bg-gray-50 p-2 text-xs">
              {rpcTab === CUSTOM_RPC_TAB ? (
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="https://your-rpc-url..."
                    value={rpcTabInput}
                    onChange={(e) => setRpcTabInput(e.target.value)}
                    className="flex-1 border-[1.5px] border-[var(--line-2)] px-2 py-1.5 text-xs font-mono min-w-0"
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
                    className="btn-outline px-2.5 py-1.5 text-[11px] flex-shrink-0"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="font-mono text-gray-600 break-all">{getRpcs(chainId)[rpcTab] || "—"}</div>
              )}
            </div>
          )}
        </div>
      )}
    </form>
  );

  return (
    <div className="font-sans px-4 py-8 md:py-10 flex items-start justify-center">
      <div className="w-full max-w-[1180px] flex flex-col gap-8">
        {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

        {!split ? (
          <>
            <div style={{ viewTransitionName: "scan-hero" }} className="text-center flex flex-col items-center gap-3 pt-4 md:pt-10">
              <h1 className="text-[26px] md:text-[34px] font-extrabold tracking-[0.08em] uppercase leading-tight text-gray-900">
                Which <span className="mark">bridge</span> does it use?
              </h1>
              <p className="text-[12px] tracking-[0.14em] uppercase text-gray-500">
                LayerZero · Chainlink CCIP · Wormhole · Hyperlane — EVM &amp; Solana
              </p>
            </div>
            <div className="w-full max-w-[560px] mx-auto pt-4">
              {form}
              <p className="mt-6 text-[11px] text-gray-400 text-center leading-relaxed">
                Live registries of each bridge + on-chain evidence (bridge contracts among the holders, OFT peers, Token Bridge state).
                Nothing is cached between scans.
              </p>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[19rem_1fr] gap-6 items-start">
            {form}

            {/* ── Results ── */}
            <div style={{ viewTransitionName: "scan-results" }} className="tile relative p-5 md:p-6 flex flex-col gap-4 min-w-0">
              <span className="tile-tab"><b>02</b>Result</span>
              {scan && (
                <>
                  <div className="flex flex-col gap-2 pb-4 border-b-[1.5px] border-[var(--line-2)]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-2xl font-extrabold tracking-[0.06em] uppercase text-gray-900">
                        {meta.token?.symbol || "Token"}
                      </span>
                      {meta.token?.name && <span className="text-sm text-gray-500">{meta.token.name}</span>}
                      <span className="text-[11px] uppercase tracking-wider px-2 py-0.5 border-[1.5px] border-[var(--line)] text-gray-900">
                        {chainName(scanCtx?.chainId)}
                      </span>
                    </div>
                    {scanCtx && <div className="text-xs text-gray-600"><Address value={scanCtx.token} chainId={scanCtx.chainId} /></div>}

                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {detected.length > 0 ? (
                        <>
                          <span className="label mr-1">Uses</span>
                          {detected.map((k) => (
                            <span key={k} className="chip-on text-[11px] font-extrabold uppercase tracking-wider px-2 py-0.5 border-[1.5px] border-[var(--line)]">{k}</span>
                          ))}
                        </>
                      ) : (
                        <span className="text-sm text-gray-500">
                          {scanning ? "Scanning…" : "No bridge protocol detected"}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
                      {meta.progress && <span className="text-gray-600">{meta.progress}</span>}
                      {meta.rpc && <span>RPC: {meta.rpc}{meta.rpcNote && <span className="text-[var(--warn)]"> ({meta.rpcNote})</span>}</span>}
                      {meta.holderSource && <span>Checked top {meta.holderCount} holder contracts via {meta.holderSource}</span>}
                      {meta.holderAttempts?.length > 0 && (
                        <span title={meta.holderAttempts.map((a) => `${a.source}: ${a.error}`).join(String.fromCharCode(10))}>
                          Skipped: {meta.holderAttempts.map((a) => a.source).join(", ")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="xl:columns-2 gap-4 [column-fill:balance]">
                    {PROTOCOL_KEYS.filter((k) => !(k === "Native bridge" && scanCtx?.chainId === SOLANA)).map((k, i) => (
                      <ProtocolCard key={k} index={i} name={k} r={scan.protocols[k]} chainId={scanCtx?.chainId} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
