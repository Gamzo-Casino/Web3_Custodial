"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import OtherGames from "@/components/OtherGames";
import BetHistory from "@/components/BetHistory";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import {
  SiTarget, SiGear, SiWallet, SiChip,
  SiDealCards, SiHand, SiSplit, SiCheckCircle,
  SiLock, SiShieldCheck, SiBarChart, SiZap,
} from "@/components/GameIcons";
import {
  Card,
  RANK_LABELS,
  SUIT_SYMBOLS,
  handValue,
  isBust,
  cardFromIndex,
  canSplitHand,
  type HandOutcome,
  type BlackjackGameState,
} from "@/lib/blackjack";

// ─── Card Visual ──────────────────────────────────────────────────────────────

function PlayingCard({
  card,
  faceDown = false,
  isNew = false,
  glow,
}: {
  card?: Card;
  faceDown?: boolean;
  isNew?: boolean;
  glow?: "win" | "lose" | "push";
}) {
  const glowColor =
    glow === "win"  ? "rgba(0,255,157,0.6)" :
    glow === "lose" ? "rgba(255,77,77,0.6)" :
    glow === "push" ? "rgba(20,184,166,0.5)" : undefined;

  if (faceDown || !card) {
    return (
      <div style={{
        width: 56, height: 80, borderRadius: 6, flexShrink: 0,
        background: "linear-gradient(135deg, #0d0d2e 0%, #1a1a50 100%)",
        border: "2px solid #2a2a60",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 3px 10px rgba(0,0,0,0.5)",
        animation: isNew ? "dealCard 0.3s ease-out" : undefined,
      }}>
        <div style={{
          width: 40, height: 64, borderRadius: 4,
          background: "repeating-linear-gradient(45deg, #1a1a40, #1a1a40 3px, #14143a 3px, #14143a 6px)",
          border: "1px solid #2a2a50",
        }} />
      </div>
    );
  }

  const isRed = card.suit === 1 || card.suit === 2;
  const color = isRed ? "#e53e3e" : "#111";
  const rank = RANK_LABELS[card.rank];
  const suit = SUIT_SYMBOLS[card.suit];

  return (
    <div style={{
      width: 56, height: 80, borderRadius: 6, flexShrink: 0,
      background: "white",
      border: "2px solid #e2e8f0",
      padding: "3px 4px",
      display: "flex", flexDirection: "column",
      boxShadow: glowColor
        ? `0 3px 10px rgba(0,0,0,0.4), 0 0 12px ${glowColor}`
        : "0 3px 10px rgba(0,0,0,0.4)",
      animation: isNew ? "dealCard 0.35s cubic-bezier(0.34,1.56,0.64,1)" : undefined,
      position: "relative",
      transition: "box-shadow 0.3s",
    }}>
      <div style={{ color, fontSize: "0.62rem", fontWeight: 800, lineHeight: 1.1, fontFamily: "monospace" }}>
        {rank}<br />{suit}
      </div>
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color, fontSize: "1.3rem", lineHeight: 1,
      }}>
        {suit}
      </div>
      <div style={{
        color, fontSize: "0.62rem", fontWeight: 800, lineHeight: 1.1,
        fontFamily: "monospace", alignSelf: "flex-end",
        transform: "rotate(180deg)",
      }}>
        {rank}<br />{suit}
      </div>
    </div>
  );
}

// ─── Hand Display ─────────────────────────────────────────────────────────────

