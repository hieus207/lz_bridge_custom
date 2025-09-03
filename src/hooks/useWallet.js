import { useState, useEffect } from "react";
import { ethers } from "ethers";

function useWallet() {
  const [address, setAddress] = useState(null);
  const [signer, setSigner] = useState(null);

  // Hàm connect
  const connect = async () => {
    if (window.ethereum) {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send("eth_requestAccounts", []);
        const signer = await provider.getSigner();
        const addr = await signer.getAddress();

        setAddress(addr);
        setSigner(signer);

        // Lưu trạng thái đã kết nối
        localStorage.setItem("isWalletConnected", "true");
      } catch (err) {
        console.error("Wallet connect error:", err);
      }
    } else {
      alert("Please install MetaMask!");
    }
  };

  // Hàm disconnect
  const disconnect = () => {
    setAddress(null);
    setSigner(null);
    localStorage.removeItem("isWalletConnected");
  };

  // Auto reconnect khi F5
  useEffect(() => {
    const autoConnect = async () => {
      if (localStorage.getItem("isWalletConnected") === "true" && window.ethereum) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
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

  return { address, signer, connect, disconnect };
}

export default useWallet;
