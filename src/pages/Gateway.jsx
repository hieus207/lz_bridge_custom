/* global BigInt */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { LogOut } from "lucide-react";
import useWallet from "../hooks/useWallet";
import Alert from "../components/Alert";
import { fetchWithTimeout } from "../lib/http";

// Circle Gateway: deposit on the source chain, sign a burn intent, Circle mints native USDC/EURC on
// the destination (1:1, no wrapped token, no pool to run dry). Fees come out of the Gateway balance.
const API = "https://gateway-api.circle.com/v1";
const RELAY = "/api/gateway";

// Gateway domain → EVM chain id (Solana is domain 5)
const DOMAIN_CHAIN = { 0: 1, 1: 43114, 2: 10, 3: 42161, 6: 8453, 7: 137, 10: 130, 13: 146, 14: 480, 16: 1329, 19: 999 };
const SOLANA_DOMAIN = 5;
// Native USDC / EURC per chain (Circle issuances). Anything missing can be pasted in the form.
const TOKENS = {
  USDC: {
    1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 43114: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", 10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    130: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", 146: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", 480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
    1329: "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
    solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  EURC: {
    1: "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c", 43114: "0xC891EB4cbdEFf6e073e859e987815Ed1505c2ACD", 8453: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
    solana: "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
  },
};
const CHAIN_NAMES = { 1: "Ethereum", 43114: "Avalanche", 10: "Optimism", 42161: "Arbitrum", 8453: "Base", 137: "Polygon", 130: "Unichain", 146: "Sonic", 480: "World Chain", 1329: "Sei", 999: "HyperEVM" };
const EXPLORER_TX = { 1: "https://etherscan.io/tx/", 43114: "https://snowtrace.io/tx/", 10: "https://optimistic.etherscan.io/tx/", 42161: "https://arbiscan.io/tx/", 8453: "https://basescan.org/tx/", 137: "https://polygonscan.com/tx/", 130: "https://uniscan.xyz/tx/", 146: "https://sonicscan.org/tx/" };
const DEC = 6; // USDC and EURC
const ZERO32 = ethers.ZeroHash;
const SOL_RPC = "https://solana-rpc.publicnode.com";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const fmt = (v) => ethers.formatUnits(v, DEC);
const dec = (s) => ethers.parseUnits(String(s ?? "0"), DEC); // API balances are decimal strings
const b32Evm = (a) => ethers.zeroPadValue(ethers.getAddress(a), 32).toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Direct first (the API allows CORS); the Vercel relay if the browser blocks it
async function api(method, path, body) {
  const init = { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, timeout: 30000 };
  let resp;
  try {
    resp = await fetchWithTimeout(API + path, init);
  } catch {
    const [p, q] = path.split("?");
    resp = await fetchWithTimeout(`${RELAY}?path=${encodeURIComponent(p)}${q ? "&" + q : ""}`, init);
  }
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${path.split("?")[0]} HTTP ${resp.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const TYPES = {
  TransferSpec: [
    { name: "version", type: "uint32" }, { name: "sourceDomain", type: "uint32" }, { name: "destinationDomain", type: "uint32" },
    { name: "sourceContract", type: "bytes32" }, { name: "destinationContract", type: "bytes32" }, { name: "sourceToken", type: "bytes32" }, { name: "destinationToken", type: "bytes32" },
    { name: "sourceDepositor", type: "bytes32" }, { name: "destinationRecipient", type: "bytes32" }, { name: "sourceSigner", type: "bytes32" }, { name: "destinationCaller", type: "bytes32" },
    { name: "value", type: "uint256" }, { name: "salt", type: "bytes32" }, { name: "hookData", type: "bytes" },
  ],
  BurnIntent: [{ name: "maxBlockHeight", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "spec", type: "TransferSpec" }],
};

function Row({ k, v, cls = "" }) {
  return (
    <div className="contents">
      <dt className="text-gray-400 text-[10px] uppercase tracking-wider pt-px whitespace-nowrap">{k}</dt>
      <dd className={`font-mono text-xs break-all ${cls}`}>{v}</dd>
    </div>
  );
}

export default function Gateway() {
  const wallet = useWallet();
  const { address, signer, connect, disconnect, switchChain } = wallet;
  const [info, setInfo] = useState(null);
  const [infoErr, setInfoErr] = useState(null);
  const [token, setToken] = useState("EURC");
  const [srcDomain, setSrcDomain] = useState(1);
  const [dstDomain, setDstDomain] = useState(SOLANA_DOMAIN);
  const [srcTokenAddr, setSrcTokenAddr] = useState("");
  const [dstTokenAddr, setDstTokenAddr] = useState("");
  const [amount, setAmount] = useState("1");
  const [evmRecipient, setEvmRecipient] = useState("");
  const [solRecipient, setSolRecipient] = useState("");
  const [solState, setSolState] = useState(null); // { recipient, ata, exists, balance }
  const [evmState, setEvmState] = useState(null); // { bal, native, allowance, gwBal, pending }
  const [est, setEst] = useState(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState(null);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);
  const logRef = useRef(null);
  const say = useCallback((m) => setLog((l) => [...l.slice(-200), `${new Date().toTimeString().slice(0, 8)} ${m}`]), []);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = 1e9; }, [log]);

  const srcChainId = DOMAIN_CHAIN[srcDomain];
  const dstIsSolana = dstDomain === SOLANA_DOMAIN;
  const dstChainId = DOMAIN_CHAIN[dstDomain];
  const domains = useMemo(() => (info?.domains || []).filter((d) => d.walletContract?.supportedTokens?.includes(token) || d.minterContract?.supportedTokens?.includes(token)), [info, token]);
  const srcInfo = domains.find((d) => d.domain === srcDomain);
  const dstInfo = domains.find((d) => d.domain === dstDomain);

  useEffect(() => {
    api("GET", "/info").then(setInfo).catch((e) => setInfoErr(e.message));
  }, []);
  // Default token addresses per selection; the inputs stay editable
  useEffect(() => { setSrcTokenAddr(TOKENS[token]?.[srcChainId] || ""); setEst(null); }, [token, srcChainId]);
  useEffect(() => { setDstTokenAddr(dstIsSolana ? TOKENS[token]?.solana || "" : TOKENS[token]?.[dstChainId] || ""); setEst(null); }, [token, dstChainId, dstIsSolana]);
  useEffect(() => { if (address && !evmRecipient) setEvmRecipient(address); }, [address, evmRecipient]);

  const evmProvider = useMemo(() => (wallet.walletProvider ? new ethers.BrowserProvider(wallet.walletProvider, "any") : null), [wallet.walletProvider]);
  const onSrcChain = wallet.chainId === srcChainId;

  const refreshEvm = useCallback(async () => {
    if (!address || !evmProvider || !ethers.isAddress(srcTokenAddr) || !srcInfo) return null;
    const erc = new ethers.Contract(srcTokenAddr, ERC20, evmProvider);
    const gw = srcInfo.walletContract.address;
    const [bal, native, allowance, b] = await Promise.all([
      onSrcChain ? erc.balanceOf(address) : Promise.resolve(null),
      onSrcChain ? evmProvider.getBalance(address) : Promise.resolve(null),
      onSrcChain ? erc.allowance(address, gw) : Promise.resolve(null),
      api("POST", "/balances", { token, sources: [{ domain: srcDomain, depositor: address }] }),
    ]);
    const s = { bal, native, allowance, gwBal: dec(b.balances?.[0]?.balance), pending: dec(b.balances?.[0]?.pendingBatch) };
    setEvmState(s);
    return s;
  }, [address, evmProvider, srcTokenAddr, srcInfo, onSrcChain, token, srcDomain]);
  useEffect(() => { refreshEvm().catch((e) => say(`balance read failed: ${e.message}`)); }, [refreshEvm, say]);

  // Solana recipient → ATA of the destination mint
  const solConn = useMemo(() => null, []);
  const resolveSol = useCallback(async () => {
    if (!dstIsSolana) { setSolState(null); return null; }
    const { Connection, PublicKey } = await import("@solana/web3.js");
    const conn = new Connection(SOL_RPC, "confirmed");
    try {
      const recipient = new PublicKey(solRecipient.trim());
      const mint = new PublicKey(dstTokenAddr);
      const [ata] = PublicKey.findProgramAddressSync([recipient.toBytes(), new PublicKey(TOKEN_PROGRAM).toBytes(), mint.toBytes()], new PublicKey(ATA_PROGRAM));
      const acc = await conn.getParsedAccountInfo(ata);
      const s = { recipient: recipient.toBase58(), ata: ata.toBase58(), exists: !!acc.value, balance: acc.value?.data?.parsed?.info?.tokenAmount?.uiAmountString ?? null };
      setSolState(s);
      return s;
    } catch (e) {
      setSolState({ error: e.message });
      return null;
    }
  }, [dstIsSolana, solRecipient, dstTokenAddr]);
  useEffect(() => { if (solRecipient.trim()) resolveSol(); else setSolState(null); }, [resolveSol, solRecipient]);
  void solConn;

  const connectPhantom = async () => {
    try {
      const p = window.phantom?.solana || window.solana;
      if (!p?.isPhantom) throw new Error("Phantom not found");
      const r = await p.connect();
      setSolRecipient(r.publicKey.toBase58());
    } catch (e) { setAlert({ type: "error", message: e.message }); }
  };
  const createAta = async () => {
    try {
      const p = window.phantom?.solana || window.solana;
      if (!p?.isPhantom) throw new Error("Phantom is needed to create the token account");
      const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } = await import("@solana/web3.js");
      const conn = new Connection(SOL_RPC, "confirmed");
      const { publicKey: payer } = await p.connect();
      const ix = new TransactionInstruction({
        programId: new PublicKey(ATA_PROGRAM), data: new Uint8Array([1]) /* createIdempotent */,
        keys: [
          { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: new PublicKey(solState.ata), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(solState.recipient), isSigner: false, isWritable: false }, { pubkey: new PublicKey(dstTokenAddr), isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: new PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
        ],
      });
      const tx = new Transaction().add(ix);
      tx.feePayer = payer;
      tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
      const { signature } = await p.signAndSendTransaction(tx);
      say(`create token account: ${signature}`);
      await conn.confirmTransaction(signature, "confirmed");
      await resolveSol();
    } catch (e) { setAlert({ type: "error", message: e.message }); }
  };

  // ── spec / estimate ────────────────────────────────────────────────────────
  const recipient32 = () => {
    if (dstIsSolana) {
      if (!solState?.ata) throw new Error("Enter the Solana recipient first");
      return "0x" + Array.from(bs58decode(solState.ata), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    if (!ethers.isAddress(evmRecipient)) throw new Error("Enter a valid EVM recipient");
    return b32Evm(evmRecipient);
  };
  const dstToken32 = () => (dstIsSolana
    ? "0x" + Array.from(bs58decode(dstTokenAddr), (b) => b.toString(16).padStart(2, "0")).join("")
    : b32Evm(dstTokenAddr));
  const dstContract32 = () => (dstIsSolana
    ? "0x" + Array.from(bs58decode(dstInfo.minterContract.address), (b) => b.toString(16).padStart(2, "0")).join("")
    : b32Evm(dstInfo.minterContract.address));
  const amountRaw = () => { const v = amount.trim(); if (!v || isNaN(+v) || +v <= 0) throw new Error("Invalid amount"); return ethers.parseUnits(v, DEC); };
  const buildSpec = (value) => ({
    version: 1, sourceDomain: srcDomain, destinationDomain: dstDomain,
    sourceContract: b32Evm(srcInfo.walletContract.address), destinationContract: dstContract32(),
    sourceToken: b32Evm(srcTokenAddr), destinationToken: dstToken32(),
    sourceDepositor: b32Evm(address), destinationRecipient: recipient32(), sourceSigner: b32Evm(address), destinationCaller: ZERO32,
    value: value.toString(), salt: ethers.hexlify(ethers.randomBytes(32)), hookData: "0x",
  });

  const estimate = async () => {
    if (!address) throw new Error("Connect the EVM wallet first");
    if (!srcInfo || !dstInfo) throw new Error("Gateway does not list this route for " + token);
    const value = amountRaw();
    const r = await api("POST", "/estimate?enableForwarder=true", [{ spec: buildSpec(value) }]);
    const e = (r.body || r)[0];
    const fees = r.fees || {};
    const next = { value, maxFee: (BigInt(e.burnIntent.maxFee) * 11n) / 10n, rawFee: BigInt(e.burnIntent.maxFee), maxBlockHeight: e.burnIntent.maxBlockHeight, fees };
    setEst(next);
    say(`estimate: total fee ${fees.total ?? fmt(next.rawFee)} ${token} for ${fmt(value)} ${token}`);
    return next;
  };

  // ── bridge ─────────────────────────────────────────────────────────────────
  const bridge = async (withDeposit) => {
    setBusy(true); setAlert(null); setResult(null);
    try {
      if (!onSrcChain) { await switchChain(srcChainId); await sleep(500); }
      const e = await estimate(); // fresh salt / fee / block height
      let { value, maxFee } = e;
      let s = await refreshEvm();
      let gwBal = s?.gwBal ?? 0n;
      if (gwBal >= value + e.rawFee && gwBal < value + maxFee) { maxFee = gwBal - value; say(`balance just covers it: maxFee ${fmt(maxFee)} (no buffer)`); }
      const need = value + maxFee;
      if (withDeposit && gwBal < need) {
        const dep = need - gwBal;
        const erc = new ethers.Contract(srcTokenAddr, ERC20, signer);
        if ((s?.bal ?? 0n) < dep) throw new Error(`Need ${fmt(dep)} ${token} on ${CHAIN_NAMES[srcChainId]}, have ${fmt(s?.bal ?? 0n)}`);
        const gwAddr = srcInfo.walletContract.address;
        if ((s?.allowance ?? 0n) < dep) { const t = await erc.approve(gwAddr, dep); say(`approve ${t.hash}`); await t.wait(); }
        const gw = new ethers.Contract(gwAddr, ["function deposit(address token, uint256 value)"], signer);
        const t = await gw.deposit(srcTokenAddr, dep);
        say(`deposit ${fmt(dep)} ${token}: ${EXPLORER_TX[srcChainId] || ""}${t.hash}`);
        await t.wait();
        say("waiting for Gateway to credit the deposit (source finality)…");
        for (let i = 0; i < 120 && gwBal < need; i++) {
          await sleep(5000);
          s = await refreshEvm(); gwBal = s?.gwBal ?? gwBal;
          if (i % 6 === 5) say(`  gateway balance ${fmt(gwBal)} / ${fmt(need)}`);
        }
        if (gwBal < need) throw new Error("Gateway has not credited the deposit after 10 min — retry later with \"Sign + mint only\"");
      } else if (gwBal < need) throw new Error(`Gateway balance ${fmt(gwBal)} < ${fmt(need)} (amount + maxFee)`);

      const spec = buildSpec(value);
      const burnIntent = { maxBlockHeight: String(e.maxBlockHeight), maxFee: maxFee.toString(), spec };
      say("sign the burn intent in your wallet…");
      const signature = await signer.signTypedData({ name: "GatewayWallet", version: "1" }, TYPES, burnIntent);
      const res = await api("POST", "/transfer?enableForwarder=true", [{ burnIntent, signature }]);
      const transferId = res.transferId || res[0]?.transferId;
      if (!transferId) throw new Error("API returned no transferId: " + JSON.stringify(res).slice(0, 200));
      say(`submitted, transferId ${transferId}`);
      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        const st = await api("GET", "/transfer/" + transferId);
        if (["finalized", "confirmed"].includes(st.status)) {
          say("✓ minted on the destination");
          setResult({ status: st.status, tx: st.transactionHash, transferId });
          await refreshEvm();
          if (dstIsSolana) await resolveSol();
          return;
        }
        if (["failed", "expired"].includes(st.status)) throw new Error(`${st.status}: ${st.forwardingDetails?.failureReason || JSON.stringify(st).slice(0, 200)}`);
        if (i % 4 === 0) say(`  status ${st.status}`);
      }
      throw new Error("Still pending after 5 min; check transferId " + transferId);
    } catch (e) {
      const msg = e.shortMessage || e.message || String(e);
      say("✗ " + msg);
      setAlert({ type: "error", message: msg });
    } finally {
      setEst(null);
      setBusy(false);
    }
  };

  const ready = !!(signer && srcInfo && dstInfo && ethers.isAddress(srcTokenAddr) && (dstIsSolana ? solState?.exists : ethers.isAddress(evmRecipient) && ethers.isAddress(dstTokenAddr)));
  const input = "border-[1.5px] border-[var(--line-2)] bg-[var(--surface)] px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[var(--ink)] min-w-0";
  const select = "border-[1.5px] border-[var(--line-2)] bg-[var(--surface)] px-2 py-1.5 text-xs";

  return (
    <div className="flex items-start justify-center font-sans px-4 py-8">
      <div className="w-full max-w-[760px] flex flex-col gap-5">
        <div className="text-center flex flex-col items-center gap-2 pt-2">
          <h1 className="text-[24px] md:text-[32px] font-extrabold tracking-[0.08em] uppercase leading-tight text-gray-900">
            <span className="mark">Circle Gateway</span> · USDC &amp; EURC
          </h1>
          <p className="text-[12px] tracking-[0.14em] uppercase text-gray-500">
            1:1 native mint by Circle · no pools, no minter allowance to run dry · fee ≈ 0.1 token + 0.005%
          </p>
        </div>

        {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}
        {infoErr && <p className="text-xs text-[var(--down)]">Gateway API unreachable: {infoErr}</p>}

        {/* 1. source */}
        <section className="relative bg-white rounded-2xl p-5 space-y-3">
          <span className="tile-tab"><b>01</b>Send from</span>
          <div className="flex flex-wrap gap-2 items-center">
            <select className={select} value={token} onChange={(e) => setToken(e.target.value)}>
              {["USDC", "EURC"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className={select} value={srcDomain} onChange={(e) => setSrcDomain(Number(e.target.value))}>
              {domains.filter((d) => DOMAIN_CHAIN[d.domain]).map((d) => <option key={d.domain} value={d.domain}>{d.chain}</option>)}
            </select>
            {!address ? (
              <button type="button" onClick={() => connect("metamask")} className="btn-primary px-3 h-8 text-xs">Connect wallet</button>
            ) : (
              <span className="flex items-center gap-2 text-xs font-mono">
                {address.slice(0, 6)}…{address.slice(-4)}
                {!onSrcChain && <button type="button" onClick={() => switchChain(srcChainId)} className="btn-outline px-2 h-7 text-[11px]">Switch to {CHAIN_NAMES[srcChainId]}</button>}
                <button type="button" onClick={disconnect} className="p-1 rounded hover:bg-red-100" title="Disconnect"><LogOut className="w-4 h-4 text-red-500" /></button>
              </span>
            )}
          </div>
          <input className={input + " w-full"} value={srcTokenAddr} onChange={(e) => setSrcTokenAddr(e.target.value)} placeholder={`${token} contract on ${CHAIN_NAMES[srcChainId] || "source"}`} spellCheck={false} />
          {evmState && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <Row k={`${token} in wallet`} v={evmState.bal != null ? fmt(evmState.bal) : "switch chain to read"} />
              <Row k="Gas" v={evmState.native != null ? (+ethers.formatEther(evmState.native)).toFixed(4) : "—"} cls={evmState.native === 0n ? "text-[var(--down)]" : ""} />
              <Row k="Approved" v={evmState.allowance != null ? fmt(evmState.allowance) : "—"} />
              <Row k="Gateway balance (unused)" v={`${fmt(evmState.gwBal)}${evmState.pending > 0n ? ` (+${fmt(evmState.pending)} pending)` : ""}`} cls={evmState.gwBal > 0n ? "text-[var(--up)]" : ""} />
            </dl>
          )}
        </section>

        {/* 2. destination */}
        <section className="relative bg-white rounded-2xl p-5 space-y-3">
          <span className="tile-tab"><b>02</b>Receive on</span>
          <div className="flex flex-wrap gap-2 items-center">
            <select className={select} value={dstDomain} onChange={(e) => setDstDomain(Number(e.target.value))}>
              {domains.filter((d) => d.domain !== srcDomain && (d.domain === SOLANA_DOMAIN || DOMAIN_CHAIN[d.domain])).map((d) => <option key={d.domain} value={d.domain}>{d.chain}</option>)}
            </select>
            {dstIsSolana ? (
              <>
                <button type="button" onClick={connectPhantom} className="btn-outline px-3 h-8 text-xs">Phantom</button>
                <input className={input + " flex-1"} value={solRecipient} onChange={(e) => setSolRecipient(e.target.value)} placeholder="or paste the Solana wallet address" spellCheck={false} />
              </>
            ) : (
              <input className={input + " flex-1"} value={evmRecipient} onChange={(e) => setEvmRecipient(e.target.value)} placeholder="recipient address (defaults to your wallet)" spellCheck={false} />
            )}
          </div>
          <input className={input + " w-full"} value={dstTokenAddr} onChange={(e) => setDstTokenAddr(e.target.value)} placeholder={`${token} ${dstIsSolana ? "mint on Solana" : "contract on " + (CHAIN_NAMES[dstChainId] || "destination")}`} spellCheck={false} />
          {dstIsSolana && solState && (
            solState.error ? <p className="text-xs text-[var(--down)]">{solState.error}</p> : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <Row k="Token account" v={solState.ata} />
                <Row k="Status" v={solState.exists ? `exists · ${solState.balance} ${token}` : "MISSING — create it before bridging"} cls={solState.exists ? "text-[var(--up)]" : "text-[var(--down)] font-bold"} />
                {!solState.exists && <Row k="" v={<button type="button" onClick={createAta} className="btn-outline px-2 h-7 text-[11px]">Create token account (Phantom, ~0.002 SOL)</button>} />}
              </dl>
            )
          )}
          <p className="text-[11px] text-gray-500">Circle's forwarder mints on the destination for you; its fee is deducted from the Gateway balance, the recipient gets the full amount.</p>
        </section>

        {/* 3. amount + go */}
        <section className="relative bg-white rounded-2xl p-5 space-y-3">
          <span className="tile-tab"><b>03</b>Amount</span>
          <div className="flex flex-wrap gap-2 items-center">
            <input className={input + " w-36"} value={amount} onChange={(e) => { setAmount(e.target.value); setEst(null); }} inputMode="decimal" />
            <span className="text-xs">{token}</span>
            <button type="button" disabled={busy || !address} onClick={() => estimate().catch((e) => setAlert({ type: "error", message: e.message }))} className="btn-outline px-3 h-8 text-xs disabled:opacity-50">Estimate fee</button>
          </div>
          {est && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <Row k="Circle fee" v={`${est.fees.perIntent?.[0]?.baseFee ?? "?"} + ${est.fees.perIntent?.[0]?.transferFee ?? "?"} ${token}`} />
              <Row k="Forwarder fee" v={`${est.fees.forwardingFee ?? "?"} ${token}`} />
              <Row k="Total fee" v={`${est.fees.total ?? fmt(est.rawFee)} ${token}`} cls="text-[var(--warn)]" />
              <Row k="Signed maxFee" v={`${fmt(est.maxFee)} ${token} (10% buffer, unused part stays in the Gateway balance)`} />
              <Row k="Recipient gets" v={`${fmt(est.value)} ${token}`} cls="text-[var(--up)]" />
              <Row k="To deposit" v={`${fmt(est.value + est.maxFee > (evmState?.gwBal ?? 0n) ? est.value + est.maxFee - (evmState?.gwBal ?? 0n) : 0n)} ${token}`} />
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !ready} onClick={() => bridge(true)} className="btn-primary px-4 h-10 text-sm disabled:opacity-50">
              {busy ? "Working…" : "Deposit + sign + mint"}
            </button>
            <button type="button" disabled={busy || !ready} onClick={() => bridge(false)} className="btn-outline px-4 h-10 text-sm disabled:opacity-50" title="Use the Gateway balance already deposited">
              Sign + mint only
            </button>
          </div>
          {!ready && address && <p className="text-[11px] text-gray-500">{dstIsSolana && !solState?.exists ? "Recipient token account must exist first." : "Fill in the route and recipient."}</p>}
          {result && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <Row k="Status" v={result.status} cls="text-[var(--up)]" />
              <Row k="Destination tx" v={result.tx ? <a className="underline" target="_blank" rel="noreferrer" href={(dstIsSolana ? "https://solscan.io/tx/" : EXPLORER_TX[dstChainId] || "") + result.tx}>{result.tx}</a> : result.transferId} />
            </dl>
          )}
        </section>

        <section className="relative bg-white rounded-2xl p-5">
          <span className="tile-tab"><b>Log</b></span>
          <pre ref={logRef} className="mt-2 bg-[var(--ink)] text-gray-200 text-[11px] p-3 h-44 overflow-auto whitespace-pre-wrap">{log.join("\n")}</pre>
        </section>
      </div>
    </div>
  );
}

// base58 → bytes (Solana addresses); tiny, avoids pulling bs58 into this chunk
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58decode(s) {
  const bytes = [0];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error("bad base58");
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch !== "1") break; bytes.push(0); }
  return Uint8Array.from(bytes.reverse());
}