function HandDisplay({
  cards,
  holeCard,
  label,
  total,
  outcome,
  isActive = false,
}: {
  cards: Card[];
  holeCard?: boolean;
  label: string;
  total?: number;
  outcome?: HandOutcome | null;
  isActive?: boolean;
}) {
  const outcomeColor =
    outcome === "BLACKJACK" ? "#14b8a6" :
    outcome === "WIN"       ? "#00ff9d" :
    outcome === "PUSH"      ? "#aaaaff" :
    outcome === "LOSS"      ? "#ff6060" : "#f0f0ff";

  const outcomeBg =
    outcome === "BLACKJACK" ? "rgba(20,184,166,0.15)" :
    outcome === "WIN"       ? "rgba(0,255,157,0.1)"  :
    outcome === "PUSH"      ? "rgba(170,170,255,0.1)" :
    outcome === "LOSS"      ? "rgba(255,96,96,0.1)"  : undefined;

  const outcomeLabel =
    outcome === "BLACKJACK" ? "Blackjack!" :
    outcome === "WIN"       ? "Win" :
    outcome === "PUSH"      ? "Push" :
    outcome === "LOSS"      ? "Loss" : outcome;

  const totalBust = total !== undefined && total > 21;

  return (
    <div style={{
      padding: "0.75rem 1rem",
      borderRadius: 10,
      border: isActive ? "1px solid rgba(0,212,255,0.4)" : "1px solid rgba(255,255,255,0.06)",
      background: isActive ? "rgba(0,212,255,0.04)" : "transparent",
      transition: "border 0.2s, background 0.2s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {label}
        </span>
        {total !== undefined && (
          <span style={{
            fontSize: "0.8rem", fontWeight: 800,
            color: totalBust ? "#ff6060" : "#f0f0ff",
            background: totalBust ? "rgba(255,96,96,0.12)" : "rgba(255,255,255,0.06)",
            padding: "0.1rem 0.45rem", borderRadius: 6,
          }}>
            {totalBust ? "BUST" : total}
          </span>
        )}
        {outcome && (
          <span style={{
            fontSize: "0.72rem", fontWeight: 800, color: outcomeColor,
            background: outcomeBg, padding: "0.1rem 0.5rem", borderRadius: 6,
          }}>
            {outcomeLabel}
          </span>
        )}
        {isActive && !outcome && (
          <span style={{ fontSize: "0.65rem", color: "#00d4ff", fontWeight: 600 }}>← Active</span>
        )}
      </div>
      <div className="bj-cards-row" style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
        {cards.map((c, i) => {
          const glowType =
            outcome === "BLACKJACK" || outcome === "WIN" ? "win" :
            outcome === "LOSS" ? "lose" :
            outcome === "PUSH" ? "push" : undefined;
          return <PlayingCard key={i} card={c} isNew={false} glow={glowType} />;
        })}
        {holeCard && <PlayingCard faceDown />}
      </div>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type GameStatus = "idle" | "dealing" | "pending_vrf" | "active" | "settling" | "settled";

const VRF_TEXTS = [
  "Requesting randomness from Chainlink VRF…",
  "Waiting for on-chain confirmation…",
  "Generating verifiable random deck seed…",
  "Almost there — VRF oracle responding…",
  "Finalising deck commitment on-chain…",
];

// ─── Chip Options ─────────────────────────────────────────────────────────────

const CHIP_OPTIONS = [
  { value: 10,  color: "#00d4ff" },
  { value: 50,  color: "#00ff9d" },
  { value: 100, color: "#e879f9" },
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
        width: "100%", height: "100%", borderRadius: "50%",
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

// ─── AtomLoader ───────────────────────────────────────────────────────────────

function AtomLoader({ title, detail }: { title: string; detail: string }) {
  const colors: [string, string, string] = ["#14b8a6", "#00d4ff", "#00ff9d"];
  const [c0, c1, c2] = colors;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "2rem 1rem" }}>
      <div className="atom-wrap" style={{ position: "relative", width: "130px", height: "130px" }}>
        <div className="nucleus" style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: "20px", height: "20px", borderRadius: "50%",
          background: `radial-gradient(circle, white 0%, ${c0} 70%)`,
          boxShadow: `0 0 6px white, 0 0 18px ${c0}, 0 0 36px ${c0}88`,
        }} />
        <div className="orbit-0" style={{
          position: "absolute", top: "50%", left: "50%",
          width: "120px", height: "50px",
          marginTop: "-25px", marginLeft: "-60px",
          border: `1.5px solid ${c0}60`, borderRadius: "50%",
        }}>
          <div style={{
            position: "absolute", top: "-5px", left: "calc(50% - 5px)",
            width: "10px", height: "10px", borderRadius: "50%",
            background: c0, boxShadow: `0 0 8px ${c0}, 0 0 16px ${c0}99`,
          }} />
        </div>
        <div className="orbit-1" style={{
          position: "absolute", top: "50%", left: "50%",
          width: "100px", height: "100px",
          marginTop: "-50px", marginLeft: "-50px",
          border: `1.5px solid ${c1}50`, borderRadius: "50%",
        }}>
          <div style={{
            position: "absolute", top: "-5px", left: "calc(50% - 5px)",
            width: "10px", height: "10px", borderRadius: "50%",
            background: c1, boxShadow: `0 0 8px ${c1}, 0 0 16px ${c1}99`,
          }} />
        </div>
        <div className="orbit-2" style={{
          position: "absolute", top: "50%", left: "50%",
          width: "120px", height: "50px",
          marginTop: "-25px", marginLeft: "-60px",
          border: `1.5px solid ${c2}40`, borderRadius: "50%",
        }}>
          <div style={{
            position: "absolute", top: "-5px", left: "calc(50% - 5px)",
            width: "10px", height: "10px", borderRadius: "50%",
            background: c2, boxShadow: `0 0 8px ${c2}, 0 0 16px ${c2}99`,
          }} />
        </div>
      </div>
      <div style={{ textAlign: "center", maxWidth: "280px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}` }} />
          <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f0f0ff", letterSpacing: "0.01em" }}>{title}</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#8888aa", lineHeight: 1.6, margin: 0 }}>{detail}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem", marginTop: "0.875rem" }}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`prog-dot prog-dot-${i}`} style={{
              width: "6px", height: "6px", borderRadius: "50%",
              background: c0, opacity: 0.3,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BlackjackPage() {
  return <BlackjackGame />;
}

function BlackjackGame() {
  const { balance, refetch: refetchBalance } = useDBBalance();

  const [stakeInput, setStakeInput] = useState("100");
  const [chipValue, setChipValue]   = useState(100);
  const [gameStatus, setGameStatus] = useState<GameStatus>("idle");
  const [gameState, setGameState]   = useState<BlackjackGameState | null>(null);
  const [roundId, setRoundId]       = useState<string | null>(null);
  const [error, setError]           = useState("");
  const [historyTick, setHistoryTick] = useState(0);
  const [vrfTextIdx, setVrfTextIdx]  = useState(0);
  const [actionBusy, setActionBusy]  = useState(false);

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const vrfTextRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── VRF text cycling ──────────────────────────────────────────────────────
  useEffect(() => {
    if (gameStatus === "pending_vrf") {
      setVrfTextIdx(0);
      vrfTextRef.current = setInterval(() => {
        setVrfTextIdx(i => (i + 1) % VRF_TEXTS.length);
      }, 4000);
    } else {
      if (vrfTextRef.current) {
        clearInterval(vrfTextRef.current);
        vrfTextRef.current = null;
      }
    }
    return () => {
      if (vrfTextRef.current) clearInterval(vrfTextRef.current);
    };
  }, [gameStatus]);

  // ── VRF polling ───────────────────────────────────────────────────────────
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPoll = useCallback((rId: string) => {
    stopPoll();
    const deadline = Date.now() + 8 * 60 * 1000; // 8 min timeout

    pollRef.current = setInterval(async () => {
      if (Date.now() > deadline) {
        stopPoll();
        setError("VRF timed out. Your stake has been refunded.");
        setGameStatus("idle");
        return;
      }
      try {
        const res = await fetch(`/api/games/blackjack/status?roundId=${rId}`);
        const data = await res.json();
        if (data.status === "active" && data.gameState) {
          stopPoll();
          setGameState(data.gameState);
          setGameStatus("active");
          refetchBalance();
        } else if (data.status === "settled") {
          stopPoll();
          setGameState(data.gameState);
          setGameStatus("settled");
          refetchBalance();
          setHistoryTick(t => t + 1);
        }
        // else pending_vrf — keep polling
      } catch {
        // network error, keep retrying
      }
    }, 3000);
  }, [stopPoll, refetchBalance]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  // ── Resume on mount ───────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/games/blackjack/current");
        const data = await res.json();
        if (data.round) {
          setGameState(data.round);
          setRoundId(data.onchainRoundId ?? null);
          setGameStatus("active");
        } else if (data.pending?.roundId) {
          setRoundId(data.pending.roundId);
          setGameStatus("pending_vrf");
          startPoll(data.pending.roundId);
        }
      } catch {
        // no active session
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deal / Start ──────────────────────────────────────────────────────────
  async function handleDeal() {
    const stake = parseInt(stakeInput, 10);
    if (!stake || stake < 1) { setError("Invalid stake"); return; }
    setError("");
    setGameStatus("dealing");

    try {
      const res = await fetch("/api/games/blackjack/start", {
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
      setRoundId(data.roundId);
      setGameStatus("pending_vrf");
      refetchBalance();
      startPoll(data.roundId);
    } catch {
      setError("Network error. Please try again.");
      setGameStatus("idle");
    }
  }

  // ── Generic action helper ─────────────────────────────────────────────────
  async function doAction(endpoint: string, body?: Record<string, unknown>) {
    if (actionBusy) return;
    setActionBusy(true);
    setError("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }
      // data has BlackjackGameState fields merged in
      setGameState({
        roundId:        data.roundId,
        status:         data.status,
        activeHand:     data.activeHand,
        playerCards:    data.playerCards,
        splitCards:     data.splitCards,
        dealerUpCard:   data.dealerUpCard,
        dealerCards:    data.dealerCards,
        playerTotal:    data.playerTotal,
        splitTotal:     data.splitTotal,
        dealerTotal:    data.dealerTotal,
        mainOutcome:    data.mainOutcome,
        splitOutcome:   data.splitOutcome,
        mainStakeGzo:   data.mainStakeGzo,
        splitStakeGzo:  data.splitStakeGzo,
        mainDoubled:    data.mainDoubled,
        splitDoubled:   data.splitDoubled,
        grossPayoutGzo: data.grossPayoutGzo,
        profitGzo:      data.profitGzo,
        feeGzo:         data.feeGzo,
        netPayoutGzo:   data.netPayoutGzo,
        balanceAfter:   data.balanceAfter,
        serverSeedHash: data.serverSeedHash,
        serverSeed:     data.serverSeed,
        clientSeed:     data.clientSeed,
        nonce:          data.nonce,
        publicSeed:     data.publicSeed,
        canHit:         data.canHit,
        canStand:       data.canStand,
        canDouble:      data.canDouble,
        canSplit:       data.canSplit,
      } as BlackjackGameState);

      if (data.gameOver) {
        await doSettle();
      }
    } finally {
      setActionBusy(false);
    }
  }

  // ── Settle ────────────────────────────────────────────────────────────────
  async function doSettle() {
    setGameStatus("settling");
    try {
      const res = await fetch("/api/games/blackjack/settle", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Settlement failed");
        setGameStatus("active");
        return;
      }
      setGameState({
        roundId:        data.roundId,
        status:         data.status,
        activeHand:     data.activeHand,
        playerCards:    data.playerCards,
        splitCards:     data.splitCards,
        dealerUpCard:   data.dealerUpCard,
        dealerCards:    data.dealerCards,
        playerTotal:    data.playerTotal,
        splitTotal:     data.splitTotal,
        dealerTotal:    data.dealerTotal,
        mainOutcome:    data.mainOutcome,
        splitOutcome:   data.splitOutcome,
        mainStakeGzo:   data.mainStakeGzo,
        splitStakeGzo:  data.splitStakeGzo,
        mainDoubled:    data.mainDoubled,
        splitDoubled:   data.splitDoubled,
        grossPayoutGzo: data.grossPayoutGzo,
        profitGzo:      data.profitGzo,
        feeGzo:         data.feeGzo,
        netPayoutGzo:   data.netPayoutGzo,
        balanceAfter:   data.balanceAfter,
        serverSeedHash: data.serverSeedHash,
        serverSeed:     data.serverSeed,
        clientSeed:     data.clientSeed,
        nonce:          data.nonce,
        publicSeed:     data.publicSeed,
        canHit:         false,
        canStand:       false,
        canDouble:      false,
        canSplit:       false,
      } as BlackjackGameState);
      setGameStatus("settled");
      refetchBalance();
      setHistoryTick(t => t + 1);
    } catch {
      setError("Settlement network error");
      setGameStatus("active");
    }
  }

  function handleHit()    { doAction("/api/games/blackjack/hit");    }
  function handleStand()  { doAction("/api/games/blackjack/stand");  }
  function handleDouble() { doAction("/api/games/blackjack/double"); }
  function handleSplit()  { doAction("/api/games/blackjack/split");  }

  function handleNewHand() {
    setGameState(null);
    setRoundId(null);
    setGameStatus("idle");
    setError("");
    setActionBusy(false);
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const isActive  = gameStatus === "active";
  const isSettled = gameStatus === "settled";
  const isLoading = gameStatus === "dealing" || gameStatus === "pending_vrf";
  const isActionLoading = gameStatus === "settling" || actionBusy;

  const playerCards = gameState?.playerCards ?? [];
  const splitCards  = gameState?.splitCards ?? null;
  const activeHand  = gameState?.activeHand ?? 0;
  const mainDoubled = gameState?.mainDoubled ?? false;
  const didSplit    = Boolean(splitCards && splitCards.length > 0);

  const canHit    = isActive && (gameState?.canHit  ?? false) && !isActionLoading;
  const canStand  = isActive && (gameState?.canStand ?? false) && !isActionLoading;
  const canDouble = isActive && (gameState?.canDouble ?? false) && !isActionLoading;
  const canSplit  = isActive && (gameState?.canSplit  ?? false) && !isActionLoading;

  const playerTotal = playerCards.length > 0 ? handValue(playerCards) : undefined;
  const splitTotal  = splitCards && splitCards.length > 0 ? handValue(splitCards) : undefined;
  const dealerShowCards = isSettled && gameState?.dealerCards
    ? gameState.dealerCards
    : gameState?.dealerUpCard
    ? [gameState.dealerUpCard]
    : [];
  const dealerTotal = gameState?.dealerTotal ?? undefined;

  const mainOutcome  = gameState?.mainOutcome  ?? null;
  const splitOutcome = gameState?.splitOutcome ?? null;
  const netPayoutGzo = gameState?.netPayoutGzo ?? null;
  const stakeEth     = gameState?.mainStakeGzo ?? parseFloat(stakeInput);
  const netPL = netPayoutGzo !== null
    ? netPayoutGzo - stakeEth * (didSplit ? 2 : 1)
    : null;

  const controlsDisabled = isActive || isLoading || isActionLoading;

  return (
    <>
      <style>{`
        @keyframes dealCard {
          from { transform: translateY(-30px) scale(0.85); opacity: 0; }
          to   { transform: translateY(0)     scale(1);    opacity: 1; }
        }
        @keyframes bjFloat0 { 0%,100%{ transform: rotate(-18deg) translateY(0px); } 50%{ transform: rotate(-18deg) translateY(-8px); } }
        @keyframes bjFloat1 { 0%,100%{ transform: rotate(-7deg) translateY(0px); }  50%{ transform: rotate(-7deg) translateY(-10px); } }
        @keyframes bjFloat2 { 0%,100%{ transform: translateX(-50%) rotate(3deg) translateY(0px); } 50%{ transform: translateX(-50%) rotate(3deg) translateY(-12px); } }
        @keyframes bjFloat3 { 0%,100%{ transform: rotate(8deg) translateY(0px); }   50%{ transform: rotate(8deg) translateY(-9px); } }
        @keyframes bjFloat4 { 0%,100%{ transform: rotate(20deg) translateY(0px); }  50%{ transform: rotate(20deg) translateY(-7px); } }
        .bj-card-float-0 { animation: bjFloat0 3.2s ease-in-out infinite; }
        .bj-card-float-1 { animation: bjFloat1 2.8s ease-in-out infinite 0.4s; }
        .bj-card-float-2 { animation: bjFloat2 3.5s ease-in-out infinite 0.2s; }
        .bj-card-float-3 { animation: bjFloat3 2.9s ease-in-out infinite 0.6s; }
        .bj-card-float-4 { animation: bjFloat4 3.1s ease-in-out infinite 0.8s; }
        @keyframes resultPulse {
          0%   { opacity: 0; transform: scale(0.88); }
          50%  { opacity: 1; transform: scale(1.04); }
          100% { transform: scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes nucleusPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.25)} }
        @keyframes orbitSpin0 { from{transform:rotateZ(0deg) rotateX(15deg)} to{transform:rotateZ(360deg) rotateX(15deg)} }
        @keyframes orbitSpin1 { from{transform:rotateZ(0deg) rotateX(75deg) rotateZ(60deg)} to{transform:rotateZ(360deg) rotateX(75deg) rotateZ(60deg)} }
        @keyframes orbitSpin2 { from{transform:rotateZ(120deg) rotateX(45deg) rotateZ(0deg)} to{transform:rotateZ(120deg) rotateX(45deg) rotateZ(360deg)} }
        @keyframes progDot { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
        .atom-wrap { perspective: 400px; }
        .nucleus { animation: nucleusPulse 1.8s ease-in-out infinite; }
        .orbit-0 { animation: orbitSpin0 2.2s linear infinite; }
        .orbit-1 { animation: orbitSpin1 1.7s linear infinite; }
        .orbit-2 { animation: orbitSpin2 3.1s linear infinite; }
        .prog-dot-0 { animation: progDot 1.4s ease-in-out 0s infinite; }
        .prog-dot-1 { animation: progDot 1.4s ease-in-out 0.2s infinite; }
        .prog-dot-2 { animation: progDot 1.4s ease-in-out 0.4s infinite; }
      `}</style>

      <div style={{ maxWidth: 1260, margin: "0 auto", padding: "1.5rem 1rem" }}>
        {/* Header */}
        <div style={{ marginBottom: "1.5rem" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 800, margin: 0 }}>
            <span style={{ background: "linear-gradient(135deg,#14b8a6,#0d9488)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Blackjack
            </span>
          </h1>
          <p style={{ color: "#8888aa", fontSize: "0.875rem", marginTop: "0.25rem" }}>
            European Blackjack · Dealer stands on 17 · Blackjack pays 3:2 · Split &amp; Double supported · Chainlink VRF
          </p>
          <p style={{ color: "#555577", fontSize: "0.75rem", marginTop: "0.25rem" }}>
            Balance: <span style={{ color: "#00ff9d", fontWeight: 700 }}>{balance.toLocaleString()} GZO</span>
            <span style={{ marginLeft: 8, color: "#3a3a5a", fontSize: "0.68rem" }}>Custodial</span>
          </p>
        </div>

        {/* 3-column grid */}
        <div className="game-3col" style={{ alignItems: "flex-start" }}>

          {/* ── Left panel: bet controls ── */}
          <div>
            <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "0.8rem", fontWeight: 700, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 1rem" }}>
                Place Bet
              </h3>

              {/* Chip selector */}
              <div style={{ marginBottom: "0.875rem" }}>
                <div style={{ fontSize: "0.72rem", color: "#555577", marginBottom: "0.5rem", fontWeight: 600 }}>Chip Value</div>
                <div className="chip-row">
                  {CHIP_OPTIONS.map(({ value, color }) => (
                    <CasinoChip
                      key={value}
                      value={value}
                      color={color}
                      active={chipValue === value}
                      onClick={() => setChipValue(value)}
                      disabled={controlsDisabled}
                    />
                  ))}
                </div>
              </div>

              {/* Stake input */}
              <div style={{ marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.72rem", color: "#555577", marginBottom: "0.4rem", fontWeight: 600 }}>Bet Amount (GZO)</div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <input
                    type="number" min={1} step="1" value={stakeInput}
                    onChange={e => setStakeInput(e.target.value)}
                    disabled={controlsDisabled}
                    style={{
                      flex: 1, background: "#0d0d1a", border: "1px solid #2a2a50", borderRadius: 8,
                      padding: "0.5rem 0.625rem", color: "#f0f0ff", fontSize: "0.875rem",
                      fontFamily: "monospace", outline: "none",
                      opacity: controlsDisabled ? 0.5 : 1,
                    }}
                  />
                  <button
                    onClick={() => setStakeInput(s => String(Math.max(1, parseInt(s || "0") - chipValue)))}
                    disabled={controlsDisabled}
                    style={{ padding: "0.5rem 0.625rem", borderRadius: 8, border: "1px solid #2a2a50", background: "transparent", color: "#8888aa", cursor: "pointer", fontSize: "0.9rem", opacity: controlsDisabled ? 0.4 : 1 }}>
                    −
                  </button>
                  <button
                    onClick={() => setStakeInput(s => String(parseInt(s || "0") + chipValue))}
                    disabled={controlsDisabled}
                    style={{ padding: "0.5rem 0.625rem", borderRadius: 8, border: "1px solid #2a2a50", background: "transparent", color: "#8888aa", cursor: "pointer", fontSize: "0.9rem", opacity: controlsDisabled ? 0.4 : 1 }}>
                    +
                  </button>
                </div>
              </div>

              {/* Status text */}
              {gameStatus === "dealing" && (
                <div style={{ fontSize: "0.78rem", color: "#00d4ff", marginBottom: "0.75rem", textAlign: "center" }}>
                  Starting round on-chain…
                </div>
              )}
              {gameStatus === "settling" && (
                <div style={{ fontSize: "0.78rem", color: "#14b8a6", marginBottom: "0.75rem", textAlign: "center" }}>
                  Settling hand on-chain…
                </div>
              )}
              {actionBusy && gameStatus === "active" && (
                <div style={{ fontSize: "0.78rem", color: "#8888aa", marginBottom: "0.75rem", textAlign: "center" }}>
                  Processing…
                </div>
              )}

              {/* Deal / New Hand button */}
              {!isActive && gameStatus !== "pending_vrf" && gameStatus !== "settling" && (
                <button
                  onClick={isSettled ? handleNewHand : handleDeal}
                  disabled={gameStatus === "dealing"}
                  className="btn-primary"
                  style={{ width: "100%", padding: "0.625rem", fontSize: "0.9rem", fontWeight: 700, opacity: gameStatus === "dealing" ? 0.6 : 1 }}
                >
                  {gameStatus === "dealing" ? "Starting…" : isSettled ? "New Hand" : "Deal Cards"}
                </button>
              )}

              {gameStatus === "pending_vrf" && (
                <div style={{ padding: "0.75rem", textAlign: "center", color: "#14b8a6", fontSize: "0.875rem", fontWeight: 600 }}>
                  Waiting for VRF…
                </div>
              )}

              {/* Error */}
              {error && (
                <div style={{
                  marginTop: "0.75rem", padding: "0.5rem 0.75rem", borderRadius: 8,
                  background: "rgba(255,77,77,0.1)", border: "1px solid rgba(255,77,77,0.3)",
                  color: "#ff6060", fontSize: "0.75rem", lineHeight: 1.5,
                }}>
                  {error}
                </div>
              )}
            </div>

            {/* Game info */}
            <div className="card" style={{ padding: "1rem", fontSize: "0.72rem", color: "#555577", lineHeight: 2 }}>
              <div style={{ color: "#8888aa", fontWeight: 700, marginBottom: "0.5rem", fontSize: "0.75rem" }}>Rules</div>
              <div>Blackjack pays <span style={{ color: "#14b8a6", fontWeight: 700 }}>3:2</span></div>
              <div>Win pays <span style={{ color: "#14b8a6", fontWeight: 700 }}>1:1</span></div>
              <div>Push returns stake</div>
              <div>Dealer hits on &lt;17</div>
              <div style={{ marginTop: "0.5rem", color: "#3a3a5a", fontSize: "0.68rem" }}>
                Deck shuffled by Chainlink VRF<br />
                On-chain settlement verification
              </div>
            </div>
          </div>

          {/* ── Centre: game table ── */}
          <div>
            <div className="card" style={{ padding: "1.5rem", minHeight: "460px", position: "relative" }}>

              {/* Idle state — decorative cards */}
              {gameStatus === "idle" && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "380px", gap: "1.5rem" }}>
                  <div style={{ position: "relative", width: "200px", height: "120px", marginBottom: "0.5rem" }}>
                    {[
                      { style: { left: 0, top: 15, transform: "rotate(-18deg)" }, className: "bj-card-float-0" },
                      { style: { left: 30, top: 5, transform: "rotate(-7deg)" }, className: "bj-card-float-1" },
                      { style: { left: "50%", top: 0, transform: "translateX(-50%) rotate(3deg)" }, className: "bj-card-float-2" },
                      { style: { right: 30, top: 5, transform: "rotate(8deg)" }, className: "bj-card-float-3" },
                      { style: { right: 0, top: 15, transform: "rotate(20deg)" }, className: "bj-card-float-4" },
                    ].map(({ style, className }, i) => (
                      <div key={i} className={className} style={{ position: "absolute", ...style }}>
                        <PlayingCard card={cardFromIndex([12, 0, 11, 23, 35][i])} />
                      </div>
                    ))}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ color: "#f0f0ff", fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.4rem" }}>
                      Set your bet and deal to start
                    </div>
                    <div style={{ color: "#555577", fontSize: "0.8rem" }}>
                      Chainlink VRF generates a tamper-proof deck on-chain
                    </div>
                  </div>
                </div>
              )}

              {/* VRF pending loader */}
              {gameStatus === "pending_vrf" && (
                <AtomLoader
                  title="Awaiting Chainlink VRF"
                  detail={VRF_TEXTS[vrfTextIdx]}
                />
              )}

              {/* Dealing loader */}
              {gameStatus === "dealing" && (
                <AtomLoader
                  title="Broadcasting Transaction"
                  detail="Sending your bet on-chain. Awaiting confirmation…"
                />
              )}

              {/* Settling loader */}
              {gameStatus === "settling" && (
                <AtomLoader
                  title="Settling Hand On-Chain"
                  detail="Contract verifying your cards and computing payout…"
                />
              )}

              {/* Active / Settled game table */}
              {(isActive || isSettled) && gameState && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {/* Dealer hand */}
                  <HandDisplay
                    cards={dealerShowCards}
                    holeCard={!isSettled && dealerShowCards.length === 1}
                    label="Dealer"
                    total={isSettled ? dealerTotal : undefined}
                  />

                  {/* Player hands */}
                  <HandDisplay
                    cards={playerCards}
                    label={didSplit ? "Your Hand (Main)" : "Your Hand"}
                    total={playerTotal}
                    outcome={isSettled ? mainOutcome : undefined}
                    isActive={isActive && activeHand === 0}
                  />

                  {splitCards && splitCards.length > 0 && (
                    <HandDisplay
                      cards={splitCards}
                      label="Your Hand (Split)"
                      total={splitTotal}
                      outcome={isSettled ? splitOutcome : undefined}
                      isActive={isActive && activeHand === 1}
                    />
                  )}

                  {/* Settlement result */}
                  {isSettled && (
                    <div style={{
                      padding: "1rem 1.25rem", borderRadius: 10,
                      background: mainOutcome === "BLACKJACK" || mainOutcome === "WIN"
                        ? "rgba(0,255,157,0.08)" : mainOutcome === "PUSH"
                        ? "rgba(170,170,255,0.08)" : "rgba(255,96,96,0.08)",
                      border: `1px solid ${mainOutcome === "BLACKJACK" || mainOutcome === "WIN"
                        ? "rgba(0,255,157,0.25)" : mainOutcome === "PUSH"
                        ? "rgba(170,170,255,0.25)" : "rgba(255,96,96,0.2)"}`,
                      animation: "resultPulse 0.6s ease-out forwards",
                    }}>
                      <div style={{ fontSize: "1rem", fontWeight: 800, color: "#f0f0ff", marginBottom: "0.5rem" }}>
                        {mainOutcome === "BLACKJACK" ? "🎰 Blackjack!" :
                         mainOutcome === "WIN"       ? "You Win!" :
                         mainOutcome === "PUSH"      ? "Push — Stake Returned" :
                         "Dealer Wins"}
                      </div>
                      {netPayoutGzo !== null && (
                        <div style={{ fontSize: "0.8rem", color: "#8888aa" }}>
                          Net payout: <span style={{ color: "#00ff9d", fontWeight: 700 }}>{netPayoutGzo.toLocaleString()} GZO</span>
                          {netPL !== null && netPL !== 0 && (
                            <span style={{ marginLeft: 8, color: netPL > 0 ? "#00ff9d" : "#ff6060", fontWeight: 700 }}>
                              ({netPL > 0 ? "+" : ""}{netPL.toLocaleString()} GZO)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  {isActive && (
                    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                      {[
                        { label: "Hit",    enabled: canHit,    fn: handleHit,    color: "#00d4ff" },
                        { label: "Stand",  enabled: canStand,  fn: handleStand,  color: "#00ff9d" },
                        { label: "Double", enabled: canDouble, fn: handleDouble, color: "#e879f9" },
                        { label: "Split",  enabled: canSplit,  fn: handleSplit,  color: "#fb923c" },
                      ].map(({ label, enabled, fn, color }) => (
                        <button
                          key={label}
                          onClick={fn}
                          disabled={!enabled}
                          style={{
                            padding: "0.6rem 1.1rem",
                            borderRadius: 8,
                            border: `1px solid ${enabled ? color + "88" : "#2a2a50"}`,
                            background: enabled ? `${color}18` : "transparent",
                            color: enabled ? color : "#3a3a5a",
                            fontWeight: 700, fontSize: "0.875rem",
                            cursor: enabled ? "pointer" : "not-allowed",
                            transition: "all 0.15s",
                            opacity: enabled ? 1 : 0.4,
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel ── */}
          <div>
            {/* On-chain verification */}
            {roundId && (
              <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>
                  On-Chain Verification
                </div>
                <div style={{ fontSize: "0.68rem", color: "#555577", wordBreak: "break-all", lineHeight: 1.6 }}>
                  <div style={{ marginBottom: "0.4rem" }}>
                    <span style={{ color: "#8888aa", fontWeight: 600 }}>Round ID:</span><br />
                    <span style={{ color: "#3a3a5a" }}>{roundId.slice(0, 10)}…{roundId.slice(-8)}</span>
                  </div>
                  {gameState?.serverSeed && (
                    <div>
                      <span style={{ color: "#8888aa", fontWeight: 600 }}>Deck Seed (VRF):</span><br />
                      <span style={{ color: "#3a3a5a" }}>{gameState.serverSeed.slice(0, 16)}…</span>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: "0.75rem", padding: "0.4rem 0.6rem", borderRadius: 6, background: "rgba(0,255,157,0.06)", border: "1px solid rgba(0,255,157,0.15)", fontSize: "0.65rem", color: "#00ff9d66", lineHeight: 1.5 }}>
                  Deck seed generated by Chainlink VRF · Cards verified on-chain at settlement
                </div>
              </div>
            )}

            {/* Current bet info */}
            {isActive && gameState && (
              <div className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.75rem" }}>
                  Current Bet
                </div>
                <div style={{ fontSize: "0.8rem", color: "#f0f0ff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                    <span style={{ color: "#555577" }}>Main stake</span>
                    <span style={{ fontWeight: 700 }}>{gameState.mainStakeGzo.toLocaleString()} GZO</span>
                  </div>
                  {gameState.splitStakeGzo != null && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                      <span style={{ color: "#555577" }}>Split stake</span>
                      <span style={{ fontWeight: 700 }}>{gameState.splitStakeGzo.toLocaleString()} GZO</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #2a2a50", paddingTop: "0.3rem", marginTop: "0.3rem" }}>
                    <span style={{ color: "#555577" }}>Total</span>
                    <span style={{ color: "#00d4ff", fontWeight: 800 }}>
                      {(gameState.mainStakeGzo + (gameState.splitStakeGzo ?? 0)).toLocaleString()} GZO
                    </span>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* ── How to Play ── */}
        <div className="card" style={{ background: "rgba(20,184,166,0.03)", borderColor: "rgba(20,184,166,0.2)", marginTop: "1.5rem", marginBottom: "1.25rem", padding: "1.25rem" }}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: "#14b8a6", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <SiTarget size={16} color="#14b8a6" /> How to Play
          </h2>
          <div className="howto-grid">
            {[
              {
                step: "1", title: "Deposit GZO", icon: <SiWallet size={14} color="#14b8a6" />,
                desc: "Go to the Dashboard and deposit GZO into your custodial casino balance. No per-bet wallet approval needed — funds are managed server-side.",
              },
              {
                step: "2", title: "Pick Your Bet", icon: <SiChip size={14} color="#14b8a6" />,
                desc: "Select a chip (10, 50, 100, 500 GZO) or enter a custom amount. Your stake is deducted immediately when you click Deal Cards.",
              },
              {
                step: "3", title: "Deal Cards", icon: <SiDealCards size={14} color="#14b8a6" />,
                desc: "Click Deal Cards. The house wallet calls the smart contract on-chain, which requests Chainlink VRF to generate a tamper-proof shuffled deck seed (~30–90 s).",
              },
              {
                step: "4", title: "Hit or Stand", icon: <SiHand size={14} color="#14b8a6" />,
                desc: "Once the deck is ready, your initial two cards are dealt. Hit to draw more cards, Stand to hold your hand. The dealer's hole card stays hidden until you stand.",
              },
              {
                step: "5", title: "Double or Split", icon: <SiSplit size={14} color="#14b8a6" />,
                desc: "Double Down on any first two cards — draw exactly one more card and double your stake. Split pairs of equal rank into two independent hands, each with its own stake.",
              },
              {
                step: "6", title: "Settlement", icon: <SiCheckCircle size={14} color="#14b8a6" />,
                desc: "When the hand ends, the backend calls settleRound() on-chain. The contract re-derives the deck from the VRF seed, verifies every card, applies blackjack rules, and emits a verified payout. Winnings are credited to your balance instantly.",
              },
            ].map(item => (
              <div key={item.step} style={{ background: "rgba(20,184,166,0.04)", border: "1px solid rgba(20,184,166,0.12)", borderRadius: "10px", padding: "0.875rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%", background: "rgba(20,184,166,0.15)", border: "1px solid rgba(20,184,166,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 800, color: "#14b8a6" }}>
                  {item.step}
                </div>
                <div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f0f0ff", marginBottom: "0.2rem", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    {item.icon} {item.title}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Play Another Game ── */}
        <OtherGames exclude="blackjack" />

        {/* ── How It Works ── */}
        <div className="card" style={{ background: "rgba(20,184,166,0.02)", borderColor: "rgba(20,184,166,0.15)", marginTop: "1.25rem", marginBottom: "1.25rem", padding: "1.25rem" }}>
          <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: "#14b8a6", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <SiGear size={16} color="#14b8a6" /> How It Works
          </h2>
          <div className="stat-grid-2">
            {[
              {
                icon: <SiLock size={20} color="#14b8a6" />,
                title: "Custodial Balance",
                desc: "GZO is held in your custodial casino balance after depositing. The stake is debited from your DB balance before the on-chain transaction — no wallet signature required per bet. This makes the game fast and gas-free for the player.",
              },
              {
                icon: <SiShieldCheck size={20} color="#14b8a6" />,
                title: "Chainlink VRF Deck",
                desc: "Each hand uses Chainlink VRF v2.5 to generate a verifiable random deck seed on-chain. The contract performs a Fisher-Yates shuffle of 52 cards using keccak256 — producing a deterministic deck that is mathematically impossible to predict or manipulate before the VRF response.",
              },
              {
                icon: <SiBarChart size={20} color="#14b8a6" />,
                title: "On-Chain Card Verification",
                desc: "At settlement, the backend submits every card played — player, dealer, and split — along with their deck positions. The smart contract re-derives the deck from the VRF seed, verifies that each submitted card matches the position in the deck, then applies blackjack rules to compute the payout. Fully verifiable on Polygonscan.",
              },
              {
                icon: <SiZap size={20} color="#14b8a6" />,
                title: "Payouts & Fees",
                desc: "Blackjack (Ace + 10-value on first deal) pays 3:2 — you receive 2.5× your stake. Win pays 2× your stake. Push returns your stake. Double doubles the effective stake. Split evaluates each hand independently. A 10% fee is applied on profit only — no fee on pushes or losses.",
              },
            ].map(item => (
              <div key={item.title} style={{ background: "rgba(20,184,166,0.03)", border: "1px solid rgba(20,184,166,0.1)", borderRadius: "10px", padding: "0.875rem" }}>
                <div style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>{item.icon}</div>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#14b8a6", marginBottom: "0.3rem" }}>{item.title}</div>
                <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.6 }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Your Transaction History ── */}
        <div style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.875rem", color: "#8888aa" }}>Your Transaction History</h2>
          <BetHistory game="BLACKJACK" refreshTrigger={historyTick} />
        </div>

      </div>
    </>
  );
}
