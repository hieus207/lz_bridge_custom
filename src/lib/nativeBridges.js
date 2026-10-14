// Canonical (native) bridges: Polygon PoS, OP Stack standard bridge (Base, Optimism),
// Arbitrum-stack token gateways (Arbitrum One, Robinhood Chain) and the Avalanche Bridge.
// Everything is read from the bridges' own contracts where a registry exists on-chain; official
// published lists fill the rest (Superchain token list for L1 → OP Stack, Ava Labs' bridge
// resources for Avalanche, whose mapping lives off-chain).
import { ethers } from "ethers";
import { getRpcs, chainName } from "./chains";
import { fetchJson } from "./http";
import { makeProvider, multicall } from "./onchain";

const ETH = 1, POLYGON = 137, ARBITRUM = 42161, OPTIMISM = 10, BASE = 8453, ROBINHOOD = 4663, AVALANCHE = 43114;

// Polygon PoS: RootChainManagerProxy on Ethereum keeps the root ↔ child token mapping
const POLYGON_ROOT_CHAIN_MANAGER = "0xA0c68C638235ee32657e8f720a23ceC1bFc77C77";
// Arbitrum-stack chains: each has its own L1GatewayRouter on Ethereum, which returns the
// deterministic L2 address of any L1 token. Robinhood Chain's router was traced from its WETH
// (l2Gateway → counterpartGateway → router) and checked: calculateL2TokenAddress(WETH) = its WETH.
const ARB_STACK = [
  { chainId: ARBITRUM, router: "0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef", app: "https://portal.arbitrum.io/bridge" },
  { chainId: ROBINHOOD, router: "0x6a2E3a1e16FC29f27Ce61429746D558d656975bB", app: "https://docs.robinhood.com/chain/bridging" },
];
// OP Stack predeploy: L2StandardBridge (same address on every OP chain)
const OP_L2_STANDARD_BRIDGE = "0x4200000000000000000000000000000000000010";
const SUPERCHAIN_TOKEN_LIST = "https://static.optimism.io/optimism.tokenlist.json";
// Arbitrum's bridged-token list (tokenlist.arbitrum.io) — for L2 tokens behind custom gateways
// that don't expose l1Address() (e.g. DAI). The L1 router still confirms the pairing.
const ARBITRUM_TOKEN_LIST = "https://tokenlist.arbitrum.io/ArbTokenLists/arbed_coingecko.json";
// Avalanche Bridge (Ava Labs): symbol → Ethereum origin, and "SYM.e" → Avalanche token
const AB_RESOURCES = "https://raw.githubusercontent.com/ava-labs/avalanche-bridge-resources/main";

const APPS = {
  polygon: "https://portal.polygon.technology/bridge",
  avalanche: "https://core.app/bridge",
  [BASE]: "https://superbridge.app/base",
  [OPTIMISM]: "https://superbridge.app/optimism",
};

const POLYGON_IFACE = new ethers.Interface([
  "function rootToChildToken(address) view returns (address)",
  "function childToRootToken(address) view returns (address)",
]);
const ARB_ROUTER_IFACE = new ethers.Interface([
  "function getGateway(address) view returns (address)",
  "function calculateL2TokenAddress(address) view returns (address)",
]);
const ARB_TOKEN_IFACE = new ethers.Interface(["function l1Address() view returns (address)"]);
const OP_TOKEN_IFACE = new ethers.Interface([
  "function remoteToken() view returns (address)",
  "function l1Token() view returns (address)",
  "function bridge() view returns (address)",
  "function l2Bridge() view returns (address)",
]);

const ZERO = ethers.ZeroAddress;
const real = (a) => (a && a !== ZERO ? a : null);
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// First reachable RPC of a chain (the scanned chain's provider is passed in directly)
async function providerFor(chainId) {
  for (const url of getRpcs(chainId).slice(0, 3)) {
    try {
      const p = makeProvider(url, chainId);
      await Promise.race([p.getBlockNumber(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 6000))]);
      return p;
    } catch { /* next */ }
  }
  throw new Error(`No RPC reachable for ${chainName(chainId)}`);
}

