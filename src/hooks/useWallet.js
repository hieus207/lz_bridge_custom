import { useState, useEffect } from "react";
import { ethers } from "ethers";

function useWallet() {
  const [address, setAddress] = useState(null);
  const [signer, setSigner] = useState(null);
  const [walletType, setWalletType] = useState(null); // "metamask" hoặc "okx"

  // ==== CHỌN PROVIDER ====
const getProvider = (type = null) => {
  if (window.ethereum?.providers) {
    const okx = window.ethereum.providers.find((p) => p.isOkxWallet);
    const metamask = window.ethereum.providers.find((p) => p.isMetaMask);
    if (type === "okx" && okx) return okx;
    if (type === "metamask" && metamask) return metamask;
    if (okx) return okx;
    if (metamask) return metamask;
  }
  if (window.okxwallet && (!type || type === "okx")) return window.okxwallet;
  if (window.ethereum) return window.ethereum;
  return null;
};

  // ==== CONNECT ====
  const connect = async (type = null) => {
    const providerObj = getProvider(type);
    if (!providerObj) {
      alert("Please install MetaMask or OKX Wallet!");
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(providerObj);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();

      setAddress(addr);
      setSigner(signer);
      localStorage.setItem("isWalletConnected", "true");
      localStorage.setItem("walletType", walletType || type);
    } catch (err) {
      console.error("Wallet connect error:", err);
    }
  };


  // ==== DISCONNECT ====
  const disconnect = () => {
    setAddress(null);
    setSigner(null);
    setWalletType(null);
    localStorage.removeItem("isWalletConnected");
    localStorage.removeItem("walletType");
  };

  // ==== AUTO CONNECT ====
  useEffect(() => {
    const autoConnect = async () => {
      if (
        localStorage.getItem("isWalletConnected") === "true" &&
        (window.ethereum || window.okxwallet)
      ) {
        try {
          const providerObj = getProvider();
          const provider = new ethers.BrowserProvider(providerObj);
          const signer = await provider.getSigner();
          const addr = await signer.getAddress();

          setAddress(addr);
          setSigner(signer);
        } catch (err) {
          console.error("Auto connect failed:", err);
          localStorage.removeItem("isWalletConnected");
        }
      }
    };

    autoConnect();
  }, []);

  return { address, signer, walletType, connect, disconnect };
}

export default useWallet;
