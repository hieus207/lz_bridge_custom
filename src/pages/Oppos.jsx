import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Copy, ExternalLink, RefreshCw } from "lucide-react";

// Live OPPOS board from the dexcheck bot (via /api/oppos): a compact list of opportunities (or the
// bot's recent alerts) on the left, the selected one's trade and route on the right. The viewing
// key comes from the bot's /webkey link (#key=…), is kept in this browser only, sent with every request.
const KEY_STORE = "oppos_key";
const POLL_MS = 10000;
const MARKETS = [["ALL", "Tất cả"], ["FT", "Futures"], ["SP", "Spot"], ["CROSS", "Cross"]];
const MARKET_LABEL = { FT: "Futures", SP: "Spot", CROSS: "Cross-chain" };

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
const fmtDiff = (d, active = true) => `${d >= 0 && active ? "+" : ""}${d.toFixed(1)}%`;
const ago = (ts) => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}p`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};
// "KuCoinFT" → "KuCoin", "HyperliquidFT" → "Hyperliquid"
const exName = (cex) => (cex || "").replace(/(FT|SP)$/, "").replace(/^Okx$/, "OKX");
const rowKey = (r) => `${r.market}|${r.symbol}|${r.cex || r.buy_chain}|${r.contract || r.buy_contract}`;

// Which side is bought and which sold, in the trader's words
function sides(r) {
  if (r.market === "CROSS") {
    return [
      { verb: "Mua", venue: r.buy_chain_short, kind: "DEX", price: r.buy_price, href: r.buy_link, liq: r.buy_liq, contract: r.buy_contract },
      { verb: "Bán", venue: r.sell_chain_short, kind: "DEX", price: r.sell_price, href: r.sell_link, liq: r.sell_liq, contract: r.sell_contract },
    ];
  }
  const dex = { venue: r.chain_short, kind: "DEX", price: r.dex_price, href: r.dex_link, liq: r.liquidity, contract: r.contract };
  const cex = { venue: exName(r.cex), kind: r.market === "FT" ? "Futures" : "Spot", price: r.cex_price, href: r.cex_link };
  if (r.market === "FT") {
    return r.cex_above ? [{ ...dex, verb: "Mua" }, { ...cex, verb: "Short" }] : [{ ...cex, verb: "Long" }, { ...dex, verb: "Bán" }];
  }
  return r.cex_above ? [{ ...dex, verb: "Mua" }, { ...cex, verb: "Bán" }] : [{ ...cex, verb: "Mua" }, { ...dex, verb: "Bán" }];
}

// Steps shown for a row: the verified route, or the hedge for reversed futures
function stepsOf(r) {
  if (r.verified) return r.steps;
  if (r.market === "FT" && r.reverse) return [`Long ${exName(r.cex)} futures`, `bán ${r.chain_short} (coin đang giữ)`, "chốt khi về cân"];
  return null;
}

const diffTone = (r) => (!r.active ? "text-gray-400" : r.reverse ? "text-[var(--down)]" : "text-[var(--up)]");

function Badge({ children, tone = "line" }) {
  const cls = {
    line: "border-[var(--line-2)] text-gray-500",
    ink: "bg-[var(--ink)] text-[var(--on-ink)] border-[var(--ink)]",
    up: "border-[var(--up)] text-[var(--up)]",
    down: "border-[var(--down)] text-[var(--down)]",
    warn: "border-[var(--warn)] text-[var(--warn)]",
  }[tone];
  return <span className={`px-1.5 py-px text-[10px] font-bold uppercase tracking-wider border-[1.5px] whitespace-nowrap ${cls}`}>{children}</span>;
}

function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); })}
      className="btn-outline px-2.5 py-1 text-[11px] inline-flex items-center gap-1"
      title={text}
    >
      {done ? <Check className="w-3.5 h-3.5 text-[var(--up)]" /> : <Copy className="w-3.5 h-3.5" />} {label}
    </button>
  );
}

// ── list (left) ────────────────────────────────────────────────────────────

function ListItem({ r, selected, onClick, meta }) {
  const [a, b] = sides(r);
  const ok = r.verified && r.active;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-[1.5px] flex items-center gap-3 transition ${
        selected ? "border-[var(--line)] bg-[var(--surface)] shadow-[3px_3px_0_var(--line)]" : "border-[var(--line-2)] bg-[var(--surface)] hover:border-[var(--line)]"
      } ${r.active ? "" : "opacity-55"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-extrabold text-gray-900 truncate">{r.symbol}</span>
          {r.star && <span className="text-[11px]">⭐</span>}
          <Badge tone="ink">{r.market === "CROSS" ? "Cross" : r.market}</Badge>
          {r.reverse && r.active && <Badge tone="down">Ngược</Badge>}
          {r.priority === "HIGH" && <Badge tone="warn">High</Badge>}
        </div>
        <div className="text-[11px] text-gray-500 truncate mt-0.5">
          {meta || <>{a.verb} <b className="text-gray-700">{a.venue}</b> → {r.bridge_leg ? "🌉 → " : ""}{b.verb} <b className="text-gray-700">{b.venue}</b></>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-extrabold tabular ${diffTone(r)}`}>{fmtDiff(r.diff, r.active)}</div>
        <div className={`text-[10px] uppercase tracking-wider ${ok ? "text-[var(--up)]" : r.blocked ? "text-[var(--down)]" : "text-gray-400"}`}>
          {ok ? "✓ có đường" : r.blocked ? "không đường" : stepsOf(r) ? "hedge" : "chưa xác thực"}
        </div>
      </div>
      <ChevronRight className={`w-4 h-4 shrink-0 ${selected ? "text-gray-900" : "text-gray-300"}`} />
    </button>
  );
}

