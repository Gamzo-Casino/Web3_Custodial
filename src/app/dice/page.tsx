"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount } from "wagmi";
import OtherGames from "@/components/OtherGames";
import BetHistory from "@/components/BetHistory";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import {
  SiTarget, SiGear, SiWallet, SiChip, SiSliders, SiRefresh,
  SiCoins, SiLock, SiDice, SiBarChart, SiZap, SiShieldCheck,
} from "@/components/GameIcons";
import CasinoChip, { CHIP_OPTIONS } from "@/components/CasinoChip";

// ── Constants ──────────────────────────────────────────────────────────────────
const ACCENT     = "#00d4ff";
const WIN_COLOR  = "#00ff9d";
const LOSE_COLOR = "#ff4444";

const PRESETS = [
  { label: "2×",  mult: 2,  target: 49.50 },
  { label: "5×",  mult: 5,  target: 19.80 },
  { label: "10×", mult: 10, target: 9.90  },
  { label: "50×", mult: 50, target: 1.98  },
];

// ── AtomLoader ─────────────────────────────────────────────────────────────────
function AtomLoader() {
  const colors: [string, string, string] = [ACCENT, "#e879f9", "#ffffff"];
  const [c0, c1, c2] = colors;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "2rem 1rem" }}>
      <div className="atom-wrap" style={{ position: "relative", width: "130px", height: "130px" }}>
        <div className="nucleus" style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          width: "20px", height: "20px", borderRadius: "50%",
          background: `radial-gradient(circle, white 0%, ${c0} 70%)`,
          boxShadow: `0 0 6px white, 0 0 18px ${c0}, 0 0 36px ${c0}88`, zIndex: 10,
        }} />
        {[c0, c1, c2].map((c, i) => (
          <div key={i} className={`orbit orbit-${i}`} style={{
            position: "absolute", top: "50%", left: "50%",
            width: "120px", height: "50px",
            marginTop: "-25px", marginLeft: "-60px",
            border: `1.5px solid ${c}${i === 2 ? "40" : "50"}`, borderRadius: "50%",
          }}>
            <div style={{
              position: "absolute", top: "-5px", left: "calc(50% - 5px)",
              width: "10px", height: "10px", borderRadius: "50%",
              background: c, boxShadow: `0 0 8px ${c}, 0 0 16px ${c}99`,
            }} />
          </div>
        ))}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          width: "130px", height: "130px",
          marginTop: "-65px", marginLeft: "-65px",
          borderRadius: "50%",
          border: `1px solid ${c0}20`,
          boxShadow: `0 0 30px ${c0}10, inset 0 0 30px ${c0}08`,
          pointerEvents: "none",
        }} />
      </div>
      <div style={{ textAlign: "center", maxWidth: "280px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}` }} />
          <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f0f0ff", letterSpacing: "0.01em" }}>Rolling…</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#8888aa", lineHeight: 1.6, margin: 0 }}>
          Chainlink VRF is generating your provably fair random number on-chain.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem", marginTop: "0.875rem" }}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`prog-dot prog-dot-${i}`} style={{ width: "6px", height: "6px", borderRadius: "50%", background: c0, opacity: 0.3 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── NeonDiceBar ────────────────────────────────────────────────────────────────
