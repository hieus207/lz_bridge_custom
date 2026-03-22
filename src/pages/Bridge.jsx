import React, { useState } from "react";
import useWallet from "../hooks/useWallet";
import BridgeButton from "../components/BridgeButton";
import { X } from "lucide-react";

function Bridge() {
  const { address, connect, disconnect, signer } = useWallet();
  const [showModal, setShowModal] = useState(false);

  const handleConnect = (type) => {
    connect(type);
    setShowModal(false);
  };

  return (
    <div className="min-h-screen flex items-start justify-center bg-[#f5f0e6] font-sans px-4 py-8">
      <div className="w-full max-w-7xl">
        {address ? (
          <BridgeButton signer={signer} address={address} disconnect={disconnect} />
        ) : (
          <div className="w-full max-w-md mx-auto bg-white rounded-2xl shadow-lg overflow-hidden p-6">
            <h1 className="text-xl font-bold text-gray-900 mb-6 text-center">LZ Bridge</h1>
            <button
              onClick={() => setShowModal(true)}
              className="w-full px-6 py-3 bg-gray-900 text-white text-sm font-semibold rounded-xl shadow hover:bg-gray-800 transition duration-200"
            >
              Connect Wallet
            </button>
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
