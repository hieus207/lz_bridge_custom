/* global BigInt */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { PublicKey } from "@solana/web3.js";
import { LogOut, ChevronDown } from "lucide-react";
import Alert from "./Alert";
import useSolanaWallet from "../hooks/useSolanaWallet";
import { CHAIN_LIST } from "../lib/chains";
import {
  SOLANA_RPCS, makeSolana, resolveSolanaOft, getPeers, getBalance, quoteSend, sendFromSolana, evmTo32,
} from "../lib/solanaOft";

const SOL_WALLETS = [
  { id: "phantom", name: "Phantom", icon: "https://assets.pancakeswap.finance/web/wallets/phantom.png" },
  { id: "solflare", name: "Solflare", icon: "https://assets.pancakeswap.finance/web/wallets/solflare.png" },
  { id: "okx", name: "OKX Wallet", icon: "https://assets.pancakeswap.finance/web/wallets/okx-wallet.png" },
];

const short = (a, n = 4) => (a ? `${a.slice(0, n)}…${a.slice(-n)}` : "");
const fmt = (v, d) => {
  const s = ethers.formatUnits(v, d);
  const [i, f = ""] = s.split(".");
  const ff = f.slice(0, 6).replace(/0+$/, "");
  return ff ? `${i}.${ff}` : i;
};

