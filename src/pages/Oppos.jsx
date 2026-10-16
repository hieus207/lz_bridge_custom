import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, RefreshCw } from "lucide-react";

// Live OPPOS table from the dexcheck bot (via /api/oppos). The viewing key comes from the bot's
// /webkey link (#key=…), is kept in this browser only and sent with every request.
const KEY_STORE = "oppos_key";
const POLL_MS = 10000;
const MARKETS = ["ALL", "FT", "SP", "CROSS"];

const readKey = () => { try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } };
const saveKey = (k) => { try { k ? localStorage.setItem(KEY_STORE, k) : localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } };

const fmtP = (p) => {
  if (!p) return "—";
  if (p >= 1000) return `$${p.toLocaleString("en", { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toFixed(3)}`;
  if (p >= 0.001) return `$${p.toFixed(5)}`;
  return `$${p.toExponential(3)}`;
};
const fmtLiq = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${(v || 0).toFixed(0)}`);
const ago = (ts) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`;
};

function Status({ r }) {
  if (!r.active) return <span className="text-gray-400" title="Đã hết lệch">✕</span>;
  if (r.market === "CROSS") return <span className="w-2.5 h-2.5 inline-block rounded-full bg-purple-500" title="Cross-chain" />;
  if (r.reverse) return <span className="w-2.5 h-2.5 inline-block rounded-full bg-[var(--down)]" title="Ngược (FT rẻ hơn DEX)" />;
  return <span className={`w-2.5 h-2.5 inline-block rounded-full ${r.cex_above ? "bg-[var(--up)]" : "bg-sky-500"}`} title={r.cex_above ? "CEX cao hơn DEX" : "CEX thấp hơn DEX"} />;
}

