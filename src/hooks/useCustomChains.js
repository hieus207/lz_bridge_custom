import { useState, useEffect } from "react";
import { loadCustomChains, subscribeCustomChains } from "../lib/customChains";

// Live list of user-added chains; stays in sync across pages and tabs.
export default function useCustomChains() {
  const [chains, setChains] = useState(loadCustomChains);
  useEffect(() => subscribeCustomChains(setChains), []);
  return chains;
}
