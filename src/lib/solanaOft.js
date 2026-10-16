/* global BigInt */
// LayerZero OFT sends from Solana, via the official @layerzerolabs/oft-v2-solana-sdk
// (first-generation `OftConfig` OFTs such as WIF/USDe go through ./solanaOftLegacy).
// Token accounts are resolved live: LZ metadata API first, then the on-chain OFTStore
// (so an OFT missing from the API still works if you paste its mint or OFT store).
import { Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { publicKey as umiPk, createNoopSigner } from "@metaplex-foundation/umi";
import { toWeb3JsInstruction } from "@metaplex-foundation/umi-web3js-adapters";
import { oft, OftPDA } from "@layerzerolabs/oft-v2-solana-sdk";
import { ethers } from "ethers";
import { Buffer } from "buffer";
import { fetchJson } from "./http";
import {
  isLegacyConfig, parseLegacyConfig, legacyPdas, legacyQuoteIxs, legacySendIx, parseMessagingFee, parseQuoteOft,
} from "./solanaOftLegacy";

export const SOLANA_EID = 30168;

export const SOLANA_RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];

// LayerZero's mainnet address lookup table: keeps the ~40-account send tx under the size limit.
const LZ_LOOKUP_TABLE = new PublicKey("AokBxha6VMLLgf97B5VYHEtqztamWmYERBmmFvjuTzJB");
const MAX_CU = 1_400_000;
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

// EVM destinations offered from Solana (EID → label / EVM chain id)
export const EVM_DESTINATIONS = [
  { eid: 30101, name: "Ethereum", chainId: 1 },
  { eid: 30102, name: "BSC", chainId: 56 },
  { eid: 30109, name: "Polygon", chainId: 137 },
  { eid: 30110, name: "Arbitrum", chainId: 42161 },
  { eid: 30111, name: "Optimism", chainId: 10 },
  { eid: 30106, name: "Avalanche", chainId: 43114 },
  { eid: 30184, name: "Base", chainId: 8453 },
  { eid: 30332, name: "Sonic", chainId: 146 },
  { eid: 30416, name: "Robinhood", chainId: 4663 },
];

export function makeSolana(rpcUrl = SOLANA_RPCS[0]) {
  return { connection: new Connection(rpcUrl, "confirmed"), umi: createUmi(rpcUrl), rpcUrl };
}

export const isSolanaAddress = (s) => {
  try { return !!s && new PublicKey(s.trim()).toBytes().length === 32; } catch { return false; }
};

// 32-byte recipient for the LZ message: EVM address left-padded
export const evmTo32 = (addr) => ethers.getBytes(ethers.zeroPadValue(addr, 32));

async function fromMetadata(input) {
  const json = await fetchJson("https://metadata.layerzero-api.com/v1/metadata/experiment/ofts/list", { timeout: 20000 });
  for (const [symbol, list] of Object.entries(json)) {
    for (const o of list) {
      const s = o.deployments?.solana;
      if (!s?.details) continue;
      if (s.address !== input && s.details.oftPDA !== input) continue;
      return {
        symbol,
        name: o.name,
        mint: s.address,
        programId: s.details.oftProgramId,
        escrow: s.details.escrowTokenAccount,
        oftStore: s.details.oftPDA || null,
        mintAuthority: s.details.mintAuthority || null,
        tokenProgram: s.details.innerTokenProgramId,
        source: "LayerZero metadata API",
      };
    }
  }
  return null;
}

// Mint layout: COption<Pubkey> mintAuthority (4 + 32) | supply u64 | decimals u8
const parseMint = (data) => ({
  mintAuthority: data.readUInt32LE(0) === 1 ? new PublicKey(data.subarray(4, 36)) : null,
  decimals: data[44],
});

async function tryOftStore(sol, address) {
  const info = await sol.connection.getAccountInfo(new PublicKey(address));
  if (!info || info.owner.equals(PublicKey.default)) return null;
  if (isLegacyConfig(info.data)) return { legacy: true, programId: info.owner.toBase58(), config: parseLegacyConfig(info.data) };
  try {
    const store = await oft.accounts.fetchOFTStore(sol.umi, umiPk(address));
    return { store, programId: info.owner.toBase58() };
  } catch {
    return null;
  }
}

