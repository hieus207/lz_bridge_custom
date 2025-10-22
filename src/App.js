import React from "react";
import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import Bridge from "./pages/Bridge";
import Dashboard from "./pages/Dashboard";
import Solana from "./pages/Solana"; // 👈 thêm dòng này


function App() {
  return (
    <Router>
      <Analytics />
      <nav className="p-4 bg-gray-800 text-white flex gap-4">
        {/* <Link to="/" className="hover:underline">
          Dashboard
        </Link> */}
        <Link to="/bridge" className="hover:underline">
          Bridge
        </Link>
        <Link to="/solana" className="hover:underline"> {/* 👈 link mới */}
          Solana
        </Link>
      </nav>

      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bridge" element={<Bridge />} />
        <Route path="/solana" element={<Solana />} /> {/* 👈 route mới */}
      </Routes>
    </Router>
  );
}

export default App;
