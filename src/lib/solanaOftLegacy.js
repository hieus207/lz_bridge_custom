/* global BigInt */
// LayerZero's first-generation Solana OFT program ("oft" 0.0.1, `OftConfig` account) —
// still used by WIF, USDe, sUSDe, ENA… The current oft-v2-solana-sdk can't drive it, so the
// instructions are encoded here from the program's on-chain Anchor IDL; the endpoint/ULN
// accounts come from the official SendHelper, exactly as for any other OApp.
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { SendHelper } from "@layerzerolabs/lz-solana-sdk-v2";
import { ethers } from "ethers";
import { Buffer } from "buffer";

export const LEGACY_OFT_CONFIG_DISC = "32615980630f6b1b"; // sha256("account:OftConfig")[0..8]

const ixDisc = (name) => Buffer.from(ethers.getBytes(ethers.sha256(ethers.toUtf8Bytes(`global:${name}`))).subarray(0, 8));
const DISC = { quote: ixDisc("quote"), quoteOft: ixDisc("quote_oft"), send: ixDisc("send") };

const eidBE = (eid) => { const b = Buffer.alloc(4); b.writeUInt32BE(eid); return b; };

export const isLegacyConfig = (data) => Buffer.from(data.subarray(0, 8)).toString("hex") === LEGACY_OFT_CONFIG_DISC;

// OftConfig: disc 8 | ld2sdRate u64 | tokenMint | tokenProgram | endpointProgram | bump u8 | admin | ext enum
//   ext: 0 = Native(Option<Pubkey> mint authority), 1 = Adapter(Pubkey escrow)
export function parseLegacyConfig(data) {
  const pk = (o) => new PublicKey(data.subarray(o, o + 32)).toBase58();
  const tag = data[145];
  return {
    ld2sdRate: data.readBigUInt64LE(8),
    tokenMint: pk(16),
    tokenProgram: pk(48),
    endpointProgram: pk(80),
    escrow: tag === 1 ? pk(146) : null,
  };
}

export const legacyPdas = (programId, config, eid) => {
  const program = new PublicKey(programId);
  const cfg = new PublicKey(config);
  return {
    peer: PublicKey.findProgramAddressSync([Buffer.from("Peer"), cfg.toBuffer(), eidBE(eid)], program)[0],
    enforcedOptions: PublicKey.findProgramAddressSync([Buffer.from("EnforcedOptions"), cfg.toBuffer(), eidBE(eid)], program)[0],
    eventAuthority: PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], program)[0],
  };
};

// Peer account: disc 8 | address [u8; 32] | …
export async function legacyPeerAddress(connection, programId, config, eid) {
  const info = await connection.getAccountInfo(legacyPdas(programId, config, eid).peer);
  return info ? "0x" + Buffer.from(info.data.subarray(8, 40)).toString("hex") : null;
}

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const bytes = (u8) => Buffer.concat([u32(u8.length), Buffer.from(u8)]);

// QuoteParams / QuoteOftParams / SendParams share the head:
// dstEid u32 | to [32] | amountLd u64 | minAmountLd u64 | options bytes | composeMsg Option<bytes>
const head = (p) => Buffer.concat([
  u32(p.dstEid), Buffer.from(p.to), u64(p.amountLd), u64(p.minAmountLd), bytes(p.options || new Uint8Array()), Buffer.from([0]),
]);

const meta = (pubkey, isWritable = false, isSigner = false) => ({ pubkey: new PublicKey(pubkey), isWritable, isSigner });

export async function legacyQuoteIxs(connection, owner, token, p) {
  const { peer, enforcedOptions } = legacyPdas(token.programId, token.oftStore, p.dstEid);
  const peerAddr = await legacyPeerAddress(connection, token.programId, token.oftStore, p.dstEid);
  if (!peerAddr) throw new Error("No peer configured for this destination");
  const remaining = await new SendHelper().getQuoteAccounts(connection, new PublicKey(owner), new PublicKey(token.oftStore), p.dstEid, peerAddr);
  const program = new PublicKey(token.programId);
  const quote = new TransactionInstruction({
    programId: program,
    keys: [meta(token.oftStore), meta(peer), meta(enforcedOptions), meta(token.mint), ...remaining],
    data: Buffer.concat([DISC.quote, head(p), Buffer.from([0])]), // payInLzToken = false
  });
  const quoteOft = new TransactionInstruction({
    programId: program,
    keys: [meta(token.oftStore), meta(peer), meta(token.mint)],
    data: Buffer.concat([DISC.quoteOft, head(p), Buffer.from([0])]),
  });
  return { quote, quoteOft };
}

// MessagingFee: nativeFee u64 | lzTokenFee u64
export const parseMessagingFee = (buf) => ({ nativeFee: buf.readBigUInt64LE(0), lzTokenFee: buf.readBigUInt64LE(8) });

// QuoteOftResult: limits (2×u64) | Vec<{ feeAmountLd u64, description string }> | receipt (sent u64, received u64)
export function parseQuoteOft(buf) {
  let o = 16;
  const n = buf.readUInt32LE(o); o += 4;
  for (let i = 0; i < n; i++) { o += 8; o += 4 + buf.readUInt32LE(o); }
  return { amountSentLd: buf.readBigUInt64LE(o), amountReceivedLd: buf.readBigUInt64LE(o + 8) };
}

export async function legacySendIx(connection, owner, token, p, tokenSource) {
  const { peer, enforcedOptions, eventAuthority } = legacyPdas(token.programId, token.oftStore, p.dstEid);
  const peerAddr = await legacyPeerAddress(connection, token.programId, token.oftStore, p.dstEid);
  if (!peerAddr) throw new Error("No peer configured for this destination");
  const remaining = await new SendHelper().getSendAccounts(connection, new PublicKey(owner), new PublicKey(token.oftStore), p.dstEid, peerAddr);
  return new TransactionInstruction({
    programId: new PublicKey(token.programId),
    keys: [
      meta(owner, false, true),
      meta(peer, true),
      meta(enforcedOptions),
      meta(token.oftStore),
      meta(tokenSource, true),
      // Optional account: Anchor expects the program id when absent (native OFTs have no escrow)
      token.escrow ? meta(token.escrow, true) : meta(token.programId),
      meta(token.mint, true),
      meta(token.tokenProgram),
      meta(eventAuthority),
      meta(token.programId),
      ...remaining,
    ],
    data: Buffer.concat([DISC.send, head(p), u64(p.nativeFee), u64(0)]),
  });
}
