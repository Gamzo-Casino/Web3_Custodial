"use client";

import { useState, useEffect } from "react";
import { useWalletUser } from "@/contexts/WalletAuthContext";
import { useAccount } from "wagmi";
import Link from "next/link";

type Bet = {
  id: string;
  game: string;
  status: string;
  stakeGzo: number;
  netPayoutGzo: number | null;
  profitGzo: number | null;
  createdAt: string;
  referenceId: string | null;
  serverSeedHash: string | null;
  serverSeedRevealed: string | null;
  nonce: number | null;
};

type Tab = "win" | "loss" | "all";

const GAME_LABELS: Record<string, string> = {
  DICE: "Dice", PLINKO: "Plinko",
  KENO: "Keno", COINFLIP: "Coin Flip", MINES: "Mines", ROULETTE: "Roulette",
  BLACKJACK: "Blackjack",
  HILO: "Hilo",
  WHEEL: "Wheel",
  AVIATOR: "Aviator",
};
const GAME_COLORS: Record<string, string> = {
  DICE: "#00d4ff", PLINKO: "#ffd700",
  KENO: "#a855f7", COINFLIP: "#00ff9d", MINES: "#ff3d7a", ROULETTE: "#e879f9",
  BLACKJACK: "#14b8a6",
  HILO: "#818cf8",
  WHEEL: "#fb923c",
  AVIATOR: "#ff6b35",
};
const GAME_VERIFY_SLUG: Record<string, string> = {
  DICE: "dice", PLINKO: "plinko",
  KENO: "keno", COINFLIP: "coinflip", MINES: "mines", ROULETTE: "roulette",
  BLACKJACK: "blackjack",
  HILO: "hilo",
  WHEEL: "wheel",
  AVIATOR: "aviator",
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function truncHash(h: string | null) {
  if (!h) return "—";
  return h.slice(0, 8) + "…";
}

const TAB_ACCENT: Record<Tab, string> = {
  win: "#00ff9d", loss: "#ff8080", all: "#8888aa",
};

const TH: React.CSSProperties = {
  padding: "0.5rem 0.875rem",
  fontSize: "0.67rem", fontWeight: 700, textAlign: "left",
  color: "#555577", letterSpacing: "0.06em", textTransform: "uppercase",
  borderBottom: "1px solid #2a2a50", whiteSpace: "nowrap", background: "#0a0a18",
};

const TD: React.CSSProperties = {
  padding: "0.6rem 0.875rem",
  fontSize: "0.78rem", whiteSpace: "nowrap",
  borderBottom: "1px solid rgba(42,42,80,0.4)",
  verticalAlign: "middle",
};

export default function TransactionHistory({ game, refreshKey }: { game?: string; refreshKey?: string | number } = {}) {
  const { user: walletUser } = useWalletUser();
  const { isConnected } = useAccount();
  const session = walletUser ?? (isConnected ? {} : null);
  const [bets,        setBets]        = useState<Bet[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);
  const [tab,         setTab]         = useState<Tab>("all");

  useEffect(() => {
    if (!session) return;
    // Only show spinner on the very first load — subsequent refreshes keep stale data visible
    // to prevent height collapse → layout shift → visual glitch
    const params = new URLSearchParams({ page: "1" });
    if (game) params.set("game", game);
    fetch(`/api/history?${params}`)
      .then((r) => r.json())
      .then((d) => setBets(d.bets ?? []))
      .catch(() => {})
      .finally(() => setInitialLoad(false));
  }, [session, refreshKey, game]);

  if (!session) return null;

  const gameFiltered = bets;
  const settled      = gameFiltered.filter((b) => b.profitGzo !== null);
  const filtered     =
    tab === "all"  ? gameFiltered
    : tab === "win"  ? settled.filter((b) => (b.profitGzo ?? 0) > 0)
    :                  settled.filter((b) => (b.profitGzo ?? 0) <= 0);
  const shown = filtered.slice(0, 15);

  return (
    <div className="card" style={{ padding: 0, marginBottom: "1.25rem" }}>
      {/* Header */}
      <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #2a2a50", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, margin: 0 }}>Recent Bets</h2>
        <Link href="/history" style={{ fontSize: "0.8rem", color: "#00ff9d", textDecoration: "none", fontWeight: 600 }}>
          View all →
        </Link>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", padding: "0.625rem 1.25rem", gap: "0.375rem", borderBottom: "1px solid #2a2a50" }}>
        {(["win", "loss", "all"] as Tab[]).map((t) => {
          const ac = TAB_ACCENT[t];
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "0.3rem 0.875rem", borderRadius: "99px",
              border: `1px solid ${tab === t ? ac : "#2a2a50"}`,
              background: tab === t ? `${ac}18` : "transparent",
              color: tab === t ? ac : "#8888aa",
              fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
            }}>
              {t === "win" ? "Wins" : t === "loss" ? "Losses" : "All"}
            </button>
          );
        })}
      </div>

      {/* Table */}
      {initialLoad ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#8888aa", fontSize: "0.875rem" }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ padding: "2rem", textAlign: "center", color: "#8888aa", fontSize: "0.875rem" }}>
          {tab === "win" ? "No wins yet — keep playing!" : tab === "loss" ? "No losses recorded." : "No bets yet."}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
            <thead>
              <tr>
                {(["Date", "Game", "Result", "Stake", "P / L", "Seeds", "Status"] as const).map((h) => (
                  <th key={h} style={TH}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((bet) => {
                const profit    = bet.profitGzo ?? 0;
                const isWin     = profit > 0;
                const isSettled = bet.profitGzo !== null;
                const color     = GAME_COLORS[bet.game] ?? "#8888aa";

                const rawStatus = bet.status;
                const statusLabel =
                  rawStatus === "COMPLETED" || rawStatus === "SETTLED" ? "Settled"
                  : rawStatus === "ACTIVE" ? "Active"
                  : rawStatus === "PENDING" ? "Pending"
                  : rawStatus;
                const statusColor =
                  statusLabel === "Settled" ? "#00ff9d"
                  : statusLabel === "Active" ? "#00d4ff"
                  : "#ff9d00";

                const verifySlug = GAME_VERIFY_SLUG[bet.game];
                const betId      = bet.referenceId ?? bet.id;

                return (
                  <tr key={bet.id}>
                    {/* Date */}
                    <td style={{ ...TD, color: "#555577" }}>{formatDate(bet.createdAt)}</td>

                    {/* Game */}
                    <td style={TD}>
                      <span style={{
                        fontSize: "0.65rem", fontWeight: 700, padding: "0.15rem 0.5rem",
                        borderRadius: "99px", background: `${color}22`, color,
                      }}>
                        {GAME_LABELS[bet.game] ?? bet.game}
                      </span>
                    </td>

                    {/* Result */}
                    <td style={TD}>
                      {isSettled ? (
                        <span style={{
                          fontSize: "0.65rem", fontWeight: 700, padding: "0.15rem 0.5rem",
                          borderRadius: "99px",
                          background: isWin ? "rgba(0,255,157,0.12)" : "rgba(255,128,128,0.12)",
                          color: isWin ? "#00ff9d" : "#ff8080",
                        }}>
                          {isWin ? "WIN" : "LOSS"}
                        </span>
                      ) : <span style={{ color: "#555577" }}>—</span>}
                    </td>

                    {/* Stake */}
                    <td style={{ ...TD, fontFamily: "monospace", color: "#f0f0ff" }}>
                      {bet.stakeGzo.toLocaleString()} GZO
                    </td>

                    {/* P/L */}
                    <td style={{ ...TD, fontFamily: "monospace", fontWeight: 700, color: isSettled ? (isWin ? "#00ff9d" : "#ff8080") : "#555577" }}>
                      {isSettled
                        ? `${isWin ? "+" : ""}${profit.toLocaleString()} GZO`
                        : "—"}
                    </td>

                    {/* Seeds */}
                    <td style={TD}>
                      <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ fontFamily: "monospace", fontSize: "0.68rem", color: "#8888aa" }}>
                          {truncHash(bet.serverSeedHash)}
                        </span>
                        {bet.serverSeedRevealed && verifySlug && (
                          <Link
                            href={`/verify?game=${verifySlug}&id=${betId}`}
                            style={{ fontSize: "0.65rem", color: "#00ff9d", textDecoration: "none", fontWeight: 700, flexShrink: 0 }}
                          >
                            Verify →
                          </Link>
                        )}
                      </span>
                    </td>

                    {/* Status */}
                    <td style={TD}>
                      <span style={{
                        fontSize: "0.65rem", fontWeight: 700, padding: "0.15rem 0.5rem",
                        borderRadius: "99px", background: `${statusColor}18`, color: statusColor,
                      }}>
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length > 15 && (
            <div style={{ padding: "0.875rem 1.25rem", textAlign: "center" }}>
              <Link href="/history" style={{ fontSize: "0.8rem", color: "#00ff9d", textDecoration: "none", fontWeight: 600 }}>
                View {filtered.length - 15} more →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
