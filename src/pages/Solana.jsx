// SolanaPage.jsx
import React, { useState } from "react";
import {
  SystemProgram,
  Transaction,
  PublicKey,
  Connection,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import useSolanaWallet from "../hooks/useSolanaWallet";
import { Buffer } from "buffer";
import BN from "bn.js";
import Alert from "../components/Alert";
import * as anchor from "@project-serum/anchor";
import idl from "../idl/launchpad.json";
import { LogOut, X, RefreshCw } from "lucide-react";

window.Buffer = Buffer;

// ===================== CONFIG =====================
const RPC = "https://small-fluent-asphalt.solana-mainnet.quiknode.pro/70dbcd6cdca9f5287bebc93e83a940bcf5642991";
const PROGRAM_ID = new PublicKey("MooNyh4CBUYEKyXVnjGYQ8mEiJDpGvJMdvrZx1iGeHV");
const LAUNCH = new PublicKey("E7kXdSdZrjVFDkLb6V7S8VihKookPviRJ7tXVik9qbdu");
const LAUNCH_SIGNER = new PublicKey("AcvcpDFo36xGzY6bYTDpWfqZ9cDqvY5kdDTKGpQfEZF4");
const LAUNCH_BASE_VAULT = new PublicKey("DGfdWcKrSuD4ftin2HmXLSq3q1V25Rbtubr2Rbw6E2dN");
const LAUNCH_QUOTE_VAULT = new PublicKey("nCqVc4ZumXbiGu9nc5P7p4G7LAHsChNSj8VRJ5zcFFs");
const MINT = new PublicKey("BANKJmvhT8tiJRsBSS1n2HryMBPvT5Ze4HU95DUAmeta");
const EVENT_AUTHORITY = new PublicKey("CT3MNSgjE5EkcpZbBVVapxDR7B8hAxMZDbNeg5nQUxyR");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// ===================== PAGE =====================
function SolanaPage() {
  const { address, connect, disconnect, signer } = useSolanaWallet();
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);
  const [fundAmount, setFundAmount] = useState("1"); // default 1 USDC
  const [launchInfo, setLaunchInfo] = useState(null);
  const [loadingLaunch, setLoadingLaunch] = useState(true);
  const [timeLeft, setTimeLeft] = useState("");
  const [launchStatus, setLaunchStatus] = useState("");
  const [alertOnComplete, setAlertOnComplete] = useState(false);
  const [alertSound, setAlertSound] = useState("https://tiengdong.com/wp-content/uploads/chay-di-cac-chau-oi-no-roi-ba-tan-vlog-ban-goc-www_tiengdong_com.mp3?_=1");
  const [autoRefresh, setAutoRefresh] = React.useState(false);
  const [refreshInterval, setRefreshInterval] = React.useState(30); // mặc định 30s
  const audioRef = React.useRef(null);
  const connection = new Connection(RPC, "confirmed");


  const provider = new anchor.AnchorProvider(connection, signer, {
    preflightCommitment: "processed",
  });
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  const makeTxLinkHtml = (txid) =>
    `<a href="https://solscan.io/tx/${txid}" style="text-decoration:underline;" target="_blank" rel="noopener noreferrer">${txid.slice(0, 6)}...${txid.slice(-4)}</a>`;

  const getFundingRecordAddr = (programId, launch, funder) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("funding_record"), launch.toBuffer(), funder.toBuffer()],
      programId
    );

  const waitAndFetchTx = async (connection, txid, attempts = 8, delayMs = 800) => {
    for (let i = 0; i < attempts; i++) {
      const info = await connection.getTransaction(txid, { commitment: "confirmed" });
      if (info) return info;
      await new Promise((res) => setTimeout(res, delayMs));
    }
    return await connection.getTransaction(txid, { commitment: "confirmed" });
  };

  const fetchLaunchInfo = async () => {
    try {
      setLoadingLaunch(true);
      const data = await program.account.launch.fetch(LAUNCH);
      setLaunchInfo(data);
      if (data.unixTimestampStarted) {
        const startTs = data.unixTimestampStarted.toNumber(); // <-- CHUẨN NHẤT
        const startDate = new Date(startTs * 1000);
        console.log("🕓 Launch started at:", startDate.toLocaleString());
      } else {
        console.log("⚠️ Không có unixTimestampStarted");
      }
      console.log(data);
      const stateKey = Object.keys(data.state)[0];
      setLaunchStatus(stateKey.toLowerCase())
    } catch (err) {
      console.error("❌ Failed to fetch launch info:", err);
      setLaunchInfo(null);
    } finally {
      setLoadingLaunch(false);
    }
  };

  React.useEffect(() => {
    fetchLaunchInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!autoRefresh) return;

    const intervalId = setInterval(() => {
      fetchLaunchInfo();
    }, refreshInterval * 1000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, refreshInterval]);

