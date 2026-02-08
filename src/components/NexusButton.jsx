import { useState, useEffect } from "react";
import { ethers } from "ethers";
import nexusAbi from "../abis/Nexus.json";
import Alert from "./Alert";
import NexusParamsEditor from "./NexusParamsEditor";

const CHAINS = {
  Ethereum: 1,
  BSC: 56,
  Polygon: 137,
  Arbitrum: 42161,
  Optimism: 10,
  Avalanche: 43114,
  Base: 8453,
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

const NexusButton = ({ signer }) => {
  const [nexusAddress, setNexusAddress] = useState("");
  const [amount, setAmount] = useState("5");
  const [dstChain, setDstChain] = useState("Ethereum");
  const [dstChainId, setDstChainId] = useState(CHAINS[dstChain]);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [useCustomRpc, setUseCustomRpc] = useState(false);
  const [customRpcUrl, setCustomRpcUrl] = useState("");
  const [tempRpcUrl, setTempRpcUrl] = useState("");
  const [provider, setProvider] = useState(null);
  const [currentChain, setCurrentChain] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);
  const [alert, setAlert] = useState(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState(null); // Token info sau khi check
  const [nexusContract, setNexusContract] = useState(null);
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [needsApproval, setNeedsApproval] = useState(false);

  // Nexus Params state
  const [nexusParams, setNexusParams] = useState({
    destination: CHAINS[dstChain],
    recipient: "",
    humanRecipient: "",
    amount: "",
    humanAmount: "5",
    hookMetadata: "0x",
    hook: ethers.ZeroAddress,
  });

  // URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const adr = params.get("nexusadr") || params.get("nexusAddr");
    if (adr && ethers.isAddress(adr)) {
      setNexusAddress(adr);
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

    // Load destination, amount, recipient from URL
    const destinationParam = params.get("destination");
    if (destinationParam) {
      setNexusParams((prev) => ({ ...prev, destination: destinationParam }));
    }

    const amountParam = params.get("amount");
    if (amountParam) {
      setAmount(amountParam);
      setNexusParams((prev) => ({ ...prev, humanAmount: amountParam }));
    }

    const recipientParam = params.get("recipient");
    if (recipientParam && ethers.isAddress(recipientParam)) {
      setRecipientAddress(recipientParam);
      setNexusParams((prev) => ({ ...prev, humanRecipient: recipientParam }));
    }
  }, []);

  // Provider setup
  useEffect(() => {
    const setupProvider = async () => {
      if (useCustomRpc && customRpcUrl) {
        const customProvider = new ethers.JsonRpcProvider(customRpcUrl);
        setProvider(customProvider);
      } else if (signer) {
        const signerProvider = signer.provider;
        setProvider(signerProvider);
      }
    };
    setupProvider();
  }, [signer, useCustomRpc, customRpcUrl]);

  // Track chain ID
  useEffect(() => {
    if (provider) {
      provider.getNetwork().then((network) => {
        setCurrentChainId(Number(network.chainId));
        setCurrentChain(SUPPORTED_CHAINS[Number(network.chainId)]?.name || "Unknown");
      });

      if (window.ethereum && !useCustomRpc) {
        window.ethereum.on("chainChanged", async () => {
          // Recreate provider when chain changes
          const newProvider = new ethers.BrowserProvider(window.ethereum);
          setProvider(newProvider);
          
          // Update chain info
          const network = await newProvider.getNetwork();
          const chainId = Number(network.chainId);
          setCurrentChainId(chainId);
          setCurrentChain(SUPPORTED_CHAINS[chainId]?.name || "Unknown");
        });
      }
    }
  }, [provider, useCustomRpc]);

  // Update dst chain ID and params
  useEffect(() => {
    setDstChainId(CHAINS[dstChain]);
    setNexusParams((prev) => ({ ...prev, destination: CHAINS[dstChain] }));
  }, [dstChain]);

  // Sync amount to params
  useEffect(() => {
    const humanAmount = nexusParams.humanAmount || amount;
    if (humanAmount && tokenDecimals) {
      try {
        const amountWei = ethers.parseUnits(humanAmount, tokenDecimals);
        setNexusParams((prev) => ({ ...prev, amount: amountWei.toString() }));
        setAmount(humanAmount);
      } catch (err) {
        // Invalid amount
      }
    }
  }, [nexusParams.humanAmount, amount, tokenDecimals]);

  // Sync recipient to params
  useEffect(() => {
    const humanRecipient = nexusParams.humanRecipient || recipientAddress;
    
    if (humanRecipient && ethers.isAddress(humanRecipient)) {
      const recipientBytes32 = ethers.zeroPadValue(humanRecipient, 32);
      setNexusParams((prev) => ({ ...prev, recipient: recipientBytes32 }));
      setRecipientAddress(humanRecipient);
    } else if (signer && !humanRecipient) {
      signer.getAddress().then((addr) => {
        const recipientBytes32 = ethers.zeroPadValue(addr, 32);
        setNexusParams((prev) => ({ ...prev, recipient: recipientBytes32, humanRecipient: addr }));
      });
    }
  }, [nexusParams.humanRecipient, recipientAddress, signer]);

  // Apply custom RPC
  const applyRpc = async () => {
    if (tempRpcUrl.trim() !== "") {
      try {
        const rpcUrl = tempRpcUrl.trim();
        const testProvider = new ethers.JsonRpcProvider(rpcUrl);
        await testProvider.getNetwork();

        setProvider(testProvider);
        setCustomRpcUrl(rpcUrl);
        setUseCustomRpc(true);

        setAlert({ type: "success", message: "Custom RPC applied successfully!" });
      } catch (error) {
        console.error("Invalid RPC:", error);
        setAlert({
          type: "error",
          message: "Invalid RPC URL! " + (error?.message ? error.message.substring(0, 80) + "..." : ""),
        });
      }
    }
  };

  // Switch chain
  async function switchChain(chainIdHex) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
      const chainName = SUPPORTED_CHAINS[parseInt(chainIdHex, 16)]?.name || "Chain";
      setAlert({ type: "info", message: `Switched to ${chainName}` });
    } catch (err) {
      console.error("Switch chain error:", err);
      setAlert({ type: "error", message: "Switch chain error: " + err.message.substring(0, 100) + "..." });
    }
  }

  // Check approval
  async function checkApproval(tokenAddress, spender, amount, decimals) {
    if (!approvalRequired) {
      setNeedsApproval(false);
      return;
    }

    try {
      const providerToUse = useCustomRpc
        ? new ethers.JsonRpcProvider(customRpcUrl)
        : signer?.provider;

      if (!providerToUse) {
        setAlert({ type: "error", message: "No provider available" });
        return;
      }

      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function allowance(address,address) view returns (uint256)"],
        providerToUse
      );

      const userAddress = await signer.getAddress();
      const allowance = await tokenContract.allowance(userAddress, spender);
      const amountWei = ethers.parseUnits(amount, decimals);

      setNeedsApproval(allowance < amountWei);
    } catch (err) {
      console.error("Check approval error:", err);
      setNeedsApproval(true);
    }
  }

  // Approve token
  async function approveToken(tokenAddress, spender, amount, decimals) {
    try {
      setLoading(true);
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ["function approve(address,uint256) returns (bool)"],
        signer
      );

      const amountWei = ethers.parseUnits(amount, decimals);
      const tx = await tokenContract.approve(spender, amountWei);
      setAlert({ type: "info", message: "Approving... TX: " + tx.hash.slice(0, 10) + "..." });

      await tx.wait();
      setAlert({ type: "success", message: "Approval successful!" });
      setNeedsApproval(false);
    } catch (err) {
      console.error("Approve error:", err);
      setAlert({ type: "error", message: "Approve failed: " + err.message.substring(0, 100) });
    } finally {
      setLoading(false);
    }
  }

  // Handle check - Tạo contract instance và lấy thông tin
  const handleCheck = async () => {
    if (!nexusAddress || !ethers.isAddress(nexusAddress)) {
      setAlert({ type: "error", message: "Invalid Nexus contract address!" });
      return;
    }

    try {
      setLoading(true);

      // Recreate provider để đảm bảo đúng chain hiện tại
      let currentProvider;
      if (useCustomRpc && customRpcUrl) {
        currentProvider = new ethers.JsonRpcProvider(customRpcUrl);
      } else if (window.ethereum) {
        currentProvider = new ethers.BrowserProvider(window.ethereum);
      } else {
        setAlert({ type: "error", message: "No provider available" });
        setLoading(false);
        return;
      }

      setProvider(currentProvider);

      // Update current chain info
      const network = await currentProvider.getNetwork();
      const chainId = Number(network.chainId);
      setCurrentChainId(chainId);
      setCurrentChain(SUPPORTED_CHAINS[chainId]?.name || `Custom (${chainId})`);

      // Tạo contract instance với Nexus ABI
      const contract = new ethers.Contract(nexusAddress, nexusAbi, currentProvider);
      setNexusContract(contract);

      // Lấy token info - nếu không có ERC20 methods thì dùng default
      let name = "Unknown";
      let symbol = "N/A";
      let decimals = 18;

      try {
        name = await contract.name();
      } catch (e) {
        console.log("name() not available, using default");
      }

      try {
        symbol = await contract.symbol();
      } catch (e) {
        console.log("symbol() not available, using default");
      }

      try {
        decimals = await contract.decimals();
      } catch (e) {
        console.log("decimals() not available, using default 18");
      }

      setTokenDecimals(Number(decimals));

      // Lấy balance nếu có signer
      let balance = "N/A";
      if (signer) {
        try {
          const userAddress = await signer.getAddress();
          const balanceWei = await contract.balanceOf(userAddress);
          balance = ethers.formatUnits(balanceWei, decimals);
        } catch (balanceErr) {
          console.log("Could not fetch balance:", balanceErr);
          balance = "N/A";
        }
      }

      // Lưu info để hiển thị form
      setInfo({
        name,
        symbol,
        decimals: Number(decimals),
        balance,
      });

      setAlert({
        type: "success",
        message: `✅ Token: ${name} (${symbol}) | Decimals: ${decimals} | Balance: ${balance}`,
      });

      // Auto check approval after successful check
      if (symbol !== "N/A") {
        await checkApproval(nexusAddress, nexusAddress, amount, tokenDecimals);
      }
    } catch (err) {
      console.error("Check error:", err);
      
      // Check for rate limit error
      if (err.message && err.message.includes("rate limit")) {
        setAlert({ 
          type: "error", 
          message: "⏱️ RPC rate limited! Please wait a few seconds and try again, or use a custom RPC URL." 
        });
      } else if (err.code === -32603 || (err.error && err.error.message && err.error.message.includes("rate limit"))) {
        setAlert({ 
          type: "error", 
          message: "⏱️ RPC rate limited! Please wait a few seconds and try again, or use a custom RPC URL." 
        });
      } else {
        setAlert({ type: "error", message: "Check failed: " + err.message.substring(0, 200) });
      }
      setInfo(null); // Reset info nếu lỗi
    } finally {
      setLoading(false);
    }
  };

  // Bridge transfer - Auto quote then bridge
  const handleBridge = async () => {
    if (!nexusContract) {
      setAlert({ type: "error", message: "Please check contract first!" });
      return;
    }

    if (!signer) {
      setAlert({ type: "error", message: "Wallet not connected!" });
      return;
    }

    // Recreate contract with fresh signer (signer always has latest provider)
    const contractWithSigner = new ethers.Contract(nexusAddress, nexusAbi, signer);

    if (!nexusParams.amount || nexusParams.amount === "0") {
      setAlert({ type: "error", message: "Invalid amount!" });
      return;
    }

    if (!nexusParams.destination) {
      setAlert({ type: "error", message: "Please select destination chain!" });
      return;
    }

    if (!nexusParams.recipient || nexusParams.recipient === "0x") {
      setAlert({ type: "error", message: "Invalid recipient!" });
      return;
    }

    // Check approval first
    if (needsApproval && approvalRequired) {
      setAlert({ type: "warning", message: "Please approve token first!" });
      return;
    }

    try {
      setLoading(true);

      // Verify network before proceeding
      const signerNetwork = await signer.provider.getNetwork();
      console.log("Current signer network:", signerNetwork.chainId.toString());

      // Step 1: Quote fee using fresh contract
      setAlert({ type: "info", message: "🔍 Quoting fee..." });
      
      const quotes = await contractWithSigner.quoteTransferRemote(
        nexusParams.destination,
        nexusParams.recipient,
        nexusParams.amount
      );

      console.log("Quote result:", quotes);

      let nativeFee = "0";
      let nativeFeeWei = 0n;
      if (quotes && quotes.length > 0) {
        nativeFee = ethers.formatEther(quotes[0].amount);
        nativeFeeWei = quotes[0].amount;
        console.log("Native fee (formatted):", nativeFee);
        console.log("Native fee (wei):", nativeFeeWei.toString());
      }

      // Check native balance
      const userAddress = await signer.getAddress();
      const nativeBalance = await signer.provider.getBalance(userAddress);
      const nativeBalanceFormatted = ethers.formatEther(nativeBalance);

      console.log("Native balance:", nativeBalanceFormatted);
      console.log("Native balance (wei):", nativeBalance.toString());

      // Estimate gas để tính total required
      const estimatedGas = 300000n; // ~0.0003 ETH với gas price 1 gwei
      const totalRequired = nativeFeeWei + estimatedGas;

      if (nativeBalance <= totalRequired) {
        setAlert({
          type: "warning",
          message: `⚠️ Low balance! Fee: ${nativeFee} | Your balance: ${nativeBalanceFormatted} | Attempting anyway...`,
        });
      } else {
        setAlert({
          type: "info",
          message: `💰 Bridge Fee: ${nativeFee} | Balance: ${nativeBalanceFormatted} | Bridging...`,
        });
      }

      // Step 2: Execute bridge
      let tx;
      // Check if using advanced options
      if (nexusParams.hook !== ethers.ZeroAddress || nexusParams.hookMetadata !== "0x") {
        // Use full version with hook
        tx = await contractWithSigner.transferRemote(
          nexusParams.destination,
          nexusParams.recipient,
          nexusParams.amount,
          nexusParams.hookMetadata,
          nexusParams.hook,
          { value: nativeFeeWei }
        );
      } else {
        // Use simple version
        tx = await contractWithSigner.transferRemote(
          nexusParams.destination,
          nexusParams.recipient,
          nexusParams.amount,
          { value: nativeFeeWei }
        );
      }

      setAlert({
        type: "info",
        message: `🚀 Bridge TX sent! Hash: ${tx.hash.slice(0, 10)}...`,
      });

      // Wait for confirmation
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        setAlert({
          type: "success",
          message: `✅ Bridge successful! TX: <a href="https://etherscan.io/tx/${tx.hash}" target="_blank" style="text-decoration:underline">${tx.hash.slice(0, 10)}...</a>`,
        });
      } else {
        setAlert({ type: "error", message: "Bridge transaction failed!" });
      }
    } catch (err) {
      console.error("Bridge error:", err);
      
      // Check for rate limit error
      if (err.message && err.message.includes("rate limit")) {
        setAlert({
          type: "error",
          message: "⏱️ RPC rate limited! Please wait a few seconds and try again, or use a custom RPC URL above.",
        });
      } else if (err.code === -32603 || (err.error && err.error.message && err.error.message.includes("rate limit"))) {
        setAlert({
          type: "error",
          message: "⏱️ RPC rate limited! Please wait a few seconds and try again, or use a custom RPC URL above.",
        });
      } else {
        setAlert({
          type: "error",
          message: "Bridge failed: " + (err.message || err.reason || "Unknown error").substring(0, 150),
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Nexus Contract Address */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Nexus Contract Address
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={nexusAddress}
            onChange={(e) => setNexusAddress(e.target.value)}
            placeholder="0x..."
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleCheck}
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? "..." : "Check"}
          </button>
        </div>
      </div>

      {/* Custom RPC */}
      <details className="border rounded-lg p-3">
        <summary className="cursor-pointer font-medium text-sm">Custom RPC (Optional)</summary>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={tempRpcUrl}
            onChange={(e) => setTempRpcUrl(e.target.value)}
            placeholder="https://rpc.example.com"
            className="flex-1 border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={applyRpc}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700"
          >
            Apply
          </button>
        </div>
        {useCustomRpc && (
          <div className="mt-2 text-xs text-green-600">✓ Using custom RPC: {customRpcUrl}</div>
        )}
      </details>

      {/* Warning Box */}
      {info && (
        <div className="p-3 rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-800 text-sm">
          <span className="font-semibold">
            ⚠️ This is a custom bridge. Always verify contract addresses before bridging!
          </span>
        </div>
      )}

      {/* Token Info Display */}
      {info && (
        <div className="bg-gray-100 p-3 rounded-lg border flex flex-col gap-1 text-sm">
          <div>
            <span className="font-semibold">Token:</span> {info.name} ({info.symbol})
          </div>
          <div>
            <span className="font-semibold">Decimals:</span> {info.decimals}
          </div>
          <div>
            <span className="font-semibold">Balance:</span> {info.balance}
          </div>
          <div>
            <span className="font-semibold">Contract:</span>{" "}
            <span className="font-mono text-xs">{nexusAddress}</span>
          </div>
          
          {/* Share button */}
          <button
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?nexusAddr=${nexusAddress}&chainId=${currentChainId}&destination=${nexusParams.destination || ""}&amount=${nexusParams.humanAmount || amount}&recipient=${nexusParams.humanRecipient || ""}`;
              navigator.clipboard.writeText(url);
              setAlert({ type: "success", message: "Copied share URL!" });
            }}
            className="mt-2 hover:text-blue-800 self-start flex items-center gap-1"
            title="Copy share URL"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4m0 0L8 6m4-4v14"
              />
            </svg>
            <span>Share</span>
          </button>
        </div>
      )}

      {/* Main Form - Only show after check */}
      {info && (
        <>
          {/* Current Chain */}
          {currentChain && (
            <div className="text-sm text-gray-600">
              Current Chain: <span className="font-semibold">{currentChain}</span> (ID: {currentChainId})
            </div>
          )}

          {/* Chain Switcher */}
          <div className="flex gap-2 flex-wrap">
            {Object.entries(SUPPORTED_CHAINS).map(([chainId, info]) => (
              <button
                key={chainId}
                onClick={() => switchChain(info.hex)}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                  currentChainId === parseInt(chainId)
                    ? "bg-purple-500 text-white"
                    : "bg-gray-200 hover:bg-gray-300"
                }`}
              >
                {info.name}
              </button>
            ))}
          </div>

          {/* Nexus Params Editor */}
          <NexusParamsEditor
            CHAINS={CHAINS}
            dstChain={dstChain}
            setDstChain={setDstChain}
            nexusParams={nexusParams}
            setNexusParams={setNexusParams}
          />

          {/* Recipient Address (optional) */}
          <div className="flex flex-col gap-1">
            <label className="font-medium text-sm">Recipient Address (optional)</label>
            <input
              type="text"
              className="border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono text-sm"
              value={nexusParams.humanRecipient || ""}
              onChange={(e) =>
                setNexusParams((prev) => ({ ...prev, humanRecipient: e.target.value }))
              }
              placeholder="0x... (leave empty to use your address)"
            />
          </div>

          {/* Amount Input */}
          <div className="flex flex-col gap-1">
            <label className="font-medium text-sm">Amount</label>
            <input
              type="number"
              className="border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={nexusParams.humanAmount || ""}
              onChange={(e) =>
                setNexusParams((prev) => ({ ...prev, humanAmount: e.target.value }))
              }
              placeholder="Enter token amount"
            />
          </div>

          {/* Approval Toggle */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={approvalRequired}
              onChange={(e) => setApprovalRequired(e.target.checked)}
            />
            <span>Require approval check</span>
          </label>

          {/* Approval Status */}
          {needsApproval && approvalRequired && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
              ⚠️ Approval required!
              <button
                onClick={() => approveToken(nexusAddress, nexusAddress, amount, tokenDecimals)}
                disabled={loading}
                className="ml-2 px-3 py-1 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handleBridge}
            disabled={loading || !nexusContract || (needsApproval && approvalRequired)}
            className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Processing..." : "🚀 Bridge"}
          </button>
        </>
      )}

      {/* Alert */}
      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}
    </div>
  );
};

export default NexusButton;
