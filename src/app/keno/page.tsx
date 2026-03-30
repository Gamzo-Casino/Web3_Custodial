"use client";

import { useState, useEffect, useRef } from "react";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import { KENO_PAYTABLE, KENO_MIN_PICKS, KENO_MAX_PICKS } from "@/lib/keno";
import OtherGames from "@/components/OtherGames";
import BetHistory from "@/components/BetHistory";
import { SiTarget, SiGear, SiWallet, SiChip, SiGrid, SiCards, SiEye, SiCoins, SiDice, SiShuffle, SiZap } from "@/components/GameIcons";
import CasinoChip, { CHIP_OPTIONS } from "@/components/CasinoChip";

// ── Constants ─────────────────────────────────────────────────────────────────
const ACCENT       = "#a855f7";
const ACCENT2      = "#9333ea";
const GREEN_C      = "#00ff9d";
const TOTAL_NUMBERS = 40;

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.68rem", fontWeight: 700,
  color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem",
};
const inputStyle: React.CSSProperties = {
  width: "100%", background: "#0d0d1a", border: "1px solid #2a2a50",
  borderRadius: "8px", padding: "0.5rem 0.6rem", color: "#f0f0ff",
  fontSize: "0.9375rem", fontWeight: 700, outline: "none", boxSizing: "border-box",
};

const VRF_PHASES = [
  "Submitting bet on-chain…",
  "Awaiting Chainlink VRF…",
  "VRF fulfilling…",
  "Settling result…",
];

// ── Result type ───────────────────────────────────────────────────────────────
interface KenoResult {
  won:           boolean;
  drawn:         number[];
  picks:         number[];
  matchCount:    number;
  multiplier:    number;
  netPayoutGzo:  number;
  grossPayoutGzo: number;
  feeGzo:        number;
  balanceAfter:  number;
  stakeGzo:      number;
  roundId:       string;
  betId:         string;
}

