import { useState } from "react";
import { CHAINS } from "../lib/chains";
import { saveCustomChain, probeRpc } from "../lib/customChains";

const input = "border border-gray-200 px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-gray-300 min-w-0 bg-white";

// Adds an EVM chain after verifying the RPC answers and reports the expected chain ID.
export default function CustomChainForm({ onAdded, onCancel }) {
  const [rpc, setRpc] = useState("");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [explorer, setExplorer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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

  return (
    // Not a <form>: it is rendered inside the Scan page's form, and forms can't nest.
    <div
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
      className="mt-2 flex flex-col gap-1.5 bg-gray-50 border border-gray-200 rounded-xl p-2.5">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Add custom chain</p>
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