React.useEffect(() => {
  // Nếu có audio đang phát -> stop và reset
  if (audioRef.current) {
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }

  // Nếu đủ điều kiện -> phát lại
  if (alertOnComplete && launchStatus === "complete" && alertSound) {
    const audio = new Audio(alertSound);
    audioRef.current = audio;
    audio.play().catch(err => console.warn("Audio play failed:", err));
  }
}, [launchStatus, alertOnComplete, alertSound,launchInfo]);
  React.useEffect(() => {
    if (!launchInfo?.unixTimestampStarted || !launchInfo?.secondsForLaunch) return;

    const startTs = launchInfo.unixTimestampStarted.toNumber();
    const duration = launchInfo.secondsForLaunch;
    const endTs = startTs + duration;

    const timer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = endTs - now;

      if (remaining <= 0) {
        setTimeLeft("🚀 Launch ended");
        clearInterval(timer);
      } else {
        const h = Math.floor((remaining % 86400) / 3600)
          .toString()
          .padStart(2, "0");
        const m = Math.floor((remaining % 3600) / 60)
          .toString()
          .padStart(2, "0");
        const s = (remaining % 60).toString().padStart(2, "0");
        setTimeLeft(`${h}h : ${m}m : ${s}s`);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [launchInfo]);

  // ================= FUND =================
  const handleFund = async () => {
    if (!signer) return setAlert({ type: "error", message: "Chưa connect wallet" });
    setLoading(true);

    try {
      const user = signer.publicKey;
      const decimals = 6; // USDC decimals
      const AMOUNT = new BN(Math.floor(parseFloat(fundAmount) * 10 ** decimals));

      // Compute budget
      const ix1 = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 });
      const ix2 = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });

      // ATA
      const funderQuoteAccount = getAssociatedTokenAddressSync(USDC, user, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const ix3 = createAssociatedTokenAccountIdempotentInstruction(user, funderQuoteAccount, user, USDC);

      const [fundingRecord] = getFundingRecordAddr(PROGRAM_ID, LAUNCH, user);

      const fundIx = await program.methods.fund(AMOUNT).accounts({
        launch: LAUNCH,
        fundingRecord: fundingRecord,
        launchSigner: LAUNCH_SIGNER,
        launchQuoteVault: LAUNCH_QUOTE_VAULT,
        funder: user,
        payer: user,
        funderQuoteAccount: funderQuoteAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: EVENT_AUTHORITY,
        program: PROGRAM_ID,
      }).instruction();

      const tx = new Transaction().add(ix1, ix2, ix3, fundIx);
      tx.feePayer = user;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

      const signedTx = await signer.signTransaction(tx);
      const txid = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true });

      const info = await waitAndFetchTx(connection, txid);

      if (!info) setAlert({ type: "warning", message: `Fund sent (pending). ${makeTxLinkHtml(txid)}` });
      else if (info.meta?.err) setAlert({ type: "error", message: `Fund failed: ${makeTxLinkHtml(txid)}` });
      else setAlert({ type: "success", message: `Fund successful! ${makeTxLinkHtml(txid)}` });

    } catch (err) {
      console.error("❌ Fund failed:", err);
      setAlert({ type: "error", message: "Fund failed: " + (err?.message ? err.message.substring(0, 200) + "..." : "Unknown error") });
    }

    setLoading(false);
  };

  // ================= CLAIM =================
  const handleClaim = async () => {
    if (!signer) return setAlert({ type: "error", message: "Chưa connect wallet" });
    setLoading(true);

    try {
      const user = signer.publicKey;
      const ix1 = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 });
      const ix2 = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });

      const funderTokenAccount = getAssociatedTokenAddressSync(MINT, user, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const ix3 = createAssociatedTokenAccountIdempotentInstruction(user, funderTokenAccount, user, MINT);

      const [fundingRecord] = getFundingRecordAddr(PROGRAM_ID, LAUNCH, user);

      const claimIx = await program.methods.claim().accounts({
        launch: LAUNCH,
        fundingRecord: fundingRecord,
        launchSigner: LAUNCH_SIGNER,
        baseMint: MINT,
        launchBaseVault: LAUNCH_BASE_VAULT,
        funder: user,
        funderTokenAccount: funderTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: EVENT_AUTHORITY,
        program: PROGRAM_ID,
      }).instruction();

      const tx = new Transaction().add(ix1, ix2, ix3, claimIx);
      tx.feePayer = user;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

      const signed = await signer.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      const info = await waitAndFetchTx(connection, sig);

      if (!info) setAlert({ type: "warning", message: `Claim sent (pending). ${makeTxLinkHtml(sig)}` });
      else if (info.meta?.err) setAlert({ type: "error", message: `Claim failed: ${makeTxLinkHtml(sig)}` });
      else setAlert({ type: "success", message: `Claim successful! ${makeTxLinkHtml(sig)}` });

    } catch (err) {
      console.error("Claim error:", err);
      setAlert({ type: "error", message: "Claim failed: " + (err?.message ? err.message.substring(0, 200) + "..." : "Unknown error") });
    }

    setLoading(false);
  };

  // ================= REFUND =================
  const handleRefund = async () => {
    if (!signer) return setAlert({ type: "error", message: "Chưa connect wallet" });
    setLoading(true);

    try {
      const user = signer.publicKey;
      const ix1 = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 });
      const ix2 = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });

      const funderQuoteAccount = getAssociatedTokenAddressSync(USDC, user, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const ix3 = createAssociatedTokenAccountIdempotentInstruction(user, funderQuoteAccount, user, USDC);

      const [fundingRecord] = getFundingRecordAddr(PROGRAM_ID, LAUNCH, user);

      const refundIx = await program.methods.refund().accounts({
        launch: LAUNCH,
        fundingRecord: fundingRecord,
        launchQuoteVault: LAUNCH_QUOTE_VAULT,
        launchSigner: LAUNCH_SIGNER,
        funder: user,
        funderQuoteAccount: funderQuoteAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        eventAuthority: EVENT_AUTHORITY,
        program: PROGRAM_ID,
      }).instruction();

      const tx = new Transaction().add(ix1, ix2, ix3, refundIx);
      tx.feePayer = user;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

      const signedTx = await signer.signTransaction(tx);
      const txid = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true });
      const info = await waitAndFetchTx(connection, txid);

      if (!info) setAlert({ type: "warning", message: `Refund sent (pending). ${makeTxLinkHtml(txid)}` });
      else if (info.meta?.err) setAlert({ type: "error", message: `Refund failed: ${makeTxLinkHtml(txid)}` });
      else setAlert({ type: "success", message: `Refund successful! ${makeTxLinkHtml(txid)}` });

    } catch (err) {
      console.error("❌ Refund failed:", err);
      setAlert({ type: "error", message: "Refund failed: " + (err?.message ? err.message.substring(0, 200) + "..." : "Unknown error") });
    }

    setLoading(false);
  };

  // ================= UI =================
  const handleConnect = (type) => { connect(type); setShowModal(false); };

