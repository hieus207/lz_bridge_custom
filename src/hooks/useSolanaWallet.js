import { useState } from "react";
import { PublicKey } from "@solana/web3.js";

export default function useSolanaWallet() {
  const [address, setAddress] = useState(null);
  const [provider, setProvider] = useState(null);

  // ====== connect ======
  const connect = async (type) => {
    try {
      let wallet;
      if (type === "phantom") {
        wallet = window.phantom?.solana;
      } else if (type === "solflare") {
        wallet = window.solflare;
      } else if (type === "okx") {
        wallet = window.okxwallet?.solana; // OKX Wallet hỗ trợ Solana
      }

      if (!wallet) {
        alert(`Không tìm thấy ví ${type}`);
        return;
      }

      const resp = await wallet.connect();
      setAddress(resp.publicKey.toString());
      setProvider(wallet);
    } catch (err) {
      console.error("Connect error:", err);
    }
  };

  // ====== disconnect ======
  const disconnect = async () => {
    try {
      await provider?.disconnect?.();
    } catch {}
    setAddress(null);
    setProvider(null);
  };

  // ====== signer (object giúp gửi tx) ======
  const signer = provider
    ? {
        publicKey: new PublicKey(address),
        signTransaction: provider.signTransaction,
        signAllTransactions: provider.signAllTransactions,
      }
    : null;

  return { address, connect, disconnect, signer };
}
