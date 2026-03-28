"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

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

const GAME_LABELS: Record<string, string> = {
  COINFLIP: "Coin Flip",
  DICE: "Dice",
  PLINKO: "Plinko",
  KENO: "Keno",
  MINES: "Mines",
  ROULETTE: "Roulette",
  BLACKJACK: "Blackjack",
  HILO: "Hilo",
  WHEEL: "Wheel",
  AVIATOR: "Aviator",
};

const GAME_COLORS: Record<string, string> = {
  COINFLIP: "#00ff9d",
  DICE: "#00d4ff",
  PLINKO: "#ffd700",
  KENO: "#a855f7",
  MINES: "#ff3d7a",
  ROULETTE: "#e879f9",
  BLACKJACK: "#14b8a6",
  HILO: "#818cf8",
  WHEEL: "#fb923c",
  AVIATOR: "#ff6b35",
};

const ALL_GAMES = ["COINFLIP", "DICE", "PLINKO", "KENO", "MINES", "ROULETTE", "BLACKJACK", "HILO", "WHEEL", "AVIATOR"];

function formatDate(d: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(d));
}

function resultSummary(bet: BetRecord): string {
  const r = bet.resultJson;
  if (!r) return "—";

  switch (bet.game) {
    case "COINFLIP":
      if (r.outcome == null) return `Picked ${r.myChoice} · vs ${r.opponentName}`;
      return `${r.outcome} · Picked ${r.myChoice}`;
    case "DICE": {
      const roll = typeof r.roll === "number" ? r.roll.toFixed(2) : "?";
      const target = typeof r.target === "number" ? r.target.toFixed(2) : "?";
      return `Roll ${roll} / Target ${target}`;
    }
    case "PLINKO": {
      const mult = typeof r.multiplier === "number" ? `${r.multiplier}×` : "?";
      return `Hit ${mult}`;
    }
    case "KENO": {
      const matches = typeof r.matches === "number" ? r.matches : "?";
      const mult = typeof r.multiplier === "number" ? `${r.multiplier}×` : "";
      return `${matches} matches${mult ? ` · ${mult}` : ""}`;
    }
    case "MINES": {
      const outcome = r.outcome ?? "?";
      const mult = typeof r.finalMultiplier === "number" ? `${r.finalMultiplier.toFixed(2)}×` : "?";
      const mines = typeof r.mineCount === "number" ? `${r.mineCount} mines` : "";
      return `${outcome} · ${mult}${mines ? ` · ${mines}` : ""}`;
    }
    case "ROULETTE": {
      const num = r.winningNumber;
      const color = r.winningColor ?? "";
      const breakdown: Array<{area: string; won: boolean; grossPayout: number}> = r.breakdown ?? [];
      const wins = breakdown.filter((b) => b.won).length;
      return `${num ?? "?"} ${color} · ${wins} win${wins !== 1 ? "s" : ""}`;
    }
    case "BLACKJACK": {
      const main  = r.mainOutcome  ?? "?";
      const split = r.splitOutcome ? ` / Split: ${r.splitOutcome}` : "";
      return `${main}${split}`;
    }
    case "HILO": {
      const outcome = r.outcome ?? "?";
      const mult = typeof r.finalMultiplier === "number" ? `${r.finalMultiplier.toFixed(2)}×` : "?";
      const guesses = typeof r.guessHistory?.length === "number" ? `${r.guessHistory.length} guess${r.guessHistory.length !== 1 ? "es" : ""}` : "";
      return `${outcome}${guesses ? ` · ${guesses}` : ""} · ${mult}`;
    }
    case "WHEEL": {
      const label = r.segmentLabel ?? "?";
      const mult = typeof r.landedMultiplier === "number" ? `${r.landedMultiplier}×` : "?";
      const riskMode = r.risk ?? "";
      return `${label} · ${mult}${riskMode ? ` · ${riskMode}` : ""}`;
    }
    case "AVIATOR": {
      const fly = typeof r.flyAwayPoint === "number" ? `${r.flyAwayPoint.toFixed(2)}×` : "?";
      const outcome = r.outcome ?? "?";
      if (outcome === "CASHED_OUT" && typeof r.cashoutMultiplier === "number") {
        return `Cashed ${r.cashoutMultiplier.toFixed(2)}× · Flew ${fly}`;
      }
      return `Crashed · Flew ${fly}`;
    }
    default:
      return "—";
  }
}

