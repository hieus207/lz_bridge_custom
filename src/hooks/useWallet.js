import { useState } from "react";
import { ethers } from "ethers";

const useWallet = () => {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState(null);

  const connect = async () => {
    if (!window.ethereum) throw new Error("No wallet found!");
    const prov = new ethers.BrowserProvider(window.ethereum);
    await prov.send("eth_requestAccounts", []);
    const signer = await prov.getSigner();
    const addr = await signer.getAddress();

    setProvider(prov);
    setSigner(signer);
    setAddress(addr);
  };

  const disconnect = () => {
    setProvider(null);
    setSigner(null);
    setAddress(null);
  };

  return { provider, signer, address, connect, disconnect };
};

export default useWallet;
