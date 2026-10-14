import React, { Suspense, lazy, useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import BridgeButton from "../components/BridgeButton";
import NexusButton from "../components/NexusButton";
import { LogOut, X } from "lucide-react";

// Solana SDKs are heavy: load them only when Solana is the source.
const SolanaOftBridge = lazy(() => import("../components/SolanaOftBridge"));

// One bridge page, two protocols: LayerZero (EVM or Solana source) and Hyperlane (ex-Nexus tab).
// URL: ?proto=hyperlane  |  ?src=solana  (default: LayerZero from an EVM chain)
const PROTOCOLS = [
  { id: "lz", label: "LayerZero" },
  { id: "hyperlane", label: "Hyperlane" },
];

// Headline in OneSwap's style: "BRIDGE CAT FROM BNB TO ETHEREUM"
function Hero({ proto, summary }) {
  const { symbol, from, to } = summary || {};
  return (
    <div className="text-center flex flex-col items-center gap-3 pt-2 md:pt-4">
      <h1 className="text-[24px] md:text-[32px] font-extrabold tracking-[0.08em] uppercase leading-tight text-gray-900">
        {proto === "hyperlane" ? (
          <>Bridge via <span className="mark">Hyperlane</span></>
        ) : symbol && from && to ? (
          <>Bridge <span className="mark">{symbol}</span> from <span className="mark">{from}</span> to <span className="mark">{to}</span></>
        ) : from ? (
          <>Bridge any <span className="mark">OFT</span> from <span className="mark">{from}</span></>
        ) : (
          <>Bridge any <span className="mark">OFT</span> across chains</>
        )}
      </h1>
      <p className="text-[12px] tracking-[0.14em] uppercase text-gray-500">
        LayerZero OFT · Hyperlane warp routes · EVM &amp; Solana — your own wallet
      </p>
    </div>
  );
}

function Bridge() {
  const wallet = useWallet();
  const { address, connect, disconnect, signer } = wallet;
  const [showModal, setShowModal] = useState(false);
  const [params, setParams] = useSearchParams();

  const proto = params.get("proto") === "hyperlane" ? "hyperlane" : "lz";
  const source = proto === "lz" && params.get("src") === "solana" ? "solana" : "evm";

  const setMode = (next) => {
    const p = new URLSearchParams(params);
    if (next.proto === "hyperlane") p.set("proto", "hyperlane"); else p.delete("proto");
    if (next.src === "solana") p.set("src", "solana"); else { p.delete("src"); p.delete("mint"); }
    setParams(p, { replace: true });
  };

  const backToEvm = (chainId) => {
    if (chainId) {
      try { localStorage.setItem("lz_current_chain", String(chainId)); } catch { /* ignore */ }
    }
    setMode({ proto: "lz", src: "evm" });
  };

  const handleConnect = (type) => {
    connect(type);
    setShowModal(false);
  };

  const needsEvm = !(proto === "lz" && source === "solana");
  const [summary, setSummary] = useState(null);
  const onSummary = useCallback((sm) => setSummary(sm), []);
  const heroSummary = proto === "lz" && source === "solana" ? { ...summary, from: "Solana" } : summary;

  return (
    <div className="flex items-start justify-center font-sans px-4 py-8">
      <div className="w-full max-w-[1240px] flex flex-col gap-6">
        <Hero proto={proto} summary={heroSummary} />

        {/* Protocol switch */}
        <div className="flex justify-center -mt-1 mb-2">
          <div className="inline-flex border-[1.5px] border-[var(--line)] bg-[var(--surface)]">
            {PROTOCOLS.map((p) => (
              <button
                key={p.id}
                onClick={() => setMode({ proto: p.id, src: p.id === "lz" ? source : "evm" })}
                className={`px-4 h-9 text-[12px] font-extrabold uppercase tracking-[0.1em] transition ${proto === p.id ? "chip-on" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {proto === "lz" && source === "solana" && (
          <Suspense fallback={<div className="text-center text-sm text-gray-400 py-10">Loading Solana…</div>}>
            <SolanaOftBridge evmAddress={address} onSourceChange={backToEvm} onSummary={onSummary} />
          </Suspense>
        )}

        {needsEvm && !address && (
          <div className="relative w-full max-w-md mx-auto bg-white rounded-2xl p-6 mt-4">
            <span className="tile-tab"><b>01</b>{proto === "hyperlane" ? "Hyperlane" : "LayerZero"}</span>
            <p className="label mb-4">Connect an EVM wallet to start</p>
            <button
              onClick={() => setShowModal(true)}
              className="btn-primary w-full h-12 text-sm"
            >
              Connect Wallet
            </button>
            {proto === "lz" && (
              <button
                onClick={() => setMode({ proto: "lz", src: "solana" })}
                className="w-full mt-3 text-xs text-gray-500 hover:text-gray-900 transition"
              >
                Bridging from Solana? Use a Solana wallet →
              </button>
            )}
          </div>
        )}

        {proto === "lz" && source === "evm" && address && (
          <BridgeButton
            signer={signer}
            address={address}
            disconnect={disconnect}
            wallet={wallet}
            onSelectSolana={() => setMode({ proto: "lz", src: "solana" })}
            onSummary={onSummary}
          />
        )}

        {proto === "hyperlane" && address && (
          <div className="relative w-full max-w-2xl mx-auto bg-white rounded-2xl p-6 space-y-4 mt-4">
            <span className="tile-tab"><b>01</b>Hyperlane</span>
            <div className="flex items-center justify-between tile-inset p-3">
              <div>
                <p className="label mb-1">Connected wallet</p>
                <p className="font-mono text-sm text-gray-900 font-medium">
                  {address.slice(0, 6)}...{address.slice(-4)}
                </p>
              </div>
              <button onClick={disconnect} className="p-2 rounded-full hover:bg-red-100 transition" title="Disconnect">
                <LogOut className="w-5 h-5 text-red-500" />
              </button>
            </div>
            <NexusButton signer={signer} wallet={wallet} />
          </div>
        )}
      </div>

      {/* Wallet selection modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
          <div className="bg-white rounded-2xl shadow-lg p-6 w-80 relative">
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold mb-4 text-center">
              Chọn ví để kết nối
            </h2>
            <div className="space-y-3">
              <button
                onClick={() => handleConnect("metamask")}
                className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-3 hover:bg-gray-50 transition"
              >
                <img
                  src="https://assets.pancakeswap.finance/web/wallets/metamask.png"
                  alt="MetaMask"
                  className="w-6 h-6"
                />
                <span className="font-medium">MetaMask</span>
              </button>
              <button
                onClick={() => handleConnect("okx")}
                className="w-full flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-3 hover:bg-gray-50 transition"
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
    </div>
  );
}

export default Bridge;
