// Single source of truth for per-chain metadata used by the scanner and wallet.
// Everything here is either a protocol constant (immutable on-chain addresses / IDs)
// or a public, documented endpoint — nothing scraped from a website bundle.
import chainRpcs from "../chainRpcs.json";
import { getCustomChain } from "./customChains";

export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

export const CHAINS = {
  1: {
    id: 1, blockTime: 12, name: "Ethereum", explorer: "https://etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    lzKey: "ethereum", hyperlane: "ethereum", oklink: "eth", cgPlatform: "ethereum",
    wormhole: { chainId: 2, tokenBridge: "0x3ee18B2214AFF97000D974cf647E7C347E8fa585" },
    holderApis: { blockscout: "https://eth.blockscout.com", routescan: 1 },
  },
  56: {
    id: 56, blockTime: 0.75, name: "BNB", explorer: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    lzKey: "bsc", hyperlane: "bsc", oklink: "bsc", cgPlatform: "binance-smart-chain",
    wormhole: { chainId: 4, tokenBridge: "0xB6F6D86a8f9879A9c87f643768d9efc38c1Da6E7" },
    holderApis: {},
  },
  137: {
    id: 137, blockTime: 2, name: "Polygon", explorer: "https://polygonscan.com",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    lzKey: "polygon", hyperlane: "polygon", oklink: "polygon", cgPlatform: "polygon-pos",
    wormhole: { chainId: 5, tokenBridge: "0x5a58505a96D1dbf8dF91cB21B54419FC36e93fdE" },
    holderApis: {},
  },
  43114: {
    id: 43114, blockTime: 2, name: "Avalanche", explorer: "https://snowtrace.io",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    lzKey: "avalanche", hyperlane: "avalanche", oklink: "avax-c", cgPlatform: "avalanche",
    wormhole: { chainId: 6, tokenBridge: "0x0e082F06FF657D94310cB8cE8B0D9a04541d8052" },
    holderApis: { routescan: 43114 },
  },
  42161: {
    id: 42161, blockTime: 0.25, name: "Arbitrum", explorer: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    lzKey: "arbitrum", hyperlane: "arbitrum", oklink: "arbitrum-one", cgPlatform: "arbitrum-one",
    wormhole: { chainId: 23, tokenBridge: "0x0b2402144Bb366A632D14B83F244D2e0e21bD39c" },
    holderApis: {},
  },
  10: {
    id: 10, blockTime: 2, name: "Optimism", explorer: "https://optimistic.etherscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    lzKey: "optimism", hyperlane: "optimism", oklink: "optimism", cgPlatform: "optimistic-ethereum",
    wormhole: { chainId: 24, tokenBridge: "0x1D68124e65faFC907325e3EDbF8c4d84499DAa8b" },
    holderApis: {},
  },
  8453: {
    id: 8453, blockTime: 2, name: "Base", explorer: "https://basescan.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    lzKey: "base", hyperlane: "base", oklink: "base", cgPlatform: "base",
    wormhole: { chainId: 30, tokenBridge: "0x8d2de8d2f73F1F4cAB472AC9A881C9b123C79627" },
    holderApis: {},
  },
};

export const CHAIN_LIST = Object.values(CHAINS);

export const toHexChainId = (id) => "0x" + Number(id).toString(16);

export const getRpcs = (chainId) => {
  if (chainRpcs[String(chainId)]) return chainRpcs[String(chainId)];
  const custom = getCustomChain(chainId);
  return custom ? [custom.rpc] : [];
};

export const chainName = (chainId) => CHAINS[chainId]?.name || getCustomChain(chainId)?.name || `Chain ${chainId}`;

export const explorerAddressUrl = (chainId, address) => {
  const explorer = CHAINS[chainId]?.explorer || getCustomChain(chainId)?.explorer;
  return explorer ? `${explorer.replace(/\/$/, "")}/address/${address}` : null;
};

const LZ_KEY_TO_ID = Object.fromEntries(CHAIN_LIST.map((c) => [c.lzKey, c.id]));
export const chainIdFromLzKey = (key) => LZ_KEY_TO_ID[key] ?? null;

const WH_ID_TO_ID = Object.fromEntries(CHAIN_LIST.map((c) => [c.wormhole.chainId, c.id]));
export const chainIdFromWormholeId = (whId) => WH_ID_TO_ID[whId] ?? null;

// Params for wallet_addEthereumChain (used when the wallet doesn't know the chain yet).
export const addChainParams = (chainId, rpcOverride) => {
  const c = CHAINS[chainId];
  const custom = c ? null : getCustomChain(chainId);
  const rpcUrls = rpcOverride ? [rpcOverride] : getRpcs(chainId).slice(0, 2);
  if (!rpcUrls.length) return null;
  const explorer = c?.explorer || custom?.explorer;
  return {
    chainId: toHexChainId(chainId),
    chainName: chainName(chainId),
    nativeCurrency: c?.nativeCurrency
      || { name: custom?.symbol || "ETH", symbol: custom?.symbol || "ETH", decimals: 18 },
    rpcUrls,
    ...(explorer ? { blockExplorerUrls: [explorer] } : {}),
  };
};
