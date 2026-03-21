import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import Bridge from "./pages/Bridge";
import Dashboard from "./pages/Dashboard";
import Solana from "./pages/Solana";
import Nexus from "./pages/Nexus";
import BridgeScan from "./pages/BridgeScan";


function App() {
  return (
    <Router>
      <nav className="px-6 py-3 bg-white border-b border-gray-100 flex items-center gap-6">
        <span className="font-bold text-gray-900 text-sm tracking-tight">HLT Bridge</span>
        <div className="flex gap-4">
          <Link to="/scan" className="text-sm text-gray-500 hover:text-gray-900 transition font-medium">
            Scan
          </Link>
          <Link to="/bridge" className="text-sm text-gray-500 hover:text-gray-900 transition font-medium">
            L0
          </Link>
          <Link to="/nexus" className="text-sm text-gray-500 hover:text-gray-900 transition font-medium">
            Nexus
          </Link>
        </div>
      </nav>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bridge" element={<Bridge />} />
        <Route path="/scan" element={<BridgeScan />} />
        <Route path="/solana" element={<Solana />} />
        <Route path="/nexus" element={<Nexus />} />
      </Routes>
    </Router>
  );
}

export default App;
