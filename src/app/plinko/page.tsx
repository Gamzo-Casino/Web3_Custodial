"use client";

import { useState, useEffect, useRef } from "react";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import { PLINKO_MULTIPLIERS, type PlinkoRisk, type PlinkoRows } from "@/lib/plinko";
import OtherGames from "@/components/OtherGames";
import BetHistory from "@/components/BetHistory";
import { SiTarget, SiGear, SiWallet, SiChip, SiSliders, SiDropBall, SiArrowDown, SiCoins, SiDice, SiBarChart, SiZap } from "@/components/GameIcons";

// ── Theme ─────────────────────────────────────────────────────────────────────
const ACCENT  = "#ffd700";
const ACCENT2 = "#ffaa00";
const GREEN_C = "#00ff9d";

// ── Helpers ───────────────────────────────────────────────────────────────────
function mulColor(m: number): string {
  if (m >= 10) return "#ffd700";
  if (m >= 5)  return "#ff9d00";
  if (m >= 2)  return "#00ff9d";
  if (m >= 1)  return "#00d4ff";
  return "#8888aa";
}

const PEG_SPACING = 36;
const ROW_HEIGHT  = 34;
const PEG_R       = 4;
const BALL_R      = 7;

let _glowId = 0;

const RISK_LABELS: PlinkoRisk[] = ["low", "med", "high"];
const riskColors: Record<PlinkoRisk, string> = { low: "#00ff9d", med: "#00d4ff", high: "#ff8080" };

// ── Casino Chip Config ────────────────────────────────────────────────────────
const CHIP_OPTIONS = [
  { value: 10,  color: "#00d4ff", label: "10"  },
  { value: 50,  color: "#00ff9d", label: "50"  },
  { value: 100, color: ACCENT,    label: "100" },
  { value: 500, color: "#ff4444", label: "500" },
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
        cursor: disabled ? "not-allowed" : "pointer", position: "relative",
        border: `3px solid ${active ? color : color + "66"}`,
        background: active
          ? `radial-gradient(circle at 35% 35%, ${color}33 0%, ${color}11 60%, ${color}22 100%)`
          : `radial-gradient(circle at 35% 35%, ${color}18 0%, #0d0d1a 70%)`,
        boxShadow: active
          ? `0 0 16px ${color}88, 0 0 32px ${color}44, inset 0 0 12px ${color}22`
          : `0 0 6px ${color}33, inset 0 0 6px ${color}11`,
        transition: "all 0.15s ease",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: "1px", outline: "none",
        opacity: disabled ? 0.45 : 1,
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
      <span style={{
        fontSize: "0.45rem", color: active ? color + "cc" : color + "66",
        fontWeight: 600, position: "relative", zIndex: 1, letterSpacing: "0.04em",
      }}>
        GZO
      </span>
    </button>
  );
}

// ── Neon Atom Loader ──────────────────────────────────────────────────────────
const VRF_PHASES = [
  "Submitting bet on-chain…",
  "Awaiting Chainlink VRF…",
  "VRF fulfilling…",
  "Settling result…",
];