const finding = (title, address, details, destinations, app, source = "on-chain bridge contracts") => ({
  protocol: "Native bridge",
  title,
  address,
  confidence: "high",
  source,
  details,
  destinations,
  appUrl: app,
});

// ── Polygon PoS ─────────────────────────────────────────────────────────────
async function polygonPos(token, chainId, eth) {
  if (chainId === ETH) {
    const [child] = await multicall(eth, [{ target: POLYGON_ROOT_CHAIN_MANAGER, iface: POLYGON_IFACE, fn: "rootToChildToken", args: [token] }]);
    if (!real(child)) return [];
    return [finding("Polygon PoS bridge", POLYGON_ROOT_CHAIN_MANAGER, [["Token on Polygon", child]], ["Polygon"], APPS.polygon)];
  }
  if (chainId === POLYGON) {
    const [root] = await multicall(eth, [{ target: POLYGON_ROOT_CHAIN_MANAGER, iface: POLYGON_IFACE, fn: "childToRootToken", args: [token] }]);
    if (!real(root)) return [];
    return [finding("Polygon PoS bridge (bridged from Ethereum)", token, [["Token on Ethereum", root]], ["Ethereum"], APPS.polygon)];
  }
  return [];
}

// ── Arbitrum-stack token gateways (Arbitrum One, Robinhood Chain) ───────────
async function arbitrumStack(token, chainId, eth, provider) {
  if (chainId === ETH) {
    const results = await Promise.all(ARB_STACK.map(async (net) => {
      const [gateway, l2] = await multicall(eth, [
        { target: net.router, iface: ARB_ROUTER_IFACE, fn: "getGateway", args: [token] },
        { target: net.router, iface: ARB_ROUTER_IFACE, fn: "calculateL2TokenAddress", args: [token] },
      ]);
      if (!real(l2)) return null;
      // The address is deterministic; it only counts once the token was actually bridged (code deployed)
      const l2p = await providerFor(net.chainId);
      if ((await l2p.getCode(l2)) === "0x") return null;
      return finding(`${chainName(net.chainId)} canonical bridge (Arbitrum gateway)`, real(gateway) || net.router,
        [[`Token on ${chainName(net.chainId)}`, l2]], [chainName(net.chainId)], net.app);
    }));
    return results.filter(Boolean);
  }
  const net = ARB_STACK.find((n) => n.chainId === chainId);
  if (!net) return [];
  let [l1] = await multicall(provider, [{ target: token, iface: ARB_TOKEN_IFACE, fn: "l1Address" }]);
  if (!real(l1) && chainId === ARBITRUM) {
    const list = await fetchJson(ARBITRUM_TOKEN_LIST, { timeout: 20000 }).catch(() => null);
    const hit = list?.tokens?.find((t) => t.chainId === ARBITRUM && same(t.address, token));
    l1 = hit?.extensions?.bridgeInfo?.[ETH]?.tokenAddress || null;
  }
  if (!real(l1)) return [];
  // Confirm with the L1 router: the canonical L2 address of that L1 token must be this token
  const [l2] = await multicall(eth, [{ target: net.router, iface: ARB_ROUTER_IFACE, fn: "calculateL2TokenAddress", args: [l1] }]);
  if (!same(l2, token)) return [];
  return [finding(`${chainName(chainId)} canonical bridge (bridged from Ethereum)`, token, [["Token on Ethereum", l1]], ["Ethereum"], net.app)];
}

