"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWalletUser } from "@/contexts/WalletAuthContext";
import { useAccount } from "wagmi";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────
type BetRecord = {
  id: string;
  game: string;
  status: string;
  stakeGzo: number;
  netPayoutGzo: number | null;
  profitGzo: number | null;
  createdAt: string;
  settledAt: string | null;
  referenceId: string | null;
  serverSeedHash: string | null;
  serverSeedRevealed: string | null;
  clientSeed: string | null;
  nonce: number | null;
  publicSeed: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resultJson: any;
};

type PageMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// ── Constants ──────────────────────────────────────────────────────────────────
const GAMES = [
  { key: "ALL",       label: "All Games",  color: "#8888aa" },
  { key: "DICE",      label: "Dice",       color: "#00d4ff" },
  { key: "PLINKO",    label: "Plinko",     color: "#ffd700" },
  { key: "MINES",     label: "Mines",      color: "#ff3d7a" },
  { key: "KENO",      label: "Keno",       color: "#a855f7" },
  { key: "ROULETTE",  label: "Roulette",   color: "#e879f9" },
  { key: "BLACKJACK", label: "Blackjack",  color: "#14b8a6" },
  { key: "HILO",      label: "Hilo",       color: "#818cf8" },
  { key: "WHEEL",     label: "Wheel",      color: "#fb923c" },
  { key: "AVIATOR",   label: "Aviator",    color: "#ff6b35" },
  { key: "COINFLIP",  label: "Coin Flip",  color: "#00ff9d" },
];

const GAME_COLOR: Record<string, string> = Object.fromEntries(GAMES.map(g => [g.key, g.color]));
const GAME_LABEL: Record<string, string> = Object.fromEntries(GAMES.map(g => [g.key, g.label]));

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDate(d: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(d));
}

function formatDateShort(d: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric",
  }).format(new Date(d));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resultSummary(bet: BetRecord): string {
  const r = bet.resultJson;
  if (!r) return "—";
  switch (bet.game) {
    case "COINFLIP":
      if (r.outcome == null) return `Picked ${r.myChoice ?? "?"} · vs ${r.opponentName ?? "?"}`;
      return `${r.outcome} · Picked ${r.myChoice ?? "?"}`;
    case "DICE": {
      const roll   = typeof r.roll   === "number" ? r.roll.toFixed(2)   : "?";
      const target = typeof r.target === "number" ? r.target.toFixed(2) : "?";
      return `Roll ${roll} / Target ${target}`;
    }
    case "PLINKO":
      return typeof r.multiplier === "number" ? `Hit ${r.multiplier}×` : "?";
    case "KENO": {
      const matches = typeof r.matches === "number" ? r.matches : "?";
      const mult    = typeof r.multiplier === "number" ? ` · ${r.multiplier}×` : "";
      return `${matches} matches${mult}`;
    }
    case "MINES": {
      const outcome = r.outcome ?? "?";
      const mult    = typeof r.finalMultiplier === "number" ? `${r.finalMultiplier.toFixed(2)}×` : "?";
      const mines   = typeof r.mineCount === "number" ? ` · ${r.mineCount} mines` : "";
      return `${outcome} · ${mult}${mines}`;
    }
    case "ROULETTE": {
      const num   = r.winningNumber ?? "?";
      const color = r.winningColor  ?? "";
      const wins  = (r.breakdown ?? []).filter((b: { won: boolean }) => b.won).length;
      return `${num} ${color} · ${wins} win${wins !== 1 ? "s" : ""}`;
    }
    case "BLACKJACK": {
      const main  = r.mainOutcome  ?? "?";
      const split = r.splitOutcome ? ` / ${r.splitOutcome}` : "";
      return `${main}${split}`;
    }
    case "HILO": {
      const outcome = r.outcome ?? "?";
      const mult    = typeof r.finalMultiplier === "number" ? ` · ${r.finalMultiplier.toFixed(2)}×` : "";
      return `${outcome}${mult}`;
    }
    case "WHEEL": {
      const label = r.segmentLabel ?? "?";
      const mult  = typeof r.landedMultiplier === "number" ? `${r.landedMultiplier}×` : "?";
      return `${label} · ${mult}`;
    }
    case "AVIATOR": {
      const fly = typeof r.flyAwayPoint === "number" ? `${r.flyAwayPoint.toFixed(2)}×` : "?";
      if (r.outcome === "CASHED_OUT" && typeof r.cashoutMultiplier === "number") {
        return `Cashed ${r.cashoutMultiplier.toFixed(2)}× · Flew ${fly}`;
      }
      return `Crashed · Flew ${fly}`;
    }
    default: return "—";
  }
}

