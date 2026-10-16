// On-chain helpers: batched reads via Multicall3 and protocol fingerprinting.
// Fingerprints rely only on public contract interfaces, which never change
// for already-deployed contracts — unlike website bundles or private APIs.
import { ethers } from "ethers";
import { MULTICALL3 } from "./chains";
import { fetchJson } from "./http";

const MC_IFACE = new ethers.Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

// ethers waits up to 300 s per request by default: a rate-limited RPC that stops answering
// would stall the whole scan. 15 s, then the caller's fallback logic takes over.
const RPC_TIMEOUT_MS = 15000;

export const makeProvider = (rpcUrl, chainId) => {
  const req = new ethers.FetchRequest(rpcUrl);
  req.timeout = RPC_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(req, chainId ? Number(chainId) : undefined, {
    staticNetwork: !!chainId,
    batchMaxCount: 10, // many public RPCs reject large JSON-RPC batches
  });
};

const hasMulticall = new WeakMap();

// A network error here must propagate: swallowing it made every probe return
// null, i.e. a dead RPC looked exactly like "no bridge contracts found".
async function multicallAvailable(provider) {
  if (!hasMulticall.has(provider)) {
    const check = provider.getCode(MULTICALL3).then((c) => c !== "0x");
    check.catch(() => hasMulticall.delete(provider));
    hasMulticall.set(provider, check);
  }
  return hasMulticall.get(provider);
}

function decode(iface, fn, data) {
  if (!data || data === "0x") return null;
  try {
    const r = iface.decodeFunctionResult(fn, data);
    return r.length === 1 ? r[0] : r;
  } catch {
    return null;
  }
}

// calls: [{ target, iface, fn, args? }] → array of decoded results (null on failure).
// Uses Multicall3 when deployed, otherwise falls back to individual eth_calls.
export async function multicall(provider, calls, chunkSize = 120) {
  if (!calls.length) return [];
  const encoded = calls.map((c) => c.iface.encodeFunctionData(c.fn, c.args || []));

  if (!(await multicallAvailable(provider))) {
    return Promise.all(calls.map((c, i) =>
      provider.call({ to: c.target, data: encoded[i] })
        .then((d) => decode(c.iface, c.fn, d))
        .catch(() => null)
    ));
  }

  // A sub-call that burns all its gas (old contracts using assert/invalid opcode)
  // starves the rest and reverts the whole aggregate, so split until it passes.
  const run = async (start, end) => {
    const slice = calls.slice(start, end);
    const data = MC_IFACE.encodeFunctionData("aggregate3", [
      slice.map((c, j) => ({ target: c.target, allowFailure: true, callData: encoded[start + j] })),
    ]);
    try {
      const raw = await provider.call({ to: MULTICALL3, data });
      const [results] = MC_IFACE.decodeFunctionResult("aggregate3", raw);
      return results.map((r, j) => (r.success ? decode(slice[j].iface, slice[j].fn, r.returnData) : null));
    } catch (err) {
      if (end - start === 1) return [null];
      if (err?.code !== "CALL_EXCEPTION") throw err; // network/RPC failure, not a bad sub-call
      const mid = start + Math.ceil((end - start) / 2);
      return [...(await run(start, mid)), ...(await run(mid, end))];
    }
  };

  const chunks = [];
  for (let i = 0; i < calls.length; i += chunkSize) chunks.push(run(i, Math.min(i + chunkSize, calls.length)));
  return (await Promise.all(chunks)).flat();
}

