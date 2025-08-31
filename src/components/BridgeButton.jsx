import { useState, useEffect } from "react";
import { ethers } from "ethers";
import oftAbi from "../abis/OFT.json";
// import oftAbi from "../abis/ERC20.json"; // dùng đúng ABI ERC20
import Alert from "./Alert";
import SendParamsEditor from "./SendParamsEditor";

const CHAINS = {
  Ethereum: 30101,
  BSC: 30102,
  Polygon: 30103,
  Arbitrum: 30104,
  Optimism: 30105,
  Avalanche: 30106,
  Fantom: 30107,
  CoreDAO: 30108,
  Custom: null,
};

const CHAIN_NAMES = {
  1: "Ethereum",
  56: "BNB Chain",
  137: "Polygon",
  43114: "Avalanche",
  42161: "Arbitrum",
  10: "Optimism",
  8453: "Base",
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
  const [provider, setProvider] = useState(null);
  const [currentChain, setCurrentChain] = useState(null);
  const [alert, setAlert] = useState(null);

  const [approvalRequired, setApprovalRequired] = useState(false); // mặc định true
  const [needsApproval, setNeedsApproval] = useState(false);

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
      if (!ethers.isAddress(oftAddress)) {
        setAlert({ type: "error", message: "Contract address không hợp lệ!" });
        setOftContract(null)
        return;
      }
      if (!provider) {
        setAlert({ type: "error", message: "Provider chưa sẵn sàng" });
        setOftContract(null)
        return;
      }

      const network = await provider.getNetwork();
      setCurrentChain(CHAIN_NAMES[Number(network.chainId)] || `ChainId ${network.chainId}`);

      const code = await provider.getCode(oftAddress);
      if (code === "0x") {
        setAlert({ type: "error", message: "Contract không tồn tại trên chain này!" });
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

      const recipient = await signer.getAddress();
      const dstEid = Number(dstEidValue);
      const amountWei = ethers.parseUnits(amount, decimals);

      setSendParams({
        dstEid,
        to: ethers.zeroPadValue(recipient, 32),
        amountLD: amountWei.toString(),
        minAmountLD: amountWei.toString(),
        extraOptions: "0x",
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
        setAlert({ type: "error", message: "Contract address không hợp lệ" });
        return;
      }
      if (!provider) {
        setAlert({ type: "error", message: "Provider chưa sẵn sàng" });
        return;
      }
      const readOnlyContract = new ethers.Contract(oftAddress, oftAbi, provider);
      const contract = new ethers.Contract(oftAddress, oftAbi, signer);
      const recipient = await signer.getAddress();

      const fee = await readOnlyContract.quoteSend(sendParams, false);

      const tx = await contract.send(
        sendParams,
        { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee },
        recipient,
        { value: fee.nativeFee }
      );
      // await tx.wait();
      const receipt = await tx.wait();
      if (receipt.status === 1) {
      setAlert({ type: "success", message: `Bridge thành công! <a class='underline underline-offset-2' target='_blank' href='https://layerzeroscan.com/tx/${tx.hash}'>${tx.hash.substring(0,10)}...</a>` });
      } else {
        setAlert({
          type: "error",
          message: `Transaction thất bại! TxHash: ${tx.hash}`,
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
      setProvider(new ethers.JsonRpcProvider(customRpcUrl));
    } else if (window.ethereum) {
      setProvider(new ethers.BrowserProvider(window.ethereum));
    } else {
      setProvider(null);
    }
  }, [useCustomRpc, customRpcUrl]);

  // auto check allowance khi amount thay đổi
  useEffect(() => {
    if (approvalRequired && info?.tokenAddress && ethers.isAddress(info.tokenAddress) && oftAddress) {
      checkApproval(info.tokenAddress, oftAddress, amount, info.decimals || 18);
    }
  }, [amount, info, oftAddress, approvalRequired]);

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
        <button onClick={handleCheck} className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-green-600">
          Check
        </button>
      </div>

      {/* custom rpc */}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={useCustomRpc} onChange={(e) => setUseCustomRpc(e.target.checked)} />
        Use custom RPC
      </label>
      {useCustomRpc && (
        <input
          type="text"
          placeholder="Enter custom RPC URL"
          value={customRpcUrl}
          onChange={(e) => setCustomRpcUrl(e.target.value)}
          className="border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      )}
<div className="mt-3 p-3 rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-800 flex flex-col gap-2 shadow-sm">
  <span className="font-semibold">
    This is a custom bridge based on the token’s LayerZero OFT contract, not an official bridge for any token via LayerZero. Test with a small amount first and take responsibility for your transactions!
  </span>
  {currentChain && (
    <div>
      <span className="font-semibold">Current Chain:</span>
      <span className="font-bold text-blue-700 ml-1">{currentChain}</span>
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
