import React from "react";
import useWallet from "./hooks/useWallet";
import BridgeButton from "./components/BridgeButton";
import { LogOut } from "lucide-react";

function App() {
  const { address, connect, disconnect, signer } = useWallet();

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
<button
  onClick={connect}
  className="px-6 py-2 bg-yellow-400 text-black text-sm font-semibold rounded-xl shadow hover:bg-yellow-300 transition duration-200 mx-auto block"
>
  Connect Wallet
</button>
        )}
      </div>
    </div>
  );
}

export default App;
