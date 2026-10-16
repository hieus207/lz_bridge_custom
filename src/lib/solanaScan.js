// Bridge detection for an SPL token on Solana: same four protocols as the EVM scanner,
// each from its live registry plus on-chain evidence (OFT store / peers, Wormhole wrapped meta).
import { PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";
import { Buffer } from "buffer";
import { CHAIN_LIST, chainName, chainIdFromWormholeId, anyChainName } from "./chains";
import {
  createScan, loadCcip, loadHyperlane, loadLzTransfer, loadWormholeScan, wormholeAttestations, finalizeWormhole,
} from "./bridgeScan";
import { makeSolana, resolveSolanaOft, getPeers, isSolanaAddress, SOLANA_RPCS } from "./solanaOft";

const CCIP_SOLANA = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"; // CCIP keys Solana by genesis hash
const WH_TOKEN_BRIDGE = new PublicKey("wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb");
const WH_SOLANA = 1;
const CG_TO_NAME = Object.fromEntries(CHAIN_LIST.map((c) => [c.cgPlatform, c.name]));

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

export const solscanUrl = (addr) => `https://solscan.io/account/${addr}`;

async function lzSolana(sol, mint) {
  const findings = [];
  const errors = [];
  let t = null;
  try {
    t = await resolveSolanaOft(sol, mint);
  } catch (err) {
    if (!/No LayerZero OFT/.test(err.message)) errors.push(err.message);
  }
  if (t) {
    const peers = await getPeers(sol, t).catch(() => []);
    findings.push({
      protocol: "LayerZero",
      title: `${t.oftType === 1 ? "OFT Adapter" : "Native OFT"}${t.legacy ? " (first-gen program)" : ""}`,
      address: t.oftStore,
      confidence: "high",
      source: `${t.source}${t.source.includes("on-chain") ? "" : " + on-chain"}`,
      details: [
        ...(t.symbol ? [["Symbol", t.symbol]] : []),
        ["OFT program", t.programId],
        ...(t.escrow ? [["Escrow", t.escrow]] : []),
        ...(t.paused ? [["Status", "Paused"]] : []),
      ],
      destinations: peers.map((p) => p.name),
      bridgeLink: `/bridge?src=solana&mint=${t.mint}`,
    });
  }

  if (!findings.length) {
    try {
      const tokens = await loadLzTransfer();
      const hit = tokens.find((x) => x.chainKey === "solana" && x.address === mint);
      if (hit) {
        findings.push({
          protocol: "LayerZero",
          title: "Listed in LayerZero Transfer API",
          confidence: "medium",
          source: "LayerZero Transfer API",
          details: [["Symbol", hit.symbol]],
        });
      }
    } catch (err) {
      errors.push(`LZ Transfer API: ${err.message}`);
    }
  }
  return { findings, errors };
}

async function ccipSolana(mint) {
  const data = await loadCcip(CCIP_SOLANA);
  const findings = [];
  for (const [symbol, perChain] of Object.entries(data)) {
    const e = perChain[CCIP_SOLANA];
    if (!e || e.tokenAddress !== mint) continue;
    findings.push({
      protocol: "Chainlink CCIP",
      title: `Token pool (${[e.pool?.rawType || e.pool?.type, e.pool?.version].filter(Boolean).join(" ") || "unknown type"})`,
      address: e.pool?.address || null,
      confidence: "high",
      source: "Chainlink CCIP directory",
      details: [["Symbol", symbol]],
      destinations: (e.destinations || []).map(anyChainName),
    });
  }
  return { findings };
}

async function wormholeSolanaRegistry(mint) {
  const list = await loadWormholeScan();
  const findings = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (t.platforms?.solana !== mint) continue;
    findings.push({
      protocol: "Wormhole",
      title: t.type === "NATIVE_TOKEN_TRANSFER" ? "Native Token Transfers (NTT)" : "Portal Token Bridge asset",
      confidence: "high",
      source: "WormholeScan",
      details: [["Symbol", (t.symbol || "").toUpperCase()], ["Type", t.type]],
      destinations: Object.keys(t.platforms).filter((p) => p !== "solana").map((p) => CG_TO_NAME[p] || p),
    });
  }
  return { findings };
}

