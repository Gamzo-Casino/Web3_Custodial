"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { parseEther, formatEther, parseAbiItem } from "viem";
import { useRouter } from "next/navigation";
import NetworkGuard from "@/components/NetworkGuard";
import ApproveGZO from "@/components/ApproveGZO";
import TxStatus, { useTxStatus } from "@/components/TxStatus";
import { useGZOBalance } from "@/lib/web3/hooks/useGZOBalance";
import { useCreateMatch, useJoinMatch, useCancelMatch } from "@/lib/web3/hooks/useCoinFlip";
import { ADDRESSES, COINFLIP_ABI } from "@/lib/web3/contracts";

// ── Types ──────────────────────────────────────────────────────────────────────
const SIDES = ["HEADS", "TAILS"] as const;
type Side = 0 | 1;

interface OnchainMatch {
  roundId: `0x${string}`;
  playerA: `0x${string}`;
  stake: bigint;
  side: 0 | 1;
  status: number; // 0=PENDING, 1=ACTIVE, 2=SETTLED, 3=CANCELLED
}

function CoinIcon({ side, size = 24 }: { side: "HEADS" | "TAILS"; size?: number }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: "50%",
      background: side === "HEADS"
        ? "linear-gradient(135deg,#00ff9d,#00d4ff)"
        : "linear-gradient(135deg,#9b59ff,#ff69b4)",
      fontSize: size * 0.45, fontWeight: 900, color: "#0d0d1a", flexShrink: 0,
    }}>
      {side === "HEADS" ? "H" : "T"}
    </span>
  );
}

function truncAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ── On-chain match fetcher ─────────────────────────────────────────────────────
function useOpenMatches() {
  const publicClient = usePublicClient();
  const [matches, setMatches] = useState<OnchainMatch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMatches = useCallback(async () => {
    if (!publicClient) return;
    try {
      // Get all MatchCreated events from block 0
      const logs = await publicClient.getLogs({
        address: ADDRESSES.coinFlipGame,
        event: parseAbiItem("event MatchCreated(bytes32 indexed roundId, address indexed playerA, uint256 stake, uint8 side)"),
        fromBlock: 0n,
        toBlock: "latest",
      });

      // Read current status of each match via getMatch
      const results = await Promise.all(
        logs.map(async (log) => {
          try {
            const roundId = log.args.roundId as `0x${string}`;
            const data = await publicClient.readContract({
              address: ADDRESSES.coinFlipGame,
              abi: COINFLIP_ABI,
              functionName: "getMatch",
              args: [roundId],
            }) as any;
            return {
              roundId,
              playerA: data.playerA as `0x${string}`,
              stake: data.stake as bigint,
              side: data.playerAChoice as 0 | 1,
              status: Number(data.status),
            } satisfies OnchainMatch;
          } catch {
            return null;
          }
        })
      );

      // Only show PENDING matches (status === 0)
      const open = results.filter((m): m is OnchainMatch => m !== null && m.status === 0);
      setMatches(open.reverse()); // newest first
    } catch (e) {
      console.error("[coinflip] fetchMatches:", e);
    } finally {
      setLoading(false);
    }
  }, [publicClient]);

  useEffect(() => {
    fetchMatches();
    const id = setInterval(fetchMatches, 5000);
    return () => clearInterval(id);
  }, [fetchMatches]);

  return { matches, loading, refetch: fetchMatches };
}

