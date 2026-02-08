import React, { useState } from "react";
import useWallet from "../hooks/useWallet";
import NexusButton from "../components/NexusButton";
import { LogOut, X } from "lucide-react";

function Nexus() {
  const { address, connect, disconnect, signer } = useWallet();
  const [showModal, setShowModal] = useState(false);

  const handleConnect = (type) => {
    connect(type);
    setShowModal(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-cyan-50 to-purple-50 font-sans px-6">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6">
        <h1 className="text-3xl font-extrabold bg-gradient-to-r from-blue-500 via-cyan-500 to-purple-500 bg-clip-text text-transparent mb-2 text-center">
          Nexus Bridge
        </h1>
        <p className="text-center text-gray-500 text-sm mb-6">
          Cross-chain bridge powered by Nexus Protocol
        </p>

        {address ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
              <div>
                <p className="text-xs text-gray-500 mb-1">Connected Wallet</p>
                <p className="font-mono text-sm text-purple-600 font-medium">
                  {address.slice(0, 6)}...{address.slice(-4)}
                </p>
              </div>
              <button
                onClick={disconnect}
                className="p-2 rounded-full hover:bg-red-100 transition"
                title="Disconnect"
              >
                <LogOut className="w-5 h-5 text-red-500" />
              </button>
            </div>

            <NexusButton signer={signer} />
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <p className="text-gray-600 mb-4">Connect your wallet to start bridging</p>
              <button
                onClick={() => setShowModal(true)}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-sm font-semibold rounded-xl shadow-lg hover:from-blue-600 hover:to-cyan-600 transition duration-200"
              >
                Connect Wallet
              </button>
            </div>

            {showModal && (
              <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-40 z-50">
                <div className="bg-white rounded-xl shadow-lg p-6 w-80 relative">
                  <button
                    onClick={() => setShowModal(false)}
                    className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <h2 className="text-lg font-semibold mb-4 text-center">
                    Choose Wallet
                  </h2>
                  <div className="space-y-3">
                    <button
                      onClick={() => handleConnect("metamask")}
                      className="w-full flex items-center justify-center gap-2 border rounded-lg py-3 hover:bg-gray-100 transition"
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
                      className="w-full flex items-center justify-center gap-2 border rounded-lg py-3 hover:bg-gray-100 transition"
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

        {/* Info Footer */}
        <div className="mt-6 pt-4 border-t border-gray-200">
          <div className="text-xs text-gray-500 space-y-1">
            <p>✨ Powered by Nexus Protocol</p>
            <p>🔒 Always verify contract addresses before bridging</p>
            <p>💡 URL Params: <code className="bg-gray-100 px-1 py-0.5 rounded">?nexusadr=0x...</code> & <code className="bg-gray-100 px-1 py-0.5 rounded">?chainId=1</code></p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Nexus;
