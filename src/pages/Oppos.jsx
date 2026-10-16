import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, RefreshCw } from "lucide-react";

// Live OPPOS board from the dexcheck bot (via /api/oppos): one card per opportunity, plus the
// bot's recent alerts. The viewing key comes from the bot's /webkey link (#key=…), is kept in
// this browser only and sent with every request.
const KEY_STORE = "oppos_key";
const POLL_MS = 10000;
const MARKETS = [["ALL", "Tất cả"], ["FT", "Futures"], ["SP", "Spot"], ["CROSS", "Cross-chain"]];

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
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}p`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
const MARKET_LABEL = { FT: "Futures", SP: "Spot", CROSS: "Cross" };

// Which side is bought and which sold, in the trader's words
function sides(r) {
  if (r.market === "CROSS") {
    return [
      { verb: "Mua", venue: r.buy_chain_short, kind: "DEX", price: r.buy_price, href: r.buy_link, liq: r.buy_liq },
      { verb: "Bán", venue: r.sell_chain_short, kind: "DEX", price: r.sell_price, href: r.sell_link, liq: r.sell_liq },
    ];
  }
  const dex = { venue: r.chain_short, kind: "DEX", price: r.dex_price, href: r.dex_link };
  const cex = { venue: r.cex_short, kind: r.market === "FT" ? "Futures" : "Spot", price: r.cex_price, href: r.cex_link };
  if (r.market === "FT") {
    return r.cex_above
      ? [{ ...dex, verb: "Mua" }, { ...cex, verb: "Short" }]
      : [{ ...cex, verb: "Long" }, { ...dex, verb: "Bán" }];
  }
  return r.cex_above ? [{ ...dex, verb: "Mua" }, { ...cex, verb: "Bán" }] : [{ ...cex, verb: "Mua" }, { ...dex, verb: "Bán" }];
}

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
      className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-900"
      title={text}
    >
      {done ? <Check className="w-3.5 h-3.5 text-[var(--up)]" /> : <Copy className="w-3.5 h-3.5" />} {label}
    </button>
  );
}

function SideBox({ s }) {
  return (
    <a
      href={s.href}
      target="_blank"
      rel="noopener noreferrer"
      className="tile-inset flex-1 min-w-0 px-3 py-2.5 hover:bg-[var(--hover)] transition group"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{s.verb}</span>
        <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-gray-600" />
      </div>
      <div className="font-extrabold text-gray-900 truncate">
        {s.venue} <span className="text-[10px] font-bold text-gray-400 uppercase">{s.kind}</span>
      </div>
      <div className="text-[15px] tabular text-gray-900">{fmtP(s.price)}</div>
      {s.liq != null && <div className="text-[10px] text-gray-400">liq {fmtLiq(s.liq)}</div>}
    </a>
  );
}

// Numbered steps: "Mua BSC" → "cầu → ETH (LayerZero)" → "nạp Bybit (ETH)"; ⚠️ steps in amber
function Steps({ steps }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5">
      {steps.map((st, i) => {
        const warn = st.startsWith("⚠️");
        return (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && !warn && <ArrowRight className="w-3 h-3 text-gray-300 shrink-0" />}
            <span className={`inline-flex items-center gap-1.5 px-2 py-1 text-[12px] border-[1.5px] ${
              warn ? "border-[var(--warn)] text-[var(--warn)]" : "border-[var(--line-2)] text-gray-700"}`}>
              {!warn && <b className="text-[10px] w-4 h-4 inline-flex items-center justify-center bg-[var(--ink)] text-[var(--on-ink)]">{i + 1}</b>}
              {st.replace(/^⚠️\s*/, "⚠ ")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RouteBlock({ r }) {
  const [open, setOpen] = useState(false);
  if (r.verified) return <Steps steps={r.steps} />;
  if (r.market === "FT" && r.reverse) {
    // Futures below DEX: no transfer can close it — a hedge that waits for parity (⚖️ CÂN)
    return <Steps steps={[`Long ${r.cex_short}`, `bán ${r.chain_short} (coin đang giữ)`, "chốt khi về cân"]} />;
  }
  const label = r.blocked ? "Không có đường đi" : "Chưa xác thực đường đi";
  return (
    <div className="text-[12px]">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`inline-flex items-center gap-1 ${r.blocked ? "text-[var(--down)]" : "text-gray-500"}`}>
        {r.blocked ? "⛔" : "❔"} {label}
        {r.reason && <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>
      {open && r.reason && <p className="mt-1 text-gray-500">{r.reason}</p>}
    </div>
  );
}

function Badge({ children, tone = "line" }) {
  const cls = {
    line: "border-[var(--line-2)] text-gray-500",
    ink: "bg-[var(--ink)] text-[var(--on-ink)] border-[var(--ink)]",
    up: "border-[var(--up)] text-[var(--up)]",
    down: "border-[var(--down)] text-[var(--down)]",
    warn: "border-[var(--warn)] text-[var(--warn)]",
  }[tone];
  return <span className={`px-1.5 py-px text-[10px] font-bold uppercase tracking-wider border-[1.5px] ${cls}`}>{children}</span>;
}

function OppCard({ r }) {
  const [a, b] = sides(r);
  const contract = r.market === "CROSS" ? r.buy_contract : r.contract;
  const diffTone = !r.active ? "text-gray-400" : r.reverse ? "text-[var(--down)]" : "text-[var(--up)]";
  return (
    <article className={`tile p-4 flex flex-col gap-3 min-w-0 ${r.active ? "" : "opacity-60"} ${r.verified && r.active ? "scan-hit" : ""}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-extrabold tracking-wide text-gray-900">{r.symbol}</span>
            {r.star && <span title="Đã đánh dấu">⭐</span>}
            {r.note && <span title={r.note}>📝</span>}
          </div>
          <div className="flex items-center gap-1 flex-wrap mt-1">
            <Badge tone="ink">{MARKET_LABEL[r.market]}</Badge>
            {r.priority === "HIGH" && <Badge tone="warn">High</Badge>}
            {r.reverse && r.active && <Badge tone="down">Ngược</Badge>}
            {r.verified && r.active && <Badge tone="up">✓ Có đường</Badge>}
            {r.stock && <Badge>Cổ phiếu</Badge>}
            {!r.active && <Badge>Hết lệch</Badge>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-2xl font-extrabold tabular leading-none ${diffTone}`}>
            {r.diff >= 0 && r.active ? "+" : ""}{r.diff.toFixed(1)}%
          </div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-1">
            {r.market === "CROSS" ? "" : `liq ${fmtLiq(r.liquidity)}`}
          </div>
        </div>
      </header>

      <div className="flex items-stretch gap-2">
        <SideBox s={a} />
        <div className="flex items-center"><ArrowRight className="w-4 h-4 text-gray-400" /></div>
        <SideBox s={b} />
      </div>

      <div className="border-t-[1.5px] border-dashed border-[var(--line-2)] pt-2.5">
        <RouteBlock r={r} />
      </div>

      <footer className="flex items-center gap-3 flex-wrap">
        {r.bridge && (
          <a href={r.bridge} target="_blank" rel="noopener noreferrer" className="btn-outline px-2.5 py-1 text-[11px] inline-flex items-center gap-1">
            🌉 Cầu <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <CopyBtn text={contract} label="Contract" />
      </footer>
    </article>
  );
}

function AlertCard({ a }) {
  const r = a.row;
  const main = a.channel === "main";
  return (
    <article className={`tile-inset p-3 flex flex-col gap-2 ${main ? "" : "opacity-80"}`}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={main ? "up" : "line"}>{main ? "Đã báo" : "Log"}</Badge>
        <span className="text-[11px] text-gray-400">{ago(a.ts)} trước</span>
      </div>
      <div className="font-bold text-[13px] text-gray-900 leading-snug">{a.title}</div>
      {r ? (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-extrabold">{r.symbol}</span>
            <span className={`font-extrabold tabular ${r.reverse ? "text-[var(--down)]" : "text-[var(--up)]"}`}>
              {r.diff >= 0 ? "+" : ""}{r.diff.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] flex-wrap">
            {sides(r).map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <ArrowRight className="w-3 h-3 text-gray-300" />}
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  <span className="text-gray-400">{s.verb}</span> <b>{s.venue}</b> {fmtP(s.price)}
                </a>
              </span>
            ))}
          </div>
          <RouteBlock r={r} />
          {r.bridge && (
            <a href={r.bridge} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
              🌉 Cầu <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </>
      ) : (
        <div className="text-[12px] text-gray-600 flex flex-col gap-0.5">
          {a.lines.slice(0, 5).map((ln, i) => <span key={i}>{ln}</span>)}
        </div>
      )}
    </article>
  );
}

function Toggle({ on, onChange, children }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider border-[1.5px] ${on ? "chip-on border-[var(--line)]" : "border-[var(--line-2)] text-gray-500 hover:border-[var(--line)]"}`}
    >
      {children}
    </button>
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
  const [showLog, setShowLog] = useState(false);
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

  const alerts = useMemo(() => (data?.alerts || []).filter((a) => showLog || a.channel === "main"), [data, showLog]);

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
    <div className="font-sans px-4 py-6 md:py-8 flex justify-center">
      <div className="w-full max-w-[1240px] flex flex-col gap-5 min-w-0">
        {/* Header + filters */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="text-[26px] font-extrabold tracking-[0.08em] uppercase text-gray-900">Oppos</h1>
            {data && (
              <span className={`inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider ${stale ? "text-[var(--warn)]" : "text-gray-500"}`}>
                <span className={`w-2 h-2 rounded-full ${stale ? "bg-[var(--warn)]" : "bg-[var(--up)] animate-pulse"}`} />
                cập nhật {ago(data.updated)} trước{stale ? " · bot có thể đang dừng" : ""}
              </span>
            )}
            <div className="ml-auto flex items-center gap-4">
              <button type="button" onClick={load} className="text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Tải lại
              </button>
              <button type="button" onClick={() => { saveKey(""); setKey(""); setData(null); }} className="text-[11px] uppercase tracking-wider text-gray-400 hover:text-gray-900">
                Đổi khoá
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap">
              {MARKETS.map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMarket(m)}
                  className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-[1.5px] -ml-[1.5px] first:ml-0 ${
                    market === m ? "chip-on border-[var(--line)] relative z-10" : "border-[var(--line-2)] text-gray-500 hover:text-gray-900"}`}
                >
                  {label} <span className="opacity-60">{counts[m]}</span>
                </button>
              ))}
            </div>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm coin…" className="tile-inset px-3 py-1.5 text-sm w-40" />
            <Toggle on={onlyActive} onChange={setOnlyActive}>Đang lệch</Toggle>
            <Toggle on={onlyVerified} onChange={setOnlyVerified}>✓ Có đường</Toggle>
            <Toggle on={showBlocked} onChange={setShowBlocked}>Kèo không có đường</Toggle>
          </div>
          {error && <p className="text-sm text-[var(--down)]">{error}</p>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_20rem] gap-5 items-start">
          {/* Opportunity cards */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
            {rows.map((r) => (
              <OppCard key={`${r.market}|${r.symbol}|${r.cex || r.buy_chain}|${r.contract || r.buy_contract}`} r={r} />
            ))}
            {data && !rows.length && <p className="text-sm text-gray-500 py-10 text-center md:col-span-2">Không có kèo nào khớp bộ lọc.</p>}
            {!data && !error && <p className="text-sm text-gray-500 py-10 text-center md:col-span-2">Đang tải…</p>}
          </section>

          {/* Recent alerts */}
          <aside className="tile relative p-4 flex flex-col gap-3 lg:sticky lg:top-28">
            <span className="tile-tab"><b>NEW</b>Kèo mới</span>
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-gray-500">Tin bot vừa báo</span>
              <Toggle on={showLog} onChange={setShowLog}>+ Log</Toggle>
            </div>
            <div className="flex flex-col gap-2.5 max-h-[70vh] overflow-y-auto -mr-1 pr-1">
              {alerts.map((a, i) => <AlertCard key={`${a.ts}-${i}`} a={a} />)}
              {data && !alerts.length && <p className="text-[12px] text-gray-500 py-4 text-center">Chưa có tin nào.</p>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