// LayerZero OFT bridge with Solana as the source chain.
export default function SolanaOftBridge({ evmAddress, onSourceChange, onSummary }) {
  const sw = useSolanaWallet();
  const [rpcUrl, setRpcUrl] = useState(() => {
    try { return localStorage.getItem("sol_rpc") || SOLANA_RPCS[0]; } catch { return SOLANA_RPCS[0]; }
  });
  const sol = useMemo(() => makeSolana(rpcUrl), [rpcUrl]);

  const initialMint = new URLSearchParams(window.location.search).get("mint") || "";
  const [input, setInput] = useState(initialMint);
  const [token, setToken] = useState(null);
  const [peers, setPeers] = useState([]);
  const [checking, setChecking] = useState(false);
  const [dstEid, setDstEid] = useState(null);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState(evmAddress || "");
  const [balance, setBalance] = useState(null);
  const [solBalance, setSolBalance] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteErr, setQuoteErr] = useState(null);
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState(null);
  const [showWallets, setShowWallets] = useState(false);
  const quoteSeq = useRef(0);

  // Prefill the EVM recipient with the connected EVM wallet
  useEffect(() => {
    if (evmAddress && !recipient) setRecipient(evmAddress);
  }, [evmAddress, recipient]);

  const updateUrl = useCallback((mint) => {
    const p = new URLSearchParams(window.location.search);
    p.set("src", "solana");
    if (mint) p.set("mint", mint); else p.delete("mint");
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, []);

  const handleCheck = useCallback(async (value = input) => {
    const v = value.trim();
    if (!v) return;
    setChecking(true);
    setToken(null);
    setPeers([]);
    setQuote(null);
    setAlert(null);
    try {
      const t = await resolveSolanaOft(sol, v);
      const p = await getPeers(sol, t);
      setToken(t);
      setPeers(p);
      setDstEid((cur) => (p.some((x) => x.eid === cur) ? cur : p[0]?.eid ?? null));
      updateUrl(t.mint);
      if (!p.length) setAlert({ type: "error", message: "This OFT has no EVM peer among the supported chains" });
    } catch (err) {
      setAlert({ type: "error", message: err.message });
    } finally {
      setChecking(false);
    }
  }, [input, sol, updateUrl]);

  // Auto-check a mint passed in the URL
  useEffect(() => {
    if (initialMint) handleCheck(initialMint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!sw.address) { setBalance(null); setSolBalance(null); return; }
    try {
      const [b, lamports] = await Promise.all([
        token ? getBalance(sol, sw.address, token) : Promise.resolve(null),
        sol.connection.getBalance(new PublicKey(sw.address)),
      ]);
      setBalance(b);
      setSolBalance(BigInt(lamports));
    } catch { /* RPC hiccup: keep last values */ }
  }, [sw.address, token, sol]);

  useEffect(() => { refreshBalances(); }, [refreshBalances]);

  const amountLd = useMemo(() => {
    if (!token || !amount) return null;
    try {
      const v = ethers.parseUnits(amount, token.decimals);
      return v > 0n ? v : null;
    } catch { return null; }
  }, [amount, token]);

  const recipientOk = ethers.isAddress(recipient);

  // Debounced fee quote
  useEffect(() => {
    setQuote(null);
    setQuoteErr(null);
    if (!token || !dstEid || !amountLd || !recipientOk || !sw.address) return;
    const seq = ++quoteSeq.current;
    const t = setTimeout(async () => {
      try {
        const q = await quoteSend(sol, sw.address, token, { dstEid, to: evmTo32(recipient), amountLd });
        if (seq === quoteSeq.current) setQuote(q);
      } catch (err) {
        if (seq === quoteSeq.current) setQuoteErr(err.message?.slice(0, 140) || "Quote failed");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [token, dstEid, amountLd, recipient, recipientOk, sw.address, sol]);

  useEffect(() => {
    onSummary?.({ symbol: token?.symbol || null, from: "Solana", to: peers.find((p) => p.eid === dstEid)?.name || null });
  }, [token?.symbol, dstEid, peers, onSummary]);

  const insufficient = balance != null && amountLd != null && amountLd > balance;
  const lowSol = solBalance != null && quote && solBalance < quote.nativeFee + 10_000n;
  const dst = peers.find((p) => p.eid === dstEid);

  const saveHistory = (rec) => {
    try {
      const list = JSON.parse(localStorage.getItem("lz_tx_history") || "[]");
      localStorage.setItem("lz_tx_history", JSON.stringify([rec, ...list.filter((t) => t.hash !== rec.hash)].slice(0, 50)));
    } catch { /* ignore */ }
  };

  const handleBridge = async () => {
    if (!sw.signer) { setShowWallets(true); return; }
    setSending(true);
    setAlert(null);
    try {
      const { signature } = await sendFromSolana(sol, sw.signer, token, { dstEid, to: evmTo32(recipient), amountLd }, setStatus);
      setAlert({
        type: "success",
        message: `Bridge sent! <a class='underline underline-offset-2' target='_blank' rel='noreferrer' href='https://layerzeroscan.com/tx/${signature}'>LayerZero Scan</a> · <a class='underline underline-offset-2' target='_blank' rel='noreferrer' href='https://solscan.io/tx/${signature}'>Solscan</a>`,
      });
      saveHistory({
        hash: signature, srcChain: "Solana", dstChain: dst?.name || String(dstEid), symbol: token.symbol || "?",
        amount, dstEid, status: "success", timestamp: Date.now(),
      });
      setTimeout(refreshBalances, 2000);
    } catch (err) {
      const msg = /reject|denied|cancel/i.test(err.message || "") ? "Rejected in wallet" : err.message;
      setAlert({ type: "error", message: `Bridge failed: ${msg?.slice(0, 200)}` });
    } finally {
      setSending(false);
      setStatus(null);
    }
  };

  let cta = "Bridge";
  let ctaDisabled = false;
  if (!sw.address) cta = "Connect Solana wallet";
  else if (!token) { cta = "Check a token first"; ctaDisabled = true; }
  else if (!dst) { cta = "No destination"; ctaDisabled = true; }
  else if (!amountLd) { cta = "Enter amount"; ctaDisabled = true; }
  else if (insufficient) { cta = `Insufficient ${token.symbol || "token"} balance`; ctaDisabled = true; }
  else if (!recipientOk) { cta = "Enter EVM recipient"; ctaDisabled = true; }
  else if (token.paused) { cta = "OFT is paused"; ctaDisabled = true; }
  else if (lowSol) { cta = "Not enough SOL for fee"; ctaDisabled = true; }
  else if (!quote) { cta = quoteErr ? "Quote failed" : "Quoting…"; ctaDisabled = true; }
  if (sending) { cta = status || "Sending…"; ctaDisabled = true; }

  return (
    <div className="relative w-full max-w-md mx-auto bg-white rounded-2xl p-5 flex flex-col gap-4 mt-4">
      <span className="tile-tab"><b>01</b>Solana → EVM</span>
      {/* Header + Solana wallet */}
      <div className="flex items-center justify-between">
        <span className="label">Source wallet</span>
        {sw.address ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
            <span className="font-mono">{short(sw.address)}</span>
            <button onClick={sw.disconnect} className="p-0.5 rounded hover:bg-gray-100 transition" title="Disconnect">
              <LogOut className="w-3 h-3 text-gray-400" />
            </button>
          </div>
        ) : (
          <button onClick={() => setShowWallets((v) => !v)} className="btn-outline text-[11px] px-2.5 py-1.5">
            Connect Solana
          </button>
        )}
      </div>

      {showWallets && !sw.address && (
        <div className="grid grid-cols-3 gap-2">
          {SOL_WALLETS.map((w) => (
            <button
              key={w.id}
              onClick={async () => { await sw.connect(w.id); setShowWallets(false); }}
              className="tile-inset flex flex-col items-center gap-1 py-2.5 hover:bg-gray-100 transition text-[11px] font-bold uppercase tracking-wide"
            >
              <img src={w.icon} alt="" className="w-6 h-6 rounded" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
              {w.name}
            </button>
          ))}
        </div>
      )}

      {/* Source chain */}
      <div className="tile-inset px-3 py-2.5 flex items-center justify-between hover:bg-gray-100 transition">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 bg-gradient-to-br from-purple-500 to-emerald-400 rounded-full flex items-center justify-center text-white text-xs font-bold">S</span>
          <span className="font-semibold text-sm text-gray-900">Solana</span>
          <span className="text-xs text-gray-400">EID: 30168</span>
        </div>
        <select
          value="solana"
          onChange={(e) => onSourceChange?.(Number(e.target.value))}
          aria-label="Source chain"
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        >
          <option value="solana">Solana</option>
          <optgroup label="EVM">
            {CHAIN_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </optgroup>
        </select>
        <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
      </div>

      {/* Token */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Paste Solana token mint or OFT store…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleCheck(); }}
          className="tile-inset flex-1 min-w-0 px-3 py-2 text-sm font-mono"
        />
        <button
          onClick={() => handleCheck()}
          disabled={checking || !input.trim()}
          className="btn-primary px-4 py-2 text-sm"
        >
          {checking ? "…" : "Check"}
        </button>
      </div>

      {token && (
        <div className="tile-inset px-3 py-2.5 text-xs flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-sm text-gray-900">{token.symbol || "Unknown"} {token.name && <span className="font-normal text-gray-500">· {token.name}</span>}</span>
            <span className="text-[10px] text-gray-400">{token.source}</span>
          </div>
          <Row k="Mint" v={<a href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noreferrer" className="font-mono hover:underline">{short(token.mint, 6)}</a>} />
          <Row k="OFT program" v={<a href={`https://solscan.io/account/${token.programId}`} target="_blank" rel="noreferrer" className="font-mono hover:underline">{short(token.programId, 6)}</a>} />
          <Row k="Balance" v={balance == null ? "—" : `${fmt(balance, token.decimals)} ${token.symbol || ""}`} />
          {token.paused && <div className="text-red-600 font-semibold">OFT is paused by its admin</div>}
        </div>
      )}

      {token && (
        <>
          {/* Destination */}
          <div>
            <label className="label">To</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {peers.length === 0 && <span className="text-xs text-gray-400">No EVM peers configured</span>}
              {peers.map((p) => (
                <button
                  key={p.eid}
                  onClick={() => setDstEid(p.eid)}
                  className={`px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider border-[1.5px] transition ${p.eid === dstEid ? "chip-on border-[var(--line)]" : "border-[var(--line-2)] text-gray-600 hover:border-[var(--line)]"}`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <div className="flex items-center justify-between label">
              <span>Amount</span>
              {balance != null && (
                <button onClick={() => setAmount(ethers.formatUnits(balance, token.decimals))} className="hover:text-gray-700">
                  Max {fmt(balance, token.decimals)}
                </button>
              )}
            </div>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              className={`tile-inset mt-1 w-full px-3 py-2 text-sm ${insufficient ? "!border-[var(--down)]" : ""}`}
            />
          </div>

          {/* Recipient */}
          <div>
            <div className="flex items-center justify-between label">
              <span>Recipient on {dst?.name || "EVM"}</span>
              {evmAddress && recipient !== evmAddress && (
                <button onClick={() => setRecipient(evmAddress)} className="hover:text-gray-700">Use my EVM wallet</button>
              )}
            </div>
            <input
              type="text"
              placeholder="0x…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              className={`tile-inset mt-1 w-full px-3 py-2 text-sm font-mono ${recipient && !recipientOk ? "!border-[var(--down)]" : ""}`}
            />
          </div>

          {/* Fee */}
          <div className="text-xs flex flex-col gap-1 border-t border-gray-100 pt-3">
            <Row k="LayerZero fee" v={quote ? `${fmt(quote.nativeFee, 9)} SOL` : quoteErr ? <span className="text-red-500">{quoteErr}</span> : !sw.address ? "Connect wallet to see fee" : "—"} />
            {quote && quote.amountReceivedLd !== quote.amountLd && (
              <Row k="You receive" v={`${fmt(quote.amountReceivedLd, token.decimals)} ${token.symbol || ""}`} />
            )}
            <Row k="SOL balance" v={solBalance == null ? "—" : <span className={lowSol ? "text-red-500 font-semibold" : ""}>{fmt(solBalance, 9)} SOL</span>} />
          </div>
        </>
      )}

      <button
        onClick={handleBridge}
        disabled={ctaDisabled}
        className="btn-primary w-full h-12 text-sm"
      >
        {cta}
      </button>

      <div className="flex items-center justify-between text-[11px] text-gray-400">
        <span>Solana RPC</span>
        <select
          value={rpcUrl}
          onChange={(e) => { setRpcUrl(e.target.value); try { localStorage.setItem("sol_rpc", e.target.value); } catch { /* ignore */ } }}
          className="bg-transparent outline-none cursor-pointer font-mono"
        >
          {SOLANA_RPCS.map((u) => <option key={u} value={u}>{new URL(u).host}</option>)}
        </select>
      </div>

      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-400">{k}</span>
      <span className="text-gray-700 text-right">{v}</span>
    </div>
  );
}