function RouteCell({ r }) {
  const [open, setOpen] = useState(false);
  const label = r.verified ? "✅ có đường" : r.blocked ? "⛔ không có đường" : "❔ chưa xác thực";
  const tone = r.verified ? "text-[var(--up)]" : r.blocked ? "text-[var(--down)]" : "text-gray-500";
  const detail = r.verified ? r.steps.join(" → ") : r.reason;
  return (
    <div className="min-w-[9rem]">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`inline-flex items-center gap-1 ${tone}`} disabled={!detail}>
        {label}
        {detail && <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && detail && <div className="text-[11px] text-gray-500 mt-1 max-w-[22rem] whitespace-normal">{detail}</div>}
      {r.bridge && (
        <a href={r.bridge} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-0.5 mt-0.5">
          🌉 cầu <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

const A = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-gray-900 hover:underline">{children}</a>
);

function Row({ r }) {
  const dim = r.active ? "" : "opacity-50";
  const diff = `${r.diff >= 0 && r.active ? "+" : ""}${r.diff.toFixed(1)}%`;
  return (
    <tr className={`border-t border-[var(--line-2)] align-top ${dim}`}>
      <td className="py-2 pr-2"><Status r={r} /></td>
      <td className="py-2 pr-3 whitespace-nowrap">
        <span className="font-extrabold text-gray-900">{r.symbol}</span>
        {r.star && <span title="Đã đánh dấu"> ⭐</span>}
        {r.note && <span title={r.note}> 📝</span>}
        {r.stock && <span title="Cổ phiếu token hoá"> 📈</span>}
        <div className="text-[10px] uppercase tracking-wider text-gray-400">{r.market}{r.priority === "HIGH" ? " · high" : ""}</div>
      </td>
      <td className="py-2 pr-3 font-bold tabular whitespace-nowrap">{diff}{r.reverse && r.active && <span className="text-[var(--down)] font-normal text-[11px]"> ngược</span>}</td>
      {r.market === "CROSS" ? (
        <td className="py-2 pr-3 whitespace-nowrap">
          mua <A href={r.buy_link}>{r.buy_chain_short}</A> {fmtP(r.buy_price)} → bán <A href={r.sell_link}>{r.sell_chain_short}</A> {fmtP(r.sell_price)}
        </td>
      ) : (
        <td className="py-2 pr-3 whitespace-nowrap">
          <A href={r.cex_link}>{r.cex_short}</A> {fmtP(r.cex_price)}
          <span className="text-gray-400"> {r.cex_above ? ">" : "<"} </span>
          <A href={r.dex_link}>{r.chain_short}</A> {fmtP(r.dex_price)}
        </td>
      )}
      <td className="py-2 pr-3 tabular whitespace-nowrap text-gray-600">
        {r.market === "CROSS" && r.buy_liq != null ? `${fmtLiq(r.buy_liq)}/${fmtLiq(r.sell_liq)}` : fmtLiq(r.liquidity)}
      </td>
      <td className="py-2"><RouteCell r={r} /></td>
    </tr>
  );
}

export default function Oppos() {
  const [key, setKey] = useState(readKey);
  const [keyInput, setKeyInput] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [market, setMarket] = useState("ALL");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [, tick] = useState(0);

  // #key=… from the bot's /webkey link: keep it, then drop it from the address bar
  useEffect(() => {
    const m = window.location.hash.match(/key=([^&]+)/);
    if (m) {
      const k = decodeURIComponent(m[1]);
      saveKey(k);
      setKey(k);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const load = async () => {
    if (!key) return;
    setLoading(true);
    try {
      const r = await fetch("/api/oppos", { headers: { "X-Feed-Token": key }, cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setError("Khoá không đúng hoặc đã đổi — lấy link mới bằng /webkey trong Telegram.");
        return;
      }
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
      setError(null);
    } catch (err) {
      setError(`Không đọc được bảng: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Poll while the tab is visible
  useEffect(() => {
    if (!key) return undefined;
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    const clock = setInterval(() => tick((x) => x + 1), 1000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); clearInterval(clock); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase();
    return (data?.rows || []).filter((r) =>
      (market === "ALL" || r.market === market)
      && (!onlyActive || r.active)
      && (!onlyVerified || r.verified)
      && (showBlocked || !r.blocked || r.market === "FT")
      && (!q || r.symbol.toUpperCase().includes(q)));
  }, [data, market, onlyActive, onlyVerified, showBlocked, query]);

  const counts = useMemo(() => {
    const c = { ALL: 0, FT: 0, SP: 0, CROSS: 0 };
    for (const r of data?.rows || []) if (r.active) { c.ALL++; c[r.market]++; }
    return c;
  }, [data]);

  if (!key) {
    return (
      <div className="font-sans px-4 py-10 flex justify-center">
        <form
          className="tile relative p-6 w-full max-w-[460px] flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); const k = keyInput.trim(); if (k) { saveKey(k); setKey(k); } }}
        >
          <span className="tile-tab"><b>01</b>Khoá xem</span>
          <p className="text-sm text-gray-600">
            Gõ <code className="font-mono">/webkey</code> trong Telegram để bot gửi link mở trang này kèm khoá, hoặc dán khoá vào đây.
          </p>
          <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Khoá…" className="tile-inset px-3 py-2.5 text-sm font-mono" />
          <button type="submit" className="btn-primary h-11 text-sm">Lưu khoá</button>
        </form>
      </div>
    );
  }

  const stale = data && Date.now() / 1000 - data.updated > 180;

  return (
    <div className="font-sans px-4 py-8 flex justify-center">
      <div className="tile relative w-full max-w-[1180px] p-4 md:p-6 flex flex-col gap-4 min-w-0">
        <span className="tile-tab"><b>LIVE</b>Oppos</span>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="text-2xl font-extrabold tracking-[0.06em] uppercase text-gray-900">Oppos</h1>
          {data && (
            <span className={`text-[11px] uppercase tracking-wider ${stale ? "text-[var(--warn)]" : "text-gray-500"}`}>
              cập nhật {ago(data.updated)} trước{stale ? " · bot có thể đang dừng" : ""}
            </span>
          )}
          <button type="button" onClick={load} className="ml-auto text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Tải lại
          </button>
          <button type="button" onClick={() => { saveKey(""); setKey(""); setData(null); }} className="text-[11px] uppercase tracking-wider text-gray-400 hover:text-gray-900">
            Đổi khoá
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {MARKETS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarket(m)}
              className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider border-[1.5px] ${market === m ? "chip-on border-[var(--line)]" : "border-[var(--line-2)] text-gray-500 hover:border-[var(--line)]"}`}
            >
              {m === "ALL" ? "Tất cả" : m} <span className="opacity-60">{counts[m]}</span>
            </button>
          ))}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm coin…" className="tile-inset px-2.5 py-1 text-sm w-36" />
          <label className="text-[12px] text-gray-600 inline-flex items-center gap-1">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> đang lệch
          </label>
          <label className="text-[12px] text-gray-600 inline-flex items-center gap-1">
            <input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} /> chỉ có đường ✅
          </label>
          <label className="text-[12px] text-gray-600 inline-flex items-center gap-1">
            <input type="checkbox" checked={showBlocked} onChange={(e) => setShowBlocked(e.target.checked)} /> hiện kèo không có đường
          </label>
        </div>

        {error && <p className="text-sm text-[var(--down)]">{error}</p>}

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400">
                <th className="font-normal py-1 pr-2" />
                <th className="font-normal py-1 pr-3">Coin</th>
                <th className="font-normal py-1 pr-3">Lệch</th>
                <th className="font-normal py-1 pr-3">Giá</th>
                <th className="font-normal py-1 pr-3">Thanh khoản</th>
                <th className="font-normal py-1">Đường đi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <Row key={`${r.market}|${r.symbol}|${r.cex || r.buy_chain}|${r.contract || r.buy_contract}`} r={r} />)}
            </tbody>
          </table>
          {data && !rows.length && <p className="text-sm text-gray-500 py-6 text-center">Không có kèo nào khớp bộ lọc.</p>}
          {!data && !error && <p className="text-sm text-gray-500 py-6 text-center">Đang tải…</p>}
        </div>
      </div>
    </div>
  );
}
