"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import OtherGames from "@/components/OtherGames";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import BetHistory from "@/components/BetHistory";
import { SiTarget, SiGear, SiDice, SiShuffle, SiFunction, SiShieldCheck, SiGem, SiBomb } from "@/components/GameIcons";
import CasinoChip, { CHIP_OPTIONS } from "@/components/CasinoChip";

// ── Pure-math helpers ─────────────────────────────────────────────────────────
function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return c;
}
function minesMultiplier(boardSize: number, mineCount: number, safePicks: number): number {
  if (safePicks <= 0) return 1.0;
  const safe = boardSize - mineCount;
  if (safePicks > safe) return 0;
  const den = comb(safe, safePicks);
  if (den === 0) return 0;
  return Math.round((comb(boardSize, safePicks) / den) * 100) / 100;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type GamePhase = "idle" | "starting" | "pending_vrf" | "active" | "cashed_out" | "lost";

const ACCENT     = "#ff3d7a";
const ACCENT2    = "#ff0055";
const SAFE_COLOR = "#00ff9d";
const MINE_COLOR = "#ff4444";

const BOARD_SIZE   = 25;
const MINE_PRESETS = [1, 3, 5, 10, 15];

const VRF_PHASES = [
  "Placing bet on-chain…",
  "Requesting Chainlink VRF…",
  "Waiting for randomness oracle…",
  "Deriving mine positions…",
  "Almost ready…",
];

// ── VRF Loader ────────────────────────────────────────────────────────────────
function VRFLoader({ phase }: { phase: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "2rem 1rem" }}>
      <div className="atom-wrap" style={{ position: "relative", width: "130px", height: "130px" }}>
        <div className="nucleus" style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: "20px", height: "20px", borderRadius: "50%",
          background: `radial-gradient(circle, white 0%, ${ACCENT} 70%)`,
          boxShadow: `0 0 6px white, 0 0 18px ${ACCENT}, 0 0 36px ${ACCENT}88`,
          zIndex: 10,
        }} />
        {[
          { cls: "orbit-0", color: ACCENT },
          { cls: "orbit-1", color: SAFE_COLOR },
          { cls: "orbit-2", color: "#00d4ff" },
        ].map(({ cls, color }) => (
          <div key={cls} className={`orbit ${cls}`} style={{
            position: "absolute", top: "50%", left: "50%",
            width: "120px", height: "50px",
            marginTop: "-25px", marginLeft: "-60px",
            border: `1.5px solid ${color}50`, borderRadius: "50%",
          }}>
            <div style={{
              position: "absolute", top: "-5px", left: "calc(50% - 5px)",
              width: "10px", height: "10px", borderRadius: "50%",
              background: color, boxShadow: `0 0 8px ${color}, 0 0 16px ${color}99`,
            }} />
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", maxWidth: "280px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }} />
          <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f0f0ff" }}>{phase}</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#8888aa", lineHeight: 1.6, margin: 0 }}>
          Chainlink VRF is generating a tamper-proof random seed on-chain. This takes ~30–60 seconds.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem", marginTop: "0.875rem" }}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`prog-dot prog-dot-${i}`} style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: ACCENT, opacity: 0.3,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tile component ────────────────────────────────────────────────────────────
type TileState = "hidden" | "safe" | "mine" | "hit-mine" | "cashout";

function Tile({
  index, state, justRevealed, onClick, disabled,
}: {
  index: number; state: TileState; justRevealed: boolean; onClick: () => void; disabled: boolean;
}) {
  const isClickable = state === "hidden" && !disabled;
  const bg =
    state === "safe" || state === "cashout" ? "rgba(0,255,157,0.15)" :
    state === "mine"     ? "rgba(255,68,68,0.12)" :
    state === "hit-mine" ? "rgba(255,68,68,0.35)" : "#0d0d1f";
  const border =
    state === "safe" || state === "cashout" ? "2px solid rgba(0,255,157,0.5)" :
    state === "mine"     ? "2px solid rgba(255,68,68,0.4)" :
    state === "hit-mine" ? "2px solid #ff4444" : "2px solid rgba(255,61,122,0.18)";
  const glow =
    state === "safe" || state === "cashout" ? "0 0 16px rgba(0,255,157,0.35)" :
    state === "hit-mine" ? "0 0 24px rgba(255,68,68,0.7)" :
    state === "mine"     ? "0 0 10px rgba(255,68,68,0.25)" : "none";
  const icon =
    state === "safe" || state === "cashout" ? <SiGem size={18} color="#00ff9d" /> :
    state === "mine" || state === "hit-mine" ? <SiBomb size={18} color="#ff4444" /> :
    <span style={{ color: "#2a2a50" }}>·</span>;

  return (
    <button
      onClick={onClick}
      disabled={!isClickable}
      style={{
        width: "100%", aspectRatio: "1", background: bg, border, borderRadius: "10px",
        cursor: isClickable ? "pointer" : "default",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800,
        boxShadow: glow,
        transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.15s",
        transform: justRevealed && state === "safe" ? "scale(1.05)" : state === "hit-mine" ? "scale(1.08)" : "scale(1)",
        animation: justRevealed
          ? state === "safe" ? "gem-pop 0.35s ease-out" : state === "hit-mine" ? "mine-shake 0.4s ease-out" : undefined
          : undefined,
        position: "relative", overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        if (isClickable) {
          (e.currentTarget as HTMLElement).style.background = "rgba(255,61,122,0.12)";
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,61,122,0.55)";
          (e.currentTarget as HTMLElement).style.boxShadow = "0 0 18px rgba(255,61,122,0.3)";
          (e.currentTarget as HTMLElement).style.transform = "scale(1.04)";
        }
      }}
      onMouseLeave={(e) => {
        if (isClickable) {
          (e.currentTarget as HTMLElement).style.background = "#0d0d1f";
          (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,61,122,0.18)";
          (e.currentTarget as HTMLElement).style.boxShadow = "none";
          (e.currentTarget as HTMLElement).style.transform = "scale(1)";
        }
      }}
    >
      {icon}
    </button>
  );
}

