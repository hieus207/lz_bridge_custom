import { useState, useEffect } from "react";
import { ethers } from "ethers";
import oftAbi from "../abis/OFT.json";
import Alert from "./Alert";
import SendParamsEditor from "./SendParamsEditor";
import { LogOut } from "lucide-react";
// import OftScanner from "./OftScanner";

// CoinGecko platform ID mapping
const CGC_PLATFORMS = {
  1: "ethereum",
  56: "binance-smart-chain",
  137: "polygon-pos",
  43114: "avalanche",
  42161: "arbitrum-one",
  10: "optimistic-ethereum",
  8453: "base",
};

const CHAINS = {
  Ethereum: 30101,
  BSC: 30102,
  Polygon: 30109,
  Arbitrum: 30110,
  Optimism: 30111,
  Avalanche: 30106,
  Sonic: 30332,
  Base: 30184,
  Solana: 30168,
  Custom: null,
};

const SUPPORTED_CHAINS = {
  1: { name: "Ethereum", hex: "0x1" },
  56: { name: "BNB", hex: "0x38" },
  137: { name: "Polygon", hex: "0x89" },
  43114: { name: "Avalanche", hex: "0xa86a" },
  42161: { name: "Arbitrum", hex: "0xa4b1" },
  10: { name: "Optimism", hex: "0xa" },
  8453: { name: "Base", hex: "0x2105" },
};

// Per-chain RPC endpoints with fallbacks
const CHAIN_RPCS = {
  1: [
    "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://eth.rpc.blxrbdn.com",
    "https://ethereum-rpc.publicnode.com",
  ],
  56: [
    "https://bsc-dataseed.binance.org",
    "https://bsc-dataseed1.defibit.io",
    "https://bsc-dataseed1.ninicoin.io",
    "https://bsc.publicnode.com",
  ],
  137: [
    "https://polygon-rpc.com",
    "https://rpc.ankr.com/polygon",
    "https://polygon.llamarpc.com",
    "https://polygon-bor-rpc.publicnode.com",
  ],
  43114: [
    "https://api.avax.network/ext/bc/C/rpc",
    "https://rpc.ankr.com/avalanche",
    "https://avalanche.public-rpc.com",
    "https://avalanche-c-chain-rpc.publicnode.com",
  ],
  42161: [
    "https://arb1.arbitrum.io/rpc",
    "https://rpc.ankr.com/arbitrum",
    "https://arbitrum.llamarpc.com",
    "https://arbitrum-one-rpc.publicnode.com",
  ],
  10: [
    "https://mainnet.optimism.io",
    "https://rpc.ankr.com/optimism",
    "https://optimism.llamarpc.com",
    "https://optimism-rpc.publicnode.com",
  ],
  8453: [
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
    "https://base-rpc.publicnode.com",
    "https://1rpc.io/base",
  ],
};

const RPC_TAB_LABELS = ["Def", "Fb1", "Fb2", "Fb3", "Cus"];
const CUSTOM_RPC_INDEX = 4;

const BridgeButton = ({ signer, address, disconnect }) => {
  const [oftAddress, setOftAddress] = useState("");
  const [amount, setAmount] = useState("5");
  const [info, setInfo] = useState(null);
  const [sendParams, setSendParams] = useState(null);
  const [dstChain, setDstChain] = useState("Ethereum");
  const [oftContract, setOftContract] = useState(null);
  const [dstEidValue, setDstEidValue] = useState(CHAINS[dstChain]);
  const [useWalletRpc, setUseWalletRpc] = useState(() => localStorage.getItem("lz_use_wallet_rpc") === "true");
  const [provider, setProvider] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);
  const [alert, setAlert] = useState(null);
  const [autoCheck, setAutoCheck] = useState(false);
  const [balance, setBalance] = useState("0");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [checking, setChecking] = useState(false);
  const [customChain, setCustomChain] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lz_custom_chain") || "null"); } catch { return null; }
  });
  const [customChainInput, setCustomChainInput] = useState("");
  const [customChainRpcInput, setCustomChainRpcInput] = useState("");

  // RPC fallback system
  const [rpcIndexes, setRpcIndexes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lz_rpc_indexes") || "{}"); } catch { return {}; }
  });
  const [selectedRpcTab, setSelectedRpcTab] = useState(0);
  const [rpcStatus, setRpcStatus] = useState("unchecked");
  const [showRpcDetail, setShowRpcDetail] = useState(false);
  const [customRpcs, setCustomRpcs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lz_custom_rpcs") || "{}"); } catch { return {}; }
  });
  const [customRpcInput, setCustomRpcInput] = useState("");

  const [approvalRequired, setApprovalRequired] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [listingStatus, setListingStatus] = useState(null);
  const [cgcLink, setCgcLink] = useState(null);
  const [tokenImage, setTokenImage] = useState(null);
  const [savedRoutes, setSavedRoutes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lz_saved_routes") || "[]"); } catch { return []; }
  });
  const [showSavedRoutes, setShowSavedRoutes] = useState(false);
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  // const [showOftScanner, setShowOftScanner] = useState(false);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);

  const adr = params.get("oftadr");
  if (adr && ethers.isAddress(adr)) {
    setOftAddress(adr);
  }

  const chainIdParam = params.get("chainId");
  if (chainIdParam && window.ethereum) {
    const parsed = parseInt(chainIdParam, 10);
    if (!isNaN(parsed)) {
      const chain = SUPPORTED_CHAINS[parsed];
      if (chain) {
        switchChain(chain.hex);
        setCurrentChainId(parsed);
      }
    }
  }
  const auto = params.get("auto");
  if (auto) {
    console.log("auto check enabled");
    setAutoCheck(auto);
  }
}, []);