// ── Create Match Panel ─────────────────────────────────────────────────────────
function CreateMatchPanel({ onCreated }: { onCreated: (roundId: string) => void }) {
  const [stake, setStake] = useState("100");
  const [side, setSide] = useState<Side>(0);
  const { formatted: balanceFormatted, raw: balanceRaw } = useGZOBalance();
  const stakeWei = (() => { try { return parseEther(stake || "0"); } catch { return 0n; } })();

  const { createMatch, hash, isPending, isConfirming, isSuccess, roundId, error, reset } = useCreateMatch();
  const txStatus = useTxStatus({ isPending, isConfirming, isSuccess: false, error });

  useEffect(() => {
    if (isSuccess && roundId) onCreated(roundId);
  }, [isSuccess, roundId, onCreated]);

  return (
    <div className="card" style={{
      background: "linear-gradient(135deg,#0f1f17,#0d0d1f)",
      borderColor: "rgba(0,255,157,0.25)",
      marginBottom: "2rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 700 }}>Create a Match</h2>
        <span style={{ fontSize: "0.8rem", color: "#8888aa" }}>
          Balance: <strong style={{ color: "#00ff9d" }}>{balanceFormatted} GZO</strong>
        </span>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {/* Stake input */}
        <div style={{ flex: 1, minWidth: "150px" }}>
          <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
            Stake (GZO)
          </label>
          <input
            type="number" min="1" max="10000" step="1" value={stake}
            onChange={(e) => { setStake(e.target.value); reset(); }}
            style={{ width: "100%", background: "#0d0d1a", border: "1px solid #2a2a50", borderRadius: "8px", padding: "0.625rem 0.875rem", color: "#f0f0ff", fontSize: "1rem", outline: "none" }}
          />
          <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.5rem" }}>
            {["50", "100", "200", "500"].map((v) => (
              <button key={v} onClick={() => setStake(v)} style={{
                padding: "0.25rem 0.625rem", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600,
                border: `1px solid ${stake === v ? "#00ff9d" : "#2a2a50"}`,
                background: stake === v ? "rgba(0,255,157,0.12)" : "transparent",
                color: stake === v ? "#00ff9d" : "#8888aa", cursor: "pointer",
              }}>{v}</button>
            ))}
          </div>
        </div>

        {/* Side picker */}
        <div style={{ flex: 1, minWidth: "150px" }}>
          <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
            Your Side
          </label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {([["HEADS", 0], ["TAILS", 1]] as const).map(([label, val]) => (
              <button key={label} onClick={() => setSide(val as Side)} style={{
                flex: 1, padding: "0.625rem", borderRadius: "8px",
                border: `1px solid ${side === val ? (val === 0 ? "#00ff9d" : "#9b59ff") : "#2a2a50"}`,
                background: side === val ? (val === 0 ? "rgba(0,255,157,0.12)" : "rgba(155,89,255,0.12)") : "transparent",
                color: side === val ? (val === 0 ? "#00ff9d" : "#9b59ff") : "#8888aa",
                fontWeight: 700, fontSize: "0.875rem", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
              }}>
                <CoinIcon side={label} size={18} />{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ApproveGZO spender={ADDRESSES.treasuryVault} requiredAmount={stakeWei}>
        <button
          className="btn-primary"
          style={{ width: "100%", opacity: isPending || isConfirming || stakeWei > balanceRaw ? 0.6 : 1 }}
          disabled={isPending || isConfirming || stakeWei > balanceRaw || stakeWei === 0n}
          onClick={() => createMatch(stakeWei, side)}
        >
          {isPending ? "Confirm in wallet…" : isConfirming ? "Creating on-chain…" : `Create for ${stake || "0"} GZO`}
        </button>
      </ApproveGZO>

      {txStatus !== "idle" && (
        <div style={{ marginTop: "0.75rem" }}>
          <TxStatus status={txStatus} hash={hash} error={error}
            labels={{ success: "Match created! Waiting for opponent…" }} />
        </div>
      )}
    </div>
  );
}

// ── Join Button ────────────────────────────────────────────────────────────────
function JoinButton({ roundId, stake, onJoined }: { roundId: `0x${string}`; stake: bigint; onJoined: () => void }) {
  const { joinMatch, hash, isPending, isConfirming, isSuccess, error } = useJoinMatch();
  const txStatus = useTxStatus({ isPending, isConfirming, isSuccess: false, error });

  useEffect(() => { if (isSuccess) onJoined(); }, [isSuccess, onJoined]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem", alignItems: "flex-end" }}>
      <ApproveGZO spender={ADDRESSES.treasuryVault} requiredAmount={stake}>
        <button
          className="btn-primary"
          style={{ fontSize: "0.8125rem", padding: "0.4rem 1rem", opacity: isPending || isConfirming ? 0.6 : 1 }}
          disabled={isPending || isConfirming}
          onClick={() => joinMatch(roundId)}
        >
          {isPending ? "Confirm…" : isConfirming ? "Joining…" : `Join · ${formatEther(stake)} GZO`}
        </button>
      </ApproveGZO>
      {txStatus !== "idle" && <TxStatus status={txStatus} hash={hash} error={error} compact />}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function CoinFlipPage() {
  const { address } = useAccount();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const { matches, loading, refetch } = useOpenMatches();

  function handleCreated(roundId: string) {
    setShowCreate(false);
    refetch();
    router.push(`/coinflip/${roundId}`);
  }

  return (
    <NetworkGuard>
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1 style={{ fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem" }}>
              Coin Flip
            </h1>
            <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
              PvP · Onchain settlement via Chainlink VRF · 10% fee on winnings
            </p>
          </div>
          <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "← Back" : "+ Create Match"}
          </button>
        </div>

        {/* Contract address badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1.5rem" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ff9d", boxShadow: "0 0 6px #00ff9d", display: "inline-block" }} />
          <span style={{ fontSize: "0.75rem", color: "#555577" }}>
            Contract: <code style={{ color: "#00ff9d", fontSize: "0.7rem" }}>{ADDRESSES.coinFlipGame}</code>
          </span>
        </div>

        {/* Create panel */}
        {showCreate && <CreateMatchPanel onCreated={handleCreated} />}

        {/* Open Matches */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #2a2a50", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>Open Matches</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              {!loading && (
                <span style={{ fontSize: "0.75rem", color: "#8888aa", background: "#1a1a35", padding: "0.25rem 0.625rem", borderRadius: "99px" }}>
                  {matches.length} waiting
                </span>
              )}
              <button onClick={refetch} style={{ background: "none", border: "none", color: "#555577", cursor: "pointer", fontSize: "0.8rem" }}>
                ↻ Refresh
              </button>
            </div>
          </div>

          {loading ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "#8888aa" }}>Loading matches…</div>
          ) : matches.length === 0 ? (
            <div style={{ padding: "4rem 2rem", textAlign: "center", color: "#8888aa", fontSize: "0.9rem" }}>
              No open matches.{" "}
              <button style={{ color: "#00ff9d", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }} onClick={() => setShowCreate(true)}>
                Create one →
              </button>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #2a2a50", color: "#8888aa", fontSize: "0.72rem", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    <th style={{ padding: "0.75rem 1.5rem", textAlign: "left", fontWeight: 600 }}>Creator</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "center", fontWeight: 600 }}>Side</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600 }}>Stake</th>
                    <th style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 600 }}>Pot</th>
                    <th style={{ padding: "0.75rem 1.5rem", textAlign: "right", fontWeight: 600 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => {
                    const isOwn = address?.toLowerCase() === m.playerA.toLowerCase();
                    const sideName = SIDES[m.side];
                    return (
                      <tr key={m.roundId} style={{ borderBottom: "1px solid rgba(42,42,80,0.5)" }}>
                        <td style={{ padding: "0.875rem 1.5rem" }}>
                          <div style={{ fontWeight: 600, fontSize: "0.875rem", fontFamily: "monospace", color: isOwn ? "#00ff9d" : "#f0f0ff" }}>
                            {truncAddr(m.playerA)}
                            {isOwn && <span style={{ marginLeft: "0.5rem", fontSize: "0.65rem", background: "rgba(0,255,157,0.12)", color: "#00ff9d", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>You</span>}
                          </div>
                        </td>
                        <td style={{ padding: "0.875rem 1rem", textAlign: "center" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem", fontWeight: 700, color: m.side === 0 ? "#00ff9d" : "#9b59ff" }}>
                            <CoinIcon side={sideName} size={20} />{sideName}
                          </span>
                        </td>
                        <td style={{ padding: "0.875rem 1rem", textAlign: "right", fontWeight: 700, color: "#f0f0ff", fontVariantNumeric: "tabular-nums" }}>
                          {Number(formatEther(m.stake)).toLocaleString()} GZO
                        </td>
                        <td style={{ padding: "0.875rem 1rem", textAlign: "right", fontWeight: 700, color: "#00ff9d", fontVariantNumeric: "tabular-nums" }}>
                          {Number(formatEther(m.stake * 2n)).toLocaleString()} GZO
                        </td>
                        <td style={{ padding: "0.875rem 1.5rem", textAlign: "right" }}>
                          {isOwn ? (
                            <span style={{ fontSize: "0.8125rem", color: "#555577" }}>Waiting for opponent…</span>
                          ) : (
                            <JoinButton roundId={m.roundId} stake={m.stake} onJoined={refetch} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </NetworkGuard>
  );
}
