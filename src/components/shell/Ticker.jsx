import { useEffect, useState } from "react";

const SYMBOLS = [
  ["BTC", "BTCUSDT"],
  ["ETH", "ETHUSDT"],
  ["BNB", "BNBUSDT"],
  ["SOL", "SOLUSDT"],
  ["AVAX", "AVAXUSDT"],
];
const REFRESH_MS = 60_000;

const fmtUsd = (v) => (v >= 1000
  ? v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })
  : v.toLocaleString("en-US", { maximumFractionDigits: 4 }));

// Market strip under the nav. Hides itself if the price API is unreachable
// rather than showing stale or placeholder numbers.
export default function Ticker() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const q = encodeURIComponent(JSON.stringify(SYMBOLS.map((s) => s[1])));
        const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${q}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const bySym = Object.fromEntries(data.map((d) => [d.symbol, d]));
        if (alive) setRows(SYMBOLS.map(([label, sym]) => ({
          label,
          price: parseFloat(bySym[sym]?.lastPrice),
          change: parseFloat(bySym[sym]?.priceChangePercent),
        })).filter((r) => Number.isFinite(r.price)));
      } catch {
        if (alive) setRows((prev) => prev ?? []);
      }
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!rows?.length) return <div className="ticker h-[3px]" aria-hidden="true" />;

  return (
    <div className="ticker text-[12px] h-7 flex items-center overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
      <div className="mx-auto flex items-center gap-7 px-4">
        <span className="flex items-center gap-2 font-bold tracking-[0.1em]"><span className="live-dot" />LIVE</span>
        {rows.map((r) => (
          <span key={r.label} className="tabular">
            1 {r.label} = ${fmtUsd(r.price)}
            <span className={`ml-2 ${r.change >= 0 ? "up" : "down"}`}>
              {r.change >= 0 ? "▲" : "▼"}{Math.abs(r.change).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
