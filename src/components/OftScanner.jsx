import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { discoverHolders } from "../lib/holders";
import { probeContracts, classify } from "../lib/onchain";

// OKLink proxy is optional now: holder discovery falls back to public APIs and
// on-chain log scanning when it is down or not running.
const OKLINK_PROXY = process.env.REACT_APP_OKLINK_PROXY ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3001" : "");

const lc = (a) => a.toLowerCase();

const OftScanner = ({ show, onClose, onSelect, chainId, provider: externalProvider, chainRpcs, initialToken }) => {
  const [tokenAddress, setTokenAddress] = useState("");
  const [status, setStatus] = useState(null); // null | "scanning" | "done" | "error"
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState([]);

  // Auto-fill + auto-scan when opened with an initialToken
  useEffect(() => {
    if (!show) return;
    if (initialToken && ethers.isAddress(initialToken)) {
      setTokenAddress(initialToken);
      setStatus(null);
      setProgress("");
      setResults([]);
      setTimeout(() => scan(initialToken), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, initialToken]);

  if (!show) return null;

  const getProvider = () => {
    if (externalProvider) return externalProvider;
    const rpcs = chainRpcs?.[chainId];
    if (rpcs?.length) return new ethers.JsonRpcProvider(rpcs[0]);
    return null;
  };

  const toResult = (f, probe, extra = {}) => ({
    address: f.address,
    percentage: extra.pct ?? null,
    linkedToken: probe?.token || null,
    isTokenMatch: f.confidence === "high",
    endpoint: probe?.endpoint || null,
    version: probe?.oftVersion ? `${probe.oftVersion[0]} v${probe.oftVersion[1]}` : null,
    ...extra,
  });

  const scan = async (overrideAddr) => {
    const addr = (overrideAddr || tokenAddress).trim();
    if (!ethers.isAddress(addr)) return;
    if (!chainId) return;

    setStatus("scanning");
    setResults([]);
    setProgress("Checking if token itself is OFT...");

    try {
      const p = getProvider();
      if (!p) throw new Error("No RPC available");

      // ── Step 0: is the token contract itself an OFT? ──
      const self = await probeContracts(p, [addr]);
      const selfProbe = self.get(lc(addr));
      const selfLz = classify(addr, selfProbe, addr, { chainId }).filter((f) => f.protocol === "LayerZero");
      if (selfLz.length) {
        setResults([toResult(selfLz[0], selfProbe, { isSelf: true, isTokenMatch: true })]);
        setStatus("done");
        setProgress("Token contract itself is an OFT!");
        return;
      }

      // ── Step 1: holders (API → OKLink → on-chain logs) ──
      const { holders, source, attempts } = await discoverHolders({
        provider: p,
        chainId,
        token: addr,
        proxyBase: OKLINK_PROXY,
        fallbackRpcs: (chainRpcs?.[chainId] || []).filter((u) => u !== p._getConnection?.().url),
        onProgress: setProgress,
      });
      if (!holders.length) {
        setStatus("done");
        setProgress(`No holders found (${attempts.map((a) => `${a.source}: ${a.error}`).join("; ")})`);
        return;
      }

      // ── Step 2: fingerprint every holder in one batched pass ──
      setProgress(`Got ${holders.length} addresses via ${source}, checking OFT interface...`);
      const probes = await probeContracts(p, holders.map((h) => h.address));
      const found = [];
      for (const h of holders) {
        const probe = probes.get(lc(h.address));
        for (const f of classify(h.address, probe, addr, { chainId, holder: h })) {
          if (f.protocol === "LayerZero") found.push(toResult(f, probe, { pct: h.pct }));
        }
      }
      found.sort((a, b) => Number(b.isTokenMatch) - Number(a.isTokenMatch));

      setResults(found);
      setStatus("done");
      setProgress(found.length === 0
        ? `No OFT contracts found among ${holders.length} addresses (via ${source})`
        : `Found ${found.length} OFT contract(s) via ${source}!`
      );
    } catch (err) {
      console.error("OFT scan error:", err);
      setStatus("error");
      setProgress(err.message || "Scan failed");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-bold text-gray-900">OFT Scanner</h3>
            <p className="text-xs text-gray-400 mt-0.5">Find OFT contract from token holders</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Token address input */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Token contract address (ERC-20)</label>
            <input
              type="text"
              value={tokenAddress}
              onChange={e => setTokenAddress(e.target.value)}
              placeholder="0x..."
              className="w-full border border-gray-200 px-3 py-2 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-300"
            />
          </div>

          {/* Info */}
          <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
            Takes the top 50 <strong>contract</strong> holders by balance (explorer APIs, OKLink, or on-chain logs as fallback), then checks each for the OFT interface.
          </div>

          {/* Scan button */}
          <button
            onClick={() => scan()}
            disabled={status === "scanning" || !ethers.isAddress(tokenAddress.trim())}
            className={`w-full py-2.5 font-semibold rounded-xl transition text-sm ${
              status === "scanning"
                ? "bg-gray-200 text-gray-500 cursor-wait"
                : !ethers.isAddress(tokenAddress.trim())
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-gray-900 text-white hover:bg-gray-800"
            }`}
          >
            {status === "scanning" ? "Scanning..." : "Scan for OFT"}
          </button>

          {/* Progress */}
          {progress && (
            <div className="flex items-center gap-2">
              {status === "scanning" && (
                <svg className="animate-spin w-4 h-4 text-gray-400 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              )}
              <p className={`text-xs ${status === "error" ? "text-red-500" : status === "done" && results.length > 0 ? "text-green-600 font-medium" : "text-gray-500"}`}>
                {progress}
              </p>
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-gray-600">Found OFT contracts:</p>
              {results.map((r, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    onSelect(r.address);
                    onClose();
                  }}
                  className={`flex flex-col gap-1.5 px-4 py-3 rounded-xl border cursor-pointer transition group ${
                    r.isTokenMatch
                      ? "bg-green-50 border-green-200 hover:bg-green-100"
                      : "bg-gray-50 border-gray-200 hover:bg-blue-50 hover:border-blue-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-800 truncate">{r.address}</span>
                    {r.isTokenMatch && (
                      <span className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2">
                        ✓ Token match
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    {r.isSelf
                      ? <span className="italic">This token is the OFT contract</span>
                      : <span>Holds: {r.percentage != null ? `${r.percentage.toFixed(2)}% of supply` : "?"}</span>
                    }
                    {r.endpoint && <span>Endpoint: {r.endpoint.slice(0, 8)}...</span>}
                    {r.version && <span>Ver: {r.version}</span>}
                  </div>
                  {r.linkedToken && (
                    <div className="text-[10px] text-gray-400">
                      token() → {r.linkedToken}
                    </div>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-gray-400 text-center mt-1">Click a result to use it as OFT contract</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OftScanner;
