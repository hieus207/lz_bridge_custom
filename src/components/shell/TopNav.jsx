import { Link, NavLink } from "react-router-dom";
import Ticker from "./Ticker";
import ThemeToggle from "./ThemeToggle";

const NAV = [
  { to: "/scan", label: "Scan" },
  { to: "/bridge", label: "Bridge" },
  { to: "/oppos", label: "Oppos" },
];

// Brand mark: a lime bridge arch over the deck (same as public/icon.svg)
export function BridgeMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect x="1.5" y="1.5" width="21" height="21" fill="#111" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 16h18M5 16v-3M19 16v-3" stroke="#f7f7f5" strokeWidth="1.6" strokeOpacity=".7" />
      <path d="M3 13c3-6 15-6 18 0" fill="none" stroke="#c6f432" strokeWidth="2.2" />
      <path d="M9 16v-4.2M12 16v-5M15 16v-4.2" stroke="#c6f432" strokeWidth="1.4" />
    </svg>
  );
}

// Sticky top bar: wordmark · nav · theme toggle, plus the market ticker underneath.
export default function TopNav() {
  return (
    <div className="sticky top-0 z-40">
      <header className="bg-[var(--bg)] border-b-[1.5px] border-[var(--line)]">
        <div className="max-w-[1240px] mx-auto h-14 px-4 flex items-center gap-6">
          <Link to="/scan" className="flex items-center gap-2 select-none shrink-0" aria-label="HLT Bridge home">
            <BridgeMark />
            <span className="font-extrabold tracking-[0.12em] text-base">HLT BRIDGE</span>
          </Link>
          <nav className="flex items-center gap-5 text-[13px] tracking-[0.08em] uppercase">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => `py-1 border-b-2 transition-colors ${isActive ? "border-[var(--accent)] text-[var(--ink)] font-bold" : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <ThemeToggle />
        </div>
      </header>
      <Ticker />
    </div>
  );
}
