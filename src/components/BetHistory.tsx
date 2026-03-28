"use client";

import { useState, useEffect } from "react";

interface Bet {
  id: string;
  gameType: string;
  stakeGzo: number | null;
  netPayoutGzo: number | null;
  profitGzo: number | null;
  won: boolean;
  status: string;
  onchainRoundId: string | null;
  txHash: string | null;
  chainId: number | null;
  contractAddress: string | null;
  createdAt: string;
  settledAt: string | null;
  resultJson: any;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function truncateTx(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function truncateRoundId(id: string): string {
  if (!id || id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-5)}`;
}

function formatResult(gameType: string, resultJson: any): string {
  if (!resultJson) return "";
  switch (gameType) {
    case "DICE":
      return `Roll: ${resultJson.roll?.toFixed(2)} / Target: ${resultJson.target?.toFixed(2)}`;
    case "PLINKO":
      return `${resultJson.multiplier}× · bin ${resultJson.binIndex} · ${resultJson.risk} risk`;
    case "WHEEL":
      return `${(resultJson.multiplier100 / 100)?.toFixed(2)}× · ${resultJson.riskMode} risk`;
    case "ROULETTE":
      return `Number: ${resultJson.number}`;
    case "KENO":
      return `${resultJson.matchCount} matches · ${(resultJson.multiplier100 / 100)?.toFixed(2)}×`;
    case "MINES":
      return `${resultJson.safePicks} safe picks · ${(resultJson.multiplier100 / 100)?.toFixed(2)}×`;
    case "BLACKJACK":
      return resultJson.outcome ?? "";
    case "HILO":
      return `${resultJson.steps} steps · ${(resultJson.multiplier100 / 100)?.toFixed(2)}×`;
    case "COINFLIP":
      return `${resultJson.outcome} · ${resultJson.won ? "Won" : "Lost"}`;
    case "AVIATOR":
      if (resultJson.outcome === "CASHED_OUT" && resultJson.cashoutMultiplier != null) {
        return `Cashed ${resultJson.cashoutMultiplier.toFixed(2)}× · Flew ${resultJson.flyAwayPoint?.toFixed(2)}×`;
      }
      return `Crashed · Flew ${resultJson.flyAwayPoint?.toFixed(2)}×`;
    default:
      return "";
  }
}

function SkeletonRow() {
  return (
    <tr>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} style={{ padding: "0.6rem 0.75rem" }}>
          <div
            style={{
              height: "14px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.06)",
              animation: "bh-pulse 1.4s ease-in-out infinite",
              width: i >= 5 ? "60%" : "80%",
            }}
          />
        </td>
      ))}
    </tr>
  );
}

export default function BetHistory({
  game,
  refreshTrigger,
}: {
  game?: string;
  refreshTrigger?: number;
}) {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = [game ? `game=${game}` : "", "limit=20"].filter(Boolean).join("&");
    fetch(`/api/bets/history?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setBets(Array.isArray(data.bets) ? data.bets : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [game, refreshTrigger]);

  return (
    <>
      <style>{`
        @keyframes bh-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.9; }
        }
        .bh-table { width: 100%; border-collapse: collapse; }
        .bh-table th {
          padding: 0.45rem 0.75rem;
          text-align: left;
          font-size: 0.65rem;
          font-weight: 700;
          color: #555577;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          border-bottom: 1px solid #1a1a35;
        }
        .bh-table td {
          padding: 0.55rem 0.75rem;
          font-size: 0.78rem;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          vertical-align: middle;
        }
        .bh-table tr:last-child td { border-bottom: none; }
        .bh-table tr:hover td { background: rgba(255,255,255,0.02); }
      `}</style>

      <div
        style={{
          background: "var(--bg-card, #12122a)",
          border: "1px solid var(--border-subtle, #2a2a50)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <table className="bh-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Bet</th>
                <th>Result</th>
                <th>Payout</th>
                <th>Spin Tx</th>
                <th>Round</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        ) : bets.length === 0 ? (
          <div
            style={{
              padding: "2rem",
              textAlign: "center",
              color: "var(--text-muted, #555577)",
              fontSize: "0.875rem",
            }}
          >
            No bets yet. Place your first bet!
          </div>
        ) : (
          <table className="bh-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Bet</th>
                <th>Result</th>
                <th>Payout</th>
                <th>Spin Tx</th>
                <th>Round</th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => {
                const detail = formatResult(bet.gameType, bet.resultJson);
                const isLocal = !bet.chainId || bet.chainId === 31337;
                const txShort = bet.txHash ? truncateTx(bet.txHash) : "—";
                const explorerUrl =
                  !isLocal && bet.txHash && bet.chainId === 80002
                    ? `https://amoy.polygonscan.com/tx/${bet.txHash}`
                    : null;
                // Round link: link to the spin tx's event log tab — the SpinPlaced event
                // contains the roundId as an indexed topic, proving the bet on-chain.
                // (onchainRoundId is a bytes32 key, NOT a tx hash — PolygonScan search fails on it)
                const roundUrl =
                  !isLocal && bet.txHash && bet.chainId === 80002
                    ? `https://amoy.polygonscan.com/tx/${bet.txHash}#eventlog`
                    : !isLocal && bet.contractAddress && bet.chainId === 80002
                    ? `https://amoy.polygonscan.com/address/${bet.contractAddress}#events`
                    : null;
                const roundShort = bet.onchainRoundId
                  ? truncateRoundId(bet.onchainRoundId)
                  : "—";

                return (
                  <tr key={bet.id}>
                    {/* Time */}
                    <td style={{ color: "#8888aa", whiteSpace: "nowrap" }}>
                      {timeAgo(bet.createdAt)}
                    </td>

                    {/* Bet */}
                    <td>
                      <div style={{ fontWeight: 700, color: "#f0f0ff", fontSize: "0.78rem" }}>
                        {bet.stakeGzo != null ? `${bet.stakeGzo} GZO` : "—"}
                      </div>
                      {detail && (
                        <div
                          style={{
                            fontSize: "0.65rem",
                            color: "#8888aa",
                            marginTop: "0.1rem",
                            fontFamily: "monospace",
                          }}
                        >
                          {detail}
                        </div>
                      )}
                    </td>

                    {/* Result badge */}
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "0.18rem 0.55rem",
                          borderRadius: "99px",
                          fontSize: "0.68rem",
                          fontWeight: 800,
                          background: bet.won
                            ? "rgba(0,255,157,0.14)"
                            : "rgba(255,80,80,0.14)",
                          color: bet.won
                            ? "var(--neon-green, #00ff9d)"
                            : "#ff8080",
                          border: `1px solid ${bet.won ? "rgba(0,255,157,0.3)" : "rgba(255,80,80,0.3)"}`,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {bet.won ? "WIN" : "LOSS"}
                      </span>
                    </td>

                    {/* Payout */}
                    <td
                      style={{
                        fontWeight: 700,
                        fontFamily: "monospace",
                        color: bet.won
                          ? "var(--neon-green, #00ff9d)"
                          : "#8888aa",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {bet.netPayoutGzo != null
                        ? `${Number(bet.netPayoutGzo).toFixed(4)} GZO`
                        : "—"}
                    </td>

                    {/* Spin Tx hash */}
                    <td>
                      {bet.txHash ? (
                        explorerUrl ? (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontFamily: "monospace",
                              fontSize: "0.72rem",
                              color: "#00d4ff",
                              textDecoration: "none",
                            }}
                            title={`Spin transaction: ${bet.txHash}`}
                          >
                            {txShort}
                          </a>
                        ) : (
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: "0.72rem",
                              color: "#555577",
                              cursor: "default",
                            }}
                            title={isLocal ? "Local Hardhat — no explorer" : bet.txHash}
                          >
                            {txShort}
                          </span>
                        )
                      ) : (
                        <span style={{ color: "#555577" }}>—</span>
                      )}
                    </td>

                    {/* Round ID — on-chain transparency link */}
                    <td>
                      {bet.onchainRoundId ? (
                        roundUrl ? (
                          <a
                            href={roundUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontFamily: "monospace",
                              fontSize: "0.72rem",
                              color: "#e879f9",
                              textDecoration: "none",
                            }}
                            title={`Round ID: ${bet.onchainRoundId} — opens tx event log on PolygonScan`}
                          >
                            {roundShort}
                          </a>
                        ) : (
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: "0.72rem",
                              color: "#555577",
                            }}
                            title={bet.onchainRoundId}
                          >
                            {roundShort}
                          </span>
                        )
                      ) : (
                        <span style={{ color: "#555577" }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
