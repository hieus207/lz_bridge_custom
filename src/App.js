import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import Bridge from "./pages/Bridge";
import Solana from "./pages/Solana";
import BridgeScan from "./pages/BridgeScan";
import TopNav from "./components/shell/TopNav";
import MarketBackground from "./components/shell/MarketBackground";


// The Nexus (Hyperlane) tab now lives inside /bridge; keep old links working.
function NexusRedirect() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("proto", "hyperlane");
  return <Navigate to={`/bridge?${p}`} replace />;
}

function App() {
  return (
    <Router>
      <MarketBackground />
      <TopNav />

      <Routes>
        <Route path="/" element={<Navigate to="/scan" replace />} />
        <Route path="/bridge" element={<Bridge />} />
        <Route path="/scan" element={<BridgeScan />} />
        <Route path="/solana" element={<Solana />} />
        <Route path="/nexus" element={<NexusRedirect />} />
      </Routes>
    </Router>
  );
}

export default App;