// ── Avalanche Bridge ────────────────────────────────────────────────────────
async function avalancheBridge(token, chainId) {
  if (chainId !== ETH && chainId !== AVALANCHE) return [];
  const [origins, wrapped] = await Promise.all([
    fetchJson(`${AB_RESOURCES}/token_list.json`, { timeout: 20000 }),
    fetchJson(`${AB_RESOURCES}/avalanche_contract_address.json`, { timeout: 20000 }),
  ]);
  if (chainId === AVALANCHE) {
    const key = Object.keys(wrapped).find((k) => same(wrapped[k], token));
    if (!key) return [];
    const origin = origins[key.replace(/\.[a-z]$/i, "")];
    const fromEth = origin?.nativeNetwork === "ethereum";
    return [finding(
      `Avalanche Bridge (${key})`,
      token,
      fromEth ? [["Token on Ethereum", origin.nativeContractAddress]] : [["Origin", origin?.nativeNetwork || "unknown"]],
      [fromEth ? "Ethereum" : origin?.nativeNetwork || "?"],
      APPS.avalanche,
      "Ava Labs bridge resources",
    )];
  }
  const sym = Object.keys(origins).find((k) => origins[k].nativeNetwork === "ethereum" && same(origins[k].nativeContractAddress, token));
  const avax = sym && wrapped[`${sym}.e`];
  if (!avax) return [];
  return [finding(`Avalanche Bridge (${sym}.e)`, token, [["Token on Avalanche", avax]], ["Avalanche"], APPS.avalanche, "Ava Labs bridge resources")];
}

// ── OP Stack standard bridge (Base, Optimism) ───────────────────────────────
async function opStackL2(token, chainId, provider) {
  if (chainId !== BASE && chainId !== OPTIMISM) return [];
  const [remote, l1Token, bridge, l2Bridge] = await multicall(provider, [
    { target: token, iface: OP_TOKEN_IFACE, fn: "remoteToken" },
    { target: token, iface: OP_TOKEN_IFACE, fn: "l1Token" },
    { target: token, iface: OP_TOKEN_IFACE, fn: "bridge" },
    { target: token, iface: OP_TOKEN_IFACE, fn: "l2Bridge" },
  ]);
  const l1 = real(remote) || real(l1Token);
  if (!l1 || !(same(bridge, OP_L2_STANDARD_BRIDGE) || same(l2Bridge, OP_L2_STANDARD_BRIDGE))) return [];
  return [finding(`OP Stack standard bridge (bridged from Ethereum)`, token, [["Token on Ethereum", l1], ["L2 bridge", OP_L2_STANDARD_BRIDGE]], ["Ethereum"], APPS[chainId])];
}

async function opStackL1(token) {
  const list = await fetchJson(SUPERCHAIN_TOKEN_LIST, { timeout: 20000 });
  const tokens = list.tokens || [];
  const l1 = tokens.find((t) => t.chainId === ETH && same(t.address, token));
  if (!l1) return [];
  const findings = [];
  for (const chainId of [BASE, OPTIMISM]) {
    const l2 = tokens.find((t) => t.chainId === chainId && t.extensions?.opTokenId === l1.extensions?.opTokenId);
    const l1Bridge = l1.extensions?.[chainId === BASE ? "baseBridgeAddress" : "optimismBridgeAddress"];
    if (!l2 || !l1Bridge) continue;
    findings.push(finding(
      `OP Stack standard bridge → ${chainName(chainId)}`,
      l1Bridge,
      [[`Token on ${chainName(chainId)}`, l2.address]],
      [chainName(chainId)],
      APPS[chainId],
      "Superchain token list",
    ));
  }
  return findings;
}

/**
 * Native-bridge findings for `token` on `chainId`. `provider` is the scanner's provider for that chain.
 * Each check fails independently; errors are reported, not thrown.
 */
export async function nativeBridgeChecks(token, chainId, provider) {
  if (![ETH, POLYGON, ARBITRUM, BASE, OPTIMISM, ROBINHOOD, AVALANCHE].includes(chainId)) return { findings: [] };
  const eth = chainId === ETH ? provider : await providerFor(ETH).catch(() => null);
  const checks = [
    eth ? polygonPos(token, chainId, eth) : Promise.resolve([]),
    eth ? arbitrumStack(token, chainId, eth, provider) : Promise.resolve([]),
    avalancheBridge(token, chainId),
    opStackL2(token, chainId, provider),
    chainId === ETH ? opStackL1(token) : Promise.resolve([]),
  ];
  const results = await Promise.allSettled(checks);
  const findings = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason?.message?.slice(0, 120) || "check failed");
  if (!eth) errors.push("Ethereum RPC unreachable — Polygon/Arbitrum/Robinhood checks skipped");
  return { findings, errors };
}