function NeonDiceBar({
  target, onChange, roll, disabled,
}: {
  target: number; onChange: (v: number) => void;
  roll: number | null; disabled: boolean;
}) {
  const targetPct = (target / 100) * 100;
  const [markerPct, setMarkerPct] = useState<number | null>(null);
  const [displayNum, setDisplayNum] = useState<string | null>(null);
  const flipRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevRoll = useRef<number | null>(null);

  useEffect(() => {
    if (roll === null) {
      setMarkerPct(null);
      setDisplayNum(null);
      prevRoll.current = null;
      return;
    }
    if (roll === prevRoll.current) return;
    prevRoll.current = roll;

    if (flipRef.current) clearInterval(flipRef.current);
    let elapsed = 0;
    flipRef.current = setInterval(() => {
      elapsed += 40;
      if (elapsed < 600) {
        setDisplayNum((Math.random() * 100).toFixed(2));
      } else {
        clearInterval(flipRef.current!);
        setDisplayNum(roll.toFixed(2));
      }
    }, 40);

    setTimeout(() => setMarkerPct((roll / 100) * 100), 80);
    return () => { if (flipRef.current) clearInterval(flipRef.current); };
  }, [roll]);

  const thumbPct = targetPct;

  return (
    <div style={{ padding: "0.5rem 0 1.5rem" }}>
      <div style={{ position: "relative", height: "28px", borderRadius: "14px", overflow: "visible", marginBottom: "0.75rem" }}>
        {/* Win zone */}
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${thumbPct}%`, borderRadius: "14px 0 0 14px",
          background: `linear-gradient(90deg, ${WIN_COLOR}33 0%, ${WIN_COLOR}55 100%)`,
          border: `1px solid ${WIN_COLOR}44`, transition: "width 0.2s ease",
        }} />
        {/* Lose zone */}
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: `${thumbPct}%`, right: 0, borderRadius: "0 14px 14px 0",
          background: `linear-gradient(90deg, ${LOSE_COLOR}44 0%, ${LOSE_COLOR}22 100%)`,
          border: `1px solid ${LOSE_COLOR}33`, transition: "left 0.2s ease",
        }} />
        {/* Divider glow */}
        <div style={{
          position: "absolute", top: "0", bottom: "0",
          left: `${thumbPct}%`, width: "2px",
          background: `linear-gradient(180deg, transparent, #f0f0ff, transparent)`,
          transform: "translateX(-50%)", boxShadow: "0 0 8px #f0f0ff88",
          transition: "left 0.2s ease",
        }} />
        {/* Labels */}
        <div style={{
          position: "absolute", top: "50%", transform: "translateY(-50%)",
          left: "0.6rem", fontSize: "0.6rem", fontWeight: 800,
          color: WIN_COLOR, letterSpacing: "0.08em", opacity: thumbPct > 15 ? 1 : 0,
          transition: "opacity 0.2s", textShadow: `0 0 8px ${WIN_COLOR}88`,
        }}>WIN</div>
        <div style={{
          position: "absolute", top: "50%", transform: "translateY(-50%)",
          right: "0.6rem", fontSize: "0.6rem", fontWeight: 800,
          color: LOSE_COLOR, letterSpacing: "0.08em", opacity: thumbPct < 85 ? 1 : 0,
          transition: "opacity 0.2s", textShadow: `0 0 8px ${LOSE_COLOR}88`,
        }}>LOSE</div>

        {/* Animated result marker */}
        {markerPct !== null && (
          <div style={{
            position: "absolute", top: "-8px", bottom: "-8px",
            left: `${markerPct}%`, width: "3px",
            background: roll !== null && roll < target ? WIN_COLOR : LOSE_COLOR,
            boxShadow: `0 0 12px ${roll !== null && roll < target ? WIN_COLOR : LOSE_COLOR}`,
            borderRadius: "2px", transform: "translateX(-50%)",
            transition: "left 0.8s cubic-bezier(0.17,0.78,0.16,1.0)", zIndex: 10,
          }}>
            <div style={{
              position: "absolute", top: "-4px", left: "50%", transform: "translateX(-50%)",
              width: "10px", height: "10px", borderRadius: "50%",
              background: roll !== null && roll < target ? WIN_COLOR : LOSE_COLOR,
              boxShadow: `0 0 16px ${roll !== null && roll < target ? WIN_COLOR : LOSE_COLOR}`,
            }} />
          </div>
        )}

        {/* Invisible range input */}
        <input
          type="range" min={1.01} max={98.00} step={0.01} value={target}
          onChange={(e) => !disabled && onChange(parseFloat(e.target.value))}
          disabled={disabled}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: disabled ? "default" : "pointer", zIndex: 5 }}
        />
        {/* Custom thumb */}
        <div style={{
          position: "absolute", top: "50%", left: `${thumbPct}%`,
          transform: "translate(-50%, -50%)",
          width: "22px", height: "22px", borderRadius: "50%",
          background: `radial-gradient(circle at 35% 35%, #ffffff33, ${ACCENT}22)`,
          border: `2px solid ${ACCENT}`, boxShadow: `0 0 12px ${ACCENT}99, 0 0 24px ${ACCENT}44`,
          zIndex: 4, pointerEvents: "none", transition: "left 0.2s ease",
        }} />
      </div>

      {/* Scale labels */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "#555577", marginTop: "0.2rem" }}>
        <span>0</span>
        <span style={{ color: ACCENT, fontWeight: 700 }}>{target.toFixed(2)}</span>
        <span>100</span>
      </div>

      {/* Digit flip */}
      {displayNum !== null && (
        <div style={{
          marginTop: "1rem", textAlign: "center",
          fontSize: "3.5rem", fontWeight: 900, fontFamily: "monospace",
          color: roll !== null && roll < target ? WIN_COLOR : LOSE_COLOR,
          letterSpacing: "-2px",
          textShadow: `0 0 32px ${roll !== null && roll < target ? WIN_COLOR : LOSE_COLOR}88`,
          animation: "flipIn 0.06s ease",
        }}>
          {displayNum}
        </div>
      )}
    </div>
  );
}

