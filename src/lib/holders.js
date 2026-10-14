// Holder / counterparty discovery for a token, with layered sources:
//   1. Documented public APIs (Blockscout, Routescan) where available
//   2. OKLink through our proxy (broad coverage, but undocumented → may break)
//   3. On-chain Transfer/Approval log scan (works on any chain, no third party)
// The first source that returns data wins; failures are recorded, not fatal.
// Whatever the source, the result is the same: the top contracts by on-chain
// balance (no % thresholds — a lock adapter can hold anything from 0.01% to 90%).
import { ethers } from "ethers";
import { CHAINS } from "./chains";
import { fetchJson } from "./http";
import { multicall, makeProvider, ERC20 } from "./onchain";

export const TOP_CONTRACTS = 50;

const TRANSFER = ethers.id("Transfer(address,address,uint256)");
const APPROVAL = ethers.id("Approval(address,address,uint256)");
const IGNORE = new Set([
  ethers.ZeroAddress.toLowerCase(),
  "0x000000000000000000000000000000000000dead",
]);

const topicToAddress = (t) => (t && t.length === 66 ? ethers.getAddress("0x" + t.slice(26)) : null);

// Two pages (100 holders) so EOAs among the top don't crowd out contracts.
async function fromBlockscout(base, token) {
  const out = [];
  let query = "";
  for (let page = 0; page < 2; page++) {
    const json = await fetchJson(`${base}/api/v2/tokens/${token}/holders${query}`);
    for (const h of json.items || []) {
      out.push({
        address: h.address?.hash,
        balance: h.value != null ? ethers.toBigInt(h.value) : null,
        isContract: h.address?.is_contract,
      });
    }
    if (!json.next_page_params) break;
    query = "?" + new URLSearchParams(json.next_page_params).toString();
  }
  return out;
}

async function fromRoutescan(chainId, token) {
  const json = await fetchJson(
    `https://api.routescan.io/v2/network/mainnet/evm/${chainId}/erc20/${token}/holders?limit=100`
  );
  return (json.items || []).map((h) => ({
    address: h.address,
    balance: h.balance != null ? ethers.toBigInt(h.balance) : null,
  }));
}

async function fromOklink(proxyBase, slug, token) {
  const json = await fetchJson(
    `${proxyBase}/api/holders/${slug}/${token}?offset=0&limit=100&sort=value%2Cdesc`,
    { timeout: 12000 }
  );
  if (json.code !== 0 && json.code !== "0") throw new Error(`OKLink code ${json.code}: ${json.msg || "rejected"}`);
  const list = json.data?.hits || json.data?.holderList || [];
  return list.map((h) => ({ address: h.holderAddress, pctHint: parseFloat(h.rate ?? 0) * 100 }));
}

// Scans recent Transfer + Approval logs backwards with an adaptive block window.
// Addresses that receive approvals (spenders) are weighted higher: users approve
// the bridge adapter/pool before bridging, so it is a strong signal.
// Public RPCs differ wildly in getLogs limits, so the window shrinks on error
// and we rotate to the next RPC when one refuses outright.
async function fromLogs(providers, token, onProgress, { maxBlocks = 300000, maxLogs = 4000, budgetMs = 25000 } = {}) {
  const score = new Map();
  const bump = (a, w) => {
    if (!a || IGNORE.has(a.toLowerCase())) return;
    score.set(a, (score.get(a) || 0) + w);
  };

  const t0 = Date.now();
  let lastErr = null;
  let scanned = 0;
  let seen = 0;
  let to = null;

  // Fast chains (0.1–0.25s blocks) need wide windows to cover any real history in budget.
  const maxSpan = Math.max(100000, Math.floor(maxBlocks / 10));
  for (const provider of providers) {
    let span = 5000;
    let ceiling = maxSpan; // lowered to the last span this RPC rejected
    try {
      if (to == null) to = await provider.getBlockNumber();
    } catch (err) {
      lastErr = err;
      continue;
    }
    while (to > 0 && scanned < maxBlocks && seen < maxLogs && Date.now() - t0 < budgetMs) {
      const from = Math.max(0, to - span + 1);
      try {
        const logs = await provider.getLogs({ address: token, topics: [[TRANSFER, APPROVAL]], fromBlock: from, toBlock: to });
        for (const l of logs) {
          if (l.topics[0] === TRANSFER) {
            bump(topicToAddress(l.topics[1]), 1);
            bump(topicToAddress(l.topics[2]), 1);
          } else {
            bump(topicToAddress(l.topics[2]), 3);
          }
        }
        seen += logs.length;
        scanned += to - from + 1;
        to = from - 1;
        if (logs.length < 1000) span = Math.min(span * 2, ceiling);
        onProgress?.(`Log scan: ${scanned.toLocaleString()} blocks, ${seen} events…`);
      } catch (err) {
        lastErr = err;
        if (span <= 100) break; // this RPC refuses even tiny ranges → next RPC
        ceiling = Math.max(100, span - 1);
        span = Math.max(100, Math.floor(span / 5));
      }
    }
    if (scanned >= maxBlocks || seen >= maxLogs || Date.now() - t0 >= budgetMs || to <= 0) break;
  }

  if (!scanned && lastErr) throw lastErr;
  // Wide net by activity; the final cut is by balance (see topContracts).
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300)
    .map(([address, activity]) => ({ address, activity }));
}