// Portal-wrapped mints have a `["meta", mint]` PDA under the Token Bridge:
//   chain u16 LE | token_address [32] | original_decimals u8
async function wormholeSolanaOnchain(sol, mint) {
  const [metaPda] = PublicKey.findProgramAddressSync([Buffer.from("meta"), new PublicKey(mint).toBuffer()], WH_TOKEN_BRIDGE);
  const info = await sol.connection.getAccountInfo(metaPda);
  if (info) {
    const originWh = info.data.readUInt16LE(0);
    const originId = chainIdFromWormholeId(originWh);
    const raw = "0x" + Buffer.from(info.data.subarray(2, 34)).toString("hex");
    return {
      findings: [{
        protocol: "Wormhole",
        title: "Wormhole-wrapped token (Portal)",
        address: mint,
        confidence: "high",
        source: "on-chain Token Bridge",
        details: [
          ["Origin chain", originId ? chainName(originId) : `Wormhole chain ${originWh}`],
          ["Origin token", originId ? "0x" + raw.slice(26) : raw],
        ],
      }],
    };
  }
  // Native SPL token: is a wrapped version deployed on the EVM Token Bridges?
  const token32 = ethers.hexlify(new PublicKey(mint).toBytes());
  const attested = await wormholeAttestations(WH_SOLANA, token32, null);
  if (!attested.length) return { findings: [] };
  return {
    findings: [{
      protocol: "Wormhole",
      title: "Native token attested on Portal Token Bridge",
      address: WH_TOKEN_BRIDGE.toBase58(),
      confidence: "high",
      source: "on-chain Token Bridge",
      details: attested.map((a) => [`Wrapped on ${a.chain.name}`, a.wrapped]),
      destinations: attested.map((a) => a.chain.name),
    }],
  };
}

async function hyperlaneSolana(mint) {
  const routes = await loadHyperlane();
  const findings = [];
  for (const t of routes) {
    if (t.chainName !== "solanamainnet") continue;
    if (t.addressOrDenom !== mint && t.collateralAddressOrDenom !== mint) continue;
    findings.push({
      protocol: "Hyperlane",
      title: `Warp route · ${t.standard || "router"}`,
      address: t.addressOrDenom,
      confidence: "high",
      source: "Hyperlane registry",
      details: [
        ["Route", t.route],
        ...(t.symbol ? [["Symbol", t.symbol]] : []),
        ...(t.collateralAddressOrDenom ? [["Token", t.collateralAddressOrDenom]] : []),
      ],
      destinations: t.connections.map((c) => c.split("|")[1] || c),
    });
  }
  return { findings };
}

// Mint layout: COption<Pubkey> (36) | supply u64 | decimals u8 | …
async function mintMeta(sol, mint) {
  const info = await sol.connection.getAccountInfo(new PublicKey(mint));
  if (!info) throw new Error("Account not found on Solana");
  if (info.data.length < 82) throw new Error("Not an SPL token mint");
  return { decimals: info.data[44], tokenProgram: info.owner.toBase58() };
}

export async function scanSolanaToken({ mint, rpcUrl = SOLANA_RPCS[0], onState }) {
  mint = mint.trim();
  if (!isSolanaAddress(mint)) throw new Error("Not a Solana address");
  const sol = makeSolana(rpcUrl);
  const { state, setMeta, run } = createScan(onState);
  setMeta({ rpc: hostOf(rpcUrl), rpcNote: null, progress: "Reading Solana registries and accounts…" });

  // Fail fast on a non-mint before spending a dozen requests
  try {
    const m = await mintMeta(sol, mint);
    setMeta({ token: { symbol: null, name: null, decimals: m.decimals } });
  } catch (err) {
    setMeta({ progress: null, done: true, error: err.message });
    return state;
  }

  await Promise.all([
    run(["LayerZero"], () => lzSolana(sol, mint)),
    run(["Chainlink CCIP"], () => ccipSolana(mint)),
    run(["Wormhole"], () => wormholeSolanaRegistry(mint)),
    run(["Wormhole"], () => wormholeSolanaOnchain(sol, mint)),
    run(["Hyperlane"], () => hyperlaneSolana(mint)),
  ]);
  finalizeWormhole(state, { verified: true });

  // Symbol from whichever registry knew the token
  const sym = Object.values(state.protocols).flatMap((p) => p.findings)
    .flatMap((f) => f.details).find(([k]) => k === "Symbol")?.[1];
  if (sym) setMeta({ token: { ...state.meta.token, symbol: sym } });
  setMeta({ progress: null, done: true });
  return state;
}