function AtomLoader({ phaseText }: { phaseText: string }) {
  const c0 = ACCENT; const c1 = "#00d4ff"; const c2 = GREEN_C;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "2rem 1rem" }}>
      <div className="atom-wrap" style={{ position: "relative", width: "130px", height: "130px" }}>
        <div className="nucleus" style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)", width: "20px", height: "20px", borderRadius: "50%",
          background: `radial-gradient(circle, white 0%, ${c0} 70%)`,
          boxShadow: `0 0 6px white, 0 0 18px ${c0}, 0 0 36px ${c0}88`, zIndex: 10,
        }} />
        {[c0, c1, c2].map((c, i) => (
          <div key={i} className={`orbit orbit-${i}`} style={{
            position: "absolute", top: "50%", left: "50%",
            width: "120px", height: "50px", marginTop: "-25px", marginLeft: "-60px",
            border: `1.5px solid ${c}50`, borderRadius: "50%",
          }}>
            <div style={{
              position: "absolute", top: "-5px", left: "calc(50% - 5px)", width: "10px", height: "10px",
              borderRadius: "50%", background: c, boxShadow: `0 0 8px ${c}, 0 0 16px ${c}99`,
            }} />
          </div>
        ))}
        <div style={{
          position: "absolute", top: "50%", left: "50%", width: "130px", height: "130px",
          marginTop: "-65px", marginLeft: "-65px", borderRadius: "50%",
          border: `1px solid ${c0}20`,
          boxShadow: `0 0 30px ${c0}10, inset 0 0 30px ${c0}08`, pointerEvents: "none",
        }} />
      </div>
      <div style={{ textAlign: "center", maxWidth: "280px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}` }} />
          <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f0f0ff" }}>Awaiting Chainlink VRF</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#8888aa", lineHeight: 1.6, margin: 0 }}>
          Chainlink VRF is generating your provably fair ball path on-chain.
        </p>
        <p style={{ fontSize: "0.68rem", color: ACCENT, lineHeight: 1.6, margin: "0.4rem 0 0 0", fontWeight: 600 }}>
          {phaseText}
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem", marginTop: "0.875rem" }}>
          {[0, 1, 2].map(i => (
            <div key={i} className={`prog-dot prog-dot-${i}`} style={{
              width: "6px", height: "6px", borderRadius: "50%", background: c0, opacity: 0.3,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Right Panel ───────────────────────────────────────────────────────────────
function RightPanel({ isSettled, isWaiting, won, displayMultiplier, netPayoutGzo, stakeGzo,
  animBin, animRisk, animRows, animPath, roundId }: {
  isSettled: boolean; isWaiting: boolean; won: boolean;
  displayMultiplier: number | null; netPayoutGzo: number | null; stakeGzo: number | null;
  animBin: number | null; animRisk: PlinkoRisk; animRows: PlinkoRows;
  animPath: boolean[] | null; roundId: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      {isSettled && displayMultiplier !== null ? (
        <div className="card" style={{
          padding: "0.875rem",
          background: won ? "rgba(0,255,157,0.04)" : "rgba(255,80,80,0.04)",
          borderColor: won ? "rgba(0,255,157,0.25)" : "rgba(255,80,80,0.25)",
        }}>
          <div style={{
            fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.06em", marginBottom: "0.625rem",
            color: won ? GREEN_C : "#ff8080",
          }}>
            {won ? "✓ Result — Win" : "✗ Result — Loss"}
          </div>
          <div style={{ textAlign: "center", marginBottom: "0.75rem" }}>
            <div style={{
              fontSize: "2.5rem", fontWeight: 900, fontFamily: "monospace",
              color: mulColor(displayMultiplier), letterSpacing: "-1px", lineHeight: 1,
            }}>
              {displayMultiplier}×
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <RPRow label="Risk" value={animRisk} />
            <RPRow label="Rows" value={String(animRows)} />
            <RPRow label="Bin" value={String(animBin ?? "—")} />
            <RPRow label="Path" value={animPath ? animPath.slice(0, 8).map(b => b ? "R" : "L").join("") + (animPath.length > 8 ? "…" : "") : "—"} />
            <RPRow label="Stake" value={`${stakeGzo ?? "—"} GZO`} />
            <div style={{
              borderTop: "1px solid #2a2a50", marginTop: "0.25rem", paddingTop: "0.3rem",
              display: "flex", justifyContent: "space-between", fontSize: "0.82rem",
              fontWeight: 800, color: won ? GREEN_C : "#ff8080",
            }}>
              <span>Net Payout</span>
              <span>{netPayoutGzo !== null ? `${netPayoutGzo.toLocaleString(undefined, { maximumFractionDigits: 4 })} GZO` : "0 GZO"}</span>
            </div>
          </div>
          {roundId && (
            <div style={{ marginTop: "0.5rem", borderTop: "1px solid #2a2a50", paddingTop: "0.5rem" }}>
              <div style={{ fontSize: "0.62rem", color: "#555577", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Round ID</div>
              <div style={{ fontSize: "0.55rem", fontFamily: "monospace", color: "#8888aa", wordBreak: "break-all", lineHeight: 1.5 }}>{roundId}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
            Quick Rules
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {[
              { label: "Rows",  value: "8 / 12 / 16" },
              { label: "Risk",  value: "Low / Med / High" },
              { label: "Pegs",  value: "Each row +1 peg" },
              { label: "Bins",  value: "rows + 1 slots" },
              { label: "Max",   value: "1000× (16 rows, high)" },
            ].map(({ label, value }) => (
              <RPRow key={label} label={label} value={value} />
            ))}
          </div>
          <div style={{ marginTop: "0.625rem", borderTop: "1px solid #1a1a35", paddingTop: "0.5rem", fontSize: "0.65rem", color: "#555577", lineHeight: 1.6 }}>
            10% fee on profit only.<br />Center bins = lowest multiplier. Edge bins = highest.
          </div>
        </div>
      )}

      {/* Provably Fair */}
      <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
          Provably Fair
        </div>
        {isSettled ? (
          <div style={{ fontSize: "0.7rem", color: "#8888aa", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <div>
              <span style={{ color: "#555577" }}>Landed: </span>
              <span style={{ fontFamily: "monospace", color: displayMultiplier ? mulColor(displayMultiplier) : "#8888aa", fontWeight: 700 }}>
                bin {animBin ?? "—"} ({displayMultiplier ?? "—"}×)
              </span>
            </div>
            <div>
              <span style={{ color: "#555577" }}>Payout: </span>
              <span style={{ fontFamily: "monospace", color: won ? GREEN_C : "#ff8080" }}>
                {netPayoutGzo !== null ? `${netPayoutGzo.toLocaleString(undefined, { maximumFractionDigits: 4 })} GZO` : "0 GZO"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.25rem" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00d4ff", flexShrink: 0 }} />
              <span style={{ fontSize: "0.65rem", color: "#00d4ff", fontWeight: 700 }}>Chainlink VRF v2.5</span>
            </div>
            <p style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.25rem", lineHeight: 1.6 }}>
              Path derived from Chainlink VRF on-chain — fully verifiable, no server involvement.
            </p>
          </div>
        ) : isWaiting ? (
          <div style={{ fontSize: "0.7rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <div style={{
              width: "10px", height: "10px", border: `2px solid ${ACCENT}`,
              borderTopColor: "transparent", borderRadius: "50%",
              animation: "vrfSpin 0.8s linear infinite", flexShrink: 0,
            }} />
            Awaiting Chainlink VRF on-chain…
          </div>
        ) : (
          <div style={{ fontSize: "0.7rem", color: "#555577", lineHeight: 1.6 }}>
            Every drop uses Chainlink VRF on Polygon — a tamper-proof random number generated on-chain. The ball path is derived from VRF bits; no one can predict or manipulate the result.
          </div>
        )}
      </div>
    </div>
  );
}

function RPRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem" }}>
      <span style={{ color: "#8888aa" }}>{label}</span>
      <span style={{ color: "#f0f0ff", fontFamily: "monospace", textTransform: "capitalize" }}>{value}</span>
    </div>
  );
}

// ── PlinkoBoard ───────────────────────────────────────────────────────────────
function PlinkoBoard({
  rows, risk, path, animStep, binIndex,
}: {
  rows: PlinkoRows; risk: PlinkoRisk;
  path: boolean[] | null; animStep: number; binIndex: number | null;
}) {
  const glowId      = useRef(`glow-${_glowId++}`).current;
  const multipliers = PLINKO_MULTIPLIERS[rows][risk];
  const boardWidth  = (rows + 2) * PEG_SPACING;
  const boardHeight = (rows + 3) * ROW_HEIGHT;
  const cx          = boardWidth / 2;

  const ballPositions: { x: number; y: number }[] = [{ x: cx, y: 0.4 * ROW_HEIGHT }];
  if (path) {
    let bx = cx;
    for (let r = 0; r < rows; r++) {
      bx += path[r] ? PEG_SPACING / 2 : -PEG_SPACING / 2;
      ballPositions.push({ x: bx, y: (r + 1.5) * ROW_HEIGHT });
    }
    ballPositions.push({ x: bx, y: (rows + 1.5) * ROW_HEIGHT });
  }

  const trailEdges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (path && animStep > 0) {
    for (let i = 0; i < Math.min(animStep, ballPositions.length - 1); i++) {
      trailEdges.push({ x1: ballPositions[i].x, y1: ballPositions[i].y, x2: ballPositions[i + 1].x, y2: ballPositions[i + 1].y });
    }
  }

  const currentBall = path && animStep > 0 ? ballPositions[Math.min(animStep, ballPositions.length - 1)] : null;

  return (
    <svg
      viewBox={`0 0 ${boardWidth} ${boardHeight}`}
      width={boardWidth}
      height={boardHeight}
      style={{ display: "block", margin: "0 auto", maxWidth: "100%" }}
    >
      <rect width={boardWidth} height={boardHeight} fill="#0a0a18" rx={8} />

      {multipliers.map((m, i) => {
        const binW      = PEG_SPACING;
        const bx        = cx - (rows * PEG_SPACING) / 2 + i * PEG_SPACING - PEG_SPACING / 2;
        const by        = (rows + 1) * ROW_HEIGHT + 4;
        const bh        = ROW_HEIGHT - 8;
        const isLanding = binIndex !== null && i === binIndex && animStep >= rows + 1;
        const color     = mulColor(m);
        return (
          <g key={i}>
            <rect x={bx + 1} y={by} width={binW - 2} height={bh} rx={3}
              fill={isLanding ? color : "rgba(255,255,255,0.04)"}
              stroke={isLanding ? color : "rgba(255,255,255,0.1)"}
              strokeWidth={isLanding ? 2 : 1} />
            <text x={bx + binW / 2} y={by + bh / 2 + 1} textAnchor="middle" dominantBaseline="middle"
              fill={isLanding ? "#000" : color}
              fontSize={m >= 10 ? 7 : m >= 2 ? 8 : 9} fontWeight={800} fontFamily="monospace">
              {m}x
            </text>
          </g>
        );
      })}

      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: r + 1 }, (_, s) => {
          const pegX = cx - (r * PEG_SPACING) / 2 + s * PEG_SPACING;
          const pegY = (r + 1) * ROW_HEIGHT;
          return <circle key={`${r}-${s}`} cx={pegX} cy={pegY} r={PEG_R} fill="#2a2a50" stroke="#4444aa" strokeWidth={1} />;
        })
      )}

      {trailEdges.map((e, i) => (
        <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke="rgba(255,215,0,0.6)" strokeWidth={2} strokeLinecap="round" />
      ))}

      {currentBall && (
        <circle cx={currentBall.x} cy={currentBall.y} r={BALL_R} fill="#ffd700" filter={`url(#${glowId})`} />
      )}

      <defs>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
    </svg>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.7rem", fontWeight: 600,
  color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.4rem",
};
const inputStyle: React.CSSProperties = {
  width: "100%", background: "#0d0d1a", border: "1px solid #2a2a50",
  borderRadius: "8px", padding: "0.5rem 0.75rem", color: "#f0f0ff",
  fontSize: "0.9375rem", fontWeight: 700, outline: "none", boxSizing: "border-box",
};

// ── Result type ───────────────────────────────────────────────────────────────
interface PlinkoResult {
  won:           boolean;
  pathBits:      number;
  binIndex:      number;
  multiplier:    number;
  rows:          PlinkoRows;
  risk:          PlinkoRisk;
  netPayoutGzo:  number;
  grossPayoutGzo: number;
  feeGzo:        number;
  balanceAfter:  number;
  roundId:       string;
  betId:         string;
}

// ── Main Page Component ───────────────────────────────────────────────────────
function PlinkoInner() {
  const { formatted: balFmt, refetch: refetchBalance } = useDBBalance();

  const [chipValue,   setChipValue]   = useState(100);
  const [customStake, setCustomStake] = useState(100);
  const [risk,        setRisk]        = useState<PlinkoRisk>("med");
  const [rows,        setRows]        = useState<PlinkoRows>(12);
  const [animStep,    setAnimStep]    = useState(0);
  const [animPath,    setAnimPath]    = useState<boolean[] | null>(null);
  const [animBin,     setAnimBin]     = useState<number | null>(null);
  const [animRows,    setAnimRows]    = useState<PlinkoRows>(12);
  const [animRisk,    setAnimRisk]    = useState<PlinkoRisk>("med");
  const [settled,     setSettled]     = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [isDropping,  setIsDropping]  = useState(false);
  const [pendingRoundId, setPendingRoundId] = useState<string | null>(null);
  const [vrfPhase,    setVrfPhase]    = useState(0);
  const [result,      setResult]      = useState<PlinkoResult | null>(null);
  const [dropError,   setDropError]   = useState<string | null>(null);

  const animRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMounted    = useRef(true);

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
    const TIMEOUT      = 8 * 60 * 1000;
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
        setIsDropping(false);
        setDropError("VRF timeout — Chainlink took too long. Please try again.");
        return;
      }

      try {
        const res = await fetch(`/api/games/plinko/status?roundId=${encodeURIComponent(pendingRoundId)}`);
        const data = await res.json();
        if (!isMounted.current) return;

        if (data.settled) {
          clearInterval(pollTimerRef.current!);
          clearInterval(phaseTimerRef.current!);
          setPendingRoundId(null);
          setIsDropping(false);
          setResult(data as PlinkoResult);
          refetchBalance();
          setHistoryTick(t => t + 1);

          // Decode path from pathBits and start animation
          const pathBitsNum  = Number(data.pathBits);
          const numRows: PlinkoRows = data.rows as PlinkoRows;
          const riskLabel: PlinkoRisk = data.risk as PlinkoRisk;
          const path: boolean[] = Array.from({ length: numRows }, (_, i) => ((pathBitsNum >> i) & 1) === 1);

          setAnimPath(path);
          setAnimBin(data.binIndex);
          setAnimRows(numRows);
          setAnimRisk(riskLabel);
          setSettled(false);
          runAnimation(path, numRows);
        }
      } catch {
        // network hiccup — will retry
      }
    }, POLL_INTERVAL);

    return () => {
      clearInterval(pollTimerRef.current!);
      clearInterval(phaseTimerRef.current!);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoundId]);

  function runAnimation(path: boolean[], totalRows: number) {
    if (animRef.current) clearTimeout(animRef.current);
    setAnimStep(0);
    setSettled(false);
    let step = 0;
    const totalSteps = totalRows + 1;
    const delay = Math.max(80, 600 / totalRows);
    function tick() {
      if (!isMounted.current) return;
      step++;
      setAnimStep(step);
      if (step < totalSteps) {
        animRef.current = setTimeout(tick, delay);
      } else {
        setSettled(true);
      }
    }
    animRef.current = setTimeout(tick, 100);
  }

  async function handleDrop() {
    if (isDropping || pendingRoundId) return;
    setIsDropping(true);
    setDropError(null);
    setResult(null);
    setAnimPath(null);
    setAnimBin(null);
    setAnimStep(0);
    setSettled(false);

    try {
      const res = await fetch("/api/games/plinko/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeGzo: chipValue, rows, risk }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to place bet");
      if (!isMounted.current) return;

      refetchBalance();
      setPendingRoundId(data.roundId);
    } catch (e: unknown) {
      if (!isMounted.current) return;
      setIsDropping(false);
      setDropError(e instanceof Error ? e.message : "Failed to drop ball. Try again.");
    }
  }

  function handleDropAgain() {
    setResult(null);
    setAnimPath(null);
    setAnimBin(null);
    setAnimStep(0);
    setSettled(false);
    setDropError(null);
  }

  // ── Derived state ─────────────────────────────────────────────────────────────
  const isVrfPending     = !!pendingRoundId;
  const animating        = !!animPath && !settled;
  const controlsDisabled = isDropping || isVrfPending || animating;

  const centerBin        = Math.floor(rows / 2);
  const centerMultiplier = PLINKO_MULTIPLIERS[rows][risk][centerBin];
  const maxMultiplier    = PLINKO_MULTIPLIERS[rows][risk][0];

  const settledResult     = settled && result ? result : null;
  const displayMultiplier = settledResult?.multiplier ?? null;
  const netPayoutGzo      = settledResult?.netPayoutGzo ?? null;
  const won               = settledResult?.won ?? false;

  const boardRows = animPath ? animRows : rows;
  const boardRisk = animPath ? animRisk : risk;
  const showLoader = (isDropping || isVrfPending) && !animPath;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{
          fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem",
          background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
        }}>
          Plinko
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>
          Drop a ball, watch it bounce. Custodial · Chainlink VRF · Provably fair.
        </p>
        <p style={{ color: "#555577", fontSize: "0.8rem", marginTop: "0.25rem" }}>
          Balance: <span style={{ color: ACCENT, fontWeight: 700 }}>{balFmt} GZO</span>
        </p>
      </div>

      {/* ── 3-column layout ────────────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "220px minmax(0,1fr) 240px",
        gap: "1.25rem",
        marginBottom: "1.25rem",
      }}>

        {/* ── LEFT — Controls ─────────────────────────────────────────────── */}
        <div className="card" style={{
          display: "flex", flexDirection: "column", gap: "1rem",
          background: "rgba(255,215,0,0.03)", borderColor: "rgba(255,215,0,0.2)",
        }}>

          {/* Chip selector */}
          <div>
            <label style={labelStyle}>Stake (GZO)</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", justifyItems: "center" }}>
              {CHIP_OPTIONS.map(chip => (
                <CasinoChip key={chip.value} value={chip.value} color={chip.color}
                  active={chipValue === chip.value && customStake === chip.value}
                  disabled={controlsDisabled}
                  onClick={() => { setChipValue(chip.value); setCustomStake(chip.value); }} />
              ))}
            </div>
          </div>

          {/* Custom amount */}
          <div>
            <label style={labelStyle}>Custom Amount</label>
            <input
              type="number" min={1} max={100000} value={customStake}
              onChange={e => {
                const v = Math.max(1, parseInt(e.target.value) || 1);
                setCustomStake(v);
                setChipValue(v);
              }}
              disabled={controlsDisabled}
              style={{ ...inputStyle, opacity: controlsDisabled ? 0.5 : 1 }}
            />
          </div>

          {/* Rows selector */}
          <div>
            <label style={labelStyle}>Rows</label>
            <div style={{ display: "flex", gap: "0.375rem" }}>
              {([8, 12, 16] as PlinkoRows[]).map((r) => (
                <button key={r} onClick={() => setRows(r)} disabled={controlsDisabled}
                  style={{
                    flex: 1, padding: "0.45rem", borderRadius: "8px",
                    border: `1px solid ${rows === r ? ACCENT : "#2a2a50"}`,
                    background: rows === r ? "rgba(255,215,0,0.1)" : "#0d0d1a",
                    color: rows === r ? ACCENT : "#8888aa",
                    fontWeight: 700, fontSize: "0.875rem",
                    cursor: controlsDisabled ? "not-allowed" : "pointer",
                    opacity: controlsDisabled ? 0.5 : 1,
                  }}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Risk selector */}
          <div>
            <label style={labelStyle}>Risk</label>
            <div style={{ display: "flex", gap: "0.375rem" }}>
              {(["low", "med", "high"] as PlinkoRisk[]).map((r) => (
                <button key={r} onClick={() => setRisk(r)} disabled={controlsDisabled}
                  style={{
                    flex: 1, padding: "0.45rem", borderRadius: "8px",
                    border: `1px solid ${risk === r ? riskColors[r] : "#2a2a50"}`,
                    background: risk === r ? `${riskColors[r]}18` : "#0d0d1a",
                    color: risk === r ? riskColors[r] : "#8888aa",
                    fontWeight: 700, fontSize: "0.8rem", textTransform: "capitalize",
                    cursor: controlsDisabled ? "not-allowed" : "pointer",
                    opacity: controlsDisabled ? 0.5 : 1,
                  }}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Multiplier preview */}
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <div style={{ background: "#0d0d1a", borderRadius: "8px", padding: "0.5rem 0.6rem", flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.6rem", color: "#8888aa", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.15rem" }}>Center</div>
              <div style={{ fontSize: "0.875rem", fontWeight: 800, color: mulColor(centerMultiplier), fontFamily: "monospace" }}>{centerMultiplier}×</div>
            </div>
            <div style={{ background: "#0d0d1a", borderRadius: "8px", padding: "0.5rem 0.6rem", flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.6rem", color: "#8888aa", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.15rem" }}>Max</div>
              <div style={{ fontSize: "0.875rem", fontWeight: 800, color: ACCENT, fontFamily: "monospace" }}>{maxMultiplier}×</div>
            </div>
          </div>

          {/* Stake summary */}
          <div style={{ borderTop: "1px solid #2a2a50", paddingTop: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
              <span style={{ color: "#8888aa" }}>Stake</span>
              <span style={{ fontWeight: 700, color: ACCENT }}>{chipValue} GZO</span>
            </div>
          </div>

          {/* Error */}
          {dropError && (
            <div style={{
              padding: "0.5rem 0.6rem", borderRadius: "7px",
              background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.35)",
              fontSize: "0.68rem", color: "#ff8080", lineHeight: 1.5,
            }}>
              {dropError}
            </div>
          )}

          {/* Action button */}
          {settled ? (
            <button
              onClick={handleDropAgain}
              style={{
                padding: "0.75rem", borderRadius: "8px",
                border: `1px solid ${ACCENT}44`, background: `${ACCENT}0a`,
                color: ACCENT, fontSize: "0.9375rem", cursor: "pointer", fontWeight: 700,
              }}
            >
              Drop Again
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={handleDrop}
              disabled={controlsDisabled}
              style={{
                width: "100%", fontSize: "1rem", padding: "0.75rem",
                background: controlsDisabled ? "#2a2a50" : `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`,
                border: "none", cursor: controlsDisabled ? "not-allowed" : "pointer",
                opacity: controlsDisabled ? 0.6 : 1,
                color: controlsDisabled ? "#fff" : "#0a0a18",
                fontWeight: 800,
                boxShadow: controlsDisabled ? "none" : `0 0 24px ${ACCENT}55, 0 0 48px ${ACCENT}22`,
                transition: "all 0.2s ease",
              }}
            >
              {isDropping && !pendingRoundId ? "Submitting…"
                : isVrfPending ? "Awaiting VRF…"
                : animating ? "Ball falling…"
                : "Drop Ball"}
            </button>
          )}
        </div>

        {/* ── CENTER — Plinko board ─────────────────────────────────────────── */}
        <div
          className="card"
          style={{
            minWidth: 0,
            padding: "1.25rem 0.5rem",
            overflowX: "auto",
            background: settled
              ? won ? "rgba(0,255,157,0.04)" : "rgba(255,80,80,0.04)"
              : animating ? "rgba(255,215,0,0.03)"
              : showLoader ? "rgba(0,212,255,0.03)"
              : "rgba(0,0,0,0.25)",
            borderColor: settled
              ? won ? "rgba(0,255,157,0.22)" : "rgba(255,80,80,0.28)"
              : animating ? "rgba(255,215,0,0.25)"
              : showLoader ? "rgba(0,212,255,0.25)"
              : "#2a2a50",
            transition: "background 0.4s, border-color 0.3s",
          }}
        >
          {showLoader ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "300px" }}>
              <AtomLoader phaseText={VRF_PHASES[vrfPhase]} />
            </div>
          ) : (
            <PlinkoBoard
              rows={boardRows}
              risk={boardRisk}
              path={animPath}
              animStep={animStep}
              binIndex={animBin}
            />
          )}
        </div>

        {/* ── RIGHT — Info panel ────────────────────────────────────────────── */}
        <RightPanel
          isSettled={settled}
          isWaiting={isVrfPending && !animPath}
          won={won}
          displayMultiplier={displayMultiplier}
          netPayoutGzo={netPayoutGzo}
          stakeGzo={chipValue}
          animBin={animBin}
          animRisk={animRisk}
          animRows={animRows}
          animPath={animPath}
          roundId={result?.roundId ?? null}
        />

      </div>{/* end 3-col grid */}

      {/* ── How to Play ────────────────────────────────────────────────────── */}
      <div className="card" style={{ background: "rgba(255,215,0,0.02)", borderColor: "rgba(255,215,0,0.15)", marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiTarget size={16} color={ACCENT} /> How to Play
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", alignItems: "start" }}>
          {[
            { step:"1", icon: <SiWallet size={14} color={ACCENT} />, title:"Sign In",            desc:"Log in with your wallet. Your GZO balance is held custodially — no per-bet wallet approval needed." },
            { step:"2", icon: <SiChip size={14} color={ACCENT} />, title:"Pick Your Stake",      desc:"Select a chip (10, 50, 100, 500 GZO) or type a custom amount." },
            { step:"3", icon: <SiSliders size={14} color={ACCENT} />, title:"Set Rows & Risk",   desc:"Choose 8, 12, or 16 peg rows. Low risk = tight spread; High risk = rare massive edge wins." },
            { step:"4", icon: <SiDropBall size={14} color={ACCENT} />, title:"Drop the Ball",    desc:"Click Drop Ball. Your stake debits instantly. The house wallet submits the bet on-chain via Chainlink VRF." },
            { step:"5", icon: <SiArrowDown size={14} color={ACCENT} />, title:"Watch It Bounce", desc:"Wait ~1–3 min for VRF on Amoy. The ball path is derived from VRF bits and animated on screen." },
            { step:"6", icon: <SiCoins size={14} color={ACCENT} />, title:"Collect Winnings",   desc:"Payout = stake × multiplier. Edge bins pay the most. 10% fee on profit only — credited to your DB balance." },
          ].map(item => (
            <div key={item.step} style={{ background: "rgba(255,215,0,0.03)", border: "1px solid rgba(255,215,0,0.1)", borderRadius: "10px", padding: "0.875rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 800, color: ACCENT }}>{item.step}</div>
              <div>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f0f0ff", marginBottom: "0.2rem" }}>{item.icon} {item.title}</div>
                <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Play Another Game ──────────────────────────────────────────────── */}
      <OtherGames exclude="plinko" />

      {/* ── How It Works ──────────────────────────────────────────────────── */}
      <div className="card" style={{ background: "rgba(255,215,0,0.02)", borderColor: "rgba(255,215,0,0.15)", marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiGear size={16} color={ACCENT} /> How It Works
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.75rem", alignItems: "start" }}>
          {[
            { icon: <SiWallet size={20} color={ACCENT} />, title:"Custodial DB Balance",        desc:"Your GZO balance is tracked in our database. When you drop a ball, your stake is debited instantly — no wallet approval, no gas from your wallet." },
            { icon: <SiDice size={20} color={ACCENT} />, title:"Chainlink VRF Randomness",     desc:"The house wallet calls PlinkoGame.dropBallFor() on-chain. The contract requests a random word from Chainlink VRF — cryptographically tamper-proof and verifiable by anyone." },
            { icon: <SiBarChart size={20} color={ACCENT} />, title:"Ball Path from VRF Bits",  desc:"The contract extracts individual bits from the VRF word — one bit per peg row. Bit = 1 → ball goes Right; bit = 0 → Left. The landing bin equals the count of Right steps across all rows." },
            { icon: <SiZap size={20} color={ACCENT} />, title:"Payout & Settlement",           desc:"Once VRF fulfills (~1–3 min on Amoy), the contract records the result on-chain. The backend detects settlement and credits your DB balance. 10% fee on profit only." },
          ].map(item => (
            <div key={item.title} style={{ background: "rgba(255,215,0,0.03)", border: "1px solid rgba(255,215,0,0.1)", borderRadius: "10px", padding: "0.875rem" }}>
              <div style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>{item.icon}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: ACCENT, marginBottom: "0.3rem" }}>{item.title}</div>
              <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Your History ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.875rem", color: "#8888aa" }}>Your History</h2>
        <BetHistory game="PLINKO" refreshTrigger={historyTick} />
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

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PlinkoPage() {
  return <PlinkoInner />;
}