useEffect(() => {
  if (oftAddress && currentChainId && provider && autoCheck) {
    console.log(autoCheck);
    handleCheck(oftAddress, currentChainId);
    setAutoCheck(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [oftAddress, currentChainId, provider, autoCheck]);

  // Reset to before-check when chain changes so user can re-verify
  useEffect(() => {
    if (info && currentChainId) {
      setInfo(null);
      setOftContract(null);
      setSendParams(null);
      setBalance("0");
      // Auto re-check if we already have an address
      if (oftAddress && ethers.isAddress(oftAddress)) {
        setTimeout(() => handleCheck(), 500);
      }
    }
    // Sync RPC tab to the active index for this chain
    if (currentChainId) {
      setSelectedRpcTab(rpcIndexes[currentChainId] || 0);
      setRpcStatus("unchecked");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChainId]);

  // Chain changed → reset info and auto re-check is handled below

// Get RPC URL for given chain and index (handles custom tab)
const getRpcUrl = (chainId, idx) => {
  if (idx === CUSTOM_RPC_INDEX) return customRpcs[chainId] || null;
  return CHAIN_RPCS[chainId]?.[idx] || null;
};

// Apply a specific RPC tab as active
const applyRpcTab = async (tabIndex) => {
  if (!currentChainId) return;
  const rpcUrl = getRpcUrl(currentChainId, tabIndex);
  if (!rpcUrl) {
    if (tabIndex === CUSTOM_RPC_INDEX) {
      setSelectedRpcTab(tabIndex);
      setShowRpcDetail(true);
      setCustomRpcInput(customRpcs[currentChainId] || "");
    }
    return;
  }

  try {
    const testProvider = new ethers.JsonRpcProvider(rpcUrl);
    await testProvider.getNetwork();
    
    const newIndexes = { ...rpcIndexes, [currentChainId]: tabIndex };
    setRpcIndexes(newIndexes);
    localStorage.setItem("lz_rpc_indexes", JSON.stringify(newIndexes));
    setProvider(testProvider);
    setSelectedRpcTab(tabIndex);
    setRpcStatus("working");
    setAlert({ type: "success", message: `RPC ${RPC_TAB_LABELS[tabIndex]} applied!` });
  } catch (error) {
    console.error("RPC test failed:", error);
    setRpcStatus("error");
    setAlert({ type: "error", message: `RPC ${RPC_TAB_LABELS[tabIndex]} failed: ${error?.message?.substring(0, 80) || "Unknown"}` });
  }
};

// Ensure wallet is on the correct chain before sending tx
const ensureWalletChain = async (chainId) => {
  if (!window.ethereum) return;
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) return;

  try {
    const currentHex = await window.ethereum.request({ method: "eth_chainId" });
    const current = parseInt(currentHex, 16);
    if (current !== chainId) {
      await switchChain(chain.hex);
      // Wait a bit for the wallet to settle
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (err) {
    throw new Error("Failed to switch wallet chain: " + (err?.message?.substring(0, 80) || ""));
  }
};

// Try a provider call with automatic RPC fallback
const tryWithFallback = async (chainId, fn) => {
  if (useWalletRpc) {
    return await fn(provider);
  }

  const builtIn = CHAIN_RPCS[chainId] || [];
  const customUrl = customRpcs[chainId];
  if (builtIn.length === 0 && !customUrl) return await fn(provider);

  // Bắt đầu từ RPC đang dùng (đã test thành công)
  const startIdx = rpcIndexes[chainId] || 0;
  const startUrl = startIdx === CUSTOM_RPC_INDEX ? customUrl : builtIn[startIdx];

  // Thử RPC hiện tại trước
  if (startUrl) {
    try {
      const p = new ethers.JsonRpcProvider(startUrl);
      return await fn(p);
    } catch (err) {
      console.error(`RPC[${startIdx}] ${startUrl} failed:`, err.message);
    }
  }

  // Fallback qua các RPC còn lại
  for (let i = 0; i < builtIn.length; i++) {
    if (i === startIdx) continue;
    try {
      const p = new ethers.JsonRpcProvider(builtIn[i]);
      const result = await fn(p);
      // Lưu lại RPC mới
      const newIndexes = { ...rpcIndexes, [chainId]: i };
      setRpcIndexes(newIndexes);
      localStorage.setItem("lz_rpc_indexes", JSON.stringify(newIndexes));
      setSelectedRpcTab(i);
      setProvider(p);
      setRpcStatus("working");
      setAlert({ type: "info", message: `Auto-fallback to ${RPC_TAB_LABELS[i] || "Cus"}` });
      return result;
    } catch (err) {
      console.error(`RPC[${i}] ${builtIn[i]} failed:`, err.message);
    }
  }

  // Thử custom RPC cuối cùng
  if (customUrl && startIdx !== CUSTOM_RPC_INDEX) {
    try {
      const p = new ethers.JsonRpcProvider(customUrl);
      const result = await fn(p);
      const newIndexes = { ...rpcIndexes, [chainId]: CUSTOM_RPC_INDEX };
      setRpcIndexes(newIndexes);
      localStorage.setItem("lz_rpc_indexes", JSON.stringify(newIndexes));
      setSelectedRpcTab(CUSTOM_RPC_INDEX);
      setProvider(p);
      setRpcStatus("working");
      setAlert({ type: "info", message: `Auto-fallback to Cus` });
      return result;
    } catch (err) {
      console.error(`RPC[Cus] ${customUrl} failed:`, err.message);
    }
  }

  setRpcStatus("error");
  throw new Error("All RPCs failed");
};

  async function switchChain(chainIdHex) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
      try {
        setAlert({ type: "info", message: `Chain ${SUPPORTED_CHAINS[parseInt(chainIdHex, 16)].name} switched successfully` });
      } catch (error) {
        setAlert({ type: "info", message: `Chain switched successfully` });
      }
    } catch (err) {
        console.error("Switch chain error:", err);
        setAlert({ type: "error", message: "Switch chain error: "+err.message.substring(0,100)+"..." } );
    }
  }

  async function checkApproval(tokenAddress, spender, amount, decimals) {
    if (!approvalRequired) {
      setNeedsApproval(false);
      return;
    }

    try {
      const signerAddr = await signer.getAddress();
      const token = new ethers.Contract(tokenAddress, oftAbi, provider);
      const allowance = await token.allowance(signerAddr, spender);

      const amountWei = ethers.parseUnits(amount, decimals);
      setNeedsApproval(allowance < amountWei);
    } catch (err) {
      setAlert({
        type: "error",
        message:
          "Approval check failed: " +
          (err?.message ? err.message.substring(0, 100) + "..." : "Unknown error"),
      });
      console.error(err);
    }
  }

  async function handleApprove(tokenAddress, spender, amount, decimals) {
    try {
      // Ensure wallet is on correct chain before approving
      await ensureWalletChain(currentChainId);

      const token = new ethers.Contract(tokenAddress, oftAbi, signer);
      const amountWei = ethers.parseUnits(amount, decimals);
      const tx = await token.approve(spender, amountWei);
      setAlert({ type: "info", message: "Approving..." });
      await tx.wait();
      setAlert({ type: "success", message: "Approval successful" });
      setNeedsApproval(false);
    } catch (err) {
      setAlert({
        type: "error",
        message:
          "Approval failed: " +
          (err?.message ? err.message.substring(0, 100) + "..." : "Unknown error"),
      });
      console.error(err);
    }
  }

  const handleCheck = async () => {
    try {
      setChecking(true);
      console.log("goi handle check");
      
      if (!ethers.isAddress(oftAddress)) {
        setAlert({ type: "error", message: "Invalid contract address!" });
        setOftContract(null)
        return;
      }
      if (!provider && useWalletRpc) {
        setAlert({ type: "error", message: "Provider not found, Try reconnect or use custom RPC" });
        setOftContract(null)
        return;
      }
      if (!currentChainId) {
        setAlert({ type: "error", message: "No chain selected!" });
        setOftContract(null)
        return;
      }

      // Use tryWithFallback for custom RPC mode
      const doCheck = async (p) => {
        const code = await p.getCode(oftAddress);
        if (code === "0x") {
          throw new Error("CONTRACT_NOT_FOUND");
        }

        const contract = new ethers.Contract(oftAddress, oftAbi, p);
        let tokenAddress = "Unknown";
        try {
          tokenAddress = await contract.token();
        } catch {
          throw new Error("TOKEN_READ_FAIL");
        }

        let decimals = 18;
        let name = "Unknown";
        let symbol = "Unknown";
        let version = "Unknown";
        let requireApprove = false;
        if (ethers.isAddress(tokenAddress)) {
          try {
            const token = new ethers.Contract(tokenAddress, oftAbi, p);
            decimals = await token.decimals();
            try { name = await token.name(); } catch {}
            try { symbol = await token.symbol(); } catch {}
            try { version = await contract.oftVersion(); } catch {}
            try {
              requireApprove = await contract.approvalRequired();
              console.log(("requireApprove", requireApprove));
            } catch {}
          } catch {}
        }

        return { tokenAddress, name, symbol, version, decimals, requireApprove, contract };
      };

      let result;
      if (!useWalletRpc && CHAIN_RPCS[currentChainId]) {
        result = await tryWithFallback(currentChainId, doCheck);
      } else {
        result = await doCheck(provider);
      }

      if (result.tokenAddress === "Unknown") {
        setAlert({ type: "error", message: "Could not read token address from contract" });
        setOftContract(null);
        return;
      }

      const { tokenAddress, name, symbol, version, decimals, requireApprove, contract } = result;

      // Re-create contract with current provider for state
      setOftContract(new ethers.Contract(oftAddress, oftAbi, provider));
      setApprovalRequired(requireApprove);
      setNeedsApproval(requireApprove);
      setInfo({ tokenAddress, name, symbol, version, decimals });

      // Fetch balance
      try {
        const signerAddr = await signer.getAddress();
        if (ethers.isAddress(tokenAddress)) {
          const token = new ethers.Contract(tokenAddress, oftAbi, provider);
          const bal = await token.balanceOf(signerAddr);
          setBalance(ethers.formatUnits(bal, decimals));
        }
      } catch {
        setBalance("0");
      }

      const params = new URLSearchParams(window.location.search);
      const recipient = await signer.getAddress();
      const dstEid = Number(params.get("dstEid")) || Number(dstEidValue);
      const extraOptions = params.get("extraOp") || localStorage.getItem("lz_extraOptions") || "0x";

      const amountWei = ethers.parseUnits(amount, decimals);

      setSendParams({
        dstEid: dstEid,
        to: ethers.zeroPadValue(recipient, 32),
        amountLD: amountWei.toString(),
        minAmountLD: amountWei.toString(),
        extraOptions: extraOptions,
        composeMsg: "0x",
        oftCmd: "0x",
      });

      if (requireApprove && ethers.isAddress(tokenAddress)) {
        await checkApproval(tokenAddress, oftAddress, amount, decimals);
      }
    } catch (err) {
      if (err.message === "CONTRACT_NOT_FOUND") {
        setAlert({ type: "error", message: "Contract does not exist on this chain!" });
      } else if (err.message === "TOKEN_READ_FAIL") {
        setAlert({ type: "error", message: "Failed to read token info from contract" });
      } else {
        setAlert({
          type: "error",
          message:
            "Check failed: " +
            (err?.message ? err.message.substring(0, 100) + "..." : "Unknown error"),
        });
      }
      setInfo(null);
      setOftContract(null);
      console.error(err);
    } finally {
      setChecking(false);
    }
  };

  const handleBridge = async () => {
    try {
      if (!ethers.isAddress(oftAddress)) {
        setAlert({ type: "error", message: "Invalid contract address" });
        return;
      }
      if (!provider) {
        setAlert({ type: "error", message: "Provider not found, Try reconnect or use custom RPC" });
        return;
      }

      // Ensure wallet is on correct chain before sending
      await ensureWalletChain(currentChainId);

      const readOnlyContract = new ethers.Contract(oftAddress, oftAbi, provider);
      const contract = new ethers.Contract(oftAddress, oftAbi, signer);
      const recipient = await signer.getAddress();

      console.log(sendParams);
      try {
        const fee1 = await readOnlyContract.quoteSend(sendParams, false);
        console.log("Quoted Fee:", fee1);
      } catch (error) {
        console.error("Error quoting fee:", error);
      }
      const fee = await readOnlyContract.quoteSend(sendParams, false);
      console.log("Quoted Fee:", fee);
      
      const tx = await contract.send(
        sendParams,
        { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee },
        recipient,
        { value: fee.nativeFee }
      );
      const receipt = await tx.wait();
      if (receipt.status === 1) {
      setAlert({ type: "success", message: `Bridge success! <a class='underline underline-offset-2' target='_blank' href='https://layerzeroscan.com/tx/${tx.hash}'>${tx.hash.substring(0,10)}...</a>` });
      } else {
        setAlert({
          type: "error",
          message: `Transaction failed! TxHash: ${tx.hash}`,
        });
      }
    } catch (err) {
      setAlert({
        type: "error",
        message:
          "Bridge failed: " +
          (err?.message ? err.message.substring(0, 100) + "..." : "Unknown error"),
      });
      console.error(err);
    }
  };

  useEffect(() => {
  if (useWalletRpc) {
    if (window.ethereum) {
      const bp = new ethers.BrowserProvider(window.ethereum);
      setProvider(bp);
      bp.getNetwork().then((network) => {
        setCurrentChainId(Number(network.chainId));
      });
      const handleChainChanged = (chainIdHex) => {
        setCurrentChainId(parseInt(chainIdHex, 16));
        setProvider(new ethers.BrowserProvider(window.ethereum));
      };
      window.ethereum.on("chainChanged", handleChainChanged);
      return () => window.ethereum.removeListener("chainChanged", handleChainChanged);
    } else {
      setProvider(null);
    }
  } else {
    // Custom RPC mode — use CHAIN_RPCS or custom
    if (currentChainId) {
      let cancelled = false;
      const savedIdx = rpcIndexes[currentChainId] || 0;
      const rpcs = CHAIN_RPCS[currentChainId] || [];
      const customUrl = customRpcs[currentChainId];

      // Build ordered list: saved index first, then others
      const tryOrder = [savedIdx];
      for (let i = 0; i < rpcs.length; i++) {
        if (i !== savedIdx) tryOrder.push(i);
      }
      if (customUrl && savedIdx !== CUSTOM_RPC_INDEX) tryOrder.push(CUSTOM_RPC_INDEX);

      (async () => {
        for (const idx of tryOrder) {
          if (cancelled) return;
          const url = idx === CUSTOM_RPC_INDEX ? customUrl : rpcs[idx];
          if (!url) continue;
          try {
            const p = new ethers.JsonRpcProvider(url);
            await p.getNetwork();
            if (cancelled) return;
            // Chỉ cập nhật nếu index khác saved → tránh re-render loop
            if (idx !== savedIdx) {
              const newIndexes = { ...rpcIndexes, [currentChainId]: idx };
              setRpcIndexes(newIndexes);
              localStorage.setItem("lz_rpc_indexes", JSON.stringify(newIndexes));
              setAlert({ type: "info", message: `Auto-fallback to ${RPC_TAB_LABELS[idx] || "Cus"}` });
            }
            setSelectedRpcTab(idx);
            setProvider(p);
            setRpcStatus("working");
            return;
          } catch {}
        }
        if (!cancelled) {
          // Tất cả RPC đều lỗi
          if (customChain?.id === currentChainId && customChain?.rpc) {
            try {
              const p = new ethers.JsonRpcProvider(customChain.rpc);
              await p.getNetwork();
              if (!cancelled) { setProvider(p); setRpcStatus("working"); }
              return;
            } catch {}
          }
          if (window.ethereum) {
            setProvider(new ethers.BrowserProvider(window.ethereum));
          }
          setRpcStatus("error");
          setAlert({ type: "error", message: "All RPCs failed for this chain" });
        }
      })();
      return () => { cancelled = true; };
    } else if (customChain?.id && customChain?.rpc && currentChainId === "custom") {
      // Custom chain đã kết nối trước đó
    } else if (window.ethereum) {
      setProvider(new ethers.BrowserProvider(window.ethereum));
    }

    // Listen for wallet chain changes to sync currentChainId on first load
    if (window.ethereum && !currentChainId) {
      const bp = new ethers.BrowserProvider(window.ethereum);
      bp.getNetwork().then((network) => {
        setCurrentChainId(Number(network.chainId));
      }).catch(() => {});
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [useWalletRpc, currentChainId]);

  // Check CoinGecko listing khi có token info
  useEffect(() => {
    if (!info?.tokenAddress || !currentChainId) {
      setListingStatus(null);
      setCgcLink(null);
      setTokenImage(null);
      return;
    }
    const cacheKey = `listing_${info.tokenAddress}_${currentChainId}`;
    const linkKey = `cgclink_${info.tokenAddress}_${currentChainId}`;
    const imgKey = `tokenimg_${info.tokenAddress}_${currentChainId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setListingStatus(cached);
      setCgcLink(localStorage.getItem(linkKey) || null);
      setTokenImage(localStorage.getItem(imgKey) || null);
      return;
    }
    setListingStatus("Checking...");
    const platform = CGC_PLATFORMS[currentChainId];
    if (!platform) {
      setListingStatus("Not listed");
      localStorage.setItem(cacheKey, "Not listed");
      return;
    }
    fetch(`https://api.coingecko.com/api/v3/coins/${platform}/contract/${info.tokenAddress}`)
      .then(res => {
        if (res.status === 200) return res.json();
        throw new Error("not found");
      })
      .then(data => {
        setListingStatus("CGC listed");
        localStorage.setItem(cacheKey, "CGC listed");
        // Lấy link CoinGecko
        const link = data?.links?.homepage?.[0] || `https://www.coingecko.com/en/coins/${data?.id || ""}`;
        const cgcUrl = `https://www.coingecko.com/en/coins/${data?.id || ""}`;
        setCgcLink(cgcUrl);
        localStorage.setItem(linkKey, cgcUrl);
        // Lấy ảnh coin
        const img = data?.image?.small || data?.image?.thumb || null;
        if (img) {
          setTokenImage(img);
          localStorage.setItem(imgKey, img);
        }
      })
      .catch(() => {
        setListingStatus("Not listed");
        localStorage.setItem(cacheKey, "Not listed");
      });
  }, [info?.tokenAddress, currentChainId]);

  useEffect(() => {
    if (approvalRequired && info?.tokenAddress && ethers.isAddress(info.tokenAddress) && oftAddress) {
      checkApproval(info.tokenAddress, oftAddress, amount, info.decimals || 18);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, info, approvalRequired]);

  useEffect(() => {
    if (!sendParams || !info?.decimals) return;
    try {
      const decimals = info.decimals || 18;
      const amountWei = ethers.parseUnits(amount || "0", decimals);
      setSendParams((prev) => ({
        ...prev,
        amountLD: amountWei.toString(),
        minAmountLD: amountWei.toString(),
      }));
    } catch (err) {
      console.error("Failed to parse amount:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, info?.decimals]);

  // ============================
  // RENDER
  // ============================
  return (
    <div className="flex flex-col lg:flex-row gap-6 w-full">
      {/* ====== LEFT PANEL — Setup ====== */}
      {!setupCollapsed && (
      <div className="w-full lg:w-[380px] flex-shrink-0 self-start bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-4">
        {/* Header + wallet */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Setup Bridge</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSetupCollapsed(true)}
              className="p-1 rounded-lg hover:bg-gray-100 transition text-gray-400 hover:text-gray-600"
              title="Collapse panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
              <span className="font-mono">{address?.slice(0, 4)}...{address?.slice(-3)}</span>
              {disconnect && (
                <button onClick={disconnect} className="p-0.5 rounded hover:bg-gray-100 transition" title="Disconnect">
                  <LogOut className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Source chain — compact */}
        <div>
          <div className="border border-gray-200 rounded-xl px-3 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                {(SUPPORTED_CHAINS[currentChainId]?.name || customChain?.name || "?").charAt(0)}
              </span>
              <span className="font-semibold text-sm text-gray-900">
                {SUPPORTED_CHAINS[currentChainId]?.name || customChain?.name || "Custom"}
              </span>
              <span className="text-xs text-gray-400">ID: {currentChainId || "?"}</span>
            </div>
            <select
              value={SUPPORTED_CHAINS[currentChainId] ? currentChainId : "custom"}
              onChange={e => {
                const val = e.target.value;
                if (val === "custom") {
                  setCustomChainInput(customChain?.id?.toString() || "");
                  setCustomChainRpcInput(customChain?.rpc || "");
                  setCurrentChainId("custom");
                } else {
                  const chainId = parseInt(val, 10);
                  const chain = SUPPORTED_CHAINS[chainId];
                  if (chain) {
                    setCurrentChainId(chainId);
                    if (useWalletRpc) {
                      switchChain(chain.hex);
                    }
                  }
                }
              }}
              className="bg-transparent text-gray-400 outline-none cursor-pointer"
            >
              {Object.entries(SUPPORTED_CHAINS).map(([id, chain]) => (
                <option key={id} value={id}>{chain.name}</option>
              ))}
              <option value="custom">+ Custom</option>
            </select>
          </div>

          {/* Custom chain inputs */}
          {(currentChainId === "custom" || !SUPPORTED_CHAINS[currentChainId]) && (
            <div className="mt-2 flex flex-col gap-1.5">
              <div className="flex gap-1.5">
                <input
                  type="number"
                  placeholder="Chain ID"
                  value={customChainInput}
                  onChange={(e) => setCustomChainInput(e.target.value)}
                  className="w-24 border border-gray-200 px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-gray-300"
                />
                <input
                  type="text"
                  placeholder="RPC URL"
                  value={customChainRpcInput}
                  onChange={(e) => setCustomChainRpcInput(e.target.value)}
                  className="flex-1 border border-gray-200 px-2 py-1.5 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-gray-300 min-w-0"
                />
              </div>
              <button
                onClick={async () => {
                  const id = parseInt(customChainInput, 10);
                  const rpc = customChainRpcInput.trim();
                  if (!id || !rpc) {
                    setAlert({ type: "error", message: "Enter chain ID and RPC URL" });
                    return;
                  }
                  try {
                    const p = new ethers.JsonRpcProvider(rpc);
                    await p.getNetwork();
                    const name = `Chain ${id}`;
                    const cc = { id, rpc, name };
                    setCustomChain(cc);
                    localStorage.setItem("lz_custom_chain", JSON.stringify(cc));
                    setCurrentChainId("custom");
                    setCustomChainInput(id.toString());
                    setCustomChainRpcInput(rpc);
                    setProvider(p);
                    setRpcStatus("working");
                    setAlert({ type: "success", message: `Custom chain ${id} connected!` });
                  } catch (err) {
                    setAlert({ type: "error", message: "RPC failed: " + (err?.message?.substring(0, 60) || "") });
                  }
                }}
                className="w-full py-1.5 bg-gray-800 text-white rounded-lg text-xs hover:bg-gray-700 transition"
              >
                Connect Chain
              </button>
            </div>
          )}
        </div>

        {/* Token contract + Verify */}
        <div>
          <input
            type="text"
            placeholder="Paste token contract address..."
            value={oftAddress}
            onChange={(e) => setOftAddress(e.target.value)}
            className="w-full border border-gray-200 px-3 py-2 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
          />
        </div>

        {/* Verify + Load Route buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleCheck}
            className="flex-1 py-2.5 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition text-sm"
          >
            Verify Contract
          </button>
          {/* OFT Scanner button — disabled temporarily
          <button
            onClick={() => setShowOftScanner(true)}
            className="px-3 py-2.5 bg-gray-50 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-100 transition text-sm flex items-center gap-1.5"
            title="Scan for OFT contract from token holders"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </button>
          */}
          <button
            onClick={() => setShowSavedRoutes(true)}
            className="px-3 py-2.5 bg-gray-50 border border-gray-200 text-gray-600 font-semibold rounded-xl hover:bg-gray-100 transition text-sm flex items-center gap-1.5"
            title="Load saved route"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
            </svg>
            {savedRoutes.length}
          </button>
        </div>

        {/* Warning — compact */}
        <p className="flex items-start gap-1.5 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
          <span className="text-yellow-600 mt-px">&#9888;</span>
          <span>Custom bridge via LayerZero OFT. Verify the contract carefully.</span>
        </p>

        {/* RPC Configuration */}
        <div>
          <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={useWalletRpc}
              onChange={(e) => {
                setUseWalletRpc(e.target.checked);
                localStorage.setItem("lz_use_wallet_rpc", e.target.checked);
                setRpcStatus("unchecked");
              }}
              className="rounded border-gray-300"
            />
            Use wallet RPC
          </label>

          {!useWalletRpc && currentChainId && CHAIN_RPCS[currentChainId] && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1">
                {RPC_TAB_LABELS.map((label, idx) => {
                  const isActive = (rpcIndexes[currentChainId] || 0) === idx;
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        setSelectedRpcTab(idx);
                        if (idx === CUSTOM_RPC_INDEX) {
                          setShowRpcDetail(true);
                          setCustomRpcInput(customRpcs[currentChainId] || "");
                        } else {
                          applyRpcTab(idx);
                        }
                      }}
                      className={`px-2 py-1 rounded-lg text-xs font-medium transition ${
                        isActive
                          ? "bg-gray-900 text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                <button
                  onClick={() => setShowRpcDetail(!showRpcDetail)}
                  className="ml-auto text-gray-400 hover:text-gray-600 transition"
                  title="Toggle RPC details"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-3.5 h-3.5 transition-transform ${showRpcDetail ? "rotate-180" : ""}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  rpcStatus === "working" ? "bg-green-500"
                    : rpcStatus === "error" ? "bg-red-500"
                    : "bg-gray-300"
                }`} title={rpcStatus}></span>
              </div>

              {showRpcDetail && (
                <div className="bg-gray-50 rounded-lg p-2 text-xs">
                  {selectedRpcTab === CUSTOM_RPC_INDEX ? (
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder="https://your-rpc-url..."
                        value={customRpcInput}
                        onChange={(e) => setCustomRpcInput(e.target.value)}
                        className="flex-1 border border-gray-200 px-2 py-1.5 rounded-md text-xs font-mono focus:outline-none focus:ring-1 focus:ring-gray-300 bg-white min-w-0"
                      />
                      <button
                        onClick={async () => {
                          const url = customRpcInput.trim();
                          if (!url) return;
                          try {
                            const p = new ethers.JsonRpcProvider(url);
                            await p.getNetwork();
                            const newCustom = { ...customRpcs, [currentChainId]: url };
                            setCustomRpcs(newCustom);
                            localStorage.setItem("lz_custom_rpcs", JSON.stringify(newCustom));
                            const newIndexes = { ...rpcIndexes, [currentChainId]: CUSTOM_RPC_INDEX };
                            setRpcIndexes(newIndexes);
                            localStorage.setItem("lz_rpc_indexes", JSON.stringify(newIndexes));
                            setProvider(p);
                            setRpcStatus("working");
                            setAlert({ type: "success", message: "Custom RPC saved & applied!" });
                          } catch (err) {
                            setRpcStatus("error");
                            setAlert({ type: "error", message: "Custom RPC failed: " + (err?.message?.substring(0, 60) || "") });
                          }
                        }}
                        className="px-2.5 py-1.5 bg-gray-900 text-white rounded-md text-xs hover:bg-gray-800 transition flex-shrink-0"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="font-mono text-gray-600 break-all">
                      {CHAIN_RPCS[currentChainId]?.[selectedRpcTab] || "—"}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* ====== RIGHT PANEL — Bridge form ====== */}
      <div className={`flex-1 min-w-0 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col gap-5 ${setupCollapsed ? "max-w-2xl mx-auto" : ""}`}>
        {/* Collapsed setup bar */}
        {setupCollapsed && (
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
            <button
              onClick={() => setSetupCollapsed(false)}
              className="p-1 rounded-lg hover:bg-gray-200 transition text-gray-400 hover:text-gray-600 flex-shrink-0"
              title="Expand Setup panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
              </svg>
            </button>
            <span className="w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
              {(SUPPORTED_CHAINS[currentChainId]?.name || customChain?.name || "?").charAt(0)}
            </span>
            <span className="text-sm font-semibold text-gray-800 truncate">
              {SUPPORTED_CHAINS[currentChainId]?.name || customChain?.name || "Custom"}
            </span>
            <span className="text-xs text-gray-400 flex-shrink-0">ID: {currentChainId || "?"}</span>
            <span className="text-gray-300">|</span>
            <span className="text-xs font-mono text-gray-500 truncate min-w-0">{oftAddress ? `${oftAddress.slice(0,6)}...${oftAddress.slice(-4)}` : "No contract"}</span>
            {info && (
              <span className="text-xs font-semibold text-gray-700 flex-shrink-0">{info.symbol}</span>
            )}
            <button
              onClick={() => setShowSavedRoutes(true)}
              className="ml-auto px-2.5 py-1.5 bg-white border border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-100 transition text-xs flex items-center gap-1.5 flex-shrink-0"
              title="Load saved route"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
              {savedRoutes.length}
            </button>
          </div>
        )}
        {!info ? (
          /* Placeholder when not verified */
          <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
            {checking ? (
              <>
                <svg className="animate-spin w-12 h-12 text-gray-300 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                <p className="text-gray-400 font-medium">Verifying contract...</p>
              </>
            ) : (
              <>
                <div className="text-5xl mb-4 opacity-30">&#128274;</div>
                <p className="text-gray-300 font-medium">Verify contract first</p>
                <p className="text-gray-300 text-sm mt-1">Click "Verify Contract" to validate and unlock bridge form</p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Bridge</h2>
            </div>

            {/* Token info card */}
            <div className="border border-gray-200 rounded-2xl p-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {tokenImage ? (
                    <img src={tokenImage} alt={info.symbol} className="w-10 h-10 rounded-full" />
                  ) : (
                    <span className="w-10 h-10 bg-red-500 rounded-full flex items-center justify-center text-white text-lg font-bold">
                      {info.symbol?.charAt(0) || "T"}
                    </span>
                  )}
                  <div>
                    <div className="font-bold text-gray-900">{info.name || "Token"}</div>
                    <div className="text-xs text-gray-500">{info.symbol} &bull; {Number(info.decimals)} decimals</div>
                  </div>
                </div>
                {listingStatus === "CGC listed" && cgcLink ? (
                  <a href={cgcLink} target="_blank" rel="noopener noreferrer" className="bg-green-600 text-white text-xs px-2.5 py-1 rounded-full flex items-center gap-1 font-medium hover:bg-green-700 transition">
                    &#10003; CGC listed
                  </a>
                ) : (
                  <span className={`text-xs px-2.5 py-1 rounded-full flex items-center gap-1 font-medium ${
                    listingStatus === "Checking..." ? "bg-yellow-100 text-yellow-700" :
                    "bg-gray-200 text-gray-600"
                  }`}>
                    {listingStatus || "\u2014"}
                  </span>
                )}
              </div>

              <div className="bg-white/70 rounded-xl p-3 mb-3">
                <div className="text-xs text-gray-400 mb-0.5">Contract address</div>
                <div className="font-mono text-xs text-gray-700 truncate">{info.tokenAddress}</div>
              </div>

              <div className="bg-green-100/80 rounded-xl px-4 py-2.5 text-center">
                <div className="text-xs text-green-600 font-medium">Chain</div>
                <div className="font-bold text-sm text-gray-900">
                  {SUPPORTED_CHAINS[currentChainId]?.name || customChain?.name || `ID: ${currentChainId}`}
                </div>
              </div>
            </div>

            {/* Amount to bridge */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-500">Amount to bridge</p>
                <p className="text-sm text-gray-500">Balance: <span className="font-semibold text-gray-800">{balance}</span></p>
              </div>
              <div className="border border-gray-200 rounded-xl p-4">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="text-3xl font-bold text-center w-full bg-transparent outline-none text-gray-900 placeholder-gray-300"
                />
                <div className="flex justify-center gap-4 mt-3">
                  <button
                    onClick={() => setAmount(String((parseFloat(balance) * 0.5).toFixed(6)))}
                    className="text-sm font-medium text-green-600 hover:text-green-700 transition"
                  >
                    50%
                  </button>
                  <button
                    onClick={() => setAmount(balance)}
                    className="text-sm font-medium text-green-600 hover:text-green-700 transition"
                  >
                    Max
                  </button>
                </div>
              </div>
            </div>

            {/* Destination */}
            <div>
              <p className="text-sm text-gray-500 mb-2">Destination</p>
              <div className="border border-gray-200 rounded-xl divide-y divide-gray-100">
                {/* Network row */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-400">Network</span>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                    <select
                      value={dstChain}
                      onChange={(e) => {
                        const chain = e.target.value;
                        if (chain === "Custom") {
                          setDstChain("Custom");
                        } else {
                          const newVal = CHAINS[chain];
                          setDstChain(chain);
                          setSendParams((prev) => prev ? ({ ...prev, dstEid: newVal }) : prev);
                        }
                      }}
                      className="bg-transparent text-sm font-semibold text-gray-800 outline-none cursor-pointer"
                    >
                      {Object.keys(CHAINS).filter(c => c !== "Custom").map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                      <option value="Custom">Custom</option>
                    </select>
                    {dstChain === "Custom" && (
                      <input
                        type="number"
                        placeholder="EID"
                        value={sendParams?.dstEid ?? ""}
                        onChange={(e) => {
                          setSendParams((prev) => prev ? ({ ...prev, dstEid: e.target.value }) : prev);
                        }}
                        className="w-20 border border-gray-200 px-2 py-1 rounded-lg text-sm text-right focus:outline-none"
                      />
                    )}
                    {dstChain !== "Custom" && (
                      <span className="text-xs text-gray-400">EID: {sendParams?.dstEid}</span>
                    )}
                  </div>
                </div>

                {/* Recipient address row */}
                <div className="px-4 py-3">
                  <div className="text-xs text-gray-400 mb-1">Recipient address</div>
                  <div className="font-mono text-xs text-gray-600 truncate border border-gray-100 rounded-lg px-3 py-2 bg-gray-50">
                    {sendParams?.to || "\u2014"}
                  </div>
                </div>
              </div>
            </div>

            {/* Advanced parameters (collapsible) */}
            <div className="border border-gray-200 rounded-xl">
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-500 hover:bg-gray-50 transition"
              >
                <span>Advanced parameters</span>
                <span className={`transition-transform duration-200 text-xs ${showAdvanced ? "rotate-90" : ""}`}>&#9654;</span>
              </button>
              {showAdvanced && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  <SendParamsEditor
                    CHAINS={CHAINS}
                    dstChain={dstChain}
                    setDstChain={setDstChain}
                    dstEidValue={dstEidValue}
                    setDstEidValue={setDstEidValue}
                    sendParams={sendParams}
                    setSendParams={setSendParams}
                  />
                </div>
              )}
            </div>

            {/* Save Route + Share link */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  const route = {
                    oftAddress,
                    chainId: currentChainId,
                    dstChain,
                    dstEid: sendParams?.dstEid || dstEidValue,
                    extraOptions: sendParams?.extraOptions || "0x",
                    name: info?.name,
                    symbol: info?.symbol,
                    tokenAddress: info?.tokenAddress,
                    savedAt: Date.now(),
                  };
                  // Kiểm tra trùng
                  const exists = savedRoutes.some(r => r.oftAddress === route.oftAddress && r.chainId === route.chainId && r.dstEid === route.dstEid);
                  if (exists) {
                    setAlert({ type: "info", message: "Route already saved!" });
                    return;
                  }
                  const updated = [...savedRoutes, route];
                  setSavedRoutes(updated);
                  localStorage.setItem("lz_saved_routes", JSON.stringify(updated));
                  setAlert({ type: "success", message: "Route saved!" });
                }}
                className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
                </svg>
                <span>Save route</span>
              </button>
              <button
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}?oftadr=${oftAddress}&chainId=${currentChainId}&auto=true&dstEid=${sendParams?.dstEid || dstEidValue}&extraOp=${sendParams?.extraOptions || "0x"}`;
                  navigator.clipboard.writeText(url);
                  setAlert({ type: "success", message: "Copied share URL!" });
                }}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition"
              >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4m0 0L8 6m4-4v14" />
              </svg>
              <span>Share link</span>
              </button>
            </div>

            {/* Bridge / Approve button */}
            <button
              onClick={() =>
                needsApproval
                  ? handleApprove(info.tokenAddress, oftAddress, amount, info.decimals || 18)
                  : handleBridge()
              }
              className={`w-full py-4 font-bold rounded-2xl text-lg transition-colors ${
                needsApproval
                  ? "bg-yellow-500 text-white hover:bg-yellow-600"
                  : "bg-gray-900 text-white hover:bg-gray-800"
              }`}
            >
              {needsApproval ? "Approve" : "Bridge now"}
            </button>
          </>
        )}
      </div>

      {/* OFT Scanner Modal — disabled temporarily
      <OftScanner
        show={showOftScanner}
        onClose={() => setShowOftScanner(false)}
        onSelect={(addr) => {
          setOftAddress(addr);
          setAutoCheck(true);
        }}
        chainId={currentChainId}
        provider={provider}
        chainRpcs={CHAIN_RPCS}
      />
      */}

      {/* Saved Routes Modal */}
      {showSavedRoutes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSavedRoutes(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Saved Routes</h3>
              <div className="flex items-center gap-2">
                {savedRoutes.length > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm("Delete all saved routes?")) {
                        setSavedRoutes([]);
                        localStorage.setItem("lz_saved_routes", "[]");
                        setAlert({ type: "info", message: "All routes cleared" });
                      }
                    }}
                    className="text-xs text-red-400 hover:text-red-600 transition"
                  >
                    Clear all
                  </button>
                )}
                <button onClick={() => setShowSavedRoutes(false)} className="text-gray-400 hover:text-gray-600 transition">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {savedRoutes.length === 0 ? (
                <p className="text-center text-gray-400 py-8">No saved routes</p>
              ) : (
                [...savedRoutes].reverse().map((route, idx) => {
                  const imgKey = `tokenimg_${route.tokenAddress}_${route.chainId}`;
                  const img = localStorage.getItem(imgKey);
                  const srcName = SUPPORTED_CHAINS[route.chainId]?.name || `Chain ${route.chainId}`;
                  const dstName = route.dstChain || "?";
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 cursor-pointer transition group"
                      onClick={() => {
                        setOftAddress(route.oftAddress);
                        if (SUPPORTED_CHAINS[route.chainId]) {
                          setCurrentChainId(route.chainId);
                          if (useWalletRpc) switchChain(SUPPORTED_CHAINS[route.chainId].hex);
                        } else {
                          setCurrentChainId(route.chainId);
                        }
                        if (route.dstChain) {
                          setDstChain(route.dstChain);
                          if (CHAINS[route.dstChain]) {
                            setDstEidValue(CHAINS[route.dstChain]);
                          }
                        }
                        if (route.dstEid) setDstEidValue(route.dstEid);
                        if (route.extraOptions) {
                          localStorage.setItem("lz_extraOptions", route.extraOptions);
                        }
                        setShowSavedRoutes(false);
                        setAlert({ type: "info", message: `Route loaded: ${route.name || route.symbol || route.oftAddress.slice(0,10)}` });
                        setAutoCheck(true);
                      }}
                    >
                      {img ? (
                        <img src={img} alt="" className="w-9 h-9 rounded-full flex-shrink-0" />
                      ) : (
                        <span className="w-9 h-9 bg-gray-300 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                          {(route.symbol || "?").charAt(0)}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-800 truncate">{route.name || route.symbol || "Token"}</div>
                        <div className="text-xs text-gray-400 flex items-center gap-1">
                          <span>{srcName}</span>
                          <span>→</span>
                          <span>{dstName}</span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const realIdx = savedRoutes.length - 1 - idx;
                          const updated = savedRoutes.filter((_, i) => i !== realIdx);
                          setSavedRoutes(updated);
                          localStorage.setItem("lz_saved_routes", JSON.stringify(updated));
                          if (updated.length === 0) setShowSavedRoutes(false);
                          setAlert({ type: "info", message: "Route deleted" });
                        }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition p-1"
                        title="Delete route"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            {/* Import / Export footer */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-2">
              {/* Export */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-1">Export:</span>
                <button
                  onClick={() => {
                    if (savedRoutes.length === 0) { setAlert({ type: "info", message: "No routes to export" }); return; }
                    navigator.clipboard.writeText(JSON.stringify(savedRoutes, null, 2));
                    setAlert({ type: "success", message: "Routes copied to clipboard!" });
                  }}
                  className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition flex items-center gap-1"
                  title="Copy routes to clipboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                  Clipboard
                </button>
                <button
                  onClick={() => {
                    if (savedRoutes.length === 0) { setAlert({ type: "info", message: "No routes to export" }); return; }
                    const blob = new Blob([JSON.stringify(savedRoutes, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "lz_routes.json";
                    a.click();
                    URL.revokeObjectURL(url);
                    setAlert({ type: "success", message: "Routes exported as JSON!" });
                  }}
                  className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition flex items-center gap-1"
                  title="Download routes as JSON file"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  JSON
                </button>
              </div>
              {/* Import */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400 mr-1">Import:</span>
                <button
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      const routes = JSON.parse(text);
                      if (!Array.isArray(routes) || routes.length === 0) { setAlert({ type: "error", message: "Invalid route data in clipboard" }); return; }
                      if (!routes.every(r => r.oftAddress && r.chainId)) { setAlert({ type: "error", message: "Invalid route format" }); return; }
                      const merged = [...savedRoutes];
                      let added = 0;
                      routes.forEach(r => {
                        const exists = merged.some(m => m.oftAddress === r.oftAddress && m.chainId === r.chainId && m.dstEid === r.dstEid);
                        if (!exists) { merged.push(r); added++; }
                      });
                      setSavedRoutes(merged);
                      localStorage.setItem("lz_saved_routes", JSON.stringify(merged));
                      setAlert({ type: "success", message: `Imported ${added} route(s), ${routes.length - added} duplicates skipped` });
                    } catch { setAlert({ type: "error", message: "Failed to read clipboard or invalid JSON" }); }
                  }}
                  className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition flex items-center gap-1"
                  title="Paste routes from clipboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                  Clipboard
                </button>
                <label
                  className="text-xs px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition flex items-center gap-1 cursor-pointer"
                  title="Upload routes JSON file"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  JSON
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const routes = JSON.parse(ev.target.result);
                          if (!Array.isArray(routes) || routes.length === 0) { setAlert({ type: "error", message: "Invalid route data in file" }); return; }
                          if (!routes.every(r => r.oftAddress && r.chainId)) { setAlert({ type: "error", message: "Invalid route format" }); return; }
                          const merged = [...savedRoutes];
                          let added = 0;
                          routes.forEach(r => {
                            const exists = merged.some(m => m.oftAddress === r.oftAddress && m.chainId === r.chainId && m.dstEid === r.dstEid);
                            if (!exists) { merged.push(r); added++; }
                          });
                          setSavedRoutes(merged);
                          localStorage.setItem("lz_saved_routes", JSON.stringify(merged));
                          setAlert({ type: "success", message: `Imported ${added} route(s), ${routes.length - added} duplicates skipped` });
                        } catch { setAlert({ type: "error", message: "Invalid JSON file" }); }
                      };
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}
    </div>
  );
};

export default BridgeButton;