// Accepts an SPL mint or an OFT store address.
export async function resolveSolanaOft(sol, input) {
  input = input.trim();
  if (!isSolanaAddress(input)) throw new Error("Not a Solana address");

  let meta = null;
  try { meta = await fromMetadata(input); } catch { /* API down → on-chain only */ }

  let found = null;
  if (meta) {
    // Some API entries omit or misreport oftPDA; native OFTs use their store as mint authority
    // API data can be stale: also try the store PDA derived from the escrow (seeds: "OFT", escrow)
    const derived = meta.escrow && meta.programId
      ? new OftPDA(umiPk(meta.programId)).oftStore(umiPk(meta.escrow))[0].toString()
      : null;
    // The escrow token account is owned by the OFT store (token account layout: mint | owner)
    let escrowOwner = null;
    if (meta.escrow) {
      const esc = await sol.connection.getAccountInfo(new PublicKey(meta.escrow)).catch(() => null);
      if (esc && TOKEN_PROGRAMS.has(esc.owner.toBase58())) escrowOwner = new PublicKey(esc.data.subarray(32, 64)).toBase58();
    }
    for (const candidate of [...new Set([meta.oftStore, derived, escrowOwner, meta.mintAuthority])]) {
      const hit = candidate && (await tryOftStore(sol, candidate));
      if (hit) {
        found = { ...hit, storeAddress: candidate };
        break;
      }
    }
  }
  if (!found) {
    const lookup = meta?.mint || input;
    const info = await sol.connection.getAccountInfo(new PublicKey(lookup));
    if (!info) throw new Error("Account not found on Solana");
    if (TOKEN_PROGRAMS.has(info.owner.toBase58())) {
      // Mint: native OFTs set their OFT store as mint authority
      const { mintAuthority } = parseMint(info.data);
      if (mintAuthority) {
        const hit = await tryOftStore(sol, mintAuthority.toBase58());
        if (hit) found = { ...hit, storeAddress: mintAuthority.toBase58() };
      }
    } else {
      const hit = await tryOftStore(sol, lookup);
      if (hit) found = { ...hit, storeAddress: lookup };
    }
  }
  if (!found) throw new Error("No LayerZero OFT found for this address (paste the token mint or its OFT store)");

  const { store, programId, legacy, config } = found;
  const mint = legacy ? config.tokenMint : store.tokenMint.toString();
  const mintInfo = await sol.connection.getAccountInfo(new PublicKey(mint));
  if (!mintInfo) throw new Error("Token mint not found");
  const { decimals } = parseMint(mintInfo.data);

  return {
    symbol: meta?.symbol || null,
    name: meta?.name || null,
    mint,
    decimals,
    programId,
    escrow: legacy ? config.escrow : store.tokenEscrow.toString(),
    oftStore: found.storeAddress,
    tokenProgram: mintInfo.owner.toBase58(),
    ld2sdRate: legacy ? config.ld2sdRate : store.ld2sdRate,
    paused: legacy ? false : !!store.paused,
    oftType: legacy ? (config.escrow ? 1 : 0) : store.oftType, // 0 native, 1 adapter
    legacy: !!legacy,
    source: meta ? meta.source : "on-chain OFT store",
  };
}

// Which EVM chains this OFT is wired to (peer config accounts that exist on-chain).
export async function getPeers(sol, token) {
  if (token.legacy) {
    const keys = EVM_DESTINATIONS.map((d) => legacyPdas(token.programId, token.oftStore, d.eid).peer);
    const infos = await sol.connection.getMultipleAccountsInfo(keys);
    return EVM_DESTINATIONS.filter((_, i) => !!infos[i]);
  }
  const pda = new OftPDA(umiPk(token.programId));
  const keys = EVM_DESTINATIONS.map((d) => pda.peer(umiPk(token.oftStore), d.eid)[0]);
  const accounts = await sol.umi.rpc.getAccounts(keys);
  return EVM_DESTINATIONS.filter((_, i) => accounts[i].exists);
}

export async function getBalance(sol, owner, token) {
  const ata = getAssociatedTokenAddressSync(new PublicKey(token.mint), new PublicKey(owner), true, new PublicKey(token.tokenProgram));
  // Raw account read: some public RPCs refuse getTokenAccountBalance.
  // Token account layout: mint (32) | owner (32) | amount u64 LE
  const info = await sol.connection.getAccountInfo(ata);
  return info ? info.data.readBigUInt64LE(64) : 0n; // no token account yet → 0
}

// Drop the dust the OFT can't carry (shared decimals) so the send doesn't revert.
export const removeDust = (amountLd, ld2sdRate) => (amountLd / ld2sdRate) * ld2sdRate;

function sendParamsFor(token, { dstEid, to, amountLd }) {
  const amount = removeDust(amountLd, token.ld2sdRate);
  return { dstEid, to, amountLd: amount, minAmountLd: 0n, options: new Uint8Array() };
}

