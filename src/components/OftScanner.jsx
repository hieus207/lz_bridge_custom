import { useState, useEffect } from "react";
import { ethers } from "ethers";

// OKLink chain slugs (matches oklink.com/<slug>)
const OKLINK_CHAINS = {
  1:     "eth",
  56:    "bsc",
  137:   "polygon",
  43114: "avax-c",
  42161: "arbitrum-one",
  10:    "optimism",
  8453:  "base",
};

// Proxy server URL — run `node oklink-proxy.mjs` alongside the dev server
// Change to your deployed URL in production
const OKLINK_PROXY = process.env.REACT_APP_OKLINK_PROXY || "http://localhost:3001";

const OFT_CHECK_ABI = [
  "function token() view returns (address)",
  "function endpoint() view returns (address)",
  "function oftVersion() view returns (bytes4 interfaceId, uint64 version)",
];

const ERC20_ABI = [
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

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

  const oklinkChain = OKLINK_CHAINS[chainId];

  const getProvider = () => {
    if (externalProvider) return externalProvider;
    const rpcs = chainRpcs?.[chainId];
    if (rpcs?.length) return new ethers.JsonRpcProvider(rpcs[0]);
    return null;
  };

  const checkCandidatesForOFT = async (candidates, p, targetToken) => {
    if (candidates.length === 0) {
      setStatus("done");
      setProgress("No contract holders found in range");
      return;
    }

    const CONCURRENCY = 8;
    const found = [];
    let checked = 0;

    const checkOne = async (c) => {
      try {
        const contract = new ethers.Contract(c.address, OFT_CHECK_ABI, p);

        let linkedToken = null;
        let isMatch = false;
        try {
          linkedToken = await contract.token();
          isMatch = linkedToken.toLowerCase() === targetToken.toLowerCase();
        } catch { /* OFT may not have token() */ }

        const [endpointAddr, versionRaw] = await Promise.all([
          contract.endpoint().catch(() => null),
          contract.oftVersion().catch(() => null),
        ]);
        const version = versionRaw ? versionRaw.toString() : null;

        if (!endpointAddr && !version) return null;

        return {
          address: c.address,
          balance: c.balance,
          percentage: c.percentage,
          decimals: c.decimals,
          linkedToken,
          isTokenMatch: isMatch,
          endpoint: endpointAddr,
          version,
        };
      } catch {
        return null;
      }
    };

    // Run in concurrent batches
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      setProgress(`Checking OFT ${i + 1}–${Math.min(i + CONCURRENCY, candidates.length)}/${candidates.length}...`);
      const results = await Promise.all(batch.map(checkOne));
      for (const r of results) {
        if (r) found.push(r);
      }
      checked += batch.length;
    }

    setResults(found);
    setStatus("done");
    setProgress(found.length === 0
      ? "No OFT contracts found among top holders"
      : `Found ${found.length} OFT contract(s)!`
    );
  };

  const scanViaTransfers = async (p, tokenAddr) => {
    setProgress("Holder API unavailable, scanning transfer events...");

    const tokenContract = new ethers.Contract(tokenAddr, ERC20_ABI, p);

    let totalSupply, decimals;
    try {
      [totalSupply, decimals] = await Promise.all([
        tokenContract.totalSupply(),
        tokenContract.decimals(),
      ]);
    } catch {
      throw new Error("Cannot read token supply. Is this a valid ERC-20?");
    }

    const transferTopic = ethers.id("Transfer(address,address,uint256)");
    const latestBlock = await p.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 100000);

    setProgress("Fetching transfer logs (last ~100k blocks)...");
    const logs = await p.getLogs({
      address: tokenAddr,
      topics: [transferTopic],
      fromBlock,
      toBlock: latestBlock,
    });

    const addressSet = new Set();
    for (const log of logs) {
      if (log.topics[2]) {
        const addr = "0x" + log.topics[2].slice(26);
        if (addr !== "0x0000000000000000000000000000000000000000") {
          addressSet.add(ethers.getAddress(addr));
        }
      }
    }

    setProgress(`Found ${addressSet.size} addresses, checking balances & contracts...`);

    const candidates = [];
    const addresses = Array.from(addressSet);

    // Parallel getCode + balanceOf in batches of 10
    for (let i = 0; i < addresses.length; i += 10) {
      const batch = addresses.slice(i, i + 10);
      setProgress(`Checking ${Math.min(i + 10, addresses.length)}/${addresses.length} addresses...`);

      const batchResults = await Promise.all(
        batch.map(async (addr) => {
          const [code, bal] = await Promise.all([
            p.getCode(addr),
            tokenContract.balanceOf(addr),
          ]);
          if (code === "0x") return null;
          const pct = Number(bal * ethers.toBigInt(10000) / totalSupply) / 100;
          if (pct < 0.2 || pct > 15) return null;
          return { address: addr, balance: bal, percentage: pct, decimals: Number(decimals) };
        })
      );

      for (const r of batchResults) {
        if (r) candidates.push(r);
      }
    }

    setProgress(`Found ${candidates.length} contract holders, checking OFT...`);
    await checkCandidatesForOFT(candidates, p, tokenAddr);
  };

  const scan = async (overrideAddr) => {
    const addr = (overrideAddr || tokenAddress).trim();
    if (!ethers.isAddress(addr)) return;
    if (!chainId || chainId === "custom") return;
    if (!oklinkChain) return;

    setStatus("scanning");
    setResults([]);
    setProgress("Checking if token itself is OFT...");

    try {
      const p = getProvider();
      if (!p) throw new Error("No RPC available");

      // ── Step 0: check if the token contract itself is an OFT ──────────────
      try {
        const selfContract = new ethers.Contract(addr, OFT_CHECK_ABI, p);
        const [endpointAddr, versionRaw] = await Promise.all([
          selfContract.endpoint().catch(() => null),
          selfContract.oftVersion().catch(() => null),
        ]);
        const version = versionRaw ? versionRaw.toString() : null;

        if (endpointAddr || version) {
          let linkedToken = null;
          let isMatch = false;
          try {
            linkedToken = await selfContract.token();
            isMatch = linkedToken.toLowerCase() === addr.toLowerCase();
          } catch { isMatch = true; /* token IS the OFT */ }

          setResults([{
            address: addr,
            balance: "—",
            percentage: 100,
            decimals: -1,
            linkedToken,
            isTokenMatch: isMatch,
            endpoint: endpointAddr,
            version,
            isSelf: true,
          }]);
          setStatus("done");
          setProgress("Token contract itself is an OFT!");
          return;
        }
      } catch { /* not OFT, continue to holder scan */ }

      // ── Step 1: scan top holders via OKLink ───────────────────────────────
      setProgress("Fetching top holders via OKLink...");

      const proxyUrl = `${OKLINK_PROXY}/api/holders/${oklinkChain}/${addr}?offset=0&limit=50&sort=value%2Cdesc`;
      const resp = await fetch(proxyUrl);
      if (!resp.ok) throw new Error(`Proxy error: ${resp.status}`);
      const json = await resp.json();

      const code = json.code;
      const ok   = code === 0 || code === "0";

      if (!ok) {
        console.warn("OKLink API failed:", json);
        await scanViaTransfers(p, addr);
        return;
      }

      const d       = json.data || {};
      const rawList = d.hits || d.holderList || [];

      if (rawList.length === 0) {
        await scanViaTransfers(p, addr);
        return;
      }

      setProgress(`Got ${rawList.length} holders from OKLink, filtering...`);

      // rate is 0-1 fraction → pct = rate * 100
      const holders = rawList
        .filter(h => {
          const pct = parseFloat(h.rate ?? 0) * 100;
          return pct >= 0.2 && pct <= 15;
        })
        .map(h => ({
          address:    ethers.getAddress(h.holderAddress),
          balance:    h.value,
          percentage: parseFloat(h.rate ?? 0) * 100,
          decimals:   -1,
        }));

      setProgress(`Found ${holders.length} holders in 0.2%-15% range, checking contracts...`);

      // Check getCode for all holders concurrently (batches of 10)
      const contractHolders = [];
      for (let i = 0; i < holders.length; i += 10) {
        const batch = holders.slice(i, i + 10);
        const codeResults = await Promise.all(
          batch.map(async (c) => {
            const code = await p.getCode(c.address);
            return code !== "0x" ? c : null;
          })
        );
        for (const r of codeResults) {
          if (r) contractHolders.push(r);
        }
      }

      setProgress(`Found ${contractHolders.length} contract holders, checking OFT...`);
      await checkCandidatesForOFT(contractHolders, p, addr);

    } catch (err) {
      console.error("OFT scan error:", err);
      setStatus("error");
      setProgress(err.message || "Scan failed");
    }
  };

  const formatBalance = (bal, dec) => {
    try {
      // dec === -1 → balance is already a human-readable float (from OKLink)
      const num = dec === -1 ? Number(bal) : parseFloat(ethers.formatUnits(bal, dec));
      if (num > 1e6) return (num / 1e6).toFixed(2) + "M";
      if (num > 1e3) return (num / 1e3).toFixed(2) + "K";
      return num.toFixed(2);
    } catch {
      return "?";
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
            Scans top holders (0.2%–15% supply) that are <strong>contracts</strong>, then checks each for OFT interface (OKLink API + RPC).{!oklinkChain && <span className="text-orange-500 ml-1">⚠ Chain not supported yet.</span>}
          </div>

          {/* Scan button */}
          <button
            onClick={scan}
            disabled={status === "scanning" || !ethers.isAddress(tokenAddress.trim()) || !oklinkChain}
            className={`w-full py-2.5 font-semibold rounded-xl transition text-sm ${
              status === "scanning"
                ? "bg-gray-200 text-gray-500 cursor-wait"
                : !oklinkChain
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
                      : <span>Holds: {formatBalance(r.balance, r.decimals)} ({r.percentage.toFixed(2)}%)</span>
                    }
                    {r.endpoint && <span>Endpoint: {r.endpoint.slice(0, 8)}...</span>}
                    {r.version && <span>Ver: {r.version}</span>}
                  </div>
                  <div className="text-[10px] text-gray-400">
                    token() → {r.linkedToken}
                  </div>
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