function isPending(status: string) {
  return status === "PENDING" || status === "ACTIVE";
}

function statusLabel(bet: BetRecord): { label: string; color: string } {
  if (bet.status === "PENDING") return { label: "Pending", color: "#ffd700" };
  if (bet.status === "ACTIVE") return { label: "Active", color: "#00d4ff" };
  if (bet.status === "CANCELLED" || bet.status === "REFUNDED")
    return { label: bet.status === "CANCELLED" ? "Cancelled" : "Refunded", color: "#8888aa" };
  const profit = bet.profitGzo;
  if (profit == null) return { label: "Settled", color: "#8888aa" };
  return profit >= 0
    ? { label: "Won", color: "#00ff9d" }
    : { label: "Lost", color: "#ff8080" };
}

function SeedCell({ bet }: { bet: BetRecord }) {
  const hash = bet.serverSeedRevealed ?? bet.serverSeedHash;
  const revealed = !!bet.serverSeedRevealed;

  if (!hash && !bet.clientSeed) {
    return <span style={{ color: "#555577" }}>—</span>;
  }

  return (
    <div style={{ fontSize: "0.72rem", fontFamily: "var(--font-geist-mono, monospace)", color: "#8888aa", lineHeight: 1.5 }}>
      {hash && (
        <div title={hash}>
          <span style={{ color: revealed ? "#00ff9d" : "#ffd700" }}>
            {revealed ? "✓" : "⏳"}
          </span>{" "}
          <span style={{ color: "#aaa" }}>{revealed ? "Seed:" : "Hash:"}</span>{" "}
          {hash.slice(0, 14)}…
        </div>
      )}
      {bet.clientSeed && (
        <div title={bet.clientSeed}>
          <span style={{ color: "#aaa" }}>Client:</span> {bet.clientSeed.slice(0, 10)}…
        </div>
      )}
      {bet.nonce != null && (
        <div>
          <span style={{ color: "#aaa" }}>Nonce:</span> {bet.nonce}
        </div>
      )}
    </div>
  );
}