export const ERC20 = new ethers.Interface([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);

const PROBE = new ethers.Interface([
  "function endpoint() view returns (address)",
  "function oftVersion() view returns (bytes4 interfaceId, uint64 version)",
  "function token() view returns (address)",
  "function approvalRequired() view returns (bool)",
  "function getMode() view returns (uint8)",
  "function typeAndVersion() view returns (string)",
  "function getToken() view returns (address)",
  "function mailbox() view returns (address)",
  "function wrappedToken() view returns (address)",
  "function getCCIPAdmin() view returns (address)",
]);
const PROBE_FNS = [
  "endpoint", "oftVersion", "token", "approvalRequired", "getMode",
  "typeAndVersion", "getToken", "mailbox", "wrappedToken", "getCCIPAdmin",
];

const ZERO = ethers.ZeroAddress.toLowerCase();
const addr = (v) => (typeof v === "string" && v.toLowerCase() !== ZERO ? v : null);
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Probe many addresses at once; returns Map(addressLower → raw probe result).
export async function probeContracts(provider, addresses) {
  const calls = [];
  for (const a of addresses) for (const fn of PROBE_FNS) calls.push({ target: a, iface: PROBE, fn });
  const flat = await multicall(provider, calls);
  const out = new Map();
  addresses.forEach((a, i) => {
    const r = {};
    PROBE_FNS.forEach((fn, j) => { r[fn] = flat[i * PROBE_FNS.length + j]; });
    out.set(a.toLowerCase(), r);
  });
  return out;
}

const NTT_MODES = ["Locking", "Burning"];

// Turn a raw probe into protocol findings relative to `token`.
// `holder` carries balance/pct when the contract was discovered as a holder.
export function classify(address, r, token, { chainId, tokenBridge, holder } = {}) {
  const findings = [];
  const isSelf = same(address, token);
  const holding = holder?.pct != null ? [["Holds", `${holder.pct.toFixed(2)}% of supply`]] : [];

  const endpoint = addr(r.endpoint);
  if (endpoint && (r.oftVersion || addr(r.token))) {
    const inner = addr(r.token);
    const linked = isSelf || same(inner, token);
    const version = r.oftVersion ? `${r.oftVersion[0]} v${r.oftVersion[1]}` : null;
    findings.push({
      protocol: "LayerZero",
      title: isSelf ? "Token is an OFT itself" : linked ? "OFT Adapter" : "OFT for a different token",
      address,
      confidence: linked ? "high" : "low",
      details: [
        ["Endpoint", endpoint],
        ...(version ? [["OFT version", version]] : []),
        ...(inner && !isSelf ? [["token()", inner]] : []),
        ...(r.approvalRequired != null ? [["Approval required", r.approvalRequired ? "yes" : "no"]] : []),
        ...holding,
      ],
      bridgeLink: chainId ? `/bridge?oftadr=${address}&chainId=${chainId}&auto=true` : null,
    });
  }

  if (r.getMode != null && addr(r.token) && !endpoint) {
    const linked = same(r.token, token);
    findings.push({
      protocol: "Wormhole",
      title: "NTT Manager",
      address,
      confidence: linked ? "high" : "low",
      details: [
        ["Mode", NTT_MODES[Number(r.getMode)] || String(r.getMode)],
        ["token()", r.token],
        ...holding,
      ],
    });
  }

  if (typeof r.typeAndVersion === "string" && /TokenPool/i.test(r.typeAndVersion) && addr(r.getToken)) {
    const linked = same(r.getToken, token);
    findings.push({
      protocol: "Chainlink CCIP",
      title: `Token pool (${r.typeAndVersion})`,
      address,
      confidence: linked ? "high" : "low",
      details: [["getToken()", r.getToken], ...holding],
    });
  }

  if (isSelf && addr(r.getCCIPAdmin)) {
    findings.push({
      protocol: "Chainlink CCIP",
      title: "Token exposes getCCIPAdmin() (CCIP-ready token)",
      address,
      confidence: "low",
      details: [["CCIP admin", r.getCCIPAdmin]],
    });
  }

  const mailbox = addr(r.mailbox);
  if (mailbox && (isSelf || addr(r.wrappedToken))) {
    const linked = isSelf || same(r.wrappedToken, token);
    findings.push({
      protocol: "Hyperlane",
      title: isSelf ? "Token is a Hyperlane warp token (synthetic)" : "Hyperlane collateral router",
      address,
      confidence: linked ? "high" : "low",
      details: [
        ["Mailbox", mailbox],
        ...(addr(r.wrappedToken) ? [["wrappedToken()", r.wrappedToken]] : []),
        ...holding,
      ],
      bridgeLink: chainId ? `/bridge?proto=hyperlane&nexusadr=${address}&chainId=${chainId}` : null,
    });
  }

  if (tokenBridge && same(address, tokenBridge)) {
    findings.push({
      protocol: "Wormhole",
      title: "Locked in Wormhole Token Bridge (Portal)",
      address,
      confidence: "high",
      details: holding,
    });
  }

  return findings;
}

const NTT_PROBE = new ethers.Interface([
  "function minter() view returns (address)",
  "function getMode() view returns (uint8)",
  "function token() view returns (address)",
  "function getPeer(uint16) view returns ((bytes32 peerAddress, uint8 tokenDecimals))",
]);
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const ROUTESCAN_CHAINS = new Set([1, 43114]); // free Etherscan-style API without range limits

// Is any of `addrs` an NTT manager for `token`?
export async function pickNttManager(provider, addrs, token) {
  if (!addrs.length) return null;
  const res = await multicall(provider, addrs.flatMap((a) => [
    { target: a, iface: NTT_PROBE, fn: "getMode" },
    { target: a, iface: NTT_PROBE, fn: "token" },
  ]));
  return addrs.find((_, i) => res[i * 2] != null && same(res[i * 2 + 1], token)) || null;
}

// The manager's peer on Wormhole chain `whChainId` (bytes32 → EVM address), if set
export async function nttPeer(provider, manager, whChainId) {
  const [p] = await multicall(provider, [{ target: manager, iface: NTT_PROBE, fn: "getPeer", args: [whChainId] }]);
  const raw = p?.[0] ?? p?.peerAddress;
  return raw && raw !== ethers.ZeroHash ? ethers.getAddress("0x" + raw.slice(26)) : null;
}

// Recent mint/burn tx hashes of `token`: Routescan where available, else eth_getLogs going back
async function mintBurnTxs(provider, token, { chainId, blockTime, days, maxCalls }) {
  const hashes = [];
  if (ROUTESCAN_CHAINS.has(Number(chainId))) {
    try {
      const url = `https://api.routescan.io/v2/network/mainnet/evm/${chainId}/etherscan/api?module=account&action=tokentx`
        + `&contractaddress=${token}&address=${ethers.ZeroAddress}&page=1&offset=5&sort=desc`;
      const json = await fetchJson(url, { timeout: 10000 });
      for (const t of json.result || []) if (!hashes.includes(t.hash)) hashes.push(t.hash);
      if (hashes.length) return hashes;
    } catch { /* fall back to logs */ }
  }
  const tip = await provider.getBlockNumber();
  const oldest = tip - Math.ceil((days * 86400) / blockTime);
  let to = tip;
  let span = 50000;
  for (let i = 0; i < maxCalls && hashes.length < 3 && to > oldest; i++) {
    const from = Math.max(oldest, to - span);
    const toBlock = to;
    try {
      const ask = (topics) => provider.getLogs({ address: token, topics, fromBlock: from, toBlock });
      const logs = (await Promise.race([
        Promise.all([ask([TRANSFER_TOPIC, ethers.ZeroHash]), ask([TRANSFER_TOPIC, null, ethers.ZeroHash])]),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
      ])).flat().sort((a, b) => b.blockNumber - a.blockNumber);
      for (const l of logs) if (!hashes.includes(l.transactionHash)) hashes.push(l.transactionHash);
      to = from - 1;
    } catch {
      if (span <= 2000) to = from - 1; // still refused at a small range: skip it
      else span = Math.floor(span / 5); // range too wide for this RPC
    }
  }
  return hashes;
}

// NTT manager of `token` on this chain: minter() (NttToken standard), else a contract emitting
// logs in a recent mint/burn tx that is an NTT manager for this token.
// Lock-mode managers hold the token and are found by the holder scan instead.
export async function findNttManager(provider, token, { chainId, blockTime = 2, days = 7, maxCalls = 12 } = {}) {
  const [minter] = await multicall(provider, [{ target: token, iface: NTT_PROBE, fn: "minter" }]);
  if (addr(minter) && (await pickNttManager(provider, [minter], token))) return minter;
  const hashes = await mintBurnTxs(provider, token, { chainId, blockTime, days, maxCalls });
  for (const h of hashes.slice(0, 3)) {
    const rc = await provider.getTransactionReceipt(h).catch(() => null);
    const cands = [...new Set((rc?.logs || []).map((l) => l.address).filter((a) => !same(a, token)))];
    const hit = await pickNttManager(provider, cands, token);
    if (hit) return hit;
  }
  return null;
}
