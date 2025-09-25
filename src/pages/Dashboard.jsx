import React from "react";
import { Link } from "react-router-dom";

function Dashboard() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-6">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <p className="mb-4">Đây là trang khác ngoài Bridge.</p>
      <Link
        to="/bridge"
        className="px-4 py-2 bg-purple-500 text-white rounded-xl shadow hover:bg-purple-400 transition"
      >
        Đi tới Bridge
      </Link>
    </div>
  );
}

export default Dashboard;