function BetsTable({ bets, myId }: { bets: BetRecord[]; myId: string | undefined }) {
  if (bets.length === 0) return null;
  void myId;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
        <thead>
          <tr
            style={{
              borderBottom: "1px solid #2a2a50",
              color: "#8888aa",
              fontSize: "0.72rem",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            <th style={{ padding: "0.75rem 1.25rem", textAlign: "left", fontWeight: 600 }}>Date</th>
            <th style={{ padding: "0.75rem 0.75rem", textAlign: "left", fontWeight: 600 }}>Game</th>
            <th style={{ padding: "0.75rem 0.75rem", textAlign: "left", fontWeight: 600 }}>Result</th>
            <th style={{ padding: "0.75rem 0.75rem", textAlign: "right", fontWeight: 600 }}>Stake</th>
            <th style={{ padding: "0.75rem 0.75rem", textAlign: "right", fontWeight: 600 }}>P/L</th>
            <th style={{ padding: "0.75rem 0.75rem", textAlign: "left", fontWeight: 600 }}>Seeds</th>
            <th style={{ padding: "0.75rem 1.25rem", textAlign: "right", fontWeight: 600 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {bets.map((bet) => {
            const { label, color } = statusLabel(bet);
            const gameColor = GAME_COLORS[bet.game] ?? "#8888aa";
            const pl = bet.profitGzo;
            const link =
              bet.game === "COINFLIP" && bet.referenceId
                ? `/coinflip/${bet.referenceId}`
                : null;

            return (
              <tr key={bet.id} style={{ borderBottom: "1px solid rgba(42,42,80,0.5)" }}>
                <td style={{ padding: "0.875rem 1.25rem", color: "#8888aa", whiteSpace: "nowrap", fontSize: "0.8rem" }}>
                  {formatDate(bet.createdAt)}
                </td>
                <td style={{ padding: "0.875rem 0.75rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                      color: gameColor,
                      background: `${gameColor}18`,
                      border: `1px solid ${gameColor}44`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {GAME_LABELS[bet.game] ?? bet.game}
                  </span>
                </td>
                <td style={{ padding: "0.875rem 0.75rem", color: "#c0c0dd", fontSize: "0.8125rem", maxWidth: "200px" }}>
                  {resultSummary(bet)}
                </td>
                <td style={{ padding: "0.875rem 0.75rem", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {bet.stakeGzo.toLocaleString()}
                </td>
                <td
                  style={{
                    padding: "0.875rem 0.75rem",
                    textAlign: "right",
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: pl == null ? "#8888aa" : pl >= 0 ? "#00ff9d" : "#ff8080",
                  }}
                >
                  {pl == null ? "—" : (pl >= 0 ? "+" : "") + pl.toLocaleString()}
                </td>
                <td style={{ padding: "0.875rem 0.75rem", maxWidth: "180px" }}>
                  <SeedCell bet={bet} />
                </td>
                <td style={{ padding: "0.875rem 1.25rem", textAlign: "right", whiteSpace: "nowrap" }}>
                  {link ? (
                    <Link
                      href={link}
                      style={{ color, fontSize: "0.8125rem", textDecoration: "none", fontWeight: 600 }}
                    >
                      {label} →
                    </Link>
                  ) : (
                    <span style={{ color, fontSize: "0.8125rem", fontWeight: 600 }}>{label}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  meta,
  onPage,
}: {
  meta: PageMeta;
  onPage: (p: number) => void;
}) {
  const { page, totalPages, total, pageSize } = meta;
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  // Build page number buttons: always show first, last, and up to 3 around current
  const pages: (number | "…")[] = [];
  const addPage = (p: number) => {
    if (!pages.includes(p)) pages.push(p);
  };

  addPage(1);
  if (page > 3) pages.push("…");
  for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) addPage(p);
  if (page < totalPages - 2) pages.push("…");
  if (totalPages > 1) addPage(totalPages);

  const btnBase: React.CSSProperties = {
    minWidth: "36px",
    height: "36px",
    borderRadius: "8px",
    border: "1px solid #2a2a50",
    background: "transparent",
    color: "#8888aa",
    fontSize: "0.8125rem",
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 0.5rem",
    transition: "all 0.15s",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.25rem 1.5rem", borderTop: "1px solid #2a2a50", flexWrap: "wrap", gap: "0.75rem" }}>
      {/* Record count */}
      <span style={{ fontSize: "0.8rem", color: "#555577" }}>
        Showing <strong style={{ color: "#8888aa" }}>{from}–{to}</strong> of{" "}
        <strong style={{ color: "#8888aa" }}>{total.toLocaleString()}</strong> bets
      </span>

      {/* Page buttons */}
      <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
        {/* Prev */}
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          style={{
            ...btnBase,
            opacity: page === 1 ? 0.35 : 1,
            cursor: page === 1 ? "default" : "pointer",
          }}
        >
          ← Prev
        </button>

        {/* Page numbers */}
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} style={{ color: "#555577", padding: "0 0.25rem", fontSize: "0.8rem" }}>…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p as number)}
              style={{
                ...btnBase,
                border: p === page ? "1px solid #00ff9d" : "1px solid #2a2a50",
                background: p === page ? "rgba(0,255,157,0.12)" : "transparent",
                color: p === page ? "#00ff9d" : "#8888aa",
              }}
            >
              {p}
            </button>
          )
        )}

        {/* Next */}
        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          style={{
            ...btnBase,
            opacity: page === totalPages ? 0.35 : 1,
            cursor: page === totalPages ? "default" : "pointer",
          }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const { data: session, status } = useSession();
  const [bets, setBets]       = useState<BetRecord[]>([]);
  const [meta, setMeta]       = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<string>("ALL");
  const [page, setPage]       = useState(1);

  const fetchPage = useCallback(
    (targetPage: number, game: string) => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(targetPage) });
      if (game !== "ALL") params.set("game", game);
      fetch(`/api/history?${params}`)
        .then((r) => r.json())
        .then((d) => {
          setBets(d.bets ?? []);
          setMeta(d.total != null
            ? { total: d.total, page: d.page, pageSize: d.pageSize, totalPages: d.totalPages }
            : null,
          );
        })
        .finally(() => setLoading(false));
    },
    [],
  );

  // Re-fetch when auth ready
  useEffect(() => {
    if (status === "unauthenticated") { setLoading(false); return; }
    if (status !== "authenticated") return;
    fetchPage(page, filter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Re-fetch when filter changes (reset to page 1)
  const handleFilterChange = (g: string) => {
    setFilter(g);
    setPage(1);
    fetchPage(1, g);
  };

  // Re-fetch when page changes
  const handlePageChange = (p: number) => {
    setPage(p);
    fetchPage(p, filter);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (status === "unauthenticated") {
    return (
      <div style={{ maxWidth: "640px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.875rem", fontWeight: 800, marginBottom: "1rem", color: "#00d4ff" }}>
          History
        </h1>
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "#8888aa", marginBottom: "1rem" }}>Login to see your bet history.</p>
          <Link href="/login" className="btn-primary">Login</Link>
        </div>
      </div>
    );
  }

  const pending   = bets.filter((b) => isPending(b.status));
  const completed = bets.filter((b) => !isPending(b.status));
  const myId      = session?.user?.id;

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem" }}>
          History
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          All your bets across every game — stored permanently, accessible forever
        </p>
      </div>

      {/* Game filter */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {["ALL", ...ALL_GAMES].map((g) => {
          const active = filter === g;
          const color = g === "ALL" ? "#8888aa" : (GAME_COLORS[g] ?? "#8888aa");
          return (
            <button
              key={g}
              onClick={() => handleFilterChange(g)}
              style={{
                padding: "0.35rem 0.9rem",
                borderRadius: "999px",
                border: `1px solid ${active ? color : "#2a2a50"}`,
                background: active ? `${color}22` : "transparent",
                color: active ? color : "#8888aa",
                fontSize: "0.8125rem",
                fontWeight: active ? 700 : 400,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {g === "ALL" ? "All Games" : GAME_LABELS[g]}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ color: "#8888aa", padding: "3rem", textAlign: "center" }}>Loading…</div>
      ) : bets.length === 0 && (!meta || meta.total === 0) ? (
        <div className="card" style={{ textAlign: "center", padding: "4rem 2rem" }}>
          <p style={{ color: "#8888aa", marginBottom: "1.25rem" }}>
            {filter === "ALL" ? "No bets yet. Pick a game and play!" : `No ${GAME_LABELS[filter]} bets found.`}
          </p>
          <Link href="/dashboard" className="btn-primary">Go to Dashboard</Link>
        </div>
      ) : (
        <>
          {/* Pending / Active section */}
          {pending.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                <span style={{
                  display: "inline-block", width: "8px", height: "8px", borderRadius: "50%",
                  background: "#ffd700", boxShadow: "0 0 8px #ffd700",
                  animation: "pulse 1.5s ease-in-out infinite",
                }} />
                <h2 style={{ fontSize: "0.9rem", fontWeight: 700, color: "#ffd700" }}>
                  Pending / Active ({pending.length})
                </h2>
              </div>
              <div className="card" style={{ padding: 0, borderColor: "rgba(255,215,0,0.2)" }}>
                <BetsTable bets={pending} myId={myId} />
              </div>
            </div>
          )}

          {/* Completed section */}
          {completed.length > 0 && (
            <div>
              <h2 style={{ fontSize: "0.9rem", fontWeight: 700, color: "#8888aa", marginBottom: "0.75rem" }}>
                Completed ({completed.length}
                {meta && meta.totalPages > 1 ? ` on this page` : ""})
              </h2>
              <div className="card" style={{ padding: 0 }}>
                <BetsTable bets={completed} myId={myId} />
                {meta && (
                  <Pagination meta={meta} onPage={handlePageChange} />
                )}
              </div>
            </div>
          )}

          {/* If only pending bets on this page, still show pagination */}
          {completed.length === 0 && meta && meta.totalPages > 1 && (
            <div className="card" style={{ padding: 0 }}>
              <Pagination meta={meta} onPage={handlePageChange} />
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
