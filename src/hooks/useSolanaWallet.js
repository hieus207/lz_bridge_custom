import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

const LAST_KEY = "sol_wallet_type";

const resolve = (type) => {
  if (type === "phantom") return window.phantom?.solana;
  if (type === "solflare") return window.solflare;
  if (type === "okx") return window.okxwallet?.solana; // OKX Wallet hỗ trợ Solana
  return null;
};

export default function useSolanaWallet() {
  const [address, setAddress] = useState(null);
  const [provider, setProvider] = useState(null);
  const [walletType, setWalletType] = useState(null);

  // ====== connect ======
  const connect = async (type, { silent = false } = {}) => {
    try {
      const wallet = resolve(type);
      if (!wallet) {
        if (!silent) alert(`Không tìm thấy ví ${type}`);
        return;
      }
      // onlyIfTrusted: reconnect without a popup when the site is already approved
      const resp = await wallet.connect(silent ? { onlyIfTrusted: true } : undefined);
      const pk = resp?.publicKey || wallet.publicKey;
      setAddress(pk.toString());
      setProvider(wallet);
      setWalletType(type);
      try { localStorage.setItem(LAST_KEY, type); } catch { /* ignore */ }
    } catch (err) {
      if (!silent) console.error("Connect error:", err);
    }
  };

  // ====== disconnect ======
  const disconnect = async () => {
    try {
      await provider?.disconnect?.();
    } catch {}
    try { localStorage.removeItem(LAST_KEY); } catch { /* ignore */ }
    setAddress(null);
    setProvider(null);
    setWalletType(null);
  };

  // Restore the last wallet after F5
  useEffect(() => {
    let last = null;
    try { last = localStorage.getItem(LAST_KEY); } catch { /* ignore */ }
    if (last) connect(last, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow account switches inside the wallet
  useEffect(() => {
    if (!provider?.on) return;
    const onChange = (pk) => {
      if (pk) setAddress(pk.toString());
      else if (provider.publicKey) setAddress(provider.publicKey.toString());
    };
    provider.on("accountChanged", onChange);
    return () => provider.removeListener?.("accountChanged", onChange);
  }, [provider]);

  // ====== signer (object giúp gửi tx) ======
  // Methods are bound: wallet providers rely on `this`.
  const signer = provider && address
    ? {
        publicKey: new PublicKey(address),
        signTransaction: (tx) => provider.signTransaction(tx),
        signAllTransactions: (txs) => provider.signAllTransactions(txs),
      }
    : null;

  return { address, connect, disconnect, signer, walletType };
}