// ── Atom Loader ───────────────────────────────────────────────────────────────
function AtomLoader({ phaseText }: { phaseText: string }) {
  const c0 = ACCENT; const c1 = "#00d4ff"; const c2 = GREEN_C;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "2rem 1rem" }}>
      <div className="atom-wrap" style={{ position: "relative", width: "130px", height: "130px" }}>
        <div className="nucleus" style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: "20px", height: "20px", borderRadius: "50%",
          background: `radial-gradient(circle, white 0%, ${c0} 70%)`,
          boxShadow: `0 0 6px white, 0 0 18px ${c0}, 0 0 36px ${c0}88`, zIndex: 10,
        }} />
        {[c0, c1, c2].map((c, i) => (
          <div key={i} className={`orbit orbit-${i}`} style={{
            position: "absolute", top: "50%", left: "50%",
            width: "120px", height: "50px", marginTop: "-25px", marginLeft: "-60px",
            border: `1.5px solid ${c}50`, borderRadius: "50%",
          }}>
            <div style={{ position: "absolute", top: "-5px", left: "calc(50% - 5px)",
              width: "10px", height: "10px", borderRadius: "50%",
              background: c, boxShadow: `0 0 8px ${c}, 0 0 16px ${c}99` }} />
          </div>
        ))}
        <div style={{
          position: "absolute", top: "50%", left: "50%", width: "130px", height: "130px",
          marginTop: "-65px", marginLeft: "-65px", borderRadius: "50%",
          border: `1px solid ${c0}20`,
          boxShadow: `0 0 30px ${c0}10, inset 0 0 30px ${c0}08`, pointerEvents: "none",
        }} />
      </div>
      <div style={{ textAlign: "center", maxWidth: "300px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}` }} />
          <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f0f0ff" }}>Awaiting Chainlink VRF</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#8888aa", lineHeight: 1.6, margin: 0 }}>
          Chainlink VRF is generating your provably fair draw on-chain.
        </p>
        <p style={{ fontSize: "0.68rem", color: ACCENT, lineHeight: 1.6, margin: "0.4rem 0 0", fontWeight: 600 }}>
          {phaseText}
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem", marginTop: "0.875rem" }}>
          {[0,1,2].map(i => (
            <div key={i} className={`prog-dot prog-dot-${i}`} style={{
              width: "6px", height: "6px", borderRadius: "50%", background: c0, opacity: 0.3 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Number Button ─────────────────────────────────────────────────────────────
function NumberButton({ n, selected, drawn, matched, revealed, onClick, disabled }: {
  n: number; selected: boolean; drawn: boolean; matched: boolean;
  revealed: boolean; onClick: () => void; disabled: boolean;
}) {
  let bg = "#0d0d1a", border = "#2a2a50", color = "#8888aa";
  if (revealed) {
    if (matched)       { bg = "rgba(0,255,157,0.18)"; border = "#00ff9d"; color = "#00ff9d"; }
    else if (drawn)    { bg = `rgba(168,85,247,0.18)`; border = ACCENT;   color = ACCENT;   }
    else if (selected) { bg = "rgba(255,80,80,0.10)";  border = "#ff8080"; color = "#ff8080"; }
  } else if (selected) {
    bg = `rgba(168,85,247,0.18)`; border = ACCENT; color = ACCENT;
  }
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: "100%", aspectRatio: "1",
      background: bg, border: `1.5px solid ${border}`, borderRadius: "8px",
      color, fontFamily: "monospace", fontWeight: 700, fontSize: "0.875rem",
      cursor: disabled ? "default" : "pointer",
      transition: "background 0.15s, border-color 0.15s, color 0.15s",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
    }}>
      {n}
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
function KenoInner() {
  const { formatted: balFmt, refetch: refetchBalance } = useDBBalance();

  const [chipValue,  setChipValue]  = useState(100);
  const [stake,      setStake]      = useState("100");
  const [selected,   setSelected]   = useState<Set<number>>(new Set());
  const [revealedDrawn, setRevealedDrawn] = useState<Set<number>>(new Set());
  const [revealed,   setRevealed]   = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  const [isPlaying,      setIsPlaying]      = useState(false);
  const [pendingRoundId, setPendingRoundId] = useState<string | null>(null);
  const [vrfPhase,       setVrfPhase]       = useState(0);
  const [result,         setResult]         = useState<KenoResult | null>(null);
  const [betError,       setBetError]       = useState<string | null>(null);

  const isMounted     = useRef(true);
  const animRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (animRef.current) clearTimeout(animRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (phaseTimerRef.current) clearInterval(phaseTimerRef.current);
    };
  }, []);

  // ── VRF Polling ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pendingRoundId) return;

    let elapsed = 0;
    const TIMEOUT       = 8 * 60 * 1000;
    const POLL_INTERVAL = 3_000;
    const PHASE_ADVANCE = 15_000;

    setVrfPhase(0);

    if (phaseTimerRef.current) clearInterval(phaseTimerRef.current);
    phaseTimerRef.current = setInterval(() => {
      if (!isMounted.current) return;
      setVrfPhase(p => Math.min(p + 1, VRF_PHASES.length - 1));
    }, PHASE_ADVANCE);

    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      if (elapsed >= TIMEOUT) {
        clearInterval(pollTimerRef.current!);
        clearInterval(phaseTimerRef.current!);
        if (!isMounted.current) return;
        setPendingRoundId(null);
        setIsPlaying(false);
        setBetError("VRF timeout — Chainlink took too long. Please try again.");
        return;
      }
      try {
        const res = await fetch(`/api/games/keno/status?roundId=${encodeURIComponent(pendingRoundId)}`);
        const data = await res.json();
        if (!isMounted.current) return;
        if (data.settled) {
          clearInterval(pollTimerRef.current!);
          clearInterval(phaseTimerRef.current!);
          setPendingRoundId(null);
          setIsPlaying(false);
          setResult(data as KenoResult);
          refetchBalance();
          setHistoryTick(t => t + 1);
          revealAnimation(data.drawn as number[]);
        }
      } catch {
        // network hiccup, retry
      }
    }, POLL_INTERVAL);

    return () => {
      clearInterval(pollTimerRef.current!);
      clearInterval(phaseTimerRef.current!);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoundId]);

  function revealAnimation(drawn: number[]) {
    setRevealedDrawn(new Set());
    setRevealed(false);
    let i = 0;
    function step() {
      if (!isMounted.current) return;
      i++;
      setRevealedDrawn(new Set(drawn.slice(0, i)));
      if (i < drawn.length) animRef.current = setTimeout(step, 120);
      else setRevealed(true);
    }
    animRef.current = setTimeout(step, 200);
  }

  async function handlePlay() {
    const stakeNum = parseInt(stake) || 0;
    if (isPlaying || pendingRoundId || selected.size < KENO_MIN_PICKS || stakeNum < 1) return;

    setIsPlaying(true);
    setBetError(null);
    setResult(null);
    setRevealedDrawn(new Set());
    setRevealed(false);

    try {
      const res = await fetch("/api/games/keno/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeGzo: stakeNum, picks: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to place bet");
      if (!isMounted.current) return;
      refetchBalance();
      setPendingRoundId(data.roundId);
    } catch (e: unknown) {
      if (!isMounted.current) return;
      setIsPlaying(false);
      setBetError(e instanceof Error ? e.message : "Failed to place bet. Try again.");
    }
  }

  function clearPicks() {
    setSelected(new Set());
    setResult(null);
    setRevealedDrawn(new Set());
    setRevealed(false);
    setBetError(null);
  }

  function toggleNumber(n: number) {
    if (result || pendingRoundId || isPlaying) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else if (next.size < KENO_MAX_PICKS) next.add(n);
      return next;
    });
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const stakeNum       = parseInt(stake) || 0;
  const picksCount     = selected.size;
  const paytable       = KENO_PAYTABLE[picksCount] ?? [];
  const maxMultiplier  = paytable.length > 0 ? Math.max(...paytable) : 0;
  const allNumbers     = Array.from({ length: TOTAL_NUMBERS }, (_, i) => i + 1);

  const isVrfPending   = !!pendingRoundId;
  const drawing        = !!result && !revealed;   // animation running
  const controlsDisabled = isPlaying || isVrfPending || drawing;
  const showLoader     = (isPlaying || isVrfPending) && !drawing;

  const settledResult  = revealed && result ? result : null;
  const drawnFinal     = settledResult?.drawn ?? [];
  const matchCount     = settledResult?.matchCount ?? 0;
  const multiplier     = settledResult?.multiplier ?? 0;
  const netPayoutGzo   = settledResult?.netPayoutGzo ?? 0;
  const won            = settledResult?.won ?? false;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{
          fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem",
          background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        }}>Keno</h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          Pick 1–10 numbers from 1–40. Custodial · Chainlink VRF draws 10 — get paid by how many match.
        </p>
        <div style={{ marginTop: "0.4rem", fontSize: "0.8rem", color: "#8888aa" }}>
          Balance: <span style={{ color: ACCENT, fontWeight: 700 }}>{balFmt} GZO</span>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="game-3col" style={{ alignItems: "start" }}>

        {/* LEFT — Controls */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem",
          background: `rgba(168,85,247,0.03)`, borderColor: `rgba(168,85,247,0.2)` }}>

          {/* Chip selector */}
          <div>
            <label style={labelStyle}>Select Chip (GZO)</label>
            <div className="chip-row" style={{ justifyItems: "center" }}>
              {CHIP_OPTIONS.map(chip => (
                <CasinoChip key={chip.value} value={chip.value} color={chip.color}
                  active={chipValue === chip.value && stake === String(chip.value)}
                  onClick={() => { setChipValue(chip.value); setStake(String(chip.value)); }} />
              ))}
            </div>
          </div>

          {/* Custom stake */}
          <div>
            <label style={labelStyle}>Bet Amount (GZO)</label>
            <input type="number" min={1} max={100000} value={stake}
              onChange={e => { setStake(e.target.value); setChipValue(0); }}
              disabled={controlsDisabled} style={inputStyle} />
          </div>

          {/* Picks summary */}
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <div style={{ background: "#0d0d1a", borderRadius: "7px", padding: "0.4rem 0.5rem", flex: 1 }}>
              <div style={{ fontSize: "0.55rem", color: "#8888aa", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.1rem" }}>Picks</div>
              <div style={{ fontSize: "0.8rem", fontWeight: 800, color: ACCENT, fontFamily: "monospace" }}>{picksCount}/{KENO_MAX_PICKS}</div>
            </div>
            <div style={{ background: "#0d0d1a", borderRadius: "7px", padding: "0.4rem 0.5rem", flex: 1 }}>
              <div style={{ fontSize: "0.55rem", color: "#8888aa", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.1rem" }}>Max Win</div>
              <div style={{ fontSize: "0.8rem", fontWeight: 800, color: GREEN_C, fontFamily: "monospace" }}>{maxMultiplier > 0 ? `${maxMultiplier}×` : "—"}</div>
            </div>
          </div>

          {/* Paytable */}
          {picksCount > 0 ? (
            <div>
              <label style={labelStyle}>Paytable — {picksCount} pick{picksCount !== 1 ? "s" : ""}</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.2rem" }}>
                {paytable.map((mult, matchIdx) => (
                  <div key={matchIdx} style={{
                    background: "#0d0d1a", border: `1px solid ${mult > 0 ? ACCENT + "33" : "#2a2a50"}`,
                    borderRadius: "5px", padding: "0.2rem 0.25rem", textAlign: "center",
                  }}>
                    <div style={{ fontSize: "0.52rem", color: "#555577", marginBottom: "0.05rem" }}>{matchIdx}h</div>
                    <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: "0.65rem", color: mult > 0 ? ACCENT : "#3a3a60" }}>
                      {mult > 0 ? `${mult}×` : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "#555577", fontSize: "0.72rem", fontStyle: "italic", padding: "0.25rem 0" }}>
              Select numbers to see paytable
            </div>
          )}

          {/* Error */}
          {betError && (
            <div style={{ padding: "0.5rem 0.6rem", borderRadius: "7px",
              background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.35)",
              fontSize: "0.68rem", color: "#ff8080", lineHeight: 1.5 }}>
              {betError}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {revealed ? (
              <button className="btn-primary" onClick={clearPicks}
                style={{ width: "100%", padding: "0.6rem 0.75rem",
                  background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
                  border: "none", cursor: "pointer", fontSize: "0.875rem", fontWeight: 700, color: "#fff" }}>
                New Game
              </button>
            ) : (
              <>
                <button
                  className="btn-primary"
                  onClick={handlePlay}
                  disabled={controlsDisabled || picksCount < KENO_MIN_PICKS || stakeNum < 1}
                  style={{
                    width: "100%", fontSize: "0.875rem", padding: "0.6rem 0.75rem",
                    background: (controlsDisabled || picksCount < KENO_MIN_PICKS || stakeNum < 1) ? "#2a2a50"
                      : `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
                    border: "none",
                    cursor: (controlsDisabled || picksCount < KENO_MIN_PICKS || stakeNum < 1) ? "not-allowed" : "pointer",
                    opacity: (controlsDisabled || picksCount < KENO_MIN_PICKS || stakeNum < 1) ? 0.5 : 1,
                    color: "#fff", fontWeight: 700,
                  }}
                >
                  {isPlaying && !pendingRoundId ? "Submitting…"
                    : isVrfPending ? "Awaiting VRF…"
                    : drawing ? "Revealing…"
                    : picksCount < KENO_MIN_PICKS ? `Pick ${KENO_MIN_PICKS}+ numbers`
                    : `Play Keno (${picksCount} pick${picksCount !== 1 ? "s" : ""})`}
                </button>
                {picksCount > 0 && !isVrfPending && !drawing && (
                  <button onClick={clearPicks} disabled={controlsDisabled}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "6px",
                      border: "1px solid #2a2a50", background: "transparent",
                      color: "#8888aa", fontSize: "0.75rem", cursor: "pointer" }}>
                    Clear Picks
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* CENTER — Game area */}
        <div className="card" style={{
          padding: "1.25rem",
          background: revealed
            ? won ? "rgba(0,255,157,0.04)" : "rgba(255,80,80,0.04)"
            : drawing ? `rgba(168,85,247,0.04)`
            : isVrfPending ? "rgba(0,212,255,0.03)"
            : `rgba(168,85,247,0.02)`,
          borderColor: revealed
            ? won ? "rgba(0,255,157,0.22)" : "rgba(255,80,80,0.28)"
            : drawing ? `rgba(168,85,247,0.3)`
            : isVrfPending ? "rgba(0,212,255,0.25)"
            : `rgba(168,85,247,0.2)`,
          transition: "background 0.4s, border-color 0.3s", position: "relative",
        }}>

          {/* AtomLoader overlay */}
          {showLoader && (
            <div style={{
              position: "absolute", inset: 0, borderRadius: "inherit",
              background: "rgba(10,10,24,0.92)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 20, backdropFilter: "blur(4px)",
            }}>
              <AtomLoader phaseText={VRF_PHASES[vrfPhase]} />
            </div>
          )}

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Pick numbers{" "}
              <span style={{ color: ACCENT, fontFamily: "monospace" }}>{picksCount}/{KENO_MAX_PICKS}</span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", fontSize: "0.7rem" }}>
              {revealed && (
                <>
                  <span style={{ color: "#00ff9d" }}>■ match</span>
                  <span style={{ color: ACCENT }}>■ drawn</span>
                  <span style={{ color: "#ff8080" }}>■ missed</span>
                </>
              )}
              {isVrfPending && <span style={{ color: "#00d4ff", fontWeight: 600 }}>Waiting for VRF…</span>}
              {drawing && <span style={{ color: ACCENT, fontWeight: 600 }}>Revealing…</span>}
            </div>
          </div>

          {/* 8×5 number grid */}
          <div className="keno-grid">
            {allNumbers.map(n => {
              const isSelected = selected.has(n);
              const isDrawn    = revealedDrawn.has(n);
              const isMatched  = isSelected && isDrawn;
              return (
                <NumberButton key={n} n={n}
                  selected={isSelected} drawn={isDrawn} matched={isMatched}
                  revealed={revealed}
                  onClick={() => toggleNumber(n)}
                  disabled={controlsDisabled || (!!result && !isSelected)} />
              );
            })}
          </div>
        </div>

        {/* RIGHT — Result / Rules + Provably Fair */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>

          {revealed && settledResult ? (
            <div className="card" style={{
              padding: "0.875rem",
              background: won ? "rgba(0,255,157,0.05)" : "rgba(255,80,80,0.05)",
              borderColor: won ? "rgba(0,255,157,0.25)" : "rgba(255,80,80,0.25)",
            }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: won ? GREEN_C : "#ff8080",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
                {won ? "✓ Result — Win" : "✗ Result — Loss"}
              </div>
              <div style={{ textAlign: "center", paddingBottom: "0.75rem", borderBottom: "1px solid #1a1a35", marginBottom: "0.6rem" }}>
                <div style={{ fontSize: "1.1rem", fontWeight: 900, color: won ? GREEN_C : "#ff8080", marginBottom: "0.15rem" }}>
                  {matchCount} match{matchCount !== 1 ? "es" : ""}
                  {won ? ` — ${multiplier}×` : " — No win"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {[
                  { label: "Net Payout", value: won ? `${netPayoutGzo.toLocaleString(undefined, { maximumFractionDigits: 4 })} GZO` : "0 GZO", accent: won ? GREEN_C : "#8888aa" },
                  { label: "Stake",      value: `${settledResult.stakeGzo} GZO`, accent: undefined },
                  { label: "Multiplier", value: won ? `${multiplier}×` : "—", accent: won ? ACCENT : "#8888aa" },
                ].map(({ label, value, accent }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.75rem", color: "#8888aa" }}>{label}</span>
                    <span style={{ fontSize: "0.8rem", fontWeight: 700, color: accent ?? "#f0f0ff" }}>{value}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "0.6rem", background: "#0d0d1a", borderRadius: "8px", padding: "0.5rem", fontSize: "0.68rem", color: "#8888aa" }}>
                <div style={{ fontWeight: 700, color: "#f0f0ff", marginBottom: "0.3rem" }}>Onchain Draw</div>
                <div style={{ fontFamily: "monospace", color: "#f0f0ff", lineHeight: 1.8 }}>
                  {drawnFinal.slice(0, 5).join(", ")}{drawnFinal.length > 5 ? ", …" : ""}
                </div>
              </div>
              {result?.roundId && (
                <div style={{ marginTop: "0.5rem", borderTop: "1px solid #2a2a50", paddingTop: "0.5rem" }}>
                  <div style={{ fontSize: "0.62rem", color: "#555577", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Round ID</div>
                  <div style={{ fontSize: "0.52rem", fontFamily: "monospace", color: "#8888aa", wordBreak: "break-all", lineHeight: 1.5 }}>{result.roundId}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff",
                textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
                Quick Rules
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {[
                  { label: "Numbers pool",    value: "1–40",         color: ACCENT    },
                  { label: "Drawn per round", value: "10",           color: "#00d4ff" },
                  { label: "Your picks",      value: "1–10",         color: GREEN_C   },
                  { label: "Max multiplier",  value: "10,000×",      color: "#f59e0b" },
                  { label: "Fee",             value: "10% on profit", color: "#8888aa" },
                ].map(p => (
                  <div key={p.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem" }}>
                    <span style={{ color: "#8888aa" }}>{p.label}</span>
                    <span style={{ fontWeight: 700, color: p.color, fontFamily: "monospace" }}>{p.value}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "0.75rem", borderTop: "1px solid #1a1a35", paddingTop: "0.5rem",
                fontSize: "0.65rem", color: "#555577", lineHeight: 1.6 }}>
                More picks = higher max multipliers but lower hit probability.
              </div>
            </div>
          )}

          {/* Provably Fair */}
          <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff",
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
              Provably Fair
            </div>
            {revealed && settledResult ? (
              <div style={{ fontSize: "0.7rem", color: "#8888aa", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <div><span style={{ color: "#555577" }}>Matches: </span>
                  <span style={{ fontFamily: "monospace", color: won ? GREEN_C : "#ff8080", fontWeight: 700 }}>{matchCount}</span></div>
                <div><span style={{ color: "#555577" }}>Multiplier: </span>
                  <span style={{ fontFamily: "monospace", color: ACCENT }}>{multiplier.toFixed(2)}×</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.25rem" }}>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00d4ff", flexShrink: 0 }} />
                  <span style={{ fontSize: "0.65rem", color: "#00d4ff", fontWeight: 700 }}>Chainlink VRF v2.5</span>
                </div>
                <p style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.25rem", lineHeight: 1.6 }}>
                  Draw generated by Chainlink VRF via Fisher-Yates shuffle — fully verifiable on-chain, tamper-proof.
                </p>
              </div>
            ) : isVrfPending ? (
              <div style={{ fontSize: "0.7rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <div style={{ width: "10px", height: "10px", border: `2px solid ${ACCENT}`,
                  borderTopColor: "transparent", borderRadius: "50%",
                  animation: "vrfSpin 0.8s linear infinite", flexShrink: 0 }} />
                Awaiting Chainlink VRF on-chain…
              </div>
            ) : (
              <div style={{ fontSize: "0.7rem", color: "#555577", lineHeight: 1.6 }}>
                Every draw uses Chainlink VRF on Polygon — a tamper-proof random seed drives a Fisher-Yates shuffle of 1–40. No one can predict or alter the result.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* How to Play */}
      <div className="card" style={{ background: `rgba(168,85,247,0.02)`, borderColor: `rgba(168,85,247,0.15)`,
        marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT,
          display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiTarget size={16} color={ACCENT} /> How to Play
        </h2>
        <div className="howto-grid" style={{ alignItems: "start" }}>
          {[
            { step:"1", title:"Sign In",           desc:"Log in with your wallet. Your GZO balance is held custodially — no per-bet wallet approval needed.", icon: <SiWallet size={14} color={ACCENT} /> },
            { step:"2", title:"Pick a Chip",        desc:"Choose your bet size: 10, 50, 100, 500 GZO or enter a custom amount.", icon: <SiChip size={14} color={ACCENT} /> },
            { step:"3", title:"Select Numbers",     desc:"Click 1 to 10 numbers from the 1–40 grid. More picks = higher max multipliers.", icon: <SiGrid size={14} color={ACCENT} /> },
            { step:"4", title:"Place Your Bet",     desc:"Click Play Keno. Your stake debits instantly. The house wallet submits the bet on-chain via Chainlink VRF.", icon: <SiCards size={14} color={ACCENT} /> },
            { step:"5", title:"Watch the Reveal",   desc:"Wait ~1–3 min for VRF on Amoy. 10 numbers are revealed one by one — green = match, purple = drawn, red = missed.", icon: <SiEye size={14} color={ACCENT} /> },
            { step:"6", title:"Collect Winnings",   desc:"Payout based on pick count and match count. Up to 10,000× for a perfect 10/10! Credited to your DB balance.", icon: <SiCoins size={14} color={ACCENT} /> },
          ].map(item => (
            <div key={item.step} style={{ background: `rgba(168,85,247,0.03)`, border: `1px solid rgba(168,85,247,0.1)`,
              borderRadius: "10px", padding: "0.875rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%",
                background: `rgba(168,85,247,0.12)`, border: `1px solid rgba(168,85,247,0.3)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.7rem", fontWeight: 800, color: ACCENT }}>
                {item.step}
              </div>
              <div>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f0f0ff", marginBottom: "0.2rem" }}>{item.icon} {item.title}</div>
                <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <OtherGames exclude="keno" />

      {/* How It Works */}
      <div className="card" style={{ background: `rgba(168,85,247,0.02)`, borderColor: `rgba(168,85,247,0.15)`,
        marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT,
          display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiGear size={16} color={ACCENT} /> How It Works
        </h2>
        <div className="stat-grid-2" style={{ alignItems: "start" }}>
          {[
            { icon: <SiWallet size={20} color={ACCENT} />, title:"Custodial DB Balance",    desc:"Your GZO balance is tracked in our database. Stake debits instantly when you play — no wallet approval or gas from your wallet." },
            { icon: <SiDice size={20} color={ACCENT} />, title:"Chainlink VRF Randomness",  desc:"The house wallet calls KenoGame.placeBetFor() on-chain. The contract requests a random word from Chainlink VRF — cryptographically tamper-proof." },
            { icon: <SiShuffle size={20} color={ACCENT} />, title:"Fisher-Yates Shuffle",   desc:"The VRF result seeds a deterministic Fisher-Yates shuffle of [1..40] fully on-chain. The first 10 shuffled values are the official draw — verifiable by anyone from the VRF seed alone." },
            { icon: <SiZap size={20} color={ACCENT} />, title:"Paytable Settlement",         desc:"Once VRF fulfills (~1–3 min on Amoy), the contract records the result on-chain. The backend credits your DB balance based on pick count and match count. 10% fee on profit only." },
          ].map(item => (
            <div key={item.title} style={{ background: `rgba(168,85,247,0.03)`, border: `1px solid rgba(168,85,247,0.1)`,
              borderRadius: "10px", padding: "0.875rem" }}>
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
        <BetHistory game="KENO" refreshTrigger={historyTick} />
      </div>

      <style>{`
        @keyframes vrfSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes nucleusPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.25)} }
        @keyframes orbitSpin0 { from{transform:rotateZ(0deg) rotateX(15deg)} to{transform:rotateZ(360deg) rotateX(15deg)} }
        @keyframes orbitSpin1 { from{transform:rotateZ(0deg) rotateX(75deg) rotateZ(60deg)} to{transform:rotateZ(360deg) rotateX(75deg) rotateZ(60deg)} }
        @keyframes orbitSpin2 { from{transform:rotateZ(120deg) rotateX(45deg) rotateZ(0deg)} to{transform:rotateZ(120deg) rotateX(45deg) rotateZ(360deg)} }
        @keyframes progDot { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
      `}</style>
    </div>
  );
}

export default function KenoPage() {
  return <KenoInner />;
}