// On-chain balance + pct of supply, keep contracts only, rank by balance.
// Errors propagate: a failing RPC must surface, not look like "nothing found".
async function topContracts(provider, token, list) {
  const calls = [
    { target: token, iface: ERC20, fn: "totalSupply" },
    ...list.map((h) => ({ target: token, iface: ERC20, fn: "balanceOf", args: [h.address] })),
  ];
  const [supply, ...balances] = await multicall(provider, calls);
  const enriched = list.map((h, i) => {
    const balance = balances[i] ?? h.balance ?? null;
    let pct = h.pctHint ?? null;
    if (balance != null && supply) pct = Number((balance * 1000000n) / supply) / 10000;
    return { ...h, balance, pct };
  });

  const tokenLc = token.toLowerCase();
  const unknown = enriched.filter((h) => h.isContract == null && h.address.toLowerCase() !== tokenLc);
  const codes = await Promise.all(unknown.map((h) => provider.getCode(h.address)));
  unknown.forEach((h, i) => { h.isContract = codes[i] !== "0x"; });

  const contracts = enriched.filter((h) => h.isContract && h.address.toLowerCase() !== tokenLc);
  const byBalance = [...contracts].sort((a, b) => {
    const x = a.balance ?? 0n;
    const y = b.balance ?? 0n;
    return x === y ? 0 : x < y ? 1 : -1;
  });
  const top = byBalance.slice(0, TOP_CONTRACTS);

  // Burn/mint bridges hold no balance; keep the most active contracts too (log source).
  const picked = new Set(top.map((h) => h.address));
  const active = contracts
    .filter((h) => h.activity && !picked.has(h.address))
    .sort((a, b) => b.activity - a.activity)
    .slice(0, 10);
  return [...top, ...active];
}

export async function discoverHolders({ provider, chainId, token, proxyBase, onProgress, fallbackRpcs = [] }) {
  const chain = CHAINS[chainId];
  const attempts = [];
  const sources = [];

  if (chain?.holderApis?.blockscout) {
    sources.push(["Blockscout", () => fromBlockscout(chain.holderApis.blockscout, token)]);
  }
  if (chain?.holderApis?.routescan) {
    sources.push(["Routescan", () => fromRoutescan(chain.holderApis.routescan, token)]);
  }
  if (chain?.oklink && proxyBase != null) {
    sources.push(["OKLink", () => fromOklink(proxyBase, chain.oklink, token)]);
  }
  // ~30 days of history, whatever the block time.
  const maxBlocks = Math.min(5000000, Math.round((30 * 86400) / (chain?.blockTime || 2)));
  const logProviders = [provider, ...fallbackRpcs.map((url) => makeProvider(url, chainId))];
  sources.push(["On-chain logs", () => fromLogs(logProviders, token, onProgress, { maxBlocks })]);

  for (const [name, load] of sources) {
    onProgress?.(`Fetching holders via ${name}…`);
    let raw;
    try {
      raw = (await load()).filter((h) => h.address && ethers.isAddress(h.address));
    } catch (err) {
      attempts.push({ source: name, error: err.message?.slice(0, 120) || "failed" });
      continue;
    }
    if (!raw.length) {
      attempts.push({ source: name, error: "no data" });
      continue;
    }
    onProgress?.(`Got ${raw.length} holders via ${name}, ranking contracts by balance…`);
    const list = raw.map((h) => ({ ...h, address: ethers.getAddress(h.address) }));
    const holders = await topContracts(provider, token, list);
    return { holders, source: name, attempts };
  }
  return { holders: [], source: null, attempts };
}