// Legacy program: quote/quoteOft are view instructions → read their return data by simulation.
async function simulateReturn(sol, owner, ix) {
  const { value: alt } = await sol.connection.getAddressLookupTable(LZ_LOOKUP_TABLE);
  const { blockhash } = await sol.connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: new PublicKey(owner),
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_CU }), ix],
  }).compileToV0Message(alt ? [alt] : []));
  const sim = await sol.connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  if (sim.value.err) throw new Error(explainSimError(sim.value));
  const data = sim.value.returnData?.data?.[0];
  if (!data) throw new Error("Quote returned no data");
  return Buffer.from(data, "base64");
}

export async function quoteSend(sol, owner, token, params) {
  const p = sendParamsFor(token, params);
  if (token.legacy) {
    const { quote, quoteOft } = await legacyQuoteIxs(sol.connection, owner, token, p);
    const [fee, oftQ] = await Promise.all([
      simulateReturn(sol, owner, quote).then(parseMessagingFee),
      simulateReturn(sol, owner, quoteOft).then(parseQuoteOft).catch(() => null),
    ]);
    return { nativeFee: fee.nativeFee, amountLd: p.amountLd, amountReceivedLd: oftQ?.amountReceivedLd ?? p.amountLd };
  }
  const accounts = { payer: umiPk(owner), tokenMint: umiPk(token.mint), tokenEscrow: umiPk(token.escrow) };
  const programs = { oft: umiPk(token.programId) };
  const [fee, oftQuote] = await Promise.all([
    oft.quote(sol.umi.rpc, accounts, { ...p, payInLzToken: false }, programs),
    oft.quoteOft(sol.umi.rpc, accounts, { ...p, payInLzToken: false }, umiPk(token.programId)).catch(() => null),
  ]);
  const received = oftQuote?.oftReceipt?.amountReceivedLd ?? p.amountLd;
  return { nativeFee: fee.nativeFee, amountLd: p.amountLd, amountReceivedLd: BigInt(received) };
}

function explainSimError({ err, logs = [] }) {
  const text = logs.join(" ");
  // 0xbc4 = Anchor AccountNotInitialized (3012): the sender has no token account
  if (/token_source[\s\S]*AccountNotInitialized|custom program error: 0xbc4\b/.test(text)) return "You don't hold this token on Solana (no token account)";
  if (/insufficient funds/i.test(text)) return "Insufficient token balance";
  if (/insufficient lamports/i.test(text) || /InsufficientFunds/.test(JSON.stringify(err)))
    return "Not enough SOL for the LayerZero fee + network fee";
  const line = logs.filter((l) => /Error Message|error|failed/i.test(l)).slice(-1)[0];
  return `Simulation failed: ${line ? line.replace(/^Program log: /, "") : JSON.stringify(err)}`;
}

// Builds the v0 send transaction (unsigned) and checks it by simulation.
export async function buildSendTx(sol, owner, token, params, onStatus) {
  const ownerPk = new PublicKey(owner);
  onStatus?.("Quoting fee…");
  const q = await quoteSend(sol, owner, token, params);
  const p = sendParamsFor(token, params);
  const ata = getAssociatedTokenAddressSync(new PublicKey(token.mint), ownerPk, true, new PublicKey(token.tokenProgram));

  const sendParams = { ...p, minAmountLd: q.amountReceivedLd, nativeFee: q.nativeFee };
  const sendIx = token.legacy
    ? await legacySendIx(sol.connection, owner, token, sendParams, ata.toBase58())
    : toWeb3JsInstruction((await oft.send(
      sol.umi.rpc,
      { payer: createNoopSigner(umiPk(owner)), tokenMint: umiPk(token.mint), tokenEscrow: umiPk(token.escrow), tokenSource: umiPk(ata.toBase58()) },
      sendParams,
      { oft: umiPk(token.programId), token: umiPk(token.tokenProgram) }
    )).instruction);

  const [{ value: alt }, { blockhash, lastValidBlockHeight }] = await Promise.all([
    sol.connection.getAddressLookupTable(LZ_LOOKUP_TABLE),
    sol.connection.getLatestBlockhash("confirmed"),
  ]);
  const build = (units) => new VersionedTransaction(new TransactionMessage({
    payerKey: ownerPk,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), sendIx],
  }).compileToV0Message(alt ? [alt] : []));

  // Usage depends on the route's DVN/executor setup (~300k to BSC, >400k to Ethereum):
  // simulate at the max, then set the limit to actual usage + 20%.
  onStatus?.("Simulating…");
  const sim = await sol.connection.simulateTransaction(build(MAX_CU), { sigVerify: false, replaceRecentBlockhash: true });
  if (sim.value.err) throw new Error(explainSimError(sim.value));
  const units = Math.min(MAX_CU, Math.ceil((sim.value.unitsConsumed || 400_000) * 1.2));
  return { tx: build(units), quote: q, blockhash, lastValidBlockHeight, unitsConsumed: sim.value.unitsConsumed };
}

