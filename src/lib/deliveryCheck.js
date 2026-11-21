/* global BigInt */
// Can the destination actually credit a transfer? A bridge happily burns or locks on the source
// and only fails on arrival when the receiving adapter may not mint (minter allowance 0, role
// revoked, token paused) or a lock/release pool is empty. Both leave the transfer stuck.
//
// EVM: eth_call the credit the adapter would perform, *from* the adapter's address —
//   mint(recipient, amount) for a mint/burn adapter, transfer(recipient, amount) for a lockbox.
//   A revert here is exactly the revert the delivery tx would hit.
// Solana: the mint authority must be the program's PDA (or a multisig that contains it).
import { ethers } from "ethers";

const CREDIT = new ethers.Interface([
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);
const PROBE_RECIPIENT = "0x000000000000000000000000000000000000dEaD";

const sel = (sig) => ethers.id(sig).slice(0, 10);
const KNOWN_ERRORS = {
  [sel("AccessControlUnauthorizedAccount(address,bytes32)")]: "adapter lacks the minter role",
  [sel("ERC20InsufficientBalance(address,uint256,uint256)")]: "adapter does not hold enough tokens",
  [sel("EnforcedPause()")]: "token is paused",
  [sel("Paused()")]: "token is paused",
  [sel("OwnableUnauthorizedAccount(address)")]: "adapter is not the token owner",
  [sel("Unauthorized()")]: "adapter is not authorized to mint",
  [sel("NotMinter()")]: "adapter is not a minter",
  [sel("Blacklisted(address)")]: "address is blacklisted",
  [sel("ERC20InvalidReceiver(address)")]: "invalid receiver",
};

// Human text for a failed eth_call
export function revertReason(err) {
  const data = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
  const hex = typeof data === "string" ? data : data?.data;
  if (typeof hex === "string" && hex.length >= 10) {
    const s = hex.slice(0, 10);
    if (s === "0x08c379a0") {
      try { return ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + hex.slice(10))[0]; } catch { /* fallthrough */ }
    }
    if (s === "0x4e487b71") return "arithmetic/assert panic (likely an underflow: allowance or balance too small)";
    if (KNOWN_ERRORS[s]) return KNOWN_ERRORS[s];
    return `reverted with ${s}`;
  }
  if (err?.reason) return err.reason;
  if (/missing revert data|execution reverted/i.test(err?.shortMessage || err?.message || "")) {
    return "reverted without a reason (no such function, or a plain require)";
  }
  return (err?.shortMessage || err?.message || String(err)).slice(0, 160);
}

const hasRevertData = (err) => {
  const d = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
  const hex = typeof d === "string" ? d : d?.data;
  return typeof hex === "string" && hex.length >= 10;
};

async function tryCall(provider, tx) {
  try { await provider.call(tx); return { ok: true }; } catch (err) { return { ok: false, err }; }
}

// mode: "mint" (adapter must mint) | "release" (expected to pay from its balance) | "auto".
// An adapter's self-description is not trusted: CYBER's Optimism OFT says approvalRequired()
// yet mints, so for "release"/"auto" both paths are tried and either passing means deliverable.
// Only "mint" (burn/mint pools and managers) is strict. The note leads with the expected path.
export async function simulateCredit(provider, { token, spender, recipient, amount, mode = "auto" }) {
  const to = recipient || PROBE_RECIPIENT;
  const amt = BigInt(amount);
  const mint = () => tryCall(provider, { to: token, from: spender, data: CREDIT.encodeFunctionData("mint", [to, amt]) });
  const release = () => tryCall(provider, { to: token, from: spender, data: CREDIT.encodeFunctionData("transfer", [to, amt]) });
  // A plain `require` (USDT-style) reverts with no data: for a payout that means "not enough held"
  const releaseNote = (err) => (hasRevertData(err) ? revertReason(err) : "adapter does not hold enough to pay this out");
  const m = await mint();
  if (m.ok) return { status: "ok", mode: "mint" };
  if (mode === "mint") return { status: "blocked", mode: "mint", note: `cannot mint: ${revertReason(m.err)}` };
  const r = await release();
  if (r.ok) return { status: "ok", mode: "release" };
  return mode === "release"
    ? { status: "blocked", mode: "release", note: `cannot release: ${releaseNote(r.err)} (mint: ${revertReason(m.err)})` }
    : { status: "blocked", mode: "mint", note: `cannot mint: ${revertReason(m.err)} (release: ${releaseNote(r.err)})` };
}

// RPC trouble (not a revert) → unknown, never a false "blocked"
export async function safeSimulateCredit(provider, args) {
  try {
    return await simulateCredit(provider, args);
  } catch (err) {
    return { status: "unknown", note: `simulation failed: ${(err?.shortMessage || err?.message || String(err)).slice(0, 100)}` };
  }
}

// ─── Solana ──────────────────────────────────────────────────────────────────
// Mint layout: COption<Pubkey> mintAuthority (4 + 32) | supply u64 | decimals u8 …
// Multisig layout (355 bytes): m u8 | n u8 | is_initialized u8 | signers [Pubkey; 11]
const TOKEN_PROGRAMS = new Set([
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
]);

export async function solanaMintAuthorityCheck(connection, mint, expectedAuthority) {
  const { PublicKey } = await import("@solana/web3.js");
  const info = await connection.getAccountInfo(new PublicKey(mint));
  if (!info || !TOKEN_PROGRAMS.has(info.owner.toBase58())) return { status: "unknown", note: "mint account not readable" };
  if (info.data.readUInt32LE(0) !== 1) return { status: "blocked", mode: "mint", note: "mint authority revoked: nothing can mint this token" };
  const authority = new PublicKey(info.data.subarray(4, 36)).toBase58();
  if (authority === expectedAuthority) return { status: "ok", mode: "mint", note: "program is the mint authority" };
  const auth = await connection.getAccountInfo(new PublicKey(authority));
  if (auth && TOKEN_PROGRAMS.has(auth.owner.toBase58()) && auth.data.length === 355) {
    const m = auth.data[0];
    const n = auth.data[1];
    const signers = [];
    for (let i = 0; i < n; i++) signers.push(new PublicKey(auth.data.subarray(3 + i * 32, 35 + i * 32)).toBase58());
    if (signers.includes(expectedAuthority)) {
      return m <= 1
        ? { status: "ok", mode: "mint", note: `mint authority is a 1-of-${n} multisig that includes the program` }
        : { status: "blocked", mode: "mint", note: `mint authority is a ${m}-of-${n} multisig: the program cannot mint alone` };
    }
    return { status: "blocked", mode: "mint", note: `mint authority is a multisig that does not include the program (${authority.slice(0, 8)}…)` };
  }
  return { status: "blocked", mode: "mint", note: `mint authority is ${authority.slice(0, 8)}…, not the bridge program` };
}

// Lockbox-style escrow on Solana: can it pay `amount`?
export function solanaEscrowCheck(held, amount) {
  if (held == null) return { status: "unknown", note: "escrow balance not readable" };
  if (amount != null && BigInt(held) < BigInt(amount)) return { status: "blocked", mode: "release", note: "escrow holds less than this transfer" };
  if (held === 0n) return { status: "blocked", mode: "release", note: "escrow is empty" };
  return { status: "ok", mode: "release" };
}
