// On-chain helpers: batched reads via Multicall3 and protocol fingerprinting.
// Fingerprints rely only on public contract interfaces, which never change
// for already-deployed contracts — unlike website bundles or private APIs.
import { ethers } from "ethers";
import { MULTICALL3 } from "./chains";

const MC_IFACE = new ethers.Interface([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

export const makeProvider = (rpcUrl, chainId) =>
  new ethers.JsonRpcProvider(rpcUrl, chainId ? Number(chainId) : undefined, {
    staticNetwork: !!chainId,
    batchMaxCount: 10, // many public RPCs reject large JSON-RPC batches
  });

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
      bridgeLink: chainId ? `/nexus?nexusadr=${address}&chainId=${chainId}` : null,
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
