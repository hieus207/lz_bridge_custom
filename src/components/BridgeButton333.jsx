import { useState, useEffect } from "react";
import { ethers } from "ethers";
import oftAbi from "../abis/OFT.json";
import Alert from "./Alert";

const CHAINS = {
  Ethereum: 30101,
  BSC: 30102,
  Polygon: 30103,
  Arbitrum: 30104,
  Optimism: 30105,
  Avalanche: 30106,
  Fantom: 30107,
  CoreDAO: 30108,
  Custom: null, // cho phép nhập thủ công
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
  const [amount, setAmount] = useState("10");
  const [info, setInfo] = useState(null); // Lưu thông tin check
  const [sendParams, setSendParams] = useState(null); // Lưu sendParam để custom
  const [dstChain, setDstChain] = useState("Ethereum");
  const [dstEidValue, setDstEidValue] = useState(CHAINS[dstChain]);
  const [useCustomRpc, setUseCustomRpc] = useState(false);
  const [customRpcUrl, setCustomRpcUrl] = useState("");
  const [provider, setProvider] = useState(null);
  const [currentChain, setCurrentChain] = useState(null);
  const [alert, setAlert] = useState(null);
  
  // Handle Check
  const handleCheck = async () => {
    try {
      if (!ethers.isAddress(oftAddress)) {
        // alert("Contract address không hợp lệ");
        setAlert({ type: "error", message: "Contract address không hợp lệ" })

        return;
      }

      // const provider = new ethers.JsonRpcProvider(BSC_RPC);
      if (!provider) {
        // alert("Provider chưa sẵn sàng!");
        setAlert({ type: "error", message: "Provider không hoạt động Mở ví check lại hoặc F5 web hoặc custom rpc" })

        return;
      }

      const network = await provider.getNetwork();
      const chainName = CHAIN_NAMES[Number(network.chainId)] || `ChainId ${network.chainId}`;
      console.log(network, chainName);

      setCurrentChain(chainName);

      const code = await provider.getCode(oftAddress);
      if (code === "0x") {
        setAlert({ type: "error", message:"Contract không tồn tại trên chain này!"})
        return;
      }

      const contract = new ethers.Contract(oftAddress, oftAbi, provider);

      // Lấy token address
      let tokenAddress = "Unknown";
      try {
        tokenAddress = await contract.token();
      } catch (err) {
        console.warn("Token() call failed, có thể do proxy:", err);
      }

      // Lấy decimals nếu tokenAddress hợp lệ
      let decimals = "Unknown";
      let name = "Unknown";
      let symbol = "Unknown";
      let version = "Unknown";
      if (ethers.isAddress(tokenAddress)) {
        try {
          const erc20Abi = [
            "function decimals() view returns (uint8)",
            "function name() view returns (string)",
            "function symbol() view returns (string)"
          ];
          const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
          decimals = await tokenContract.decimals();
          try { name = await tokenContract.name(); } catch (err) { }
          try { symbol = await tokenContract.symbol(); } catch (err) { }
          try { version = await contract.oftVersion(); } catch (err) { }
        } catch (err) {
          console.warn("Không lấy được decimals:", err);
        }
      }

      // Lấy name, symbol, version từ OFT contract




      setInfo({ tokenAddress, name, symbol, version, decimals });

      // Tạo sendParams mặc định
      const recipient = await signer.getAddress();
      const dstEid = Number(dstEidValue); // luôn lấy từ input
      const amountWei = ethers.parseUnits(amount, decimals === "Unknown" ? 18 : decimals);

      setSendParams({
        dstEid,
        to: ethers.zeroPadValue(recipient, 32),
        amountLD: amountWei.toString(),
        minAmountLD: amountWei.toString(),
        extraOptions: "0x",
        composeMsg: "0x",
        oftCmd: "0x",
      });

    } catch (err) {
      console.error(err);
      setAlert({ type: "error", message:"Check failed: " + err.message})

      // alert("Check failed: " + err.message);
    }
  };

  // Update sendParams khi dstChain hoặc customDstEid thay đổi
  useEffect(() => {
    if (!sendParams) return;
    // Lấy dstEid từ input dstEidValue
    const dstEid = Number(dstEidValue);
    setSendParams((prev) => ({ ...prev, dstEid }));
  }, [dstChain, dstEidValue]);

  useEffect(() => {
    if (!sendParams || !info?.decimals) return;

    const decimals = info.decimals === "Unknown" ? 18 : info.decimals;
    const amountWei = ethers.parseUnits(amount, decimals);

    setSendParams((prev) => ({
      ...prev,
      amountLD: amountWei.toString(),
      minAmountLD: amountWei.toString(),
    }));
  }, [amount, info?.decimals]);

  useEffect(() => {
    if (useCustomRpc && customRpcUrl) {
      setProvider(new ethers.JsonRpcProvider(customRpcUrl));
    } else if (window.ethereum) {
      setProvider(new ethers.BrowserProvider(window.ethereum));
    } else {
      setProvider(null);
    }
  }, [useCustomRpc, customRpcUrl]);

  // Handle Bridge
  const handleBridge = async () => {
    try {
      if (!ethers.isAddress(oftAddress)) {
        // alert("Contract address không hợp lệ");
        setAlert({ type: "error", message: "Contract address không hợp lệ" })

        return;
      }
      if (!provider) {
        // alert("Provider chưa sẵn sàng!");
        setAlert({ type: "error", message: "Provider không hoạt động Mở ví check lại hoặc F5 web hoặc custom rpc" })
        
        return;
      }
      const readOnlyContract = new ethers.Contract(oftAddress, oftAbi, provider);
      const contract = new ethers.Contract(oftAddress, oftAbi, signer);
      const recipient = await signer.getAddress();

      // Call quoteSend
      console.log("Call quoteSend with param:", sendParams);
      console.log(provider);

      const fee = await readOnlyContract.quoteSend(sendParams, false);
      console.log(fee);

      const tx = await contract.send(
        sendParams,
        { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee },
        recipient,
        { value: fee.nativeFee }
      );

      await tx.wait();
      setAlert({ type: "success", message: "Giao dịch thành công!" })
    } catch (err) {
      console.error(err);
      // alert("Bridge failed: " + err.message);
      setAlert({ type: "error", message: "Giao dịch thất bại!\n" + err.message })

    }
  };

  return (
    <div className="p-6 border rounded-xl flex flex-col gap-4 w-full max-w-3xl mx-auto shadow-md bg-white">
      {/* Input + nút check */}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="Nhập OFT contract address"
          value={oftAddress}
          onChange={(e) => setOftAddress(e.target.value)}
          className="flex-1 border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />

        <button
          onClick={handleCheck}
          className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
        >
          Check
        </button>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={useCustomRpc}
          onChange={(e) => setUseCustomRpc(e.target.checked)}
        />
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
      {/* Hiển thị thông tin check */}
      {info && (
        <div className="bg-gray-100 p-3 rounded-lg border flex flex-col gap-1 text-sm">
          {currentChain && (
            <div className="mt-3 p-3 rounded-lg border border-yellow-300 bg-yellow-50 text-yellow-800 flex items-center gap-2 shadow-sm">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5 text-yellow-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M12 5a7 7 0 100 14a7 7 0 000-14z"
                />
              </svg>
              <span className="font-semibold">Current Chain:</span>
              <span className="font-bold text-blue-700">{currentChain}</span>
            </div>
          )}
          <div><span className="font-semibold">Token adr:</span> {info.tokenAddress}</div>
          <div><span className="font-semibold">Name:</span> {info.name}</div>
          <div><span className="font-semibold">Symbol:</span> {info.symbol}</div>
          <div><span className="font-semibold">OFT Version:</span> {info.version}</div>
          <div><span className="font-semibold">Decimals:</span> {info.decimals}</div>
        </div>
      )}

      {/* Hiển thị và custom sendParams */}
      {sendParams && (
        <div className="bg-gray-50 border p-3 rounded-lg flex flex-col gap-2 text-sm">
          <div className="font-semibold">Send Params (customizable)</div>

          {/* dstEid với dropdown + custom */}
          <div className="flex gap-2 items-center">

            <label className="w-28 font-medium">dstEid (Chain):</label>
            <select
              className="border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={dstChain}
              onChange={(e) => {
                const chain = e.target.value;
                setDstChain(chain);
                setDstEidValue(CHAINS[chain] ?? dstEidValue); // update input
              }}
            >
              {Object.keys(CHAINS).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <input
              type="number"
              value={dstEidValue ?? ""}
              onChange={(e) => {
                setDstEidValue(e.target.value);
                setDstChain("Custom"); // sửa input → dropdown về Custom
              }}
              className="border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>


          {/* Hiển thị các field sendParams khác */}
          {Object.entries(sendParams).map(([key, value]) => {
            if (key === "dstEid") return null; // dstEid đã render bên trên
            return (
              <div key={key} className="flex gap-2 items-center">
                <label className="w-28 font-medium">{key}:</label>
                <input
                  type="text"
                  className="flex-1 border px-2 py-1 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={value}
                  onChange={(e) =>
                    setSendParams((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Input số lượng + nút bridge */}
      <input
        type="number"
        placeholder="Số lượng token"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="border px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <button onClick={handleBridge} className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors" >
        Bridge
      </button>
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

export default BridgeButton;
