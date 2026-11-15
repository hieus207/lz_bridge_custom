import { useState } from "react";
import { CHAINS } from "../lib/chains";
import { saveCustomChain, probeRpc, getCustomChain } from "../lib/customChains";
import { loadChainlist, searchChains, pickWorkingRpc } from "../lib/chainlist";

const input = "border border-gray-200 px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-gray-300 min-w-0 bg-white";

// Adds an EVM chain after verifying the RPC answers and reports the expected chain ID.
// "Find on Chainlist" fills the form from chainid.network and keeps the fastest public RPC that answers.
export default function CustomChainForm({ onAdded, onCancel }) {
  const [rpc, setRpc] = useState("");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [explorer, setExplorer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [chainlist, setChainlist] = useState(null);
  const [listMsg, setListMsg] = useState("");

  const onQuery = (v) => {
    setQuery(v);
    if (!chainlist && v.trim()) {
      setListMsg("Loading Chainlist…");
      loadChainlist().then((list) => { setChainlist(list); setListMsg(""); })
        .catch((e) => setListMsg(`Chainlist unavailable: ${e.message}`));
    }
  };

  const pick = async (c) => {
    setQuery("");
    setError(null);
    setId(String(c.chainId)); setName(c.name); setSymbol(c.symbol); setExplorer(c.explorer); setRpc("");
    setListMsg(`Testing ${Math.min(c.rpcs.length, 6)} public RPCs…`);
    try {
      setRpc(await pickWorkingRpc(c, probeRpc));
      setListMsg("");
    } catch {
      setListMsg("No public RPC from Chainlist answered: paste one");
    }
  };

  const submit = async () => {
    if (busy) return;
    const url = rpc.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError("RPC URL must start with http(s)://");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const detected = await probeRpc(url);
      const wanted = id.trim() ? parseInt(id, 10) : detected;
      if (wanted !== detected) throw new Error(`RPC is on chain ${detected}, not ${wanted}`);
      if (CHAINS[detected]) throw new Error(`Chain ${detected} is ${CHAINS[detected].name} — already built in, just select it`);
      const chain = {
        id: detected,
        name: name.trim() || `Chain ${detected}`,
        rpc: url,
        symbol: symbol.trim().toUpperCase() || "ETH",
        ...(explorer.trim() ? { explorer: explorer.trim() } : {}),
      };
      saveCustomChain(chain);
      onAdded?.(chain);
    } catch (err) {
      setError(`Cannot add chain: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const matches = chainlist ? searchChains(chainlist, query) : [];

  return (
    // Not a <form>: it is rendered inside the Scan page's form, and forms can't nest.
    <div
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
      className="mt-2 flex flex-col gap-1.5 bg-gray-50 border border-gray-200 rounded-xl p-2.5">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Add custom chain</p>
      <input className={input} placeholder="Find on Chainlist: name or chain ID (e.g. Linea / 59144)" value={query} onChange={(e) => onQuery(e.target.value)} />
      {matches.length > 0 && (
        <div className="flex flex-col border border-gray-200 rounded-lg bg-white overflow-hidden">
          {matches.map((c) => {
            const taken = CHAINS[c.chainId] ? "built in" : getCustomChain(c.chainId) ? "added" : null;
            return (
              <button key={c.chainId} type="button" disabled={!!taken} onClick={() => pick(c)}
                className="flex items-center gap-2 px-2 py-1 text-left text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                <span className="flex-1 truncate">{c.name}</span>
                {c.testnet && <span className="text-[10px] text-amber-600 uppercase">testnet</span>}
                {taken && <span className="text-[10px] text-gray-400 uppercase">{taken}</span>}
                <span className="text-[11px] text-gray-400 tabular-nums">#{c.chainId} · {c.symbol}</span>
              </button>
            );
          })}
        </div>
      )}
      {listMsg && <p className="text-[11px] text-gray-500">{listMsg}</p>}
      <input className={input + " font-mono"} placeholder="RPC URL (required)" value={rpc} onChange={(e) => setRpc(e.target.value)} />
      <div className="flex gap-1.5">
        <input className={input + " w-24"} type="number" placeholder="Chain ID (auto)" value={id} onChange={(e) => setId(e.target.value)} />
        <input className={input + " flex-1"} placeholder="Name (e.g. Sonic)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={input + " w-16"} placeholder="ETH" value={symbol} onChange={(e) => setSymbol(e.target.value)} title="Native currency symbol" />
      </div>
      <input className={input} placeholder="Explorer URL (optional)" value={explorer} onChange={(e) => setExplorer(e.target.value)} />
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="flex-1 py-1.5 bg-gray-800 text-white rounded-lg text-xs hover:bg-gray-700 transition disabled:opacity-60 disabled:cursor-wait"
        >
          {busy ? "Checking RPC…" : "Save chain"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-white transition">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