// ── Stats row ─────────────────────────────────────────────────────────────────
function StatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.35rem 0", borderBottom: "1px solid rgba(255,61,122,0.08)" }}>
      <span style={{ fontSize: "0.75rem", color: "#8888aa" }}>{label}</span>
      <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: accent ?? "#f0f0ff", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: "0.75rem", fontWeight: 700, color: "#8888aa",
  textTransform: "uppercase", letterSpacing: "0.06em",
  display: "block", marginBottom: "0.4rem",
};
const inputStyle = (disabled: boolean): React.CSSProperties => ({
  width: "100%", padding: "0.625rem 0.75rem",
  background: disabled ? "#0a0a18" : "#0d0d1f",
  border: `1px solid ${disabled ? "#1a1a35" : "rgba(255,61,122,0.3)"}`,
  borderRadius: "8px", color: disabled ? "#555577" : "#f0f0ff",
  fontSize: "1rem", fontWeight: 600, outline: "none",
  opacity: disabled ? 0.6 : 1,
  boxSizing: "border-box",
});

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MinesPage() {
  return <MinesGame />;
}

function MinesGame() {
  const { formatted: balance, refetch: refetchBalance } = useDBBalance();

  // Controls
  const [stakeInput, setStakeInput]   = useState("100");
  const [mineCount, setMineCount]     = useState(3);

  // Game state
  const [phase, setPhase]                   = useState<GamePhase>("idle");
  const [roundId, setRoundId]               = useState<string | null>(null);
  const [minePositions, setMinePositions]   = useState<number[] | null>(null);
  const [revealedTiles, setRevealedTiles]   = useState<number[]>([]);
  const [multiplierPath, setMultiplierPath] = useState<number[]>([]);
  const [hitTile, setHitTile]               = useState<number | null>(null);
  const [justRevealedTile, setJustRevealedTile] = useState<number | null>(null);
  const [error, setError]                   = useState("");
  const [isRevealing, setIsRevealing]       = useState(false);
  const [isCashingOut, setIsCashingOut]     = useState(false);
  const [isForfeiting, setIsForfeiting]     = useState(false);
  const [vrfPhaseIdx, setVrfPhaseIdx]       = useState(0);
  const [historyTick, setHistoryTick]       = useState(0);

  // Settled result
  const [result, setResult] = useState<{
    outcome: "CASHED_OUT" | "LOST";
    netPayoutGzo?: number;
    grossPayoutGzo?: number;
    finalMultiplier?: number;
    safePicks?: number;
    hitTile?: number;
    minePositions?: number[];
  } | null>(null);

  // Resume on-chain round on mount
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    (async () => {
      try {
        const r = await fetch("/api/games/mines/current");
        const data = await r.json();
        if (!data.round?.roundId) return; // no active round → stay idle

        setRoundId(data.round.roundId);
        setRevealedTiles(data.round.revealedTiles ?? []);
        setMultiplierPath(data.round.multiplierPath ?? []);
        setMineCount(data.round.mineCount ?? 3);
        setStakeInput(String(data.round.stakeGzo ?? 100));

        // Immediately check on-chain status — skip the animation if VRF is done
        const statusRes = await fetch(`/api/games/mines/status?roundId=${encodeURIComponent(data.round.roundId)}`);
        const statusData = await statusRes.json();

        if (statusData.status === "ACTIVE") {
          setMinePositions(statusData.minePositions);
          setPhase("active");
        } else if (statusData.status === "PENDING") {
          setPhase("pending_vrf"); // VRF not fulfilled yet — start polling
        }
        // CASHED_OUT / LOST / REFUNDED / error → stay idle (stale bet, nothing to resume)
      } catch { /* stay idle */ }
    })();
  }, []);

  // VRF phase text cycling
  useEffect(() => {
    if (phase !== "pending_vrf") return;
    const interval = setInterval(() => {
      setVrfPhaseIdx(i => Math.min(i + 1, VRF_PHASES.length - 1));
    }, 15_000);
    return () => clearInterval(interval);
  }, [phase]);

  // VRF polling — 3 s interval, 8-min timeout
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const pollStart = useRef<number>(0);

  const startPolling = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollStart.current = Date.now();

    pollRef.current = setInterval(async () => {
      if (Date.now() - pollStart.current > 8 * 60_000) {
        clearInterval(pollRef.current!);
        setError("VRF timed out. Please try again.");
        setPhase("idle");
        return;
      }
      try {
        const res  = await fetch(`/api/games/mines/status?roundId=${encodeURIComponent(id)}`);
        const data = await res.json();
        if (data.status === "ACTIVE") {
          clearInterval(pollRef.current!);
          setMinePositions(data.minePositions);
          setPhase("active");
        }
      } catch { /* retry */ }
    }, 3_000);
  }, []);

  useEffect(() => {
    if (phase === "pending_vrf" && roundId) {
      setVrfPhaseIdx(0);
      startPolling(roundId);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [phase, roundId, startPolling]);

  // ── Tile state derivation ─────────────────────────────────────────────────
  function getTileState(idx: number): TileState {
    if (phase === "active") {
      if (revealedTiles.includes(idx)) return "safe";
      return "hidden";
    }
    if (phase === "cashed_out" || phase === "lost") {
      if (phase === "lost" && hitTile === idx) return "hit-mine";
      if (result?.minePositions?.includes(idx)) return "mine";
      if (revealedTiles.includes(idx)) return phase === "cashed_out" ? "cashout" : "safe";
      return "hidden";
    }
    return "hidden";
  }

  // ── Start game ────────────────────────────────────────────────────────────
  async function handleStart() {
    const stake = parseInt(stakeInput, 10);
    if (!stake || stake < 1) { setError("Enter a valid stake."); return; }
    setError("");
    setPhase("starting");

    try {
      const res  = await fetch("/api/games/mines/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeGzo: stake, mineCount }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to start game.");
        setPhase("idle");
        return;
      }
      setRoundId(data.roundId);
      setRevealedTiles([]);
      setMultiplierPath([]);
      setHitTile(null);
      setResult(null);
      setMinePositions(null);
      setPhase("pending_vrf");
      refetchBalance();
    } catch {
      setError("Network error. Please try again.");
      setPhase("idle");
    }
  }

  // ── Reveal tile ───────────────────────────────────────────────────────────
  async function handleTileClick(tileIndex: number) {
    if (phase !== "active" || !roundId || !minePositions || isRevealing) return;
    if (revealedTiles.includes(tileIndex)) return;

    setIsRevealing(true);
    setJustRevealedTile(tileIndex);
    setTimeout(() => setJustRevealedTile(null), 400);

    try {
      const res  = await fetch("/api/games/mines/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId, tileIndex, minePositions }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to reveal tile.");
        setIsRevealing(false);
        return;
      }

      if (data.outcome === "LOST") {
        setHitTile(tileIndex);
        setRevealedTiles(data.revealedTiles ?? [...revealedTiles, tileIndex]);
        setMinePositions(data.minePositions);
        setResult({
          outcome:      "LOST",
          safePicks:    revealedTiles.length,
          hitTile:      tileIndex,
          minePositions: data.minePositions,
        });
        setPhase("lost");
        refetchBalance();
        setHistoryTick(t => t + 1);
      } else if (data.outcome === "CASHED_OUT") {
        // Auto-cashout: all safe tiles revealed
        setRevealedTiles(data.revealedTiles);
        setMultiplierPath(data.multiplierPath ?? []);
        setMinePositions(data.minePositions);
        setResult({
          outcome:       "CASHED_OUT",
          netPayoutGzo:  data.netPayoutGzo,
          grossPayoutGzo: data.grossPayoutGzo,
          finalMultiplier: data.currentMultiplier,
          safePicks:     data.revealedTiles?.length,
          minePositions: data.minePositions,
        });
        setPhase("cashed_out");
        refetchBalance();
        setHistoryTick(t => t + 1);
      } else {
        // SAFE
        setRevealedTiles(data.revealedTiles);
        setMultiplierPath(data.multiplierPath ?? []);
      }
    } catch {
      setError("Network error during reveal.");
    } finally {
      setIsRevealing(false);
    }
  }

  // ── Cash out ──────────────────────────────────────────────────────────────
  async function handleCashout() {
    if (phase !== "active" || !roundId || revealedTiles.length === 0 || isCashingOut) return;
    setIsCashingOut(true);
    setError("");

    try {
      const res  = await fetch("/api/games/mines/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to cash out.");
        setIsCashingOut(false);
        return;
      }
      setResult({
        outcome:        "CASHED_OUT",
        netPayoutGzo:   data.netPayoutGzo,
        grossPayoutGzo: data.grossPayoutGzo,
        finalMultiplier: data.currentMultiplier,
        safePicks:      data.revealedTiles?.length ?? revealedTiles.length,
        minePositions:  minePositions ?? undefined,
      });
      setPhase("cashed_out");
      refetchBalance();
      setHistoryTick(t => t + 1);
    } catch {
      setError("Network error during cashout.");
    } finally {
      setIsCashingOut(false);
    }
  }

  // ── New game (used after settled rounds — no API call needed) ────────────
  function handleNewGame() {
    setPhase("idle");
    setRoundId(null);
    setRevealedTiles([]);
    setMultiplierPath([]);
    setHitTile(null);
    setError("");
    setResult(null);
    setMinePositions(null);
    setJustRevealedTile(null);
  }

  // ── Forfeit active round (calls API to settle on-chain + DB) ─────────────
  async function handleForfeit() {
    if (!roundId || isForfeiting || isRevealing || isCashingOut) return;
    setIsForfeiting(true);
    setError("");
    try {
      const res = await fetch("/api/games/mines/forfeit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to forfeit.");
        return;
      }
      refetchBalance();
      handleNewGame();
    } catch {
      setError("Network error during forfeit.");
    } finally {
      setIsForfeiting(false);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const safePicks       = revealedTiles.length;
  const currentMult     = minesMultiplier(BOARD_SIZE, mineCount, safePicks);
  const stake           = parseInt(stakeInput, 10) || 0;
  const projGross       = currentMult > 0 ? stake * currentMult : 0;
  const canStart        = phase === "idle" && !error;
  const canCashout      = phase === "active" && safePicks > 0 && !isCashingOut && !isRevealing;
  const canReveal       = phase === "active" && !isRevealing && !isCashingOut;
  const isLoading       = phase === "starting" || phase === "pending_vrf" || isRevealing || isCashingOut || isForfeiting;
  const showVrfOverlay  = phase === "starting" || phase === "pending_vrf";

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      <style>{`
        @keyframes gem-pop {
          0%   { transform: scale(0.7); opacity: 0.4; }
          60%  { transform: scale(1.12); }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes mine-shake {
          0%   { transform: scale(1)    translateX(0); }
          20%  { transform: scale(1.1)  translateX(-4px); }
          40%  { transform: scale(1.1)  translateX(4px); }
          60%  { transform: scale(1.08) translateX(-3px); }
          80%  { transform: scale(1.05) translateX(2px); }
          100% { transform: scale(1)    translateX(0); }
        }
        @keyframes vrf-pulse { 0%,100%{ opacity:0.3; } 50%{ opacity:0.7; } }
        @keyframes startBtnGlow {
          0%,100%{ box-shadow: 0 0 10px rgba(255,61,122,0.4); }
          50%    { box-shadow: 0 0 28px rgba(255,61,122,0.9), 0 0 48px rgba(255,0,85,0.4); }
        }
        @keyframes nucleusPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.25)} }
        @keyframes orbitSpin0 { from{transform:rotateZ(0deg) rotateX(15deg)} to{transform:rotateZ(360deg) rotateX(15deg)} }
        @keyframes orbitSpin1 { from{transform:rotateZ(0deg) rotateX(75deg) rotateZ(60deg)} to{transform:rotateZ(360deg) rotateX(75deg) rotateZ(60deg)} }
        @keyframes orbitSpin2 { from{transform:rotateZ(120deg) rotateX(45deg) rotateZ(0deg)} to{transform:rotateZ(120deg) rotateX(45deg) rotateZ(360deg)} }
        @keyframes progDot { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
        @keyframes vrfSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .start-btn-glow { animation: startBtnGlow 1.8s ease-in-out infinite; }
        .atom-wrap { perspective: 400px; }
        .nucleus { animation: nucleusPulse 1.8s ease-in-out infinite; }
        .orbit-0 { animation: orbitSpin0 2.2s linear infinite; }
        .orbit-1 { animation: orbitSpin1 1.7s linear infinite; }
        .orbit-2 { animation: orbitSpin2 3.1s linear infinite; }
        .prog-dot-0 { animation: progDot 1.4s ease-in-out 0s infinite; }
        .prog-dot-1 { animation: progDot 1.4s ease-in-out 0.2s infinite; }
        .prog-dot-2 { animation: progDot 1.4s ease-in-out 0.4s infinite; }
      `}</style>

      {/* ── Page header ── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{
          fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem",
          background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        }}>
          Mines
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          Uncover safe tiles, grow your multiplier, and cash out before hitting a mine.
        </p>
        <p style={{ color: "#555577", fontSize: "0.75rem", marginTop: "0.25rem" }}>
          Balance: <span style={{ color: SAFE_COLOR, fontWeight: 700 }}>{balance} GZO</span>
        </p>
      </div>

      {/* ── Main layout: Controls | Board | Stats ── */}
      <div className="game-3col">

        {/* ── LEFT — Controls ── */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem", background: "rgba(255,61,122,0.03)", borderColor: "rgba(255,61,122,0.2)" }}>

          {/* Bet Amount */}
          <div>
            <label style={labelStyle}>Bet Amount (GZO)</label>
            <input
              type="number" min={1} step={1}
              value={stakeInput}
              onChange={(e) => setStakeInput(e.target.value)}
              disabled={phase !== "idle"}
              style={inputStyle(phase !== "idle")}
            />
            <div className="chip-row" style={{ justifyItems: "center", marginTop: "0.5rem" }}>
              {CHIP_OPTIONS.map((chip) => (
                <CasinoChip
                  key={chip.value}
                  value={chip.value}
                  color={chip.color}
                  active={stakeInput === String(chip.value)}
                  onClick={() => setStakeInput(String(chip.value))}
                  disabled={phase !== "idle"}
                />
              ))}
            </div>
          </div>

          {/* Mine count */}
          <div>
            <label style={labelStyle}>Mines ({mineCount})</label>
            <input
              type="range" min={1} max={24}
              value={mineCount}
              onChange={(e) => setMineCount(parseInt(e.target.value))}
              disabled={phase !== "idle"}
              style={{ width: "100%", accentColor: ACCENT, cursor: phase !== "idle" ? "not-allowed" : "pointer", opacity: phase !== "idle" ? 0.5 : 1 }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.3rem" }}>
              {MINE_PRESETS.map((p) => (
                <button key={p} onClick={() => setMineCount(p)} disabled={phase !== "idle"}
                  style={{
                    padding: "0.2rem 0.45rem", borderRadius: "6px",
                    border: `1px solid ${mineCount === p ? MINE_COLOR : "#2a2a50"}`,
                    background: mineCount === p ? `${MINE_COLOR}22` : "transparent",
                    color: mineCount === p ? MINE_COLOR : "#8888aa",
                    fontSize: "0.7rem", fontWeight: mineCount === p ? 700 : 400,
                    cursor: phase !== "idle" ? "not-allowed" : "pointer",
                    opacity: phase !== "idle" ? 0.5 : 1,
                  }}>
                  {p} <SiBomb size={12} color="currentColor" />
                </button>
              ))}
            </div>
          </div>

          {/* First pick multiplier preview */}
          {phase === "idle" && (
            <div style={{ background: "#0a0a18", borderRadius: "8px", padding: "0.6rem 0.75rem" }}>
              <div style={{ fontSize: "0.65rem", color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.25rem" }}>First pick multiplier</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 900, color: ACCENT, fontFamily: "monospace" }}>
                {minesMultiplier(25, mineCount, 1).toFixed(2)}×
              </div>
              <div style={{ fontSize: "0.65rem", color: "#8888aa", marginTop: "0.15rem" }}>
                {25 - mineCount} safe tiles of 25
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: "0.5rem 0.6rem", background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", borderRadius: "8px", color: "#ff8080", fontSize: "0.775rem" }}>
              {error}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {phase === "idle" && (
              <button
                className={canStart ? "btn-primary start-btn-glow" : "btn-primary"}
                onClick={handleStart}
                disabled={!canStart}
                style={{
                  background: canStart ? `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})` : "#2a2a50",
                  border: "none", cursor: canStart ? "pointer" : "not-allowed",
                  opacity: canStart ? 1 : 0.6, color: canStart ? "#fff" : "#888",
                  padding: "0.75rem", fontSize: "0.9375rem", fontWeight: 700,
                }}
              >
                Start Game
              </button>
            )}

            {phase === "starting" && (
              <button disabled style={{ padding: "0.75rem", background: "#2a2a50", border: "none", borderRadius: "8px", color: "#888", fontWeight: 700, cursor: "not-allowed" }}>
                Starting…
              </button>
            )}

            {phase === "active" && (
              <>
                <button
                  onClick={handleCashout}
                  disabled={!canCashout}
                  style={{
                    background: canCashout ? "linear-gradient(135deg, #ffd700, #ffaa00)" : "#2a2a50",
                    border: "none", cursor: canCashout ? "pointer" : "not-allowed",
                    opacity: canCashout ? 1 : 0.5,
                    color: canCashout ? "#0a0a18" : "#888",
                    padding: "0.75rem", fontSize: "0.9375rem", fontWeight: 800,
                    borderRadius: "8px",
                    boxShadow: canCashout ? "0 0 20px rgba(255,215,0,0.3)" : "none",
                    transition: "all 0.2s",
                  }}
                >
                  {isCashingOut
                    ? "Cashing out…"
                    : `Cash Out${safePicks > 0 ? ` · ${projGross.toFixed(0)} GZO` : ""}`}
                </button>
                <button
                  onClick={handleForfeit}
                  disabled={isLoading || isForfeiting}
                  style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid #2a2a50", background: "transparent", color: "#8888aa", fontSize: "0.8rem", cursor: isForfeiting ? "not-allowed" : "pointer", opacity: isForfeiting ? 0.5 : 1 }}
                >
                  {isForfeiting ? "Forfeiting…" : "Forfeit"}
                </button>
              </>
            )}

            {(phase === "cashed_out" || phase === "lost") && (
              <button
                className="btn-primary"
                onClick={handleNewGame}
                style={{
                  background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
                  border: "none", cursor: "pointer", color: "#fff",
                  padding: "0.75rem", fontSize: "0.9375rem", fontWeight: 700,
                }}
              >
                New Game
              </button>
            )}
          </div>
        </div>

        {/* ── CENTER — Board ── */}
        <div
          className="card"
          style={{
            padding: "1.25rem", position: "relative",
            background:
              phase === "cashed_out" ? "rgba(0,255,157,0.04)" :
              phase === "lost"       ? "rgba(255,68,68,0.06)"  : "rgba(255,61,122,0.02)",
            borderColor:
              phase === "cashed_out" ? "rgba(0,255,157,0.25)" :
              phase === "lost"       ? "rgba(255,68,68,0.3)"   : "rgba(255,61,122,0.2)",
            transition: "background 0.4s, border-color 0.3s",
            display: "flex", flexDirection: "column", gap: "0.875rem",
          }}
        >
          {/* VRF loader overlay */}
          {showVrfOverlay && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 10,
              background: "rgba(10,10,24,0.85)",
              backdropFilter: "blur(4px)",
              borderRadius: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <VRFLoader phase={phase === "starting" ? "Placing bet on-chain…" : VRF_PHASES[vrfPhaseIdx]} />
            </div>
          )}

          {/* Board header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "#8888aa", fontWeight: 600 }}>
              {phase === "active"      ? `${safePicks} safe · ${mineCount} mines hidden` :
               phase === "pending_vrf" ? "Waiting for Chainlink VRF…" :
               phase === "starting"   ? "Placing bet on-chain…" :
               phase === "idle"       ? "Configure your bet and start" :
               phase === "cashed_out" ? "Cashed out!" : "Mine hit!"}
            </div>
            {phase === "active" && (
              <div style={{ fontSize: "1.375rem", fontWeight: 900, fontFamily: "monospace", color: currentMult >= 5 ? "#ffd700" : currentMult >= 2 ? SAFE_COLOR : "#f0f0ff", transition: "color 0.3s" }}>
                {currentMult.toFixed(2)}×
              </div>
            )}
            {phase === "cashed_out" && result?.netPayoutGzo !== undefined && (
              <div style={{ fontSize: "1.375rem", fontWeight: 900, fontFamily: "monospace", color: SAFE_COLOR }}>
                +{result.netPayoutGzo} GZO
              </div>
            )}
            {phase === "lost" && (
              <div style={{ fontSize: "1.375rem", fontWeight: 900, color: MINE_COLOR }}>
                −{stake} GZO
              </div>
            )}
          </div>

          {/* 5×5 Grid */}
          <div className="mines-board">
            {(phase === "pending_vrf" || phase === "starting") ? (
              Array.from({ length: BOARD_SIZE }, (_, i) => (
                <div key={i} style={{
                  aspectRatio: "1", background: "#0d0d1f", border: "2px solid rgba(255,215,0,0.15)",
                  borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.25rem", color: "rgba(255,215,0,0.2)", animation: "vrf-pulse 1.5s ease-in-out infinite",
                }}>·</div>
              ))
            ) : (
              Array.from({ length: BOARD_SIZE }, (_, i) => (
                <Tile
                  key={i} index={i}
                  state={getTileState(i)}
                  justRevealed={justRevealedTile === i}
                  onClick={() => canReveal && handleTileClick(i)}
                  disabled={!canReveal}
                />
              ))
            )}
          </div>

          {/* Board footer */}
          {phase === "idle" && (
            <div style={{ textAlign: "center", color: "#555577", fontSize: "0.775rem" }}>
              Configure your bet on the left, then hit <strong style={{ color: ACCENT }}>Start Game</strong>
            </div>
          )}
          {phase === "cashed_out" && result && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "rgba(0,255,157,0.08)", borderRadius: "8px", border: "1px solid rgba(0,255,157,0.2)" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: SAFE_COLOR }}>
                {(result.finalMultiplier ?? currentMult).toFixed(2)}× · {result.safePicks ?? safePicks} safe tiles
              </div>
              {result.netPayoutGzo !== undefined && (
                <div style={{ fontSize: "0.75rem", color: "#8888aa", marginTop: "0.15rem" }}>
                  Net payout: {result.netPayoutGzo} GZO
                </div>
              )}
            </div>
          )}
          {phase === "lost" && hitTile !== null && (
            <div style={{ textAlign: "center", padding: "0.5rem", background: "rgba(255,68,68,0.08)", borderRadius: "8px", border: "1px solid rgba(255,68,68,0.2)" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 700, color: MINE_COLOR }}>Mine hit at tile {hitTile}</div>
              <div style={{ fontSize: "0.75rem", color: "#8888aa", marginTop: "0.15rem" }}>{safePicks} safe picks before explosion</div>
            </div>
          )}
        </div>

        {/* ── RIGHT — Stats panel ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>

          {/* Idle: multiplier reference */}
          {phase === "idle" && (
            <div className="card" style={{ padding: "0.875rem", background: "rgba(255,61,122,0.03)", borderColor: "rgba(255,61,122,0.2)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.6rem" }}>
                Multiplier Reference
              </div>
              <div style={{ fontSize: "0.65rem", color: "#555577", marginBottom: "0.5rem" }}>
                With {mineCount} mine{mineCount !== 1 ? "s" : ""}, picking K safe tiles:
              </div>
              {[1, 2, 3, 5, 10].filter(k => k <= (25 - mineCount)).map((k) => (
                <StatRow key={k} label={`${k} pick${k !== 1 ? "s" : ""}`}
                  value={`${minesMultiplier(25, mineCount, k).toFixed(2)}×`}
                  accent={minesMultiplier(25, mineCount, k) >= 5 ? "#ffd700" : minesMultiplier(25, mineCount, k) >= 2 ? SAFE_COLOR : "#f0f0ff"} />
              ))}
            </div>
          )}

          {/* Active / pending_vrf: live stats */}
          {(phase === "active" || phase === "pending_vrf" || phase === "starting") && (
            <div className="card" style={{ padding: "0.875rem", background: "rgba(255,61,122,0.03)", borderColor: "rgba(255,61,122,0.2)" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: ACCENT, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.6rem" }}>
                Live Round
              </div>
              <StatRow label="Stake"        value={`${stake} GZO`} />
              <StatRow label="Mines"        value={`${mineCount} / ${BOARD_SIZE}`} accent={MINE_COLOR} />
              <StatRow label="Safe picks"   value={String(safePicks)} accent={SAFE_COLOR} />
              <StatRow label="Multiplier"   value={`${currentMult.toFixed(2)}×`} accent={currentMult >= 2 ? SAFE_COLOR : "#f0f0ff"} />
              <StatRow label="Gross payout" value={`${projGross.toFixed(0)} GZO`} />
            </div>
          )}

          {/* Settled result */}
          {(phase === "cashed_out" || phase === "lost") && result && (
            <div className="card" style={{
              padding: "0.875rem",
              background: phase === "cashed_out" ? "rgba(0,255,157,0.04)" : "rgba(255,68,68,0.04)",
              borderColor: phase === "cashed_out" ? "rgba(0,255,157,0.25)" : "rgba(255,68,68,0.25)",
            }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: phase === "cashed_out" ? SAFE_COLOR : MINE_COLOR, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.6rem" }}>
                {phase === "cashed_out" ? "Won!" : "Lost"}
              </div>
              <StatRow label="Safe picks"  value={String(result.safePicks ?? safePicks)} />
              <StatRow label="Multiplier"  value={`${(result.finalMultiplier ?? currentMult).toFixed(2)}×`}
                accent={phase === "cashed_out" ? SAFE_COLOR : MINE_COLOR} />
              {result.netPayoutGzo !== undefined && (
                <StatRow label="Net payout" value={`${result.netPayoutGzo} GZO`}
                  accent={phase === "cashed_out" ? SAFE_COLOR : MINE_COLOR} />
              )}
            </div>
          )}

          {/* Round info */}
          <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#f0f0ff", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.6rem" }}>
              Round Info
            </div>
            {roundId ? (
              <div style={{ fontSize: "0.7rem", color: "#8888aa", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <div>
                  <span style={{ color: "#555577" }}>Round ID: </span>
                  <span style={{ fontFamily: "monospace", color: "#ffd700" }} title={roundId}>{roundId.slice(0, 14)}…</span>
                </div>
                <div>
                  <span style={{ color: "#555577" }}>Status: </span>
                  <span style={{ fontFamily: "monospace" }}>{phase.toUpperCase().replace("_", " ")}</span>
                </div>
                {result?.minePositions && (phase === "cashed_out" || phase === "lost") && (
                  <div>
                    <span style={{ color: "#555577" }}>Mines: </span>
                    <span style={{ fontFamily: "monospace", color: MINE_COLOR }}>[{result.minePositions.join(", ")}]</span>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: "0.7rem", color: "#555577" }}>Start a game to see round data.</div>
            )}
          </div>

          {/* Provably Fair */}
          <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
              Provably Fair
            </div>
            {(phase === "cashed_out" || phase === "lost") ? (
              <div style={{ fontSize: "0.7rem", color: "#8888aa", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <div><span style={{ color: "#555577" }}>Safe picks: </span>
                  <span style={{ fontFamily: "monospace", color: SAFE_COLOR, fontWeight: 700 }}>{result?.safePicks ?? safePicks}</span></div>
                <div><span style={{ color: "#555577" }}>Multiplier: </span>
                  <span style={{ fontFamily: "monospace", color: ACCENT }}>{(result?.finalMultiplier ?? currentMult).toFixed(2)}×</span></div>
                <p style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.25rem", lineHeight: 1.6 }}>
                  Mine positions derived from Chainlink VRF seed — fully verifiable on-chain, tamper-proof.
                </p>
              </div>
            ) : phase === "pending_vrf" ? (
              <div style={{ fontSize: "0.7rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <div style={{ width: "10px", height: "10px", border: `2px solid ${ACCENT}`, borderTopColor: "transparent",
                  borderRadius: "50%", animation: "vrfSpin 0.8s linear infinite", flexShrink: 0 }} />
                Awaiting Chainlink VRF on-chain…
              </div>
            ) : (
              <div style={{ fontSize: "0.7rem", color: "#555577", lineHeight: 1.6 }}>
                Every game uses Chainlink VRF on Polygon to generate mine positions — tamper-proof randomness. No one, including the house, can predict or manipulate the result.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bet History ── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <BetHistory game="MINES" refreshTrigger={historyTick} />
      </div>

      {/* ── How to Play ── */}
      <div className="card" style={{ marginBottom: "1.25rem", background: "rgba(255,61,122,0.02)", borderColor: "rgba(255,61,122,0.15)" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiTarget size={16} color={ACCENT} /> How to Play
        </h2>
        <div className="howto-grid">
          {[
            { step: "1", title: "Set Your Bet",      desc: "Pick a chip size (10/50/100/500 GZO) or type a custom amount. Your balance is custodial — no wallet approval needed." },
            { step: "2", title: "Choose Mines",      desc: "Drag the slider to set how many mines hide on the 5×5 grid — more mines, bigger multipliers." },
            { step: "3", title: "Start Game",        desc: "Click Start Game. Chainlink VRF locks mine positions on-chain — provably fair and tamper-proof." },
            { step: "4", title: "Wait for VRF",      desc: "Chainlink VRF takes ~30–60 seconds to generate the random seed. The board activates automatically." },
            { step: "5", title: "Reveal Tiles",      desc: "Click tiles to reveal them. Each 💎 safe tile boosts your multiplier. Avoid the 💣 mines!" },
            { step: "6", title: "Cash Out or Boom!", desc: "Cash out any time after 1+ safe tile to lock in your winnings, or risk it all for a higher multiplier." },
          ].map(({ step, title, desc }) => (
            <div key={step} style={{
              background: "rgba(255,255,255,0.02)", borderRadius: "10px",
              border: "1px solid rgba(255,61,122,0.12)", padding: "0.875rem",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.65rem", fontWeight: 800, color: "#fff",
                }}>{step}</div>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color: ACCENT }}>{title}</div>
              </div>
              <p style={{ fontSize: "0.73rem", color: "#8888aa", lineHeight: 1.5, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Play Another Game ── */}
      <OtherGames exclude="mines" />

      {/* ── How it Works ── */}
      <div className="card" style={{ marginBottom: "1.25rem", background: "rgba(255,61,122,0.02)", borderColor: "rgba(255,61,122,0.15)" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiGear size={16} color={ACCENT} /> How it Works
        </h2>
        <div className="stat-grid-2">
          {[
            {
              icon: <SiDice size={20} color={ACCENT} />,
              title: "Chainlink VRF Mine Seed",
              body: "When you start a round, a VRF randomness request is sent to the Chainlink oracle. The returned seed is stored on-chain — no one can predict or alter the mine positions.",
            },
            {
              icon: <SiShuffle size={20} color={ACCENT} />,
              title: "Fisher-Yates Shuffle",
              body: "Mine positions are derived from the VRF seed using a deterministic Fisher-Yates shuffle. Both the contract and the frontend compute identical results — fully auditable.",
            },
            {
              icon: <SiFunction size={20} color={ACCENT} />,
              title: "Multiplier Math",
              body: "Each safe pick multiplies your stake by C(25,K) / C(25−mines,K). More mines or more picks = exponentially higher reward. The math is public and verifiable.",
            },
            {
              icon: <SiShieldCheck size={20} color={ACCENT} />,
              title: "Custodial Balance",
              body: "Your GZO balance is tracked in our secure database. No wallet approvals required to play — funds are debited on bet start and credited instantly on cashout.",
            },
          ].map(({ icon, title, body }) => (
            <div key={title} style={{ background: "rgba(255,255,255,0.02)", borderRadius: "10px", border: "1px solid rgba(255,61,122,0.12)", padding: "0.875rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                {icon}
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color: ACCENT }}>{title}</div>
              </div>
              <p style={{ fontSize: "0.73rem", color: "#8888aa", lineHeight: 1.5, margin: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
