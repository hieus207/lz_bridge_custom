import React, { useState } from "react";
import useWallet from "../hooks/useWallet";
import BridgeButton from "../components/BridgeButton";
import { LogOut, X } from "lucide-react";

function Bridge() {
  const { address, connect, disconnect, signer } = useWallet();
  const [showModal, setShowModal] = useState(false);

  const handleConnect = (type) => {
    connect(type);
    setShowModal(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 font-sans px-6">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow p-6">
        <h1 className="text-3xl font-extrabold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent mb-8 text-center">
          LZ Bridge Custom
        </h1>

        {address ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-gray-700 font-medium">
                Wallet:{" "}
                <span className="font-mono text-sm text-purple-600">
                  {address}
                </span>
              </p>
              <button
                onClick={disconnect}
                className="p-2 rounded-full hover:bg-gray-200 transition"
                title="Disconnect"
              >
                <LogOut className="w-5 h-5 text-red-500" />
              </button>
            </div>
            <BridgeButton signer={signer} />
          </div>
        ) : (
          <>
            <button
              onClick={() => setShowModal(true)}
              className="px-6 py-2 bg-yellow-400 text-black text-sm font-semibold rounded-xl shadow hover:bg-yellow-300 transition duration-200 mx-auto block"
            >
              Connect Wallet
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
                  <h2 className="text-lg font-semibold mb-4 text-center">
                    Chọn ví để kết nối
                  </h2>
                  <div className="space-y-3">
                    <button
                      onClick={() => handleConnect("metamask")}
                      className="w-full flex items-center justify-center gap-2 border rounded-lg py-2 hover:bg-gray-100"
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

export default Bridge;