return (
  <div className="min-h-screen flex items-center justify-center bg-gray-50 font-sans px-6 py-12">
    <div className="w-full max-w-2xl bg-white rounded-2xl shadow-lg p-8 space-y-6">
      <h1 className="text-3xl font-extrabold bg-gradient-to-r from-green-500 to-teal-500 bg-clip-text text-transparent text-center">
        Metadao UI Demo
      </h1>

 <div className="max-w-2xl mx-auto p-6">
    {/* ====== Launch Info Section ====== */}
    <div className="border rounded-xl p-4 bg-gray-50 text-sm relative">
      <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center justify-between">
        Launch Information
        <button
          onClick={fetchLaunchInfo}
          title="Refresh Launch Info"
          className="text-gray-500 hover:text-green-600 transition p-1"
        >
          <RefreshCw className={`w-4 h-4 ${loadingLaunch ? "animate-spin" : ""}`} />
        </button>
      </h2>

      {loadingLaunch ? (
        <p className="text-gray-500 italic">Loading launch info...</p>
      ) : launchInfo ? (
        <>
          <div className="grid grid-cols-[150px_1fr] gap-y-2 gap-x-4">
            <div className="font-medium text-gray-600">Launch Address:</div>
            <div className="font-mono text-gray-800 break-all">
              <a
                href={`https://solscan.io/account/${LAUNCH.toBase58()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {LAUNCH.toBase58()}
              </a>
            </div>

            <div className="font-medium text-gray-600">Token Sale Address:</div>
            <div className="font-mono text-gray-800 break-all">
              <a
                href={`https://solscan.io/token/${launchInfo.baseMint.toBase58()}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {launchInfo.baseMint.toBase58()}
              </a>
            </div>

            <div className="font-medium text-gray-600">Status:</div>
            <div className="text-green-600 font-semibold">{launchStatus}</div>

            <div className="font-medium text-gray-600">Min Raise:</div>
            <div className="font-mono text-gray-800">
              {launchInfo.minimumRaiseAmount
                ? (launchInfo.minimumRaiseAmount.toNumber() / 10 ** 6).toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })
                : "?"}{" "}
              USDC
            </div>

            <div className="font-medium text-gray-600">Total Committed:</div>
            <div className="font-mono text-gray-800 font-bold">
              {launchInfo.totalCommittedAmount
                ? (launchInfo.totalCommittedAmount.toNumber() / 10 ** 6).toLocaleString("en-US", {
                    maximumFractionDigits: 2,
                  })
                : "?"}{" "}
              USDC
            </div>

            <div className="font-medium text-gray-600">Time Remaining:</div>
            <div className="font-mono text-gray-800">{timeLeft || "Loading..."}</div>
          </div>

          <hr className="my-3" />

          {/* ====== Alert Section ====== */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={alertOnComplete}
                onChange={(e) => setAlertOnComplete(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-gray-700 font-medium">
                Alert when status is Completed
              </span>
            </label>
          </div>

          {alertOnComplete && (
            <div className="mt-2">
              <input
                type="text"
                value={alertSound}
                onChange={(e) => setAlertSound(e.target.value)}
                placeholder="Enter MP3 link..."
                className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
          )}
          {/* Auto Refresh */}
          <hr className="my-3" />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-gray-700 font-medium">Auto refresh every</span>
            </label>

            {autoRefresh && (
              <input
                type="number"
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="border rounded px-2 py-1 w-20 text-center focus:outline-none focus:ring-2 focus:ring-green-400"
                min="5"
                step="1"
              />
            )}
            {autoRefresh && <span className="text-gray-600 text-sm">seconds</span>}
          </div>

        </>
      ) : (
        <p className="text-red-500">Không có dữ liệu launch info.</p>
      )}
    </div>
  </div>

      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
          duration={10000}
        />
      )}

      {address ? (
        <div className="space-y-4">
          {/* Wallet Info */}
          <div className="flex items-center justify-between">
            <p className="text-gray-700 font-medium">
              Wallet: <span className="font-mono text-sm text-green-600">{address}</span>
            </p>
            <button onClick={disconnect} className="p-2 rounded-full hover:bg-gray-200 transition">
              <LogOut className="w-5 h-5 text-red-500" />
            </button>
          </div>

          {/* Input fund amount */}
          <div className="flex items-center gap-3">
            <label className="font-medium text-gray-700">Fund Amount (USDC):</label>
            <input
              type="number"
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              className="border rounded px-3 py-2 w-32 text-right focus:outline-none focus:ring-2 focus:ring-green-400"
              min="0"
              step="0.01"
            />
          </div>

          <div className="flex gap-4">
            <button
              onClick={handleFund}
              disabled={loading}
              className="flex-1 bg-green-500 hover:bg-green-400 text-white py-2 rounded-xl font-semibold disabled:opacity-50"
            >
              {loading ? "Processing..." : "Fund"}
            </button>
            <button
              onClick={handleClaim}
              disabled={loading}
              className="flex-1 bg-blue-500 hover:bg-blue-400 text-white py-2 rounded-xl font-semibold disabled:opacity-50"
            >
              {loading ? "Processing..." : "Claim"}
            </button>
            <button
              onClick={handleRefund}
              disabled={loading}
              className="flex-1 bg-red-500 hover:bg-red-400 text-white py-2 rounded-xl font-semibold disabled:opacity-50"
            >
              {loading ? "Processing..." : "Refund"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={() => setShowModal(true)}
            className="px-6 py-2 bg-green-400 text-black text-sm font-semibold rounded-xl shadow hover:bg-green-300 transition mx-auto block"
          >
            Connect Solana Wallet
          </button>

          {showModal && (
            <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
              <div className="bg-white rounded-xl shadow-lg p-6 w-80 relative">
                <button
                  onClick={() => setShowModal(false)}
                  className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
                >
                  <X className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-semibold mb-4 text-center">Chọn ví Solana</h2>
                <div className="space-y-3">
                  <button
                    onClick={() => handleConnect("phantom")}
                    className="w-full flex items-center justify-center gap-2 border rounded-lg py-2 hover:bg-gray-100"
                  >
                    <img
                      src="https://cryptologos.cc/logos/phantom-phantom-logo.png"
                      alt="Phantom"
                      className="w-6 h-6"
                    />
                    <span className="font-medium">Phantom</span>
                  </button>
                  <button
                    onClick={() => handleConnect("solflare")}
                    className="w-full flex items-center justify-center gap-2 border rounded-lg py-2 hover:bg-gray-100"
                  >
                    <img
                      src="https://solflare.com/static/media/logo.5828b7b6.svg"
                      alt="Solflare"
                      className="w-6 h-6"
                    />
                    <span className="font-medium">Solflare</span>
                  </button>
                  <button
                    onClick={() => handleConnect("okx")}
                    className="w-full flex items-center justify-center gap-2 border rounded-lg py-2 hover:bg-gray-100"
                  >
                    <img
                      src="https://assets.pancakeswap.finance/web/wallets/okx-wallet.png"
                      alt="OKX"
                      className="w-6 h-6"
                    />
                    <span className="font-medium">OKX Wallet</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  </div>
);

}

export default SolanaPage;
