"use client";

import { useState, useEffect, useCallback } from "react";
import OtherGames from "@/components/OtherGames";
import BetHistory from "@/components/BetHistory";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import {
  HILO_RANK_LABELS,
  HILO_SUIT_SYMBOLS,
  hiloCardFromIndex,
  getGuessMultiplier,
  type HiloCard,
  type HiloGuess,
  type HiloGuessHistoryEntry,
  type HiloGameState,
} from "@/lib/hilo";
import { SiTarget, SiGear, SiWallet, SiChip, SiCard, SiArrowUpDown, SiTrendingUp, SiCashOut, SiDice, SiShuffle, SiFunction, SiShieldCheck } from "@/components/GameIcons";

// ── Constants ─────────────────────────────────────────────────────────────────
const ACCENT = "#818cf8";
const ACCENT2 = "#a78bfa";

// ── Casino chip config ────────────────────────────────────────────────────────
const CHIP_OPTIONS = [
  { value: 10,  color: "#00d4ff" },
  { value: 50,  color: "#00ff9d" },
  { value: 100, color: "#818cf8" },
  { value: 500, color: "#ff4444" },
];

function CasinoChip({ value, color, active, onClick, disabled }: {
  value: number; color: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "52px", height: "52px", borderRadius: "50%",
        cursor: disabled ? "not-allowed" : "pointer",
        position: "relative",
        border: `3px solid ${active ? color : color + "66"}`,
        background: active
          ? `radial-gradient(circle at 35% 35%, ${color}33 0%, ${color}11 60%, ${color}22 100%)`
          : `radial-gradient(circle at 35% 35%, ${color}18 0%, #0d0d1a 70%)`,
        boxShadow: active
          ? `0 0 16px ${color}88, 0 0 32px ${color}44, inset 0 0 12px ${color}22`
          : `0 0 6px ${color}33, inset 0 0 6px ${color}11`,
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.15s ease",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "1px", outline: "none",
      }}
    >
      <div style={{
        position: "absolute", inset: "5px", borderRadius: "50%",
        border: `1px dashed ${color}${active ? "66" : "33"}`,
        pointerEvents: "none",
      }} />
      <span style={{
        fontSize: value >= 100 ? "0.62rem" : "0.72rem",
        fontWeight: 900, color: active ? color : color + "cc",
        fontFamily: "monospace", letterSpacing: "-0.03em", lineHeight: 1,
        position: "relative", zIndex: 1,
      }}>
        {value}
      </span>
      <span style={{ fontSize: "0.45rem", color: active ? color + "cc" : color + "66", fontWeight: 600, position: "relative", zIndex: 1, letterSpacing: "0.04em" }}>
        GZO
      </span>
    </button>
  );
}

// ── Neon Atom Loader ──────────────────────────────────────────────────────────
type LoadPhase = "dealing" | "vrf" | "settling";

const PHASE_CONFIG: Record<LoadPhase, { title: string; detail: string; colors: [string, string, string] }> = {
  dealing: {
    title: "Placing Bet…",
    detail: "Debiting your balance and requesting Chainlink VRF on-chain.",
    colors: [ACCENT, "#00d4ff", "#ffffff"],
  },
  vrf: {
    title: "Awaiting VRF",
    detail: "Chainlink VRF is generating your provably fair deck on-chain.",
    colors: ["#ffd700", "#ff9900", ACCENT],
  },
  settling: {
    title: "Settling…",
    detail: "Verifying your guesses on-chain and computing your payout.",
    colors: ["#00ff9d", ACCENT, "#00d4ff"],
  },
};

const VRF_TEXTS = [
  "Waiting for Chainlink VRF…",
  "Generating provably fair deck…",
  "On-chain randomness in progress…",
  "Almost there…",
];

function AtomLoader({ phase }: { phase: LoadPhase }) {
  const cfg = PHASE_CONFIG[phase];
  const [c0, c1, c2] = cfg.colors;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
      <div className="atom-wrap" style={{ position: "relative", width: 130, height: 130, flexShrink: 0 }}>
        <div className="nucleus" style={{
          position: "absolute", top: "50%", left: "50%",
          width: 20, height: 20, borderRadius: "50%",
          background: `radial-gradient(circle at 40% 40%, #fff, ${c0})`,
          boxShadow: `0 0 12px ${c0}, 0 0 28px ${c0}88`,
        }} />
        <div className="orbit orbit-0" style={{
          position: "absolute", top: "50%", left: "50%",
          width: 120, height: 50, marginTop: -25, marginLeft: -60,
          border: `1.5px solid ${c0}88`, borderRadius: "50%",
        }} />
        <div className="orbit orbit-1" style={{
          position: "absolute", top: "50%", left: "50%",
          width: 120, height: 50, marginTop: -25, marginLeft: -60,
          border: `1.5px solid ${c1}88`, borderRadius: "50%",
        }} />
        <div className="orbit orbit-2" style={{
          position: "absolute", top: "50%", left: "50%",
          width: 120, height: 50, marginTop: -25, marginLeft: -60,
          border: `1.5px solid ${c2}88`, borderRadius: "50%",
        }} />
        <div style={{
          position: "absolute", inset: 4, borderRadius: "50%",
          border: `1px solid ${c0}22`,
          boxShadow: `0 0 20px ${c0}22, inset 0 0 20px ${c0}11`,
          pointerEvents: "none",
        }} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.3rem" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}` }} />
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: c0 }}>{cfg.title}</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#8888aa", maxWidth: 220, textAlign: "center", lineHeight: 1.5, margin: "0 0 0.5rem" }}>
          {cfg.detail}
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.35rem" }}>
          <div className="prog-dot-0" style={{ width: 7, height: 7, borderRadius: "50%", background: c0 }} />
          <div className="prog-dot-1" style={{ width: 7, height: 7, borderRadius: "50%", background: c1 }} />
          <div className="prog-dot-2" style={{ width: 7, height: 7, borderRadius: "50%", background: c2 }} />
        </div>
      </div>
    </div>
  );
}