// ── detail (right) ─────────────────────────────────────────────────────────

function SideBox({ s }) {
  return (
    <a href={s.href} target="_blank" rel="noopener noreferrer" className="tile-inset flex-1 min-w-0 px-4 py-3 hover:bg-[var(--hover)] transition group">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{s.verb}</span>
        <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-700" />
      </div>
      <div className="text-lg font-extrabold text-gray-900 truncate">{s.venue}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{s.kind}</div>
      <div className="text-xl tabular text-gray-900 mt-1">{fmtP(s.price)}</div>
      {s.liq != null && s.kind === "DEX" && <div className="text-[11px] text-gray-400">thanh khoản {fmtLiq(s.liq)}</div>}
    </a>
  );
}

// Middle box between buy and sell when the coins have to change chain
function BridgeBox({ leg, verified, blocked }) {
  const known = verified || !!leg.url;
  const tone = verified ? "border-[var(--up)]" : blocked ? "border-[var(--down)] border-dashed" : known ? "border-[var(--line)]" : "border-[var(--line-2)] border-dashed";
  const status = verified
    ? [leg.protocol, leg.detail].filter(Boolean).join(" · ")
    : blocked ? "không có cầu" : leg.url ? (leg.protocol || "link cầu") : "chưa xác định";
  const body = (
    <>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">🌉 Cầu</span>
        {leg.url && <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-700" />}
      </div>
      <div className="font-extrabold text-gray-900 whitespace-nowrap">{leg.from} → {leg.to}</div>
      <div className={`text-[12px] mt-1 ${verified ? "text-[var(--up)] font-bold" : blocked ? "text-[var(--down)]" : "text-gray-500"}`}>{status}</div>
    </>
  );
  const cls = `bg-[var(--surface)] border-[1.5px] ${tone} px-3 py-3 sm:w-40 shrink-0 flex flex-col justify-center group`;
  return leg.url ? (
    <a href={leg.url} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-[var(--hover)] transition`}>{body}</a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const Arrow = () => (
  <div className="flex items-center justify-center"><ArrowRight className="w-5 h-5 text-gray-400 rotate-90 sm:rotate-0" /></div>
);

function StepList({ steps }) {
  return (
    <ol className="flex flex-col">
      {steps.map((st, i) => {
        const warn = st.startsWith("⚠️");
        const last = i === steps.length - 1;
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={`w-6 h-6 shrink-0 inline-flex items-center justify-center text-[11px] font-bold ${
                warn ? "border-[1.5px] border-[var(--warn)] text-[var(--warn)]" : "bg-[var(--ink)] text-[var(--on-ink)]"}`}>
                {warn ? "!" : i + 1}
              </span>
              {!last && <span className="w-[1.5px] flex-1 bg-[var(--line-2)] my-1" />}
            </div>
            <div className={`pb-3 pt-0.5 text-[14px] ${warn ? "text-[var(--warn)]" : "text-gray-800"}`}>
              {st.replace(/^⚠️\s*/, "")}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Detail({ r, when, title, onBack }) {
  const [a, b] = sides(r);
  const steps = stepsOf(r);
  const contracts = r.market === "CROSS"
    ? [[`Contract ${r.buy_chain_short}`, r.buy_contract], [`Contract ${r.sell_chain_short}`, r.sell_contract]]
    : [["Contract", r.contract]];
  return (
    <div className="flex flex-col gap-5">
      {onBack && (
        <button type="button" onClick={onBack} className="lg:hidden self-start inline-flex items-center gap-1 text-[12px] text-gray-500">
          <ArrowLeft className="w-4 h-4" /> Danh sách
        </button>
      )}
      {title && (
        <div className="text-[12px] text-gray-500">
          <span className="font-bold text-gray-700">{title}</span>{when ? ` · ${ago(when)} trước` : ""}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-3xl font-extrabold tracking-wide text-gray-900">{r.symbol}</h2>
            {r.star && <span title="Đã đánh dấu">⭐</span>}
          </div>
          <div className="flex items-center gap-1 flex-wrap mt-2">
            <Badge tone="ink">{MARKET_LABEL[r.market]}</Badge>
            {r.priority === "HIGH" && <Badge tone="warn">High</Badge>}
            {r.reverse && r.active && <Badge tone="down">Ngược</Badge>}
            {r.verified && r.active && <Badge tone="up">✓ Có đường</Badge>}
            {r.stock && <Badge>Cổ phiếu</Badge>}
            {!r.active && <Badge>Hết lệch</Badge>}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-extrabold tabular leading-none ${diffTone(r)}`}>{fmtDiff(r.diff, r.active)}</div>
          <div className="text-[11px] uppercase tracking-wider text-gray-400 mt-1">chênh lệch</div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch gap-2">
        <SideBox s={a} />
        <Arrow />
        {r.bridge_leg && (
          <>
            <BridgeBox leg={r.bridge_leg} verified={r.verified} blocked={r.blocked} />
            <Arrow />
          </>
        )}
        <SideBox s={b} />
      </div>

      <section>
        <div className="label mb-2">{r.verified ? "Các bước" : r.market === "FT" && r.reverse ? "Cách vào (hedge)" : "Đường đi"}</div>
        {steps ? (
          <StepList steps={steps} />
        ) : (
          <div className={`tile-inset px-3 py-2.5 text-[13px] ${r.blocked ? "text-[var(--down)]" : "text-gray-600"}`}>
            {r.blocked ? "⛔ Không có đường đi" : "❔ Chưa xác thực đường đi"}
            {r.reason && <div className="text-gray-500 mt-1">{r.reason}</div>}
          </div>
        )}
      </section>

      {r.note && (
        <section>
          <div className="label mb-1">Ghi chú</div>
          <p className="text-[13px] text-gray-700">📝 {r.note}</p>
        </section>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {r.bridge && (
          <a href={r.bridge} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm px-3 py-1.5 text-[12px] inline-flex items-center gap-1">
            🌉 Mở cầu <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        {contracts.map(([label, c]) => <CopyBtn key={label} text={c} label={label} />)}
      </div>
    </div>
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
  const [tab, setTab] = useState("opps");              // "opps" | "alerts"
  const [market, setMarket] = useState("ALL");
  const [onlyActive, setOnlyActive] = useState(true);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);      // { kind: "row", key } | { kind: "alert", idx }
  const [mobileDetail, setMobileDetail] = useState(false);
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

  // Keep the selection on the same opportunity across refreshes; default to the first one
  const current = useMemo(() => {
    if (selected?.kind === "alert") {
      const a = alerts[selected.idx];
      if (a?.row) return { r: a.row, title: a.title, when: a.ts };
    }
    if (selected?.kind === "row") {
      const r = (data?.rows || []).find((x) => rowKey(x) === selected.key);
      if (r) return { r };
    }
    return rows[0] ? { r: rows[0] } : null;
  }, [selected, alerts, data, rows]);

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
  const pick = (sel) => { setSelected(sel); setMobileDetail(true); };

  return (
    <div className="font-sans px-4 py-6 md:py-8 flex justify-center">
      <div className="w-full max-w-[1180px] flex flex-col gap-4 min-w-0">
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
        {error && <p className="text-sm text-[var(--down)]">{error}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 items-start">
          {/* ── List ── */}
          <section className={`tile relative p-4 flex flex-col gap-3 min-w-0 ${mobileDetail ? "hidden lg:flex" : ""}`}>
            <div className="flex border-b-[1.5px] border-[var(--line-2)] -mx-4 px-4">
              {[["opps", `Kèo ${counts.ALL}`], ["alerts", `Tin mới ${alerts.length}`]].map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-3 pb-2 text-[12px] font-bold uppercase tracking-wider border-b-[2.5px] -mb-[1.5px] ${
                    tab === t ? "border-[var(--ink)] text-gray-900" : "border-transparent text-gray-400 hover:text-gray-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "opps" ? (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {MARKETS.map(([m, label]) => (
                    <Toggle key={m} on={market === m} onChange={() => setMarket(m)}>
                      {label} <span className="opacity-60">{counts[m]}</span>
                    </Toggle>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm coin…" className="tile-inset px-2.5 py-1 text-sm w-32" />
                  <Toggle on={onlyActive} onChange={setOnlyActive}>Đang lệch</Toggle>
                  <Toggle on={onlyVerified} onChange={setOnlyVerified}>✓ Có đường</Toggle>
                  <Toggle on={showBlocked} onChange={setShowBlocked}>+ Không đường</Toggle>
                </div>
                <div className="flex flex-col gap-2 lg:max-h-[68vh] overflow-y-auto -mr-2 pr-2 pb-1">
                  {rows.map((r) => (
                    <ListItem
                      key={rowKey(r)}
                      r={r}
                      selected={current?.r && !current.title && rowKey(current.r) === rowKey(r)}
                      onClick={() => pick({ kind: "row", key: rowKey(r) })}
                    />
                  ))}
                  {data && !rows.length && <p className="text-sm text-gray-500 py-8 text-center">Không có kèo nào khớp bộ lọc.</p>}
                  {!data && !error && <p className="text-sm text-gray-500 py-8 text-center">Đang tải…</p>}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Tin bot vừa báo, mới nhất trước</span>
                  <Toggle on={showLog} onChange={setShowLog}>+ Log</Toggle>
                </div>
                <div className="flex flex-col gap-2 lg:max-h-[68vh] overflow-y-auto -mr-2 pr-2 pb-1">
                  {alerts.map((a, i) => (a.row ? (
                    <ListItem
                      key={`${a.ts}-${i}`}
                      r={a.row}
                      selected={selected?.kind === "alert" && selected.idx === i}
                      onClick={() => pick({ kind: "alert", idx: i })}
                      meta={<>{a.title.slice(0, 48)} · {ago(a.ts)}</>}
                    />
                  ) : (
                    <div key={`${a.ts}-${i}`} className="px-3 py-2.5 border-[1.5px] border-[var(--line-2)] bg-[var(--surface)] text-[12px]">
                      <div className="flex justify-between gap-2"><b className="text-gray-800">{a.title}</b><span className="text-gray-400">{ago(a.ts)}</span></div>
                      {a.lines.slice(0, 3).map((ln, j) => <div key={j} className="text-gray-500">{ln}</div>)}
                    </div>
                  )))}
                  {data && !alerts.length && <p className="text-sm text-gray-500 py-8 text-center">Chưa có tin nào.</p>}
                </div>
              </>
            )}
          </section>

          {/* ── Detail ── */}
          <section className={`tile relative p-5 md:p-6 min-w-0 lg:sticky lg:top-28 ${mobileDetail ? "" : "hidden lg:block"}`}>
            <span className="tile-tab"><b>02</b>Chi tiết</span>
            {current ? (
              <Detail r={current.r} title={current.title} when={current.when} onBack={() => setMobileDetail(false)} />
            ) : (
              <p className="text-sm text-gray-500 py-10 text-center">Chọn một kèo bên trái để xem đường đi.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