// Builds, signs (wallet) and submits the send. Returns the signature once confirmed.
export async function sendFromSolana(sol, signer, token, params, onStatus) {
  const { tx, quote, blockhash, lastValidBlockHeight } = await buildSendTx(sol, signer.publicKey.toBase58(), token, params, onStatus);
  onStatus?.("Waiting for wallet signature…");
  const signed = await signer.signTransaction(tx);
  onStatus?.("Sending…");
  const sig = await sol.connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 });
  onStatus?.("Confirming…");
  const res = await sol.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw Object.assign(new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`), { signature: sig });
  return { signature: sig, nativeFee: quote.nativeFee, amountLd: quote.amountLd };
}

// ─── Rate limits ─────────────────────────────────────────────────────────────

// Many accounts at once. publicnode refuses batches above ~10 accounts, mainnet-beta takes 100:
// small batches on the given connection, then the other public RPCs in big batches.
async function getManyAccounts(connection, keys) {
  const batches = async (conn, size) => {
    const out = [];
    for (let i = 0; i < keys.length; i += size * 4) {
      const group = [];
      for (let j = i; j < Math.min(i + size * 4, keys.length); j += size) group.push(keys.slice(j, j + size));
      out.push(...(await Promise.all(group.map((g) => conn.getMultipleAccountsInfo(g)))).flat());
    }
    return out;
  };
  try {
    return await batches(connection, 10);
  } catch (err) {
    for (const url of SOLANA_RPCS.filter((u) => u !== connection.rpcEndpoint)) {
      try { return await batches(new Connection(url, "confirmed"), 100); } catch { /* next */ }
    }
    throw err;
  }
}

// RateLimiter { capacity, tokens, refill_per_second, last_refill_time } → what can pass now
const limiterNow = (rl, now) => {
  if (!rl) return null;
  const elapsed = BigInt(now) > rl.lastRefillTime ? BigInt(now) - rl.lastRefillTime : 0n;
  const refilled = rl.tokens + elapsed * rl.refillPerSecond;
  return { available: refilled > rl.capacity ? rl.capacity : refilled, capacity: rl.capacity, rate: rl.refillPerSecond };
};
const someOrNull = (opt) => (opt && opt.__option === "Some" ? opt.value : null);

// First-gen Peer: disc 8 | address [32] | rate_limiter Option<RateLimiter> | …
function parseLegacyPeer(data) {
  const out = { peer: "0x" + Buffer.from(data.subarray(8, 40)).toString("hex"), outbound: null, inbound: null };
  if (data.length >= 73 && data[40] === 1) {
    out.outbound = {
      capacity: data.readBigUInt64LE(41), tokens: data.readBigUInt64LE(49),
      refillPerSecond: data.readBigUInt64LE(57), lastRefillTime: data.readBigUInt64LE(65),
    };
  }
  return out;
}

// Peers + their outbound/inbound rate limiters for the given EIDs (only existing peers returned).
// Amounts are in the mint's local decimals.
export async function getPeerLimits(sol, token, eids) {
  const now = Math.floor(Date.now() / 1000);
  const keys = token.legacy
    ? eids.map((e) => legacyPdas(token.programId, token.oftStore, e).peer)
    : eids.map((e) => new PublicKey(new OftPDA(umiPk(token.programId)).peer(umiPk(token.oftStore), e)[0].toString()));
  const infos = await getManyAccounts(sol.connection, keys);
  const out = [];
  eids.forEach((eid, i) => {
    const info = infos[i];
    if (!info) return;
    if (token.legacy) {
      const p = parseLegacyPeer(info.data);
      out.push({ eid, peer: p.peer, outbound: limiterNow(p.outbound, now), inbound: null });
      return;
    }
    const cfg = oft.accounts.getPeerConfigAccountDataSerializer().deserialize(info.data)[0];
    out.push({
      eid,
      peer: "0x" + Buffer.from(cfg.peerAddress).toString("hex"),
      outbound: limiterNow(someOrNull(cfg.outboundRateLimiter), now),
      inbound: limiterNow(someOrNull(cfg.inboundRateLimiter), now),
    });
  });
  return out;
}

// Tokens held in an adapter's escrow (what it can release on Solana)
export async function escrowBalance(sol, token) {
  if (!token.escrow) return null;
  const info = await sol.connection.getAccountInfo(new PublicKey(token.escrow));
  return info ? info.data.readBigUInt64LE(64) : null;
}
