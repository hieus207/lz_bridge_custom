import { useState, useEffect } from "react";
import { ethers } from "ethers";
import oftAbi from "../abis/OFT.json";
// import oftAbi from "../abis/ERC20.json"; // dùng đúng ABI ERC20
import Alert from "./Alert";
import SendParamsEditor from "./SendParamsEditor";

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



const BridgeButton = ({ signer }) => {
  const [oftAddress, setOftAddress] = useState("");
  const [amount, setAmount] = useState("5");
  const [info, setInfo] = useState(null);
  const [sendParams, setSendParams] = useState(null);
  const [dstChain, setDstChain] = useState("Ethereum");
  const [oftContract, setOftContract] = useState(null);
  const [dstEidValue, setDstEidValue] = useState(CHAINS[dstChain]);
  const [useCustomRpc, setUseCustomRpc] = useState(false);
  const [customRpcUrl, setCustomRpcUrl] = useState("");
  const [tempRpcUrl, setTempRpcUrl] = useState("");
  const [provider, setProvider] = useState(null);
  // const [currentChain, setCurrentChain] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);
  const [alert, setAlert] = useState(null);
  const [autoCheck, setAutoCheck] = useState(false);
  const [isCustomRpc, setIsCustomRpc] = useState(false);

  const [approvalRequired, setApprovalRequired] = useState(false); // mặc định true
  const [needsApproval, setNeedsApproval] = useState(false);

useEffect(() => {
  const params = new URLSearchParams(window.location.search);

  // ✅ Lấy oftadr
  const adr = params.get("oftadr");
  if (adr && ethers.isAddress(adr)) {
    setOftAddress(adr);
  }

  // ✅ Lấy chainId và switch luôn
  const chainIdParam = params.get("chainId");
  if (chainIdParam && window.ethereum) {
    const parsed = parseInt(chainIdParam, 10);
    if (!isNaN(parsed)) {
      const chain = SUPPORTED_CHAINS[parsed];
      if (chain) {
        switchChain(chain.hex);   // dùng hàm switchChain có sẵn của mày
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

    
    setAutoCheck(false); // chỉ auto check 1 lần thôi
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [oftAddress, currentChainId, provider,autoCheck]);

  useEffect(() => {
  if (provider) {
    provider.getNetwork().then((network) => {
      setCurrentChainId(Number(network.chainId));
    });

    // lắng nghe khi user đổi chain trong ví
    if (window.ethereum && useCustomRpc === false) {
      window.ethereum.on("chainChanged", (chainIdHex) => {
        setCurrentChainId(parseInt(chainIdHex, 16));
      });
    }
  }
}, [provider, useCustomRpc]);
  // Apply RPC
const applyRpc = async () => {
  if (tempRpcUrl.trim() !== "") {
    try {
      const rpcUrl = tempRpcUrl.trim();
      console.log("Testing custom RPC:", rpcUrl);

      const testProvider = new ethers.JsonRpcProvider(rpcUrl);

      // thử gọi getNetwork để validate RPC
      await testProvider.getNetwork();

      setProvider(testProvider);
      setCustomRpcUrl(rpcUrl);
      setUseCustomRpc(true);

      setAlert({ type: "success", message: "Custom RPC applied successfully!" });
    } catch (error) {
      console.error("Invalid RPC:", error);
      setAlert({
        type: "error",
        message:
          "Invalid RPC URL! " +
          (error?.message ? error.message.substring(0, 80) + "..." : ""),
      });
    }
  }
};

  async function switchChain(chainIdHex) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
      // console.log();
      try {
        setAlert({ type: "info", message: `Chain ${SUPPORTED_CHAINS[parseInt(chainIdHex, 16)].name} switched successfully` });
        
      } catch (error) {
        setAlert({ type: "info", message: `Chain switched successfully` });
        
      }
    } catch (err) {

      // if (err.code === 4902) {
      //   // Chain chưa có thì thêm vào (ví dụ với BNB)
      //   if (chainIdHex === "0x38") {
      //     await window.ethereum.request({
      //       method: "wallet_addEthereumChain",
      //       params: [
      //         {
      //           chainId: "0x38",
      //           chainName: "BNB Smart Chain",
      //           nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      //           rpcUrls: ["https://bsc-dataseed.binance.org/"],
      //           blockExplorerUrls: ["https://bscscan.com/"],
      //         },
      //       ],
      //     });
      //   }
      //   if (chainIdHex === "0x1") {
      //     await window.ethereum.request({
      //       method: "wallet_addEthereumChain",
      //       params: [
      //         {
      //           chainId: "0x1",
      //           chainName: "Ethereum Mainnet",
      //           nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      //           rpcUrls: ["https://mainnet.infura.io/v3/"], // thay rpc của mày
      //           blockExplorerUrls: ["https://etherscan.io/"],
      //         },
      //       ],
      //     });
      //   }
      // } else {
      //   console.log("Co vao day bat loi");

        console.error("Switch chain error:", err);
        setAlert({ type: "error", message: "Switch chain error: "+err.message.substring(0,100)+"..." } );
      // }
    }
  }

  // check approval
  async function checkApproval(tokenAddress, spender, amount, decimals) {
    if (!approvalRequired) {
      setNeedsApproval(false);
      return;
    }

    try {
      const providerToUse = useCustomRpc
        ? new ethers.JsonRpcProvider(customRpcUrl)
        : new ethers.BrowserProvider(window.ethereum);

      const signerAddr = await signer.getAddress();
      const token = new ethers.Contract(tokenAddress, oftAbi, providerToUse);
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

  // approve
  async function handleApprove(tokenAddress, spender, amount, decimals) {
    try {
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

  // handle check contract
  const handleCheck = async () => {
    try {
      console.log("goi handle check");
      
      if (!ethers.isAddress(oftAddress)) {
        setAlert({ type: "error", message: "Invalid contract address!" });
        setOftContract(null)
        return;
      }
      if (!provider) {
        setAlert({ type: "error", message: "Provider not found, Try reconect or use custom RPC" });
        setOftContract(null)
        return;
      }

      const network = await provider.getNetwork();
      // setCurrentChain(SUPPORTED_CHAINS[Number(network.chainId)]?.name || `ChainId ${network.chainId}`);

      const code = await provider.getCode(oftAddress);
      if (code === "0x") {
        console.log("Contract does not exist on this chain");
        setAlert({ type: "error", message: "Contract does not exist on this chain!" });
        setOftContract(null)
        return;
      }

      const contract = new ethers.Contract(oftAddress, oftAbi, provider);
      setOftContract(contract);
      let tokenAddress = "Unknown";
      try {
        tokenAddress = await contract.token();
      } catch {
        setOftContract(null)
      }

      let decimals = 18;
      let name = "Unknown";
      let symbol = "Unknown";
      let version = "Unknown";
      let requireApprove = false
      if (ethers.isAddress(tokenAddress)) {
        try {
          const token = new ethers.Contract(tokenAddress, oftAbi, provider);
          decimals = await token.decimals();
          try {
            name = await token.name();
          } catch {}
          try {
            symbol = await token.symbol();
          } catch {}
          try {
            version = await contract.oftVersion();
          } catch {}
          try {
            requireApprove = await contract.approvalRequired();
            console.log(("requireApprove", requireApprove));
            
            setApprovalRequired(requireApprove)
            setNeedsApproval(requireApprove) // reset needsApproval khi check lại
          } catch {}
        } catch {

        }
      }

      setInfo({ tokenAddress, name, symbol, version, decimals });
      const params = new URLSearchParams(window.location.search);
      const recipient = await signer.getAddress();
      const dstEid = Number(params.get("dstEid")) ?? Number(dstEidValue);
      const extraOptions = params.get("extraOp") ?? "0x";

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

      // chỉ check approve nếu cần
      if (approvalRequired && ethers.isAddress(tokenAddress)) {
        await checkApproval(tokenAddress, oftAddress, amount, decimals);
      }
    } catch (err) {
      
      setAlert({
        type: "error",
        message:
          "Check failed: " +
          (err?.message ? err.message.substring(0, 100) + "..." : "Unknown error"),
      });
      console.error(err);
    }
  };

  // handle bridge
  const handleBridge = async () => {
    try {
      if (!ethers.isAddress(oftAddress)) {
        setAlert({ type: "error", message: "Invalid contract address" });
        return;
      }
      if (!provider) {
        setAlert({ type: "error", message: "Provider not found, Try reconect or use custom RPC" });
        return;
      }
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
      // await tx.wait();
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

  // auto update provider
  useEffect(() => {
    if (useCustomRpc && customRpcUrl) {
      // setProvider(new ethers.JsonRpcProvider(customRpcUrl));
    } else if (window.ethereum) {
      setProvider(new ethers.BrowserProvider(window.ethereum));
    } else {
      setProvider(null);
    }
  }, [useCustomRpc, customRpcUrl,currentChainId]);

  // auto check allowance khi amount thay đổi
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

  return (
    <div className="p-6 border rounded-xl flex flex-col gap-4 w-full max-w-3xl mx-auto shadow-md bg-white">
      {/* input contract */}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="Input OFT contract address"
          value={oftAddress}
          onChange={(e) => setOftAddress(e.target.value)}
          className="flex-1 border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          onClick={handleCheck}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
        >
          Check
        </button>
      </div>

{/* custom rpc */}
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={useCustomRpc}
    onChange={(e) => setUseCustomRpc(e.target.checked)}
  />
  Use custom RPC
</label>
{useCustomRpc && (
  <div className="flex flex-col gap-2">
    <div className="flex gap-2 items-center">
<select
  value={isCustomRpc ? "custom" : tempRpcUrl || "default"}
  onChange={(e) => {
    const val = e.target.value;
    if (val === "custom") {
      setIsCustomRpc(true);
      setTempRpcUrl("");
    } else {
      setIsCustomRpc(false);
      setTempRpcUrl(val);
    }
  }}
  className="flex-1 border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
>
  <option value="default">-- Select RPC --</option>
  <option value="https://eth.rpc.blxrbdn.com">Ethereum (blxrdn)</option>
  <option value="https://bsc-dataseed.binance.org/">BNB Chain</option>
  <option value="https://polygon-rpc.com">Polygon</option>
  <option value="https://arb1.arbitrum.io/rpc">Arbitrum</option>
  <option value="https://mainnet.optimism.io">Optimism</option>
  <option value="https://api.avax.network/ext/bc/C/rpc">Avalanche</option>
  <option value="https://base-rpc.publicnode.com">Base</option>
  <option value="custom">➕ Custom (enter manually)</option>
</select>


      <button
        onClick={() => applyRpc()}
        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
      >
        Apply
      </button>
    </div>

    {/* Chỉ hiện ô nhập khi chọn custom */}
  {isCustomRpc && (
    <input
      type="text"
      placeholder="Enter custom RPC URL"
      value={tempRpcUrl}
      onChange={(e) => setTempRpcUrl(e.target.value)}
      className="w-full border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  )}
  </div>
)}



<div className="mt-3 p-3 rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-800 flex flex-col gap-2 shadow-sm">
  <span className="font-semibold">
    This is a custom bridge based on the token’s LayerZero OFT contract, not an official bridge for any token via LayerZero. Test with a small amount first and take responsibility for your transactions!
  </span>
{currentChainId && (
  <div className="flex items-center gap-2">
    <span className="font-semibold">Current Chain:</span>
    <select
      value={currentChainId}
      onChange={(e) => {
        const chain = SUPPORTED_CHAINS[e.target.value];
        if (chain) {
          switchChain(chain.hex);
        } else {
          setAlert({ type: "info", message: `Custom chain selected: ${e.target.value}` });
        }
      }}
      className="border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 font-bold text-blue-600"
    >
      {Object.entries(SUPPORTED_CHAINS).map(([id, chain]) => (
        <option key={id} value={id} className="font-bold">
          {chain.name}
        </option>
      ))}

      {/* ✅ Nếu chain hiện tại không có trong SUPPORTED_CHAINS thì thêm option Custom */}
      {!SUPPORTED_CHAINS[currentChainId] && (
        <option value={currentChainId} className="font-bold">
          Custom (ChainId {currentChainId})
        </option>
      )}
    </select>
  </div>
)}
</div>


      {/* info */}
      {info && (
        <div className="bg-gray-100 p-3 rounded-lg border flex flex-col gap-1 text-sm">
          {/* {currentChain && (
            <div className="mt-3 p-3 rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-800 flex items-center gap-2 shadow-sm">
              <span className="font-semibold">Current Chain:</span>
              <span className="font-bold text-blue-700">{currentChain}</span>
            </div>
          )} */}
          <div>
            <span className="font-semibold">Token adr:</span> {info.tokenAddress}
          </div>
          <div>
            <span className="font-semibold">Name:</span> {info.name}
          </div>
          <div>
            <span className="font-semibold">Symbol:</span> {info.symbol}
          </div>
          <div>
            <span className="font-semibold">OFT Version:</span> {info.version}
          </div>
          <div>
            <span className="font-semibold">Decimals:</span> {info.decimals}
          </div>
              {/* nút share */}
<button
  onClick={() => {
    const url = `${window.location.origin}${window.location.pathname}?oftadr=${oftAddress}&chainId=${currentChainId}&auto=true&dstEid=${sendParams?.dstEid || dstEidValue}&extraOp=${sendParams?.extraOptions || "0x"}`;
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

      {/* send params */}
      {sendParams && (
        <SendParamsEditor
          CHAINS={CHAINS}
          dstChain={dstChain}
          setDstChain={setDstChain}
          dstEidValue={dstEidValue}
          setDstEidValue={setDstEidValue}
          sendParams={sendParams}
          setSendParams={setSendParams}
        />
      )}

      {/* amount + button */}
      {oftContract &&
        <input
          type="number"
          placeholder="Input token amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      }
      {oftContract &&
      <button
        onClick={() =>
          needsApproval
            ? handleApprove(info.tokenAddress, oftAddress, amount, info.decimals || 18)
            : handleBridge()
        }
        className={`text-white px-4 py-2 rounded-lg transition-colors ${
          needsApproval ? "bg-yellow-500 hover:bg-yellow-600" : "bg-blue-500 hover:bg-blue-600"
        }`}
      >
        {needsApproval ? "Approve" : "Bridge"}
      </button>
      }
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}
    </div>
  );
};

export default BridgeButton;
