import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import Bridge from "./pages/Bridge";
import Dashboard from "./pages/Dashboard";
import Solana from "./pages/Solana";
import Nexus from "./pages/Nexus";


function App() {
  return (
    <Router>
      <nav className="p-4 bg-gray-800 text-white flex gap-4">
        {/* <Link to="/" className="hover:underline">
          Dashboard
        </Link> */}
        <Link to="/bridge" className="hover:underline">
          Bridge
        </Link>
        <Link to="/solana" className="hover:underline">
          Solana
        </Link>
        <Link to="/nexus" className="hover:underline">
          Nexus
        </Link>
      </nav>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bridge" element={<Bridge />} />
        <Route path="/solana" element={<Solana />} />
        <Route path="/nexus" element={<Nexus />} />
      </Routes>
    </Router>
  );
}

export default App;