function getStatus(bet: BetRecord): { label: string; color: string } {
  if (bet.status === "PENDING")   return { label: "Pending",   color: "#ffd700" };
  if (bet.status === "ACTIVE")    return { label: "Active",    color: "#00d4ff" };
  if (bet.status === "REFUNDED")  return { label: "Refunded",  color: "#8888aa" };
  if (bet.status === "CANCELLED") return { label: "Cancelled", color: "#8888aa" };
  const p = bet.profitGzo;
  if (p == null) return { label: "Settled", color: "#8888aa" };
  return p >= 0
    ? { label: "Won",  color: "#00ff9d" }
    : { label: "Lost", color: "#ff8080" };
}

function isPending(s: string) { return s === "PENDING" || s === "ACTIVE"; }

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatsSummary({ bets, totalBets }: { bets: BetRecord[]; totalBets: number }) {
  const settled = bets.filter(b => b.profitGzo !== null);
  const wins    = settled.filter(b => (b.profitGzo ?? 0) > 0).length;
  const losses  = settled.filter(b => (b.profitGzo ?? 0) <= 0).length;
  const totalPL = settled.reduce((s, b) => s + (b.profitGzo ?? 0), 0);
  const wagered = bets.reduce((s, b) => s + b.stakeGzo, 0);

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
      gap: "0.75rem",
      marginBottom: "1.25rem",
    }}>
      {[
        { label: "Total Bets",   value: totalBets.toLocaleString(),                  color: "#8888aa" },
        { label: "Wagered",      value: `${wagered.toLocaleString()} GZO`,           color: "#f0f0ff" },
        { label: "Wins",         value: wins.toLocaleString(),                        color: "#00ff9d" },
        { label: "Losses",       value: losses.toLocaleString(),                      color: "#ff8080" },
        { label: "Total P/L",    value: `${totalPL >= 0 ? "+" : ""}${totalPL.toLocaleString()} GZO`,
          color: totalPL >= 0 ? "#00ff9d" : "#ff8080" },
      ].map(({ label, value, color }) => (
        <div key={label} className="card" style={{ padding: "0.875rem 1rem" }}>
          <div style={{ fontSize: "0.65rem", color: "#555577", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.25rem" }}>
            {label}
          </div>
          <div style={{ fontSize: "1rem", fontWeight: 800, color, fontVariantNumeric: "tabular-nums" }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function SeedCell({ bet }: { bet: BetRecord }) {
  const hash     = bet.serverSeedRevealed ?? bet.serverSeedHash;
  const revealed = !!bet.serverSeedRevealed;
  if (!hash && !bet.clientSeed) return <span style={{ color: "#555577" }}>—</span>;

  return (
    <div style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "#8888aa", lineHeight: 1.6 }}>
      {hash && (
        <div title={hash}>
          <span style={{ color: revealed ? "#00ff9d" : "#ffd700", marginRight: "3px" }}>
            {revealed ? "✓" : "⏳"}
          </span>
          {hash.slice(0, 10)}…
        </div>
      )}
      {bet.nonce != null && (
        <div style={{ color: "#666688" }}>#{bet.nonce}</div>
      )}
    </div>
  );
}

function BetsTable({ bets, showGame }: { bets: BetRecord[]; showGame: boolean }) {
  if (bets.length === 0) return null;

  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "580px" }}>
        <thead>
          <tr style={{ background: "#0a0a18", borderBottom: "1px solid #2a2a50" }}>
            {(showGame
              ? ["Date", "Game", "Result", "Stake", "P / L", "Seeds", "Status"]
              : ["Date", "Result", "Stake", "P / L", "Seeds", "Status"]
            ).map(h => (
              <th key={h} style={{
                padding: "0.6rem 0.875rem",
                fontSize: "0.65rem", fontWeight: 700, textAlign: h === "Stake" || h === "P / L" ? "right" : "left",
                color: "#555577", letterSpacing: "0.07em", textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bets.map(bet => {
            const { label, color } = getStatus(bet);
            const gameColor = GAME_COLOR[bet.game] ?? "#8888aa";
            const pl        = bet.profitGzo;
            const pending   = isPending(bet.status);

            return (
              <tr key={bet.id} style={{
                borderBottom: "1px solid rgba(42,42,80,0.4)",
                opacity: pending ? 0.75 : 1,
                transition: "background 0.1s",
              }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
              >
                {/* Date */}
                <td style={{ padding: "0.75rem 0.875rem", whiteSpace: "nowrap", fontSize: "0.78rem", color: "#555577" }}>
                  <span className="date-full">{formatDate(bet.createdAt)}</span>
                  <span className="date-short">{formatDateShort(bet.createdAt)}</span>
                </td>

                {/* Game badge (only in All tab) */}
                {showGame && (
                  <td style={{ padding: "0.75rem 0.875rem", whiteSpace: "nowrap" }}>
                    <span style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "99px",
                      fontSize: "0.65rem", fontWeight: 700,
                      color: gameColor,
                      background: `${gameColor}18`,
                      border: `1px solid ${gameColor}33`,
                    }}>
                      {GAME_LABEL[bet.game] ?? bet.game}
                    </span>
                  </td>
                )}

                {/* Result */}
                <td style={{ padding: "0.75rem 0.875rem", fontSize: "0.8rem", color: "#c0c0dd", maxWidth: "200px" }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {resultSummary(bet)}
                  </span>
                </td>

                {/* Stake */}
                <td style={{ padding: "0.75rem 0.875rem", textAlign: "right", fontWeight: 700, fontSize: "0.82rem", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {bet.stakeGzo.toLocaleString()}
                </td>

                {/* P/L */}
                <td style={{
                  padding: "0.75rem 0.875rem", textAlign: "right",
                  fontWeight: 800, fontSize: "0.82rem", fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                  color: pl == null ? "#555577" : pl > 0 ? "#00ff9d" : pl < 0 ? "#ff8080" : "#8888aa",
                }}>
                  {pl == null ? "—" : (pl > 0 ? "+" : "") + pl.toLocaleString()}
                </td>

                {/* Seeds */}
                <td style={{ padding: "0.75rem 0.875rem" }}>
                  <SeedCell bet={bet} />
                </td>

                {/* Status */}
                <td style={{ padding: "0.75rem 0.875rem", whiteSpace: "nowrap" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: "0.3rem",
                    fontSize: "0.72rem", fontWeight: 700,
                    color, padding: "0.2rem 0.6rem",
                    borderRadius: "99px",
                    background: `${color}14`,
                    border: `1px solid ${color}33`,
                  }}>
                    {pending && (
                      <span style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: color, display: "inline-block",
                        boxShadow: `0 0 6px ${color}`,
                        animation: "histPulse 1.4s ease-in-out infinite",
                      }} />
                    )}
                    {label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (p: number) => void }) {
  const { page, totalPages, total, pageSize } = meta;
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  const pages: (number | "…")[] = [];
  const push = (p: number) => { if (!pages.includes(p)) pages.push(p); };
  push(1);
  if (page > 3) pages.push("…");
  for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) push(p);
  if (page < totalPages - 2) pages.push("…");
  if (totalPages > 1) push(totalPages);

  const btn: React.CSSProperties = {
    minWidth: "36px", height: "36px", borderRadius: "8px",
    border: "1px solid #2a2a50", background: "transparent",
    color: "#8888aa", fontSize: "0.8rem", fontWeight: 600,
    cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", padding: "0 0.6rem", transition: "all 0.15s",
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "1rem 1.25rem", borderTop: "1px solid #2a2a50",
      flexWrap: "wrap", gap: "0.75rem",
    }}>
      <span style={{ fontSize: "0.78rem", color: "#555577" }}>
        <strong style={{ color: "#8888aa" }}>{from}–{to}</strong>
        {" "}of{" "}
        <strong style={{ color: "#8888aa" }}>{total.toLocaleString()}</strong> bets
      </span>

      <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => onPage(page - 1)} disabled={page === 1}
          style={{ ...btn, opacity: page === 1 ? 0.35 : 1, cursor: page === 1 ? "default" : "pointer" }}>
          ← Prev
        </button>

        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`el-${i}`} style={{ color: "#555577", padding: "0 0.25rem", fontSize: "0.8rem" }}>…</span>
          ) : (
            <button key={p} onClick={() => onPage(p as number)} style={{
              ...btn,
              border:     p === page ? "1px solid #00ff9d" : "1px solid #2a2a50",
              background: p === page ? "rgba(0,255,157,0.12)" : "transparent",
              color:      p === page ? "#00ff9d" : "#8888aa",
            }}>{p}</button>
          )
        )}

        <button onClick={() => onPage(page + 1)} disabled={page === totalPages}
          style={{ ...btn, opacity: page === totalPages ? 0.35 : 1, cursor: page === totalPages ? "default" : "pointer" }}>
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function HistoryPage() {
  const { user: walletUser } = useWalletUser();
  const { isConnected }      = useAccount();
  const authed               = walletUser ?? (isConnected ? {} : null);

  const [activeTab, setActiveTab] = useState("ALL");
  const [page,      setPage]      = useState(1);
  const [bets,      setBets]      = useState<BetRecord[]>([]);
  const [meta,      setMeta]      = useState<PageMeta | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const tabBarRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback((tab: string, p: number) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(p) });
    if (tab !== "ALL") params.set("game", tab);
    fetch(`/api/history?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return; }
        setBets(d.bets ?? []);
        setMeta(d.total != null ? {
          total: d.total, page: d.page, pageSize: d.pageSize, totalPages: d.totalPages,
        } : null);
      })
      .catch(() => setError("Failed to load history"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!authed) { setLoading(false); return; }
    fetchPage(activeTab, page);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  function handleTab(tab: string) {
    setActiveTab(tab);
    setPage(1);
    fetchPage(tab, 1);
    // Scroll active tab into view
    setTimeout(() => {
      const btn = tabBarRef.current?.querySelector(`[data-tab="${tab}"]`) as HTMLElement;
      btn?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }, 50);
  }

  function handlePage(p: number) {
    setPage(p);
    fetchPage(activeTab, p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Unauthenticated
  if (!authed && !loading) {
    return (
      <div style={{ maxWidth: "540px", margin: "4rem auto", padding: "0 1rem" }}>
        <div className="card" style={{ textAlign: "center", padding: "3rem 2rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🎲</div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 800, marginBottom: "0.5rem" }}>Connect to view history</h2>
          <p style={{ color: "#8888aa", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
            Connect your wallet to see all your bets across every game.
          </p>
          <Link href="/dashboard" className="btn-primary">Connect Wallet</Link>
        </div>
      </div>
    );
  }

  const gameTab   = GAMES.find(g => g.key === activeTab)!;
  const tabColor  = gameTab.color;
  const pending   = bets.filter(b => isPending(b.status));
  const completed = bets.filter(b => !isPending(b.status));
  const showGame  = activeTab === "ALL";

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <style>{`
        @keyframes histPulse { 0%,100%{ opacity:1; } 50%{ opacity:0.35; } }
        .date-short { display: none; }
        .tab-bar::-webkit-scrollbar { height: 0; }
        .tab-bar { scrollbar-width: none; }
        @media (max-width: 560px) {
          .date-full  { display: none; }
          .date-short { display: inline; }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{
          fontSize: "clamp(1.4rem, 4vw, 2rem)", fontWeight: 800,
          letterSpacing: "-0.5px", marginBottom: "0.25rem",
        }}>
          Bet History
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          All bets across every game — stored permanently, 50 per page
        </p>
      </div>

      {/* ── Tab Bar ── */}
      <div
        ref={tabBarRef}
        className="tab-bar"
        style={{
          display: "flex",
          overflowX: "auto",
          gap: "0.25rem",
          marginBottom: "1.25rem",
          borderBottom: "1px solid #2a2a50",
          paddingBottom: "0",
        }}
      >
        {GAMES.map(g => {
          const active = activeTab === g.key;
          return (
            <button
              key={g.key}
              data-tab={g.key}
              onClick={() => handleTab(g.key)}
              style={{
                padding: "0.625rem 1rem",
                fontSize: "0.8125rem",
                fontWeight: active ? 700 : 500,
                color: active ? g.color : "#8888aa",
                background: "transparent",
                border: "none",
                borderBottom: active ? `2px solid ${g.color}` : "2px solid transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s",
                marginBottom: "-1px",
                flexShrink: 0,
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* ── Stats row (only when data loaded) ── */}
      {!loading && meta && meta.total > 0 && (
        <StatsSummary bets={bets} totalBets={meta.total} />
      )}

      {/* ── Content ── */}
      {loading ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "5rem 2rem", color: "#8888aa", fontSize: "0.875rem", gap: "0.75rem",
        }}>
          <div style={{
            width: 20, height: 20, borderRadius: "50%",
            border: `2px solid ${tabColor}44`, borderTopColor: tabColor,
            animation: "spin 0.8s linear infinite",
          }} />
          Loading…
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>

      ) : error ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem", borderColor: "rgba(255,80,80,0.3)" }}>
          <p style={{ color: "#ff8080", marginBottom: "1rem" }}>{error}</p>
          <button className="btn-ghost" onClick={() => fetchPage(activeTab, page)}>Retry</button>
        </div>

      ) : bets.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "4rem 2rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "1rem", opacity: 0.4 }}>🎲</div>
          <p style={{ color: "#8888aa", marginBottom: "1.25rem" }}>
            {activeTab === "ALL"
              ? "No bets yet — pick a game and play!"
              : `No ${gameTab.label} bets found.`}
          </p>
          <Link href="/dashboard" className="btn-primary">Go Play</Link>
        </div>

      ) : (
        <>
          {/* Pending section */}
          {pending.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.625rem" }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "#ffd700", boxShadow: "0 0 8px #ffd700",
                  display: "inline-block", animation: "histPulse 1.4s ease-in-out infinite",
                }} />
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#ffd700" }}>
                  Pending / Active ({pending.length})
                </span>
              </div>
              <div className="card" style={{ padding: 0, borderColor: "rgba(255,215,0,0.2)", overflow: "hidden" }}>
                <BetsTable bets={pending} showGame={showGame} />
              </div>
            </div>
          )}

          {/* Completed section */}
          {completed.length > 0 && (
            <div>
              {pending.length > 0 && (
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#555577", marginBottom: "0.625rem" }}>
                  Settled ({completed.length}{meta && meta.totalPages > 1 ? " on this page" : ""})
                </div>
              )}
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <BetsTable bets={completed} showGame={showGame} />
                {meta && <Pagination meta={meta} onPage={handlePage} />}
              </div>
            </div>
          )}

          {/* Edge case: only pending on this page but more pages exist */}
          {completed.length === 0 && meta && meta.totalPages > 1 && (
            <div className="card" style={{ padding: 0 }}>
              <Pagination meta={meta} onPage={handlePage} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
