import { useState } from "react";
import { ethers } from "ethers";

// Explorer API config per chain (Etherscan-compatible APIs)
const EXPLORER_APIS = {
  1: { url: "https://api.etherscan.io/api", name: "Etherscan" },
  56: { url: "https://api.bscscan.com/api", name: "BSCScan" },
  137: { url: "https://api.polygonscan.com/api", name: "Polygonscan" },
  43114: { url: "https://api.snowtrace.io/api", name: "Snowtrace" },
  42161: { url: "https://api.arbiscan.io/api", name: "Arbiscan" },
  10: { url: "https://api-optimistic.etherscan.io/api", name: "Optimism Etherscan" },
  8453: { url: "https://api.basescan.org/api", name: "Basescan" },
};

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

const OftScanner = ({ show, onClose, onSelect, chainId, provider: externalProvider, chainRpcs }) => {
  const [tokenAddress, setTokenAddress] = useState("");
  const [status, setStatus] = useState(null); // null | "scanning" | "done" | "error"
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState([]);
  const [apiKey, setApiKey] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lz_explorer_keys") || "{}"); } catch { return {}; }
  });
  const [showApiKey, setShowApiKey] = useState(false);

  if (!show) return null;

  const explorer = EXPLORER_APIS[chainId];

  const getProvider = () => {
    if (externalProvider) return externalProvider;
    const rpcs = chainRpcs?.[chainId];
    if (rpcs?.length) return new ethers.JsonRpcProvider(rpcs[0]);
    return null;
  };

  const checkCandidatesForOFT = async (candidates, p, targetToken) => {
    if (candidates.length === 0) {
      setStatus("done");
      setProgress("No contract holders found in 0.2%-15% range");
      return;
    }

    const found = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      setProgress(`Checking OFT ${i + 1}/${candidates.length}: ${c.address.slice(0, 10)}...`);

      try {
        const contract = new ethers.Contract(c.address, OFT_CHECK_ABI, p);

        let linkedToken;
        try {
          linkedToken = await contract.token();
        } catch {
          continue;
        }

        const isMatch = linkedToken.toLowerCase() === targetToken.toLowerCase();

        let endpointAddr = null;
        let version = null;
        try { endpointAddr = await contract.endpoint(); } catch {}
        try {
          const v = await contract.oftVersion();
          version = v.toString();
        } catch {}

        found.push({
          address: c.address,
          balance: c.balance,
          percentage: c.percentage,
          decimals: c.decimals,
          linkedToken,
          isTokenMatch: isMatch,
          endpoint: endpointAddr,
          version,
        });
      } catch {
        // Not OFT
      }
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

    for (let i = 0; i < addresses.length; i += 10) {
      const batch = addresses.slice(i, i + 10);
      setProgress(`Checking ${Math.min(i + 10, addresses.length)}/${addresses.length} addresses...`);

      const batchResults = await Promise.allSettled(
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
        if (r.status === "fulfilled" && r.value) candidates.push(r.value);
      }
    }

    setProgress(`Found ${candidates.length} contract holders, checking OFT...`);
    await checkCandidatesForOFT(candidates, p, tokenAddr);
  };

  const scan = async () => {
    const addr = tokenAddress.trim();
    if (!ethers.isAddress(addr)) return;
    if (!chainId || chainId === "custom") return;
    if (!explorer) return;

    setStatus("scanning");
    setResults([]);
    setProgress("Fetching top holders...");

    try {
      const p = getProvider();
      if (!p) throw new Error("No RPC available");

      const key = apiKey[chainId] || "";
      const keyParam = key ? `&apikey=${encodeURIComponent(key)}` : "";
      const holdersUrl = `${explorer.url}?module=token&action=tokenholderlist&contractaddress=${encodeURIComponent(addr)}&page=1&offset=50${keyParam}`;

      const resp = await fetch(holdersUrl);
      const data = await resp.json();

      if (data.status !== "1" || !Array.isArray(data.result) || data.result.length === 0) {
        await scanViaTransfers(p, addr);
        return;
      }

      setProgress(`Got ${data.result.length} holders, filtering...`);

      const tokenContract = new ethers.Contract(addr, ERC20_ABI, p);
      let totalSupply, decimals;
      try {
        [totalSupply, decimals] = await Promise.all([
          tokenContract.totalSupply(),
          tokenContract.decimals(),
        ]);
      } catch {
        totalSupply = null;
        decimals = 18;
      }

      const holders = [];
      for (const h of data.result) {
        const holderAddr = ethers.getAddress(h.TokenHolderAddress);
        const qty = ethers.toBigInt(h.TokenHolderQuantity);
        let pct = 0;
        if (totalSupply) {
          pct = Number(qty * ethers.toBigInt(10000) / totalSupply) / 100;
        }
        if (pct < 0.2 || pct > 15) continue;
        holders.push({ address: holderAddr, balance: qty, percentage: pct, decimals: Number(decimals) });
      }

      setProgress(`Found ${holders.length} holders in range, checking contracts...`);

      const contractHolders = [];
      for (let i = 0; i < holders.length; i += 5) {
        const batch = holders.slice(i, i + 5);
        const codeResults = await Promise.allSettled(
          batch.map(async (c) => {
            const code = await p.getCode(c.address);
            return code !== "0x" ? c : null;
          })
        );
        for (const r of codeResults) {
          if (r.status === "fulfilled" && r.value) contractHolders.push(r.value);
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
      const str = ethers.formatUnits(bal, dec);
      const num = parseFloat(str);
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

          {/* API Key toggle */}
          <div>
            <button
              onClick={() => setShowApiKey(!showApiKey)}
              className="text-xs text-gray-400 hover:text-gray-600 transition flex items-center gap-1"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
              Explorer API Key {showApiKey ? "▲" : "▼"}
            </button>
            {showApiKey && (
              <div className="mt-2 flex gap-1.5">
                <input
                  type="text"
                  value={apiKey[chainId] || ""}
                  onChange={e => {
                    const updated = { ...apiKey, [chainId]: e.target.value };
                    setApiKey(updated);
                    localStorage.setItem("lz_explorer_keys", JSON.stringify(updated));
                  }}
                  placeholder={`${explorer?.name || "Explorer"} API key (optional, increases rate limit)`}
                  className="flex-1 border border-gray-200 px-2.5 py-1.5 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
            Scans top holders (0.2% - 15% supply) that are <strong>contracts</strong>, then checks each for OFT interface ({explorer?.name || "Explorer API"} + RPC).
          </div>

          {/* Scan button */}
          <button
            onClick={scan}
            disabled={status === "scanning" || !ethers.isAddress(tokenAddress.trim()) || !explorer}
            className={`w-full py-2.5 font-semibold rounded-xl transition text-sm ${
              status === "scanning"
                ? "bg-gray-200 text-gray-500 cursor-wait"
                : !explorer
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
                    <span>Holds: {formatBalance(r.balance, r.decimals)} ({r.percentage.toFixed(2)}%)</span>
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