// ── StatRow ────────────────────────────────────────────────────────────────────
function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "0.5rem 0", borderBottom: "1px solid #1a1a35" }}>
      <span style={{ fontSize: "0.7rem", color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: "0.9rem", fontWeight: 800, fontFamily: "monospace", color: color ?? "#f0f0ff" }}>{value}</span>
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface DiceResult {
  roll: number;        // 0–99.99 (contract value / 100)
  target: number;
  won: boolean;
  stakeGzo: number;
  netPayoutGzo: number;
  grossPayoutGzo: number;
  feeGzo: number;
  balanceAfter: number;
  roundId: string;     // on-chain bytes32 roundId
  betId: string;
}

// ── VRF phase labels shown inside AtomLoader ───────────────────────────────────
const VRF_PHASES = [
  "Submitting bet on-chain…",
  "Awaiting Chainlink VRF…",
  "VRF fulfilling…",
  "Settling result…",
];

// ── Main Inner ─────────────────────────────────────────────────────────────────
function DiceGameInner() {
  const { address } = useAccount();
  const { balance, formatted: balFmt, refetch: refetchBalance } = useDBBalance();

  const [chipValue,      setChipValue]      = useState(100);
  const [stakeGzo,       setStakeGzo]       = useState("100");
  const [target,         setTarget]         = useState(50.00);
  const [isRolling,      setIsRolling]      = useState(false);
  const [result,         setResult]         = useState<DiceResult | null>(null);
  const [errorMsg,       setErrorMsg]       = useState<string | null>(null);
  const [showResult,     setShowResult]     = useState(false);
  const [historyTick,    setHistoryTick]    = useState(0);
  const [pendingRoundId, setPendingRoundId] = useState<string | null>(null);
  const [vrfPhase,       setVrfPhase]       = useState(0);
  const pollTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedRef = useRef<number>(0);

  const stakeNum    = parseFloat(stakeGzo) || 0;
  const multiplier  = 99.0 / target;
  const winChance   = target;
  const profitOnWin = stakeNum * (multiplier - 1);

  // ── VRF polling ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pendingRoundId) return;

    // Progress through phase labels every ~15s
    const phaseTimer = setInterval(() => {
      setVrfPhase(p => Math.min(p + 1, VRF_PHASES.length - 1));
    }, 15_000);

    pollTimerRef.current = setInterval(async () => {
      const elapsed = Date.now() - pollStartedRef.current;
      if (elapsed > 8 * 60 * 1000) {
        // 8 min timeout — VRF may be stuck
        clearInterval(pollTimerRef.current!);
        clearInterval(phaseTimer);
        setPendingRoundId(null);
        setIsRolling(false);
        setErrorMsg("VRF is taking longer than expected. Your stake was refunded if VRF fails. Check your bet history.");
        return;
      }

      try {
        const res = await fetch(`/api/games/dice/status?roundId=${encodeURIComponent(pendingRoundId)}`);
        const data = await res.json();

        if (!res.ok) return; // keep polling on transient errors

        if (data.settled) {
          clearInterval(pollTimerRef.current!);
          clearInterval(phaseTimer);
          setPendingRoundId(null);

          setResult({
            roll:           data.roll,
            target:         data.target,
            won:            data.won,
            stakeGzo:       data.stakeGzo ?? stakeNum,
            netPayoutGzo:   data.netPayoutGzo,
            grossPayoutGzo: data.grossPayoutGzo,
            feeGzo:         data.feeGzo,
            balanceAfter:   data.balanceAfter,
            roundId:        data.roundId,
            betId:          data.betId,
          });
          setShowResult(true);
          setIsRolling(false);
          refetchBalance();
          setHistoryTick(t => t + 1);
        }
      } catch {
        // keep polling on network errors
      }
    }, 3_000);

    return () => {
      clearInterval(pollTimerRef.current!);
      clearInterval(phaseTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoundId]);

  // ── Roll handler ──────────────────────────────────────────────────────────────
  const handleRoll = useCallback(async () => {
    setErrorMsg(null);

    if (stakeNum <= 0) {
      setErrorMsg("Enter a valid stake amount.");
      return;
    }
    if (stakeNum > balance) {
      setErrorMsg(`Insufficient balance. You have ${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} GZO deposited. Please deposit more to play.`);
      return;
    }

    setIsRolling(true);
    setShowResult(false);
    setResult(null);
    setVrfPhase(0);

    try {
      const res = await fetch("/api/games/dice/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeGzo: stakeNum, target, mode: "ROLL_UNDER" }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? "Something went wrong. Please try again.");
        setIsRolling(false);
        return;
      }

      // Bet placed on-chain — start polling for VRF result
      pollStartedRef.current = Date.now();
      setPendingRoundId(data.roundId);
      refetchBalance(); // refresh balance (stake was deducted)
    } catch {
      setErrorMsg("Network error. Please try again.");
      setIsRolling(false);
    }
  }, [stakeNum, target, balance, refetchBalance]);

  function handleNewRound() {
    setResult(null);
    setShowResult(false);
    setErrorMsg(null);
  }

  function handleChipClick(v: number) {
    setChipValue(v);
    setStakeGzo(String(v));
    setErrorMsg(null);
  }

  const roll = result?.roll ?? null;
  const won  = result?.won  ?? null;
  const isBusy = isRolling;

  const insufficientBalance = stakeNum > 0 && stakeNum > balance;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{
          fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem",
          background: `linear-gradient(135deg, ${ACCENT}, #0099cc)`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        }}>Dice</h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          Set your target, roll under to win. Provably fair · Instant settlement.
        </p>
        {address && (
          <p style={{ color: "#555577", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            Balance: <span style={{ color: ACCENT, fontWeight: 700 }}>{balFmt} GZO</span>
          </p>
        )}
      </div>

      {/* 3-column layout */}
      <div className="game-3col" style={{ alignItems: "stretch" }}>

        {/* LEFT — Controls */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem",
          background: `rgba(0,212,255,0.03)`, borderColor: `rgba(0,212,255,0.2)` }}>

          {/* Chip selector */}
          <div>
            <label style={labelStyle}>Select Chip (GZO)</label>
            <div className="chip-row" style={{ justifyItems: "center" }}>
              {CHIP_OPTIONS.map(chip => (
                <CasinoChip key={chip.value} value={chip.value} color={chip.color}
                  active={chipValue === chip.value} onClick={() => handleChipClick(chip.value)} />
              ))}
            </div>
          </div>

          {/* Custom stake */}
          <div>
            <label style={labelStyle}>Custom Stake</label>
            <input
              type="number" min={1} value={stakeGzo}
              onChange={e => { setStakeGzo(e.target.value); setErrorMsg(null); }}
              style={{
                ...inputStyle,
                borderColor: insufficientBalance ? "#ff444466" : "#2a2a50",
              }}
            />
            {insufficientBalance && (
              <div style={{ fontSize: "0.65rem", color: "#ff6060", marginTop: "0.3rem", lineHeight: 1.4 }}>
                Max available: {balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} GZO
              </div>
            )}
          </div>

          {/* Quick presets */}
          <div>
            <label style={labelStyle}>Quick Multiplier</label>
            <div className="chip-row" style={{}}>
              {PRESETS.map(p => (
                <button key={p.label} onClick={() => setTarget(p.target)} disabled={isBusy}
                  style={{
                    padding: "0.4rem 0.3rem", borderRadius: "7px",
                    border: `1px solid ${Math.abs(target - p.target) < 0.1 ? ACCENT + "88" : "#2a2a50"}`,
                    background: Math.abs(target - p.target) < 0.1 ? `${ACCENT}12` : "transparent",
                    color: Math.abs(target - p.target) < 0.1 ? ACCENT : "#8888aa",
                    fontSize: "0.72rem", fontWeight: 700, cursor: isBusy ? "not-allowed" : "pointer",
                    transition: "all 0.15s",
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Error message */}
          {errorMsg && (
            <div style={{
              padding: "0.5rem 0.6rem", borderRadius: "7px",
              background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.3)",
              fontSize: "0.68rem", color: "#ff8080", lineHeight: 1.5,
            }}>
              {errorMsg}
            </div>
          )}

          {/* Roll / New Round button */}
          <div style={{ marginTop: "auto" }}>
            {showResult && result ? (
              <button onClick={handleNewRound} style={{
                width: "100%", padding: "0.75rem", borderRadius: "8px",
                border: `1px solid ${ACCENT}44`, background: `${ACCENT}0a`,
                color: ACCENT, fontSize: "0.9375rem", cursor: "pointer", fontWeight: 700,
              }}>
                Roll Again
              </button>
            ) : (
              <button
                className={!isBusy && stakeNum > 0 && !insufficientBalance ? "dice-btn-active" : ""}
                onClick={handleRoll}
                disabled={isBusy || stakeNum <= 0 || insufficientBalance}
                style={{
                  width: "100%", padding: "0.75rem", borderRadius: "8px", fontWeight: 800,
                  fontSize: "0.9375rem", cursor: (isBusy || insufficientBalance) ? "not-allowed" : "pointer",
                  background: (!isBusy && stakeNum > 0 && !insufficientBalance)
                    ? `linear-gradient(135deg, ${ACCENT}, #0099cc)` : "#2a2a50",
                  border: (!isBusy && stakeNum > 0 && !insufficientBalance)
                    ? `1px solid ${ACCENT}66` : "1px solid #3a3a60",
                  color: (!isBusy && stakeNum > 0 && !insufficientBalance) ? "#0a0a18" : "#666688",
                  boxShadow: (!isBusy && stakeNum > 0 && !insufficientBalance)
                    ? `0 0 24px ${ACCENT}55, 0 0 48px ${ACCENT}22` : "none",
                  opacity: isBusy ? 0.7 : 1, transition: "all 0.2s ease",
                }}>
                {isRolling ? "Rolling…" : insufficientBalance ? "Insufficient Balance" : "Roll Dice"}
              </button>
            )}
          </div>
        </div>

        {/* CENTER — NeonDiceBar + Animation */}
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div className="card" style={{
            padding: "1.5rem 2rem", position: "relative",
            background: "rgba(0,212,255,0.02)", borderColor: "rgba(0,212,255,0.2)",
            display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1,
          }}>

            {/* AtomLoader overlay during roll */}
            {isRolling && (
              <div style={{
                position: "absolute", inset: 0, borderRadius: "inherit",
                background: "rgba(10,10,24,0.92)",
                display: "flex", alignItems: "center", justifyContent: "center",
                zIndex: 20, backdropFilter: "blur(4px)",
              }}>
                <AtomLoader />
              </div>
            )}

            {/* Idle poster */}
            {!showResult && !isRolling && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", paddingTop: "0.5rem" }}>
                <div style={{
                  width: "100%", maxWidth: "260px", height: "140px",
                  background: "radial-gradient(ellipse at 50% 40%, rgba(0,212,255,0.14) 0%, rgba(0,0,20,0.0) 70%)",
                  border: "1px solid rgba(0,212,255,0.18)", borderRadius: "20px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative", overflow: "hidden",
                }}>
                  <svg width="110" height="110" viewBox="0 0 80 80" fill="none">
                    <rect x="8" y="8" width="64" height="64" rx="14"
                      fill="rgba(0,212,255,0.06)" stroke={ACCENT} strokeWidth="2" />
                    <rect x="12" y="12" width="56" height="56" rx="11"
                      fill="none" stroke={`${ACCENT}33`} strokeWidth="1" strokeDasharray="4 3" />
                    {([[24,24],[56,24],[40,40],[24,56],[56,56]] as [number,number][]).map(([cx,cy],i) => (
                      <circle key={i} cx={cx} cy={cy} r="5" fill={ACCENT}
                        style={{ filter: `drop-shadow(0 0 6px ${ACCENT})` }} />
                    ))}
                  </svg>
                  <div style={{
                    position: "absolute", bottom: 0, left: "8%", right: "8%", height: "1px",
                    background: `linear-gradient(90deg, transparent, ${ACCENT}99, transparent)`,
                    boxShadow: `0 0 16px ${ACCENT}55`,
                  }} />
                  {([[8,8],[8,"calc(100% - 8px)"],["calc(100% - 8px)",8],["calc(100% - 8px)","calc(100% - 8px)"]] as any[]).map(([t,l],i) => (
                    <div key={i} style={{
                      position: "absolute", top: t, left: l,
                      width: "4px", height: "4px", borderRadius: "50%",
                      background: ACCENT, boxShadow: `0 0 6px ${ACCENT}`,
                    }} />
                  ))}
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "0.72rem", color: "#555577", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    Set target · Roll · Win
                  </div>
                </div>
              </div>
            )}

            {/* Bar */}
            <div style={{ padding: "0.5rem 0" }}>
              <div style={{ fontSize: "0.65rem", color: "#555577", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.25rem" }}>
                Roll Under Target — drag to adjust
              </div>
              <NeonDiceBar target={target} onChange={setTarget} roll={roll} disabled={isBusy} />
            </div>

            {/* Outcome badge or live stats */}
            <div style={{ paddingBottom: "0.5rem" }}>
              {showResult && roll !== null && won !== null ? (
                <div style={{ textAlign: "center", animation: "resultReveal 0.4s ease-out" }}>
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: "0.5rem",
                    padding: "0.625rem 1.5rem", borderRadius: "99px",
                    background: won ? `rgba(0,255,157,0.1)` : `rgba(255,68,68,0.1)`,
                    border: `1px solid ${won ? WIN_COLOR : LOSE_COLOR}44`,
                  }}>
                    <span style={{ fontSize: "1.125rem", fontWeight: 900, color: won ? WIN_COLOR : LOSE_COLOR }}>
                      {won ? "WIN" : "LOSE"}
                    </span>
                    <span style={{ fontSize: "0.85rem", color: "#8888aa", fontFamily: "monospace" }}>
                      {roll.toFixed(2)} {won ? "<" : "≥"} {target.toFixed(2)}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{
                  display: "flex", justifyContent: "space-around", alignItems: "center",
                  padding: "0.75rem 0.5rem",
                  background: "rgba(0,212,255,0.04)", borderRadius: "10px",
                  border: "1px solid rgba(0,212,255,0.1)",
                }}>
                  {[
                    { label: "Win Chance", value: `${winChance.toFixed(1)}%`, color: ACCENT },
                    { label: "Multiplier",  value: `${(99/target).toFixed(3)}×`, color: "#e879f9" },
                    { label: "House Edge",  value: "1.00%", color: "#8888aa" },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "0.6rem", color: "#555577", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.2rem" }}>{s.label}</div>
                      <div style={{ fontSize: "0.85rem", fontWeight: 800, fontFamily: "monospace", color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — Stats + Result + Provably Fair */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>

          {/* Bet stats */}
          <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
              Bet Stats
            </div>
            <StatRow label="Win Chance" value={`${winChance.toFixed(2)}%`} color={ACCENT} />
            <StatRow label="Multiplier"  value={`${multiplier.toFixed(4)}×`} color={ACCENT} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0" }}>
              <span style={{ fontSize: "0.7rem", color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Profit on Win</span>
              <span style={{ fontSize: "0.9rem", fontWeight: 800, fontFamily: "monospace", color: WIN_COLOR }}>
                {profitOnWin > 0 ? `+${profitOnWin.toFixed(2)}` : "—"} GZO
              </span>
            </div>
          </div>

          {/* Result card */}
          {showResult && result ? (
            <div className="card" style={{ padding: "0.875rem",
              background: result.won ? "rgba(0,255,157,0.04)" : "rgba(255,68,68,0.04)",
              borderColor: result.won ? "rgba(0,255,157,0.25)" : "rgba(255,68,68,0.25)" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700,
                color: result.won ? WIN_COLOR : LOSE_COLOR,
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
                {result.won ? "✓ Result — Win" : "✗ Result — Loss"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {[
                  { label: "Stake",  val: `${result.stakeGzo} GZO` },
                  { label: "Roll",   val: result.roll.toFixed(2) },
                  { label: "Target", val: `< ${result.target.toFixed(2)}` },
                  { label: "Fee",    val: result.feeGzo > 0 ? `${result.feeGzo.toFixed(4)} GZO` : "—" },
                ].map(r => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem" }}>
                    <span style={{ color: "#8888aa" }}>{r.label}</span>
                    <span style={{ color: "#f0f0ff", fontFamily: "monospace" }}>{r.val}</span>
                  </div>
                ))}
                <div style={{ borderTop: "1px solid #2a2a50", marginTop: "0.25rem", paddingTop: "0.3rem",
                  display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 800,
                  color: result.won ? WIN_COLOR : LOSE_COLOR }}>
                  <span>Net Payout</span>
                  <span>{result.netPayoutGzo.toFixed(4)} GZO</span>
                </div>
                <div style={{ borderTop: "1px solid #2a2a50", marginTop: "0.15rem", paddingTop: "0.3rem",
                  display: "flex", justifyContent: "space-between", fontSize: "0.72rem" }}>
                  <span style={{ color: "#8888aa" }}>New Balance</span>
                  <span style={{ color: ACCENT, fontFamily: "monospace", fontWeight: 700 }}>
                    {result.balanceAfter.toLocaleString(undefined, { maximumFractionDigits: 2 })} GZO
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
                Payout Reference
              </div>
              {[
                { label: "Win Chance 50%", payout: "1.98×", color: ACCENT },
                { label: "Win Chance 25%", payout: "3.96×", color: "#e879f9" },
                { label: "Win Chance 10%", payout: "9.90×", color: WIN_COLOR },
                { label: "Win Chance 2%",  payout: "49.50×", color: "#ff4444" },
                { label: "Win Chance 1%",  payout: "99.00×", color: "#ffd700" },
              ].map(p => (
                <div key={p.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem", marginBottom: "0.3rem" }}>
                  <span style={{ color: "#8888aa" }}>{p.label}</span>
                  <span style={{ fontWeight: 800, color: p.color, fontFamily: "monospace" }}>{p.payout}</span>
                </div>
              ))}
              <div style={{ marginTop: "0.5rem", borderTop: "1px solid #1a1a35", paddingTop: "0.5rem", fontSize: "0.65rem", color: "#555577", lineHeight: 1.6 }}>
                Multiplier = 99 ÷ target%. 10% fee on profit only.
              </div>
            </div>
          )}

          {/* Provably Fair */}
          <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
              Provably Fair
            </div>
            {showResult && result ? (
              <div style={{ fontSize: "0.68rem", color: "#8888aa", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#555577" }}>Round ID</span>
                  <span style={{ fontFamily: "monospace", color: "#8888aa" }}>{result.roundId.slice(0,12)}…</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#555577" }}>Randomness</span>
                  <span style={{ color: "#00d4ff", fontSize: "0.65rem" }}>Chainlink VRF v2.5</span>
                </div>
                <a
                  href={`https://amoy.polygonscan.com/address/0x4b87dF81A498ed204590f9aF25b8889cd0cBC5f7`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: "0.62rem", color: "#00d4ff", textDecoration: "none", marginTop: "0.2rem" }}
                >
                  View contract on Polygonscan ↗
                </a>
                <p style={{ fontSize: "0.62rem", color: "#445566", lineHeight: 1.6, margin: 0 }}>
                  Chainlink VRF generates an unpredictable random number. The roundId is stored on-chain before VRF is called — results are verifiable on Polygonscan.
                </p>
              </div>
            ) : (
              <div style={{ fontSize: "0.7rem", color: "#555577", lineHeight: 1.6 }}>
                Every roll uses Chainlink VRF v2.5 — an on-chain verifiable random function. The round is committed to the blockchain before the random number is generated, making it impossible to manipulate.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* How to Play */}
      <div className="card" style={{ background: "rgba(0,212,255,0.03)", borderColor: "rgba(0,212,255,0.2)", marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: "#00d4ff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiTarget size={16} color="#00d4ff" /> How to Play
        </h2>
        <div className="howto-grid">
          {[
            { step:"1", title:"Deposit GZO",        desc:"Go to the Dashboard and deposit GZO from your wallet into your casino balance. No per-bet wallet approval needed.",  icon: <SiWallet size={14} color="#00d4ff" /> },
            { step:"2", title:"Pick a Chip",         desc:"Choose your bet size — 10, 50, 100, 500 GZO — or enter any custom amount up to your deposited balance.",           icon: <SiChip size={14} color="#00d4ff" /> },
            { step:"3", title:"Set Your Target",     desc:"Drag the slider or pick a quick preset. Lower target = higher multiplier, lower win chance.",                       icon: <SiSliders size={14} color="#00d4ff" /> },
            { step:"4", title:"Click Roll Dice",     desc:"Hit Roll Dice — no wallet pop-up per bet. Stake is deducted from your balance and sent to the smart contract. Chainlink VRF generates your random number on-chain (takes ~1–3 min).", icon: <SiRefresh size={14} color="#00d4ff" /> },
            { step:"5", title:"Watch the Result",    desc:"Once Chainlink VRF fulfills, the result is stored on-chain. A neon marker slides to your roll. Win if roll < target. The number flips and reveals your outcome.", icon: <SiDice size={14} color="#00d4ff" /> },
            { step:"6", title:"Collect Winnings",    desc:"Winnings = stake × (99 ÷ target%). 10% fee on profit only. Funds credited to your balance instantly.",              icon: <SiCoins size={14} color="#00d4ff" /> },
          ].map(item => (
            <div key={item.step} style={{ background: "rgba(0,212,255,0.04)", border: "1px solid rgba(0,212,255,0.12)", borderRadius: "10px", padding: "0.875rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%", background: "rgba(0,212,255,0.15)", border: "1px solid rgba(0,212,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 800, color: "#00d4ff" }}>
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

      <OtherGames exclude="dice" />

      {/* How It Works */}
      <div className="card" style={{ background: `rgba(0,212,255,0.02)`, borderColor: `rgba(0,212,255,0.15)`, marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiGear size={16} color={ACCENT} /> How It Works
        </h2>
        <div className="stat-grid-2">
          {[
            { icon: <SiLock size={20} color={ACCENT} />,     title: "Custodial Balance",       desc: "Your GZO is held in a custodial DB balance after depositing. Stake is deducted from DB before the on-chain call — no wallet approval per bet." },
            { icon: <SiShieldCheck size={20} color={ACCENT} />, title: "Chainlink VRF",        desc: "Each roll uses Chainlink VRF v2.5 — an on-chain verifiable random function. The round is committed to the blockchain first, then VRF generates an unpredictable number. Fully verifiable on Polygonscan." },
            { icon: <SiBarChart size={20} color={ACCENT} />, title: "Roll Under Mechanic",     desc: "You win if roll < target. Target is 1.01–98.00%. Multiplier = 99 ÷ target (1% house edge). Higher target = safer bet, lower multiplier." },
            { icon: <SiZap size={20} color={ACCENT} />,      title: "Settlement & Fees",       desc: "Net payout = stake × multiplier, minus 10% fee on profit only. Example: stake 100 GZO, target 50%, win → gross 198 GZO → profit 98 GZO → fee 9.8 GZO → receive 188.2 GZO." },
          ].map(item => (
            <div key={item.title} style={{ background: `rgba(0,212,255,0.03)`, border: `1px solid rgba(0,212,255,0.1)`, borderRadius: "10px", padding: "0.875rem" }}>
              <div style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>{item.icon}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: ACCENT, marginBottom: "0.3rem" }}>{item.title}</div>
              <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.875rem", color: "#8888aa" }}>Your History</h2>
        <BetHistory game="DICE" refreshTrigger={historyTick} />
      </div>

      <style>{`
        @keyframes resultReveal { 0%{opacity:0;transform:translateY(8px)} 100%{opacity:1;transform:translateY(0)} }
        @keyframes flipIn { 0%{opacity:0.3;transform:scaleY(0.6)} 100%{opacity:1;transform:scaleY(1)} }
        @keyframes diceBtnGlow { 0%,100%{box-shadow:0 0 20px ${ACCENT}55,0 0 40px ${ACCENT}22} 50%{box-shadow:0 0 32px ${ACCENT}88,0 0 64px ${ACCENT}44} }
        @keyframes nucleusPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.25)} }
        @keyframes orbitSpin0 { from{transform:rotateZ(0deg) rotateX(15deg)} to{transform:rotateZ(360deg) rotateX(15deg)} }
        @keyframes orbitSpin1 { from{transform:rotateZ(0deg) rotateX(75deg) rotateZ(60deg)} to{transform:rotateZ(360deg) rotateX(75deg) rotateZ(60deg)} }
        @keyframes orbitSpin2 { from{transform:rotateZ(120deg) rotateX(45deg) rotateZ(0deg)} to{transform:rotateZ(120deg) rotateX(45deg) rotateZ(360deg)} }
        @keyframes progDot { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
        .dice-btn-active { animation: diceBtnGlow 2s ease-in-out infinite !important; }
        .atom-wrap { perspective: 400px; }
        .nucleus { animation: nucleusPulse 1.8s ease-in-out infinite; }
        .orbit-0 { animation: orbitSpin0 2.2s linear infinite; }
        .orbit-1 { animation: orbitSpin1 1.7s linear infinite; }
        .orbit-2 { animation: orbitSpin2 3.1s linear infinite; }
        .prog-dot-0 { animation: progDot 1.4s ease-in-out 0s infinite; }
        .prog-dot-1 { animation: progDot 1.4s ease-in-out 0.2s infinite; }
        .prog-dot-2 { animation: progDot 1.4s ease-in-out 0.4s infinite; }
        .game-3col { display: grid; grid-template-columns: 220px minmax(0,1fr) 240px; gap: 1.25rem; margin-bottom: 1.25rem; }
        .chip-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
        .howto-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 0.75rem; }
        .stat-grid-2 { display: grid; grid-template-columns: repeat(2,1fr); gap: 0.75rem; }
        @media (max-width: 900px) {
          .game-3col { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 640px) {
          .game-3col { grid-template-columns: 1fr !important; }
          .howto-grid { grid-template-columns: 1fr !important; }
          .stat-grid-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

export default function DicePage() {
  return <DiceGameInner />;
}

// ── Style helpers ──────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.68rem", fontWeight: 700,
  color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem",
};
const inputStyle: React.CSSProperties = {
  width: "100%", background: "#0d0d1a", border: "1px solid #2a2a50",
  borderRadius: "8px", padding: "0.5rem 0.6rem", color: "#f0f0ff",
  fontSize: "0.9375rem", fontWeight: 700, outline: "none", boxSizing: "border-box",
};
