import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { addChainParams, toHexChainId, chainName } from "../lib/chains";

// ==== PROVIDER DISCOVERY ====
// EIP-6963 lets every installed wallet announce itself, so we get the exact
// provider the user picked instead of whichever extension won window.ethereum.
const RDNS = { metamask: "io.metamask", okx: "com.okex.wallet" };
const announced = new Map(); // rdns -> EIP-1193 provider

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => {
    if (e.detail?.info?.rdns) announced.set(e.detail.info.rdns, e.detail.provider);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

const legacyProviders = () => {
  const eth = window.ethereum;
  return [...(eth?.providers || (eth ? [eth] : [])), window.okxwallet].filter(Boolean);
};

const resolveProvider = (type) => {
  if (type && announced.has(RDNS[type])) return announced.get(RDNS[type]);
  const list = legacyProviders();
  // OKX sets isMetaMask=true when it takes over window.ethereum — exclude it explicitly.
  if (type === "okx") return window.okxwallet || list.find((p) => p.isOkxWallet) || null;
  if (type === "metamask") return list.find((p) => p.isMetaMask && !p.isOkxWallet) || null;
  return announced.values().next().value || list[0] || null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readChainId = async (raw) => parseInt(await raw.request({ method: "eth_chainId" }), 16);
const errCode = (err) => err?.code ?? err?.data?.originalError?.code ?? err?.error?.code;

function useWallet() {
  const [address, setAddress] = useState(null);
  const [signer, setSigner] = useState(null);
  const [walletType, setWalletType] = useState(null); // "metamask" | "okx"
  const [walletProvider, setWalletProvider] = useState(null); // raw EIP-1193 provider
  const [chainId, setChainId] = useState(null); // chain the wallet is currently on

  const attach = useCallback(async (raw, type, prompt) => {
    const accounts = await raw.request({ method: prompt ? "eth_requestAccounts" : "eth_accounts" });
    if (!accounts?.length) throw new Error("No account authorized");
    const bp = new ethers.BrowserProvider(raw, "any");
    const s = await bp.getSigner(accounts[0]);
    setWalletProvider(raw);
    setWalletType(type);
    setAddress(ethers.getAddress(accounts[0]));
    setSigner(s);
    setChainId(await readChainId(raw));
  }, []);

  // ==== CONNECT ====
  const connect = async (type = null) => {
    const raw = resolveProvider(type);
    if (!raw) {
      alert(type === "okx" ? "OKX Wallet not found" : type === "metamask" ? "MetaMask not found" : "Please install MetaMask or OKX Wallet!");
      return;
    }
    try {
      await attach(raw, type, true);
      localStorage.setItem("isWalletConnected", "true");
      localStorage.setItem("walletType", type || "");
    } catch (err) {
      console.error("Wallet connect error:", err);
    }
  };

  // ==== DISCONNECT ====
  const disconnect = useCallback(() => {
    setAddress(null);
    setSigner(null);
    setWalletType(null);
    setWalletProvider(null);
    setChainId(null);
    localStorage.removeItem("isWalletConnected");
    localStorage.removeItem("walletType");
  }, []);

  // ==== AUTO CONNECT ====
  useEffect(() => {
    if (localStorage.getItem("isWalletConnected") !== "true") return;
    (async () => {
      await sleep(200); // let EIP-6963 announcements arrive
      const savedType = localStorage.getItem("walletType") || null;
      const raw = resolveProvider(savedType);
      if (!raw) return;
      try {
        await attach(raw, savedType, false);
      } catch (err) {
        console.error("Auto connect failed:", err);
        localStorage.removeItem("isWalletConnected");
      }
    })();
  }, [attach]);

  // ==== WALLET EVENTS (on the provider we actually use, not window.ethereum) ====
  useEffect(() => {
    if (!walletProvider?.on) return;
    const refreshSigner = (account) =>
      new ethers.BrowserProvider(walletProvider, "any").getSigner(account).then(setSigner).catch(() => {});
    const onChainChanged = (hex) => {
      setChainId(parseInt(hex, 16));
      refreshSigner();
    };
    const onAccountsChanged = (accounts) => {
      if (!accounts?.length) return disconnect();
      setAddress(ethers.getAddress(accounts[0]));
      refreshSigner(accounts[0]);
    };
    walletProvider.on("chainChanged", onChainChanged);
    walletProvider.on("accountsChanged", onAccountsChanged);
    return () => {
      walletProvider.removeListener?.("chainChanged", onChainChanged);
      walletProvider.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, [walletProvider, disconnect]);

  // ==== SWITCH CHAIN ====
  // Resolves only once the wallet really reports the target chain: some wallets
  // (OKX included) resolve wallet_switchEthereumChain before the switch lands.
  const switchChain = useCallback(async (targetId, { rpcUrl } = {}) => {
    const raw = walletProvider;
    if (!raw) throw new Error("Wallet not connected");
    targetId = Number(targetId);
    const from = await readChainId(raw);
    if (from === targetId) return;

    const hex = toHexChainId(targetId);
    try {
      await raw.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (err) {
      const code = errCode(err);
      if (code === 4001) throw new Error("Network switch rejected in wallet");
      if (code === -32002) throw new Error("A network switch request is already open in your wallet");
      if (code === 4902 || /unrecognized chain|not been added|unknown chain/i.test(err?.message || "")) {
        const params = addChainParams(targetId, rpcUrl);
        if (!params) throw new Error(`Wallet doesn't know chain ${targetId} and no RPC is configured to add it`);
        await raw.request({ method: "wallet_addEthereumChain", params: [params] });
        await raw.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }).catch(() => {});
      } else {
        throw err;
      }
    }

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if ((await readChainId(raw)) === targetId) {
        setChainId(targetId);
        return;
      }
      await sleep(300);
    }
    throw new Error(`Wallet is still on ${chainName(from)}. Switch to ${chainName(targetId)} in the wallet and retry.`);
  }, [walletProvider]);

  // ==== SIGNER FOR A TX ====
  // Always use this before sending: guarantees the wallet is on `targetId`
  // and returns a fresh signer bound to that chain.
  const getSigner = useCallback(async (targetId, opts) => {
    if (!walletProvider) throw new Error("Wallet not connected");
    await switchChain(targetId, opts);
    const bp = new ethers.BrowserProvider(walletProvider);
    const net = await bp.getNetwork();
    if (Number(net.chainId) !== Number(targetId)) {
      throw new Error(`Wallet is on ${chainName(Number(net.chainId))}, expected ${chainName(Number(targetId))}`);
    }
    return bp.getSigner(address || undefined);
  }, [walletProvider, switchChain, address]);

  return {
    address, signer, walletType, walletProvider, chainId,
    connect, disconnect, switchChain, getSigner,
  };
}

export default useWallet;