// ─── Playing Card ─────────────────────────────────────────────────────────────
function PlayingCard({
  card, faceDown = false, size = "md", animationDelay = 0, highlight,
}: {
  card?: HiloCard; faceDown?: boolean; size?: "sm" | "md" | "lg";
  animationDelay?: number; highlight?: "win" | "loss" | "current";
}) {
  const isRed = card ? (card.suit === 1 || card.suit === 2) : false;
  const dims = size === "lg"
    ? { w: 100, h: 140, rank: "2rem", suit: "1.4rem" }
    : size === "sm"
    ? { w: 56, h: 80, rank: "1rem", suit: "0.75rem" }
    : { w: 80, h: 112, rank: "1.5rem", suit: "1rem" };

  const borderColor =
    highlight === "win"     ? "#00ff9d" :
    highlight === "loss"    ? "#ff4d4d" :
    highlight === "current" ? ACCENT :
    "#c0c0dd";

  return (
    <div style={{
      width: dims.w, height: dims.h, borderRadius: 10,
      background: faceDown ? "linear-gradient(135deg, #1a1a3a, #2a2a5a)" : "#fff",
      border: `2px solid ${borderColor}`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      position: "relative",
      boxShadow: highlight
        ? `0 0 20px ${borderColor}55, 0 4px 12px rgba(0,0,0,0.5)`
        : "0 4px 12px rgba(0,0,0,0.5)",
      animation: faceDown ? "none" : `dealCard 0.35s ease both`,
      animationDelay: `${animationDelay}ms`,
      flexShrink: 0,
      transition: "border-color 0.2s, box-shadow 0.2s",
    }}>
      {faceDown ? (
        <div style={{ fontSize: "1.5rem", opacity: 0.4 }}>🂠</div>
      ) : card ? (
        <>
          <div style={{
            position: "absolute", top: 6, left: 8,
            fontSize: dims.rank, fontWeight: 800,
            color: isRed ? "#cc2200" : "#111", lineHeight: 1,
          }}>
            {HILO_RANK_LABELS[card.rank]}
          </div>
          <div style={{ fontSize: dims.suit, color: isRed ? "#cc2200" : "#111" }}>
            {HILO_SUIT_SYMBOLS[card.suit]}
          </div>
          <div style={{
            position: "absolute", bottom: 6, right: 8,
            fontSize: dims.rank, fontWeight: 800,
            color: isRed ? "#cc2200" : "#111", lineHeight: 1,
            transform: "rotate(180deg)",
          }}>
            {HILO_RANK_LABELS[card.rank]}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ─── History Row ──────────────────────────────────────────────────────────────
function HistoryRow({ entry }: { entry: HiloGuessHistoryEntry }) {
  const isWin = entry.result === "win";
  const guessLabel = entry.guess === "higher" ? "↑ Higher" : entry.guess === "lower" ? "↓ Lower" : "= Same";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.6rem",
      padding: "0.4rem 0.75rem",
      borderBottom: "1px solid rgba(42,42,80,0.4)",
      fontSize: "0.8rem",
    }}>
      <PlayingCard card={entry.cardBefore} size="sm" />
      <span style={{ color: "#8888aa", fontSize: "0.7rem" }}>→</span>
      <span style={{
        fontSize: "0.72rem", fontWeight: 700, padding: "0.1rem 0.4rem",
        borderRadius: "4px",
        background: isWin ? "rgba(0,255,157,0.12)" : "rgba(255,77,77,0.12)",
        color: isWin ? "#00ff9d" : "#ff4d4d",
      }}>{guessLabel}</span>
      <span style={{ color: "#8888aa", fontSize: "0.7rem" }}>→</span>
      <PlayingCard card={entry.cardAfter} size="sm" highlight={isWin ? "win" : "loss"} />
      <span style={{ marginLeft: "auto", fontSize: "0.75rem", fontWeight: 700, fontFamily: "monospace", color: isWin ? "#00ff9d" : "#ff4d4d" }}>
        {isWin ? `${entry.multiplierAfter.toFixed(2)}×` : "—"}
      </span>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
type GameStatus = "idle" | "dealing" | "pending_vrf" | "active" | "settling" | "settled";

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function HiloPage() {
  return <HiloGame />;
}

function HiloGame() {
  const { balance, refetch: refetchBalance } = useDBBalance();

  const [stakeInput, setStakeInput] = useState("100");
  const [chipValue, setChipValue] = useState(100);
  const [gameStatus, setGameStatus] = useState<GameStatus>("idle");
  const [gameState, setGameState] = useState<HiloGameState | null>(null);
  const [onchainRoundId, setOnchainRoundId] = useState<string | null>(null);
  const [vrfText, setVrfText] = useState(VRF_TEXTS[0]);
  const [error, setError] = useState("");
  const [historyTick, setHistoryTick] = useState(0);

  // ── Resume active round on mount ────────────────────────────────────────────
  useEffect(() => {
    async function checkExisting() {
      try {
        const res = await fetch("/api/games/hilo/current");
        if (!res.ok) return;
        const data = await res.json();
        if (data.round) {
          setGameState(data.round);
          setGameStatus("active");
        } else if (data.pending?.roundId) {
          setOnchainRoundId(data.pending.roundId);
          setGameStatus("pending_vrf");
        }
      } catch {
        // silent
      }
    }
    checkExisting();
  }, []);

  // ── VRF polling ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (gameStatus !== "pending_vrf" || !onchainRoundId) return;
    const TIMEOUT = 8 * 60 * 1000;
    const start = Date.now();

    // Cycle VRF status text
    let textIdx = 0;
    const textInterval = setInterval(() => {
      textIdx = (textIdx + 1) % VRF_TEXTS.length;
      setVrfText(VRF_TEXTS[textIdx]);
    }, 4000);

    const pollInterval = setInterval(async () => {
      if (Date.now() - start > TIMEOUT) {
        clearInterval(pollInterval);
        clearInterval(textInterval);
        setError("VRF timeout — please refresh and try again.");
        setGameStatus("idle");
        return;
      }
      try {
        const res = await fetch(`/api/games/hilo/status?roundId=${onchainRoundId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "active" && data.gameState) {
          clearInterval(pollInterval);
          clearInterval(textInterval);
          setGameState(data.gameState);
          setGameStatus("active");
          refetchBalance();
        }
      } catch {
        // silent, keep polling
      }
    }, 3000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(textInterval);
    };
  }, [gameStatus, onchainRoundId, refetchBalance]);

  // ── Game actions ─────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    const stake = parseInt(stakeInput, 10);
    if (!stake || stake < 1) { setError("Invalid stake amount"); return; }
    setError("");
    setGameStatus("dealing");

    try {
      const res = await fetch("/api/games/hilo/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeGzo: stake }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start round");
        setGameStatus("idle");
        return;
      }
      setOnchainRoundId(data.onchainRoundId);
      setGameStatus("pending_vrf");
      refetchBalance();
    } catch {
      setError("Network error, please try again");
      setGameStatus("idle");
    }
  }, [stakeInput, refetchBalance]);

  const handleGuess = useCallback(async (guess: HiloGuess) => {
    if (!gameState || gameStatus !== "active") return;
    setError("");

    try {
      const res = await fetch("/api/games/hilo/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: gameState.roundId, guess }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Guess failed");
        return;
      }
      const newState: HiloGameState = data;
      setGameState(newState);
      if (newState.status === "LOST") {
        setGameStatus("settled");
        setHistoryTick((t) => t + 1);
      }
    } catch {
      setError("Network error, please try again");
    }
  }, [gameState, gameStatus]);

  const handleCashout = useCallback(async () => {
    if (!gameState || gameStatus !== "active") return;
    if ((gameState.guessHistory?.length ?? 0) === 0) return;
    setError("");
    setGameStatus("settling");

    try {
      const res = await fetch("/api/games/hilo/cashout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: gameState.roundId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Cashout failed");
        setGameStatus("active");
        return;
      }
      const newState: HiloGameState = data;
      setGameState(newState);
      setGameStatus("settled");
      refetchBalance();
      setHistoryTick((t) => t + 1);
    } catch {
      setError("Network error, please try again");
      setGameStatus("active");
    }
  }, [gameState, gameStatus, refetchBalance]);

  function handlePlayAgain() {
    setGameState(null);
    setOnchainRoundId(null);
    setGameStatus("idle");
    setError("");
  }

  // ── Derived values ────────────────────────────────────────────────────────────
  const isActive    = gameStatus === "active";
  const isSettled   = gameStatus === "settled";
  const isDealing   = gameStatus === "dealing";
  const isPendingVrf = gameStatus === "pending_vrf";
  const isSettling  = gameStatus === "settling";
  const controlsDisabled = isActive || isDealing || isPendingVrf || isSettling;

  const isSettledWin = gameState?.status === "CASHED_OUT";
  const currentCard  = gameState?.currentCard;
  const currentMult  = gameState?.currentMultiplier ?? 1.0;
  const guessHistory = gameState?.guessHistory ?? [];

  const higherMult = currentCard ? getGuessMultiplier(currentCard.value, "higher") : 0;
  const lowerMult  = currentCard ? getGuessMultiplier(currentCard.value, "lower")  : 0;
  const sameMult   = currentCard ? getGuessMultiplier(currentCard.value, "same")   : 0;

  const canCashout = isActive && guessHistory.length > 0 && !isSettling;
  const resultColor = isSettledWin ? "#00ff9d" : "#ff4d4d";

  const loadPhase: LoadPhase | null =
    isDealing     ? "dealing" :
    isPendingVrf  ? "vrf"     :
    isSettling    ? "settling": null;

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      <style>{`
        @keyframes dealCard {
          from { opacity: 0; transform: translateY(-20px) scale(0.85); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes vrfSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes nucleusPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.25)} }
        @keyframes orbitSpin0 { from{transform:rotateZ(0deg) rotateX(15deg)} to{transform:rotateZ(360deg) rotateX(15deg)} }
        @keyframes orbitSpin1 { from{transform:rotateZ(0deg) rotateX(75deg) rotateZ(60deg)} to{transform:rotateZ(360deg) rotateX(75deg) rotateZ(60deg)} }
        @keyframes orbitSpin2 { from{transform:rotateZ(120deg) rotateX(45deg) rotateZ(0deg)} to{transform:rotateZ(120deg) rotateX(45deg) rotateZ(360deg)} }
        @keyframes progDot { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
        @keyframes hiloBtnGlow { 0%,100%{box-shadow:0 0 20px #818cf855,0 0 40px #818cf822} 50%{box-shadow:0 0 32px #818cf888,0 0 64px #818cf844} }
        @keyframes hiloFloat0 { 0%,100%{ transform: rotate(-20deg) translateY(0px); } 50%{ transform: rotate(-20deg) translateY(-9px); } }
        @keyframes hiloFloat1 { 0%,100%{ transform: rotate(-5deg) translateY(0px); }  50%{ transform: rotate(-5deg) translateY(-12px); } }
        @keyframes hiloFloat2 { 0%,100%{ transform: translateX(-50%) rotate(4deg) translateY(0px); } 50%{ transform: translateX(-50%) rotate(4deg) translateY(-10px); } }
        @keyframes hiloFloat3 { 0%,100%{ transform: rotate(10deg) translateY(0px); }  50%{ transform: rotate(10deg) translateY(-8px); } }
        @keyframes hiloFloat4 { 0%,100%{ transform: rotate(22deg) translateY(0px); }  50%{ transform: rotate(22deg) translateY(-11px); } }
        .hilo-float-0 { animation: hiloFloat0 3.4s ease-in-out infinite; }
        .hilo-float-1 { animation: hiloFloat1 2.9s ease-in-out infinite 0.3s; }
        .hilo-float-2 { animation: hiloFloat2 3.6s ease-in-out infinite 0.1s; }
        .hilo-float-3 { animation: hiloFloat3 3.0s ease-in-out infinite 0.5s; }
        .hilo-float-4 { animation: hiloFloat4 3.2s ease-in-out infinite 0.7s; }
        .atom-wrap { perspective: 400px; }
        .nucleus { animation: nucleusPulse 1.8s ease-in-out infinite; }
        .orbit-0 { animation: orbitSpin0 2.2s linear infinite; }
        .orbit-1 { animation: orbitSpin1 1.7s linear infinite; }
        .orbit-2 { animation: orbitSpin2 3.1s linear infinite; }
        .prog-dot-0 { animation: progDot 1.4s ease-in-out 0s infinite; }
        .prog-dot-1 { animation: progDot 1.4s ease-in-out 0.2s infinite; }
        .prog-dot-2 { animation: progDot 1.4s ease-in-out 0.4s infinite; }
        .hilo-deal-btn { animation: hiloBtnGlow 2s ease-in-out infinite !important; }
      `}</style>

      {/* ── Page header ── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{
          fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem",
          background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        }}>
          Hi-Lo
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          Guess Higher, Lower, or Same — build your multiplier, cash out before you bust.
        </p>
        <p style={{ color: "#555577", fontSize: "0.75rem", marginTop: "0.25rem" }}>
          Balance: <span style={{ color: "#00ff9d", fontWeight: 700 }}>{balance} GZO</span>
        </p>
      </div>

      {/* ── 3-column main layout ── */}
      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0,1fr) 240px", gap: "1.25rem", marginBottom: "1.25rem", alignItems: "start" }}>

        {/* ── LEFT — Controls ── */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem", background: `rgba(129,140,248,0.03)`, borderColor: `rgba(129,140,248,0.2)` }}>

          {/* Bet Amount */}
          <div>
            <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem" }}>
              Bet Amount (GZO)
            </div>
            <input
              type="number" min={0} step="1"
              value={stakeInput}
              onChange={(e) => setStakeInput(e.target.value)}
              disabled={controlsDisabled}
              style={{
                width: "100%", background: "#0d0d1a", border: "1px solid #2a2a50",
                borderRadius: "8px", padding: "0.5rem 0.6rem", color: "#f0f0ff",
                fontSize: "0.9375rem", fontWeight: 700, outline: "none",
                boxSizing: "border-box", opacity: controlsDisabled ? 0.5 : 1,
                cursor: controlsDisabled ? "not-allowed" : "text",
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", justifyItems: "center", marginTop: "0.5rem" }}>
              {CHIP_OPTIONS.map((chip) => (
                <CasinoChip
                  key={chip.value}
                  value={chip.value}
                  color={chip.color}
                  active={chipValue === chip.value && stakeInput === String(chip.value)}
                  onClick={() => { setChipValue(chip.value); setStakeInput(String(chip.value)); }}
                  disabled={controlsDisabled}
                />
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: "0.5rem 0.75rem", borderRadius: "6px",
              background: "rgba(255,77,77,0.1)", border: "1px solid rgba(255,77,77,0.3)",
              color: "#ff8080", fontSize: "0.8rem", animation: "fadeIn 0.2s ease",
            }}>
              {error}
            </div>
          )}

          {/* Deal button */}
          {gameStatus === "idle" && (
            <button
              onClick={handleStart}
              className="hilo-deal-btn"
              style={{
                width: "100%", padding: "0.75rem", borderRadius: "8px",
                border: `1px solid ${ACCENT}66`,
                background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
                color: "#0a0a18", fontWeight: 800, fontSize: "0.9375rem",
                cursor: "pointer",
              }}
            >
              Deal Card
            </button>
          )}

          {/* Cashout button */}
          {isActive && (
            <button
              onClick={handleCashout}
              disabled={!canCashout}
              style={{
                width: "100%", padding: "0.75rem", borderRadius: "8px",
                border: `1px solid ${canCashout ? "#00ff9d" : "#2a2a50"}`,
                background: canCashout ? "linear-gradient(135deg, #00ff9d, #00c87a)" : "#1a1a35",
                color: canCashout ? "#000" : "#555577",
                fontWeight: 800, fontSize: "0.9375rem",
                cursor: canCashout ? "pointer" : "not-allowed",
                transition: "all 0.15s",
              }}
            >
              {isSettling
                ? "Settling…"
                : canCashout
                ? `Cashout ${currentMult.toFixed(2)}×`
                : "Cashout"}
            </button>
          )}

          {/* Play again */}
          {isSettled && (
            <button
              onClick={handlePlayAgain}
              style={{
                width: "100%", padding: "0.75rem", borderRadius: "8px",
                border: `1px solid ${ACCENT}66`,
                background: `${ACCENT}18`, color: ACCENT,
                fontWeight: 800, fontSize: "0.9375rem", cursor: "pointer",
              }}
            >
              Play Again
            </button>
          )}

          {/* Guess Odds — shown when active */}
          {isActive && gameState && (
            <div style={{ borderTop: "1px solid rgba(129,140,248,0.15)", paddingTop: "0.75rem" }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
                Guess Odds
              </div>
              {[
                { label: "↑ Higher", mult: gameState.higherMultiplier, color: "#00d4ff" },
                { label: "= Same",   mult: gameState.sameMultiplier,   color: "#ffd700" },
                { label: "↓ Lower",  mult: gameState.lowerMultiplier,  color: "#ff9d00" },
              ].map(({ label, mult, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                  <span style={{ fontSize: "0.78rem", color: "#c0c0dd" }}>{label}</span>
                  <span style={{ fontSize: "0.82rem", fontWeight: 800, fontFamily: "monospace", color: mult === 0 ? "#555577" : color }}>
                    {mult === 0 ? "—" : `${mult}×`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── CENTER — Game Table ── */}
        <div className="card" style={{
          minHeight: 420, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: "1.5rem",
          background: `rgba(129,140,248,0.02)`, borderColor: `rgba(129,140,248,0.2)`,
          position: "relative",
        }}>

          {/* AtomLoader overlay */}
          {loadPhase && (
            <div style={{
              position: "absolute", inset: 0, borderRadius: "inherit",
              background: "rgba(10,10,24,0.88)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 20, backdropFilter: "blur(4px)",
            }}>
              <AtomLoader phase={loadPhase} />
            </div>
          )}

          {/* Idle state — casino floating cards */}
          {gameStatus === "idle" && !loadPhase && (
            <div style={{
              position: "relative", overflow: "hidden",
              width: "100%", minHeight: "280px",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: "1.25rem", padding: "2rem 1rem",
            }}>
              <div style={{ position: "absolute", top: "18%", left: "12%", width: 130, height: 130, borderRadius: "50%", background: `radial-gradient(circle, ${ACCENT}28 0%, transparent 70%)`, pointerEvents: "none" }} />
              <div style={{ position: "absolute", bottom: "14%", right: "10%", width: 110, height: 110, borderRadius: "50%", background: "radial-gradient(circle, #00d4ff1a 0%, transparent 70%)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", top: "48%", right: "18%", width: 85, height: 85, borderRadius: "50%", background: "radial-gradient(circle, #00ff9d14 0%, transparent 70%)", pointerEvents: "none" }} />

              <div style={{ position: "relative", width: "100%", height: "145px", flexShrink: 0 }}>
                {/* Floating demo cards */}
                {[
                  { cls: "hilo-float-0", style: { position: "absolute" as const, left: "6%", top: "8px" } },
                  { cls: "hilo-float-1", style: { position: "absolute" as const, left: "20%", top: "18px" } },
                  { cls: "hilo-float-2", style: { position: "absolute" as const, left: "50%", top: "0px" } },
                  { cls: "hilo-float-3", style: { position: "absolute" as const, right: "20%", top: "12px" } },
                  { cls: "hilo-float-4", style: { position: "absolute" as const, right: "6%", top: "6px" } },
                ].map((item, i) => (
                  <div key={i} className={item.cls} style={item.style}>
                    <PlayingCard card={hiloCardFromIndex(i * 13)} size="md" />
                  </div>
                ))}
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 800, color: ACCENT, marginBottom: "0.4rem" }}>
                  Higher · Lower · Same
                </div>
                <p style={{ fontSize: "0.8rem", color: "#8888aa", maxWidth: 300, lineHeight: 1.6, margin: 0 }}>
                  A Chainlink VRF deck is shuffled on-chain. Guess each card to compound your multiplier.
                  Cash out any time after one correct guess.
                </p>
              </div>
            </div>
          )}

          {/* VRF waiting state */}
          {isPendingVrf && !loadPhase && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "2rem" }}>
              <div style={{ width: 48, height: 48, border: `3px solid ${ACCENT}`, borderTopColor: "transparent",
                borderRadius: "50%", animation: "vrfSpin 0.9s linear infinite" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: ACCENT, marginBottom: "0.3rem" }}>{vrfText}</div>
                <p style={{ fontSize: "0.72rem", color: "#8888aa", maxWidth: 260, lineHeight: 1.6 }}>
                  Chainlink VRF is generating your provably fair deck on-chain. This typically takes 10–30 seconds.
                </p>
              </div>
            </div>
          )}

          {/* Active / Settled game */}
          {(isActive || isSettled || isSettling) && currentCard && (
            <>
              {/* Multiplier display */}
              <div style={{ textAlign: "center" }}>
                <div style={{
                  fontSize: "2.5rem", fontWeight: 900, fontFamily: "monospace",
                  color: isSettled ? resultColor : ACCENT,
                  textShadow: `0 0 20px ${isSettled ? resultColor : ACCENT}88`,
                  transition: "color 0.3s, text-shadow 0.3s",
                }}>
                  {currentMult.toFixed(2)}×
                </div>
                {isSettled && (
                  <div style={{ fontSize: "1rem", fontWeight: 700, color: resultColor, marginTop: "0.2rem" }}>
                    {isSettledWin ? "Cashed Out!" : "Busted!"}
                  </div>
                )}
                {isSettled && gameState?.netPayoutGzo != null && (
                  <div style={{ fontSize: "0.85rem", color: "#8888aa", marginTop: "0.1rem" }}>
                    {isSettledWin
                      ? `Payout: ${gameState.netPayoutGzo} GZO`
                      : `Lost: ${gameState.stakeGzo} GZO`}
                  </div>
                )}
              </div>

              {/* Card row */}
              <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                {guessHistory.length > 0 && (
                  <PlayingCard card={guessHistory[guessHistory.length - 1].cardBefore} size="md" />
                )}
                <PlayingCard
                  card={currentCard} size="lg" animationDelay={50}
                  highlight={isSettled ? (isSettledWin ? "win" : "loss") : "current"}
                />
                {isSettled && guessHistory.length > 0 && (
                  <PlayingCard
                    card={guessHistory[guessHistory.length - 1].cardAfter} size="md" animationDelay={100}
                    highlight={isSettledWin ? "win" : "loss"}
                  />
                )}
                {isActive && <PlayingCard faceDown size="md" />}
              </div>

              {/* Current card value */}
              <div style={{ fontSize: "0.85rem", color: "#8888aa" }}>
                Current card value: <strong style={{ color: "#f0f0ff" }}>{currentCard.value}</strong>
                {currentCard.value === 14 && <span style={{ color: ACCENT }}> (Ace — highest)</span>}
                {currentCard.value === 2  && <span style={{ color: ACCENT }}> (Two — lowest)</span>}
              </div>

              {/* Guess buttons */}
              {isActive && (
                <div style={{ display: "flex", gap: "0.75rem", animation: "slideUp 0.25s ease" }}>
                  {[
                    { label: "↑ Higher", guess: "higher" as const, color: "#00d4ff", mult: higherMult },
                    { label: "= Same",   guess: "same"   as const, color: "#ffd700", mult: sameMult },
                    { label: "↓ Lower",  guess: "lower"  as const, color: "#ff9d00", mult: lowerMult },
                  ].map(({ label, guess, color, mult }) => (
                    <button
                      key={guess}
                      onClick={() => handleGuess(guess)}
                      disabled={mult === 0}
                      style={{
                        padding: "0.75rem 1.25rem", borderRadius: "10px",
                        border: `2px solid ${mult === 0 ? "#2a2a50" : color}`,
                        background: mult === 0 ? "#0a0a18" : `${color}18`,
                        color: mult === 0 ? "#555577" : color,
                        fontWeight: 800, fontSize: "0.9rem",
                        cursor: mult === 0 ? "not-allowed" : "pointer",
                        transition: "all 0.15s",
                        display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem",
                        minWidth: "100px",
                      }}
                      onMouseEnter={(e) => {
                        if (mult > 0) {
                          (e.currentTarget as HTMLElement).style.background = `${color}30`;
                          (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = mult === 0 ? "#0a0a18" : `${color}18`;
                        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                      }}
                    >
                      <span>{label}</span>
                      <span style={{ fontSize: "0.75rem", fontFamily: "monospace", opacity: 0.8 }}>
                        {mult === 0 ? "—" : `${mult}×`}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Guess streak dots */}
              {guessHistory.length > 0 && (
                <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", justifyContent: "center" }}>
                  {guessHistory.map((h, i) => (
                    <div
                      key={i}
                      title={`${h.guess}: ${h.result}`}
                      style={{
                        width: 10, height: 10, borderRadius: "50%",
                        background: h.result === "win" ? "#00ff9d" : "#ff4d4d",
                        boxShadow: h.result === "win" ? "0 0 6px #00ff9d88" : "0 0 6px #ff4d4d88",
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Inline guess history */}
              {guessHistory.length > 0 && (
                <div style={{ width: "100%", borderTop: "1px solid rgba(42,42,80,0.4)", paddingTop: "0.5rem", maxHeight: 200, overflowY: "auto" }}>
                  {[...guessHistory].reverse().map((entry, i) => (
                    <HistoryRow key={i} entry={entry} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT — Info panel ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>

          {/* Quick Rules — idle/pending */}
          {(gameStatus === "idle" || isPendingVrf) && (
            <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
              <div style={{ fontSize: "0.72rem", color: "#555577", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>
                Quick Rules
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {[
                  ["Higher guess", "if next > current"],
                  ["Lower guess",  "if next < current"],
                  ["Same guess",   "if next = current"],
                  ["Ace",          "Highest (14)"],
                  ["Cashout",      "After 1+ correct"],
                  ["Max mult",     "10000×"],
                ].map(([rule, value]) => (
                  <div key={rule} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.73rem" }}>
                    <span style={{ color: "#8888aa" }}>{rule}</span>
                    <span style={{ color: "#f0f0ff", fontFamily: "monospace", fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Round Info — active/settled */}
          {(isActive || isSettled || isSettling) && gameState && (
            <div className="card" style={{ padding: "0.875rem", background: `rgba(129,140,248,0.03)`, borderColor: `rgba(129,140,248,0.2)` }}>
              <div style={{ fontSize: "0.72rem", color: ACCENT, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.6rem" }}>
                Round Info
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.72rem", color: "#8888aa" }}>
                <div>
                  <span style={{ color: "#555577" }}>On-chain ID: </span>
                  <span style={{ fontFamily: "monospace", color: "#ffd700" }} title={gameState.serverSeedHash ?? ""}>
                    {gameState.serverSeedHash ? gameState.serverSeedHash.slice(0, 14) + "…" : "—"}
                  </span>
                </div>
                <div>
                  <span style={{ color: "#555577" }}>Status: </span>
                  <span style={{ fontFamily: "monospace" }}>{gameState.status}</span>
                </div>
                <div>
                  <span style={{ color: "#555577" }}>Stake: </span>
                  <span style={{ fontFamily: "monospace" }}>{gameState.stakeGzo} GZO</span>
                </div>
                {isSettled && (
                  <div>
                    <span style={{ color: "#555577" }}>Result: </span>
                    <span style={{ fontFamily: "monospace", color: isSettledWin ? "#00ff9d" : "#ff4d4d", fontWeight: 700 }}>
                      {isSettledWin ? "Cashed Out" : "Busted"}
                    </span>
                  </div>
                )}
                {isSettled && gameState.netPayoutGzo != null && isSettledWin && (
                  <div>
                    <span style={{ color: "#555577" }}>Payout: </span>
                    <span style={{ fontFamily: "monospace", color: "#00ff9d" }}>{gameState.netPayoutGzo} GZO</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Provably Fair */}
          <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff",
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
              Provably Fair
            </div>
            {isSettled && gameState ? (
              <div style={{ fontSize: "0.7rem", color: "#8888aa", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <div><span style={{ color: "#555577" }}>Steps: </span>
                  <span style={{ fontFamily: "monospace", color: ACCENT, fontWeight: 700 }}>{guessHistory.length}</span></div>
                <div><span style={{ color: "#555577" }}>Multiplier: </span>
                  <span style={{ fontFamily: "monospace", color: isSettledWin ? "#00ff9d" : "#ff4d4d" }}>{currentMult.toFixed(2)}×</span></div>
                <p style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.25rem", lineHeight: 1.6 }}>
                  Deck generated on-chain by Chainlink VRF — fully verifiable, no server involvement.
                </p>
              </div>
            ) : isPendingVrf ? (
              <div style={{ fontSize: "0.7rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <div style={{ width: "10px", height: "10px", border: `2px solid ${ACCENT}`, borderTopColor: "transparent",
                  borderRadius: "50%", animation: "vrfSpin 0.8s linear infinite", flexShrink: 0 }} />
                Awaiting Chainlink VRF on-chain…
              </div>
            ) : (
              <div style={{ fontSize: "0.7rem", color: "#555577", lineHeight: 1.6 }}>
                Every game uses Chainlink VRF on Polygon to shuffle a 52-card deck on-chain — tamper-proof randomness no one can predict or manipulate.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── How to Play ── */}
      <div className="card" style={{ background: "rgba(0,212,255,0.03)", borderColor: "rgba(0,212,255,0.2)", marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: "#00d4ff",
          display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiTarget size={16} color="#00d4ff" /> How to Play
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem" }}>
          {[
            { step: "1", icon: <SiWallet size={14} color="#00d4ff" />, title: "Connect & Fund",       desc: "Log in and make sure your custodial GZO balance is funded. No wallet approval needed — funds come from your account balance." },
            { step: "2", icon: <SiChip size={14} color="#00d4ff" />, title: "Pick a Chip",           desc: "Choose your bet size — 10, 50, 100, or 500 GZO chips, or type a custom amount." },
            { step: "3", icon: <SiCard size={14} color="#00d4ff" />, title: "Deal a Card",           desc: "Click Deal Card. Chainlink VRF generates a provably fair shuffled deck on-chain." },
            { step: "4", icon: <SiArrowUpDown size={14} color="#00d4ff" />, title: "Make Your Guess", desc: "Predict whether the next card is Higher, Lower, or the Same value as the current one." },
            { step: "5", icon: <SiTrendingUp size={14} color="#00d4ff" />, title: "Build Multiplier", desc: "Each correct guess compounds your multiplier. The riskier the guess, the higher the reward." },
            { step: "6", icon: <SiCashOut size={14} color="#00d4ff" />, title: "Cash Out or Bust",   desc: "Cash out any time after 1+ correct guess to lock winnings, or keep going for a bigger payout." },
          ].map(item => (
            <div key={item.step} style={{ background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.12)",
              borderRadius: "10px", padding: "0.875rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%",
                background: "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.7rem", fontWeight: 800, color: "#00d4ff" }}>
                {item.step}
              </div>
              <div>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f0f0ff", marginBottom: "0.2rem" }}>
                  {item.icon} {item.title}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Play Another Game ── */}
      <OtherGames exclude="hilo" />

      {/* ── How It Works ── */}
      <div className="card" style={{ background: `rgba(129,140,248,0.02)`, borderColor: `rgba(129,140,248,0.15)`, marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT,
          display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiGear size={16} color={ACCENT} /> How It Works
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem" }}>
          {[
            { icon: <SiWallet size={20} color={ACCENT} />, title: "Custodial Balance",        desc: "Your GZO stake is debited from your secure custodial balance when you start a round — no gas fees, no wallet popups required." },
            { icon: <SiDice size={20} color={ACCENT} />, title: "Chainlink VRF Deck Shuffle", desc: "The HiloGame contract requests Chainlink VRF randomness. The returned seed is stored on-chain and used to shuffle all 52 cards — fully deterministic and auditable." },
            { icon: <SiShuffle size={20} color={ACCENT} />, title: "Fisher-Yates Algorithm",  desc: "The VRF seed is expanded via keccak256 to produce a full Fisher-Yates shuffle. Both the smart contract and the UI compute identical card sequences from the same seed." },
            { icon: <SiShieldCheck size={20} color={ACCENT} />, title: "On-Chain Settlement",  desc: "On cashout or loss, the contract re-derives the deck, replays all guesses, recomputes the multiplier, and settles. The contract is the sole financial authority." },
          ].map(item => (
            <div key={item.title} style={{ background: `rgba(129,140,248,0.03)`, border: `1px solid rgba(129,140,248,0.1)`,
              borderRadius: "10px", padding: "0.875rem" }}>
              <div style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>{item.icon}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: ACCENT, marginBottom: "0.3rem" }}>{item.title}</div>
              <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Your History ── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.875rem", color: "#8888aa" }}>Your History</h2>
        <BetHistory game="HILO" refreshTrigger={historyTick} />
      </div>
    </div>
  );
}
