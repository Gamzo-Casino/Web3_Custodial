"use client";

import { useState, useEffect, useRef } from "react";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import { useWalletUser } from "@/contexts/WalletAuthContext";
import OtherGames from "@/components/OtherGames";
import BetHistory from "@/components/BetHistory";
import {
  WHEEL_CONFIGS,
  stopCenterAngle,
  type WheelConfig,
  type WheelRisk,
  type WheelSegment,
} from "@/lib/wheel";
import { SiTarget, SiGear, SiWallet, SiChip, SiSliders, SiRefresh, SiWheel, SiCoins, SiLock, SiDice, SiBarChart, SiZap } from "@/components/GameIcons";
import CasinoChip, { CHIP_OPTIONS } from "@/components/CasinoChip";

// ── Theme ────────────────────────────────────────────────────────────────────
const ACCENT = "#fb923c";
const GREEN_C = "#00ff9d";
const RED_C   = "#ff5555";

// ── Risk mode meta ────────────────────────────────────────────────────────────
const RISK_META: Record<WheelRisk, { color: string; desc: string }> = {
  low:    { color: "#00d4ff", desc: "Safer — smaller prizes, lower variance" },
  medium: { color: ACCENT,    desc: "Balanced — mix of multipliers" },
  high:   { color: RED_C,     desc: "High risk — rare big wins, more zeroes" },
};

// ── SVG Wheel ─────────────────────────────────────────────────────────────────
function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function segmentPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const s = polarToXY(cx, cy, r, startAngle);
  const e = polarToXY(cx, cy, r, endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z`;
}

function WheelSVG({ config, rotation, transitioning, winningSegIdx, settled }: {
  config: WheelConfig; rotation: number; transitioning: boolean;
  winningSegIdx: number | null; settled: boolean;
}) {
  const SIZE = 320; const cx = SIZE / 2, cy = SIZE / 2, r = SIZE / 2 - 8;
  let cumDeg = 0;
  const segPaths = config.segments.map((seg) => {
    const arcDeg = (seg.weight / config.totalWeight) * 360;
    const startAngle = cumDeg;
    const midAngle = cumDeg + arcDeg / 2;
    const path = segmentPath(cx, cy, r, startAngle, startAngle + arcDeg);
    cumDeg += arcDeg;
    return { seg, path, midAngle, startAngle, arcDeg };
  });

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{ transform: `rotate(${rotation}deg)`,
        transition: transitioning ? "transform 5s cubic-bezier(0.17,0.78,0.16,1.0)" : "none",
        display: "block", filter: "drop-shadow(0 0 20px rgba(0,0,0,0.8))" }}>
      <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#2a2a50" strokeWidth="6" />
      {segPaths.map(({ seg, path, midAngle, arcDeg }) => {
        const isWinner = settled && seg.index === winningSegIdx;
        const lp = polarToXY(cx, cy, r * 0.62, midAngle);
        const showLabel = arcDeg >= 9;
        return (
          <g key={seg.index}>
            <path d={path} fill={isWinner ? seg.textColor + "44" : seg.color}
              stroke="#0d0d1a" strokeWidth="1.5"
              style={{ filter: isWinner ? `drop-shadow(0 0 10px ${seg.textColor})` : "none", transition: "filter 0.3s" }} />
            {showLabel && (
              <text x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
                fill={seg.textColor} fontSize={arcDeg >= 20 ? "13" : "10"} fontWeight="800"
                fontFamily="monospace" transform={`rotate(${midAngle}, ${lp.x}, ${lp.y})`}
                style={{ userSelect: "none", pointerEvents: "none" }}>
                {seg.label}
              </text>
            )}
          </g>
        );
      })}
      {segPaths.map(({ startAngle }, i) => {
        const p = polarToXY(cx, cy, r, startAngle);
        return <line key={i} x1={cx} y1={cy} x2={p.x.toFixed(2)} y2={p.y.toFixed(2)} stroke="#0d0d1a" strokeWidth="2" />;
      })}
      <defs>
        <filter id="centerGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="centerGrad" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#fb923c" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.4" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={34} fill="none" stroke="#fb923c" strokeWidth="1.5" opacity="0.35" filter="url(#centerGlow)" />
      <circle cx={cx} cy={cy} r={28} fill="#0d0d1a" stroke="#fb923c44" strokeWidth="2" />
      <circle cx={cx} cy={cy} r={18} fill="url(#centerGrad)" opacity="0.85" filter="url(#centerGlow)" />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
        fill="#fb923c" fontSize="15" fontWeight="800" fontFamily="monospace"
        filter="url(#centerGlow)" opacity="0.95">✦</text>
    </svg>
  );
}

// ── Atom Loader ───────────────────────────────────────────────────────────────
type LoadPhase = "broadcast" | "vrf";
const PHASE_CONFIG: Record<LoadPhase, { title: string; detail: string; colors: [string, string, string] }> = {
  broadcast: { title: "Placing Bet On-Chain",    detail: "House wallet is submitting your spin to the Polygon blockchain…", colors: ["#00d4ff", GREEN_C, ACCENT] },
  vrf:       { title: "Awaiting Chainlink VRF",  detail: "A tamper-proof random number is being generated on-chain. This takes ~30–60 seconds.", colors: [GREEN_C, ACCENT, "#00d4ff"] },
};

function AtomLoader({ phase }: { phase: LoadPhase }) {
  const cfg = PHASE_CONFIG[phase];
  const [c0, c1, c2] = cfg.colors;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "2rem 1rem" }}>
      <div className="atom-wrap" style={{ position: "relative", width: "130px", height: "130px" }}>
        <div className="nucleus" style={{ position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)", width: "20px", height: "20px", borderRadius: "50%",
          background: `radial-gradient(circle, white 0%, ${c0} 70%)`,
          boxShadow: `0 0 6px white, 0 0 18px ${c0}, 0 0 36px ${c0}88`, zIndex: 10 }} />
        <div className="orbit orbit-0" style={{ position: "absolute", top: "50%", left: "50%",
          width: "120px", height: "50px", marginTop: "-25px", marginLeft: "-60px",
          border: `1.5px solid ${c0}50`, borderRadius: "50%" }}>
          <div style={{ position: "absolute", top: "-5px", left: "calc(50% - 5px)", width: "10px", height: "10px",
            borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}, 0 0 16px ${c0}99` }} />
        </div>
        <div className="orbit orbit-1" style={{ position: "absolute", top: "50%", left: "50%",
          width: "120px", height: "50px", marginTop: "-25px", marginLeft: "-60px",
          border: `1.5px solid ${c1}50`, borderRadius: "50%" }}>
          <div style={{ position: "absolute", top: "-5px", left: "calc(50% - 5px)", width: "10px", height: "10px",
            borderRadius: "50%", background: c1, boxShadow: `0 0 8px ${c1}, 0 0 16px ${c1}99` }} />
        </div>
        <div className="orbit orbit-2" style={{ position: "absolute", top: "50%", left: "50%",
          width: "120px", height: "50px", marginTop: "-25px", marginLeft: "-60px",
          border: `1.5px solid ${c2}40`, borderRadius: "50%" }}>
          <div style={{ position: "absolute", top: "-5px", left: "calc(50% - 5px)", width: "10px", height: "10px",
            borderRadius: "50%", background: c2, boxShadow: `0 0 8px ${c2}, 0 0 16px ${c2}99` }} />
        </div>
        <div style={{ position: "absolute", top: "50%", left: "50%", width: "130px", height: "130px",
          marginTop: "-65px", marginLeft: "-65px", borderRadius: "50%",
          border: `1px solid ${c0}20`, boxShadow: `0 0 30px ${c0}10, inset 0 0 30px ${c0}08`, pointerEvents: "none" }} />
      </div>
      <div style={{ textAlign: "center", maxWidth: "280px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: c0, boxShadow: `0 0 8px ${c0}` }} />
          <span style={{ fontSize: "0.95rem", fontWeight: 800, color: "#f0f0ff" }}>{cfg.title}</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#8888aa", lineHeight: 1.6, margin: 0 }}>{cfg.detail}</p>
        <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem", marginTop: "0.875rem" }}>
          {[0,1,2].map(i => <div key={i} className={`prog-dot prog-dot-${i}`} style={{ width: "6px", height: "6px", borderRadius: "50%", background: c0, opacity: 0.3 }} />)}
        </div>
      </div>
    </div>
  );
}

// ── Right Panel ───────────────────────────────────────────────────────────────
interface SettledResult {
  won: boolean; riskMode: string; stopPosition: number; segmentIndex: number;
  multiplier100: number; netPayoutGzo: number; grossPayoutGzo: number;
  feeGzo: number; balanceAfter: number; stakeGzo: number; roundId: string;
}

function RightPanel({ config, risk, isSettled, isWaiting, winSeg, multiplierDisplay,
  isWin, resultColor, netPayoutDisplay, stakeNum, activeRoundId }: {
  config: WheelConfig; risk: WheelRisk; isSettled: boolean; isWaiting: boolean;
  winSeg: WheelSegment | null; multiplierDisplay: string; isWin: boolean;
  resultColor: string; netPayoutDisplay: string; stakeNum: number; activeRoundId: string | null;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem", height: "100%" }}>
      {isSettled && winSeg ? (
        <div className="card" style={{ padding: "0.875rem",
          background: isWin ? "rgba(0,255,157,0.04)" : "rgba(255,85,85,0.04)",
          borderColor: isWin ? "rgba(0,255,157,0.25)" : "rgba(255,85,85,0.25)" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: isWin ? GREEN_C : RED_C,
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
            {isWin ? "✓ Result — Win" : "✗ Result — Loss"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <RPRow label="Risk Mode" value={risk.charAt(0).toUpperCase() + risk.slice(1)} />
            <RPRow label="Landed" value={winSeg.label} />
            <RPRow label="Multiplier" value={`${multiplierDisplay}×`} />
            <RPRow label="Stake" value={`${stakeNum} GZO`} />
            <div style={{ borderTop: "1px solid #2a2a50", marginTop: "0.25rem", paddingTop: "0.3rem",
              display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 800,
              color: isWin ? GREEN_C : RED_C }}>
              <span>Net Payout</span><span>{netPayoutDisplay} GZO</span>
            </div>
          </div>
          {activeRoundId && (
            <div style={{ marginTop: "0.5rem", borderTop: "1px solid #2a2a50", paddingTop: "0.5rem" }}>
              <div style={{ fontSize: "0.62rem", color: "#555577", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Round ID</div>
              <div style={{ fontSize: "0.58rem", fontFamily: "monospace", color: "#8888aa", wordBreak: "break-all", lineHeight: 1.5 }}>{activeRoundId}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff",
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
            {risk.charAt(0).toUpperCase() + risk.slice(1)} Mode Segments
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {config.segments.map(seg => {
              const pct = ((seg.weight / config.totalWeight) * 100).toFixed(1);
              return (
                <div key={seg.index} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.72rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: seg.color, border: `1px solid ${seg.textColor}66`, flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, color: seg.textColor, fontFamily: "monospace" }}>{seg.label}</span>
                  </div>
                  <span style={{ color: "#555577", fontSize: "0.65rem" }}>{pct}%</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: "0.75rem", borderTop: "1px solid #1a1a35", paddingTop: "0.5rem",
            fontSize: "0.65rem", color: "#555577", lineHeight: 1.6 }}>
            10% fee on profit only.<br />Multiplier 0× = full loss of stake.
          </div>
        </div>
      )}

      {/* Bet Stats */}
      {(() => {
        const winWeight = config.segments.reduce((s, seg) => s + (seg.multiplier > 0 ? seg.weight : 0), 0);
        const winChance = (winWeight / config.totalWeight) * 100;
        const bestMult  = Math.max(...config.segments.map(s => s.multiplier));
        const maxGross  = stakeNum * bestMult;
        const fee       = bestMult > 1 ? Math.floor((maxGross - stakeNum) * 0.1) : 0;
        const maxNet    = maxGross - fee;
        const profitOnWin = maxNet - stakeNum;
        return (
          <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35" }}>
            <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff",
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.625rem" }}>
              Bet Stats
            </div>
            {[
              { label: "Win Chance",    val: `${winChance.toFixed(1)}%`,  color: ACCENT },
              { label: "Best Multiplier", val: `${bestMult}×`,            color: "#e879f9" },
              { label: "Max Gross Win", val: `${maxGross.toLocaleString()} GZO`, color: "#f0f0ff" },
            ].map(row => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", padding: "0.3rem 0",
                borderBottom: "1px solid #1a1a3544" }}>
                <span style={{ fontSize: "0.7rem", color: "#8888aa", textTransform: "uppercase",
                  letterSpacing: "0.07em", fontWeight: 600 }}>{row.label}</span>
                <span style={{ fontSize: "0.82rem", fontWeight: 800, fontFamily: "monospace",
                  color: row.color }}>{row.val}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
              paddingTop: "0.4rem" }}>
              <span style={{ fontSize: "0.7rem", color: "#8888aa", textTransform: "uppercase",
                letterSpacing: "0.07em", fontWeight: 600 }}>Profit on Max Win</span>
              <span style={{ fontSize: "0.78rem", fontWeight: 800, fontFamily: "monospace",
                color: GREEN_C, whiteSpace: "nowrap" }}>
                {profitOnWin > 0 ? `+${profitOnWin.toLocaleString()}` : "—"} GZO
              </span>
            </div>
          </div>
        );
      })()}

      {/* Provably Fair */}
      <div className="card" style={{ padding: "0.875rem", background: "#0a0a18", borderColor: "#1a1a35", flex: 1 }}>
        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#f0f0ff",
          textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
          Provably Fair
        </div>
        {isSettled ? (
          <div style={{ fontSize: "0.7rem", color: "#8888aa", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <div><span style={{ color: "#555577" }}>Landed: </span>
              <span style={{ fontFamily: "monospace", color: resultColor, fontWeight: 700 }}>{winSeg?.label ?? "—"} ({multiplierDisplay}×)</span></div>
            <div><span style={{ color: "#555577" }}>Net payout: </span>
              <span style={{ fontFamily: "monospace", color: isWin ? GREEN_C : RED_C }}>{netPayoutDisplay} GZO</span></div>
            <p style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.25rem", lineHeight: 1.6 }}>
              Result generated on-chain by Chainlink VRF — fully verifiable, no server involvement.
            </p>
          </div>
        ) : isWaiting ? (
          <div style={{ fontSize: "0.7rem", color: ACCENT, display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <div style={{ width: "10px", height: "10px", border: `2px solid ${ACCENT}`, borderTopColor: "transparent",
              borderRadius: "50%", animation: "vrfSpin 0.8s linear infinite", flexShrink: 0 }} />
            Awaiting Chainlink VRF on-chain…
          </div>
        ) : (
          <div style={{ fontSize: "0.7rem", color: "#555577", lineHeight: 1.6 }}>
            Every spin uses Chainlink VRF on Polygon — a tamper-proof random number generated on-chain. No one, including the house, can predict the landing segment.
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

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WheelPage() {
  const { user: walletUser } = useWalletUser();
  const { balance, formatted: balanceFormatted, refetch: refetchBalance } = useDBBalance();

  const [chipValue,     setChipValue]     = useState(100);
  const [customStake,   setCustomStake]   = useState(100);
  const [risk,          setRisk]          = useState<WheelRisk>("medium");
  const [spinning,      setSpinning]      = useState(false);
  const [rotation,      setRotation]      = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [activeRoundId, setActiveRoundId] = useState<string | null>(null);
  const [loadPhase,     setLoadPhase]     = useState<LoadPhase | null>(null);
  const [settledResult, setSettledResult] = useState<SettledResult | null>(null);
  const [showResult,    setShowResult]    = useState(false);
  const [spinError,     setSpinError]     = useState<string | null>(null);
  const [historyTick,   setHistoryTick]   = useState(0);
  const [spinHint,      setSpinHint]      = useState(false);

  const rotationRef    = useRef(0);
  const animTriggered  = useRef(false);
  const isMounted      = useRef(true);
  const pollTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const animTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = WHEEL_CONFIGS[risk];

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, []);

  // ── VRF Polling ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRoundId || settledResult) return;

    let elapsed = 0;
    const TIMEOUT       = 8 * 60 * 1000;
    const POLL_INTERVAL = 3_000;

    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    animTriggered.current = false;

    pollTimerRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      if (elapsed >= TIMEOUT) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        if (!isMounted.current) return;
        setLoadPhase(null);
        setActiveRoundId(null);
        setSpinError("VRF timeout — Chainlink took too long. Please try again.");
        return;
      }

      try {
        const res = await fetch(`/api/games/wheel/status?roundId=${encodeURIComponent(activeRoundId)}`);
        const data = await res.json();
        if (!isMounted.current) return;

        if (data.settled && !animTriggered.current) {
          animTriggered.current = true;
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);

          // Trigger wheel animation
          const stopPos = data.stopPosition as number;
          const centerAngle = stopCenterAngle(stopPos, config.totalWeight);
          const targetOffset = (360 - centerAngle % 360) % 360;
          const extraSpins = 6 * 360;
          const currentRot = rotationRef.current;
          const delta = ((targetOffset - currentRot % 360) + 360) % 360;
          const newRotation = currentRot + delta + extraSpins;
          rotationRef.current = newRotation;

          setLoadPhase(null);
          setSettledResult(data as SettledResult);
          setTransitioning(true);
          setRotation(newRotation);
          setSpinning(true);

          animTimerRef.current = setTimeout(() => {
            if (!isMounted.current) return;
            setTransitioning(false);
            setShowResult(true);
            setSpinning(false);
            refetchBalance();
            setHistoryTick(t => t + 1);
          }, 5400);
        }
      } catch {
        // poll continues on network error
      }
    }, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeRoundId]); // eslint-disable-line

  const isBusy = !!(loadPhase || spinning || (activeRoundId && !settledResult));
  const canSpin = !!walletUser && chipValue > 0 && !isBusy && balance >= chipValue;

  async function handleSpin() {
    if (!walletUser) { setSpinHint(true); setTimeout(() => setSpinHint(false), 3000); return; }
    if (!canSpin) { setSpinHint(true); setTimeout(() => setSpinHint(false), 3000); return; }

    setShowResult(false);
    setActiveRoundId(null);
    setSettledResult(null);
    setSpinError(null);
    setSpinHint(false);
    animTriggered.current = false;
    setLoadPhase("broadcast");

    try {
      const res = await fetch("/api/games/wheel/spin", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ stakeGzo: chipValue, risk }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Spin failed");

      if (!isMounted.current) return;
      setActiveRoundId(data.roundId);
      setLoadPhase("vrf");
    } catch (err) {
      if (!isMounted.current) return;
      setLoadPhase(null);
      setSpinError(err instanceof Error ? err.message : "Spin failed");
    }
  }

  function handleNewRound() {
    setShowResult(false);
    setActiveRoundId(null);
    setSettledResult(null);
    setLoadPhase(null);
    setSpinError(null);
    setSpinHint(false);
    animTriggered.current = false;
  }

  function changeRisk(r: WheelRisk) {
    if (isBusy) return;
    setRisk(r);
    handleNewRound();
  }

  const isSettled = showResult && !!settledResult;
  const isWaiting = !!(activeRoundId && !settledResult && !spinning);
  const multiplier100 = settledResult ? settledResult.multiplier100 : 0;
  const multiplierDisplay = (multiplier100 / 100).toFixed(2).replace(/\.00$/, "");
  const netPayoutDisplay = settledResult ? settledResult.netPayoutGzo.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "0";
  const isWin = isSettled && multiplier100 > 0;
  const resultColor = isSettled ? (isWin ? GREEN_C : RED_C) : ACCENT;
  const winningSegIdx: number | null = settledResult ? settledResult.segmentIndex : null;
  const winSeg = winningSegIdx !== null ? config.segments[winningSegIdx] : null;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.875rem", fontWeight: 800, letterSpacing: "-0.5px", marginBottom: "0.25rem",
          background: `linear-gradient(135deg, ${ACCENT}, #f97316)`,
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
          Wheel
        </h1>
        <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>Spin the wheel — land on a multiplier segment and win big.</p>
        {walletUser && (
          <p style={{ color: "#555577", fontSize: "0.8rem", marginTop: "0.25rem" }}>
            Balance: <span style={{ color: ACCENT, fontWeight: 700 }}>{balanceFormatted} GZO</span>
          </p>
        )}
      </div>

      {/* 3-col layout */}
      <div className="game-3col" style={{ alignItems: "stretch" }}>

        {/* LEFT — Controls */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem",
          background: `rgba(251,146,60,0.03)`, borderColor: `rgba(251,146,60,0.2)` }}>

          {/* Casino chips */}
          <div>
            <label style={labelStyle}>Select Chip (GZO)</label>
            <div className="chip-row">
              {CHIP_OPTIONS.map(chip => (
                <CasinoChip key={chip.value} value={chip.value} color={chip.color}
                  active={chipValue === chip.value} onClick={() => { setChipValue(chip.value); setCustomStake(chip.value); }} />
              ))}
            </div>
          </div>

          {/* Custom amount */}
          <div>
            <label style={labelStyle}>Custom Amount</label>
            <input type="number" min={1} max={10000} value={customStake} disabled={isBusy}
              onChange={e => { const v = Math.max(1, parseInt(e.target.value)||1); setCustomStake(v); setChipValue(v); }}
              style={inputStyle} />
          </div>

          {/* Risk mode */}
          <div>
            <label style={labelStyle}>Risk Mode</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {(["low","medium","high"] as WheelRisk[]).map(r => {
                const active = risk === r;
                const { color, desc } = RISK_META[r];
                const maxMult = Math.max(...WHEEL_CONFIGS[r].segments.map(s => s.multiplier));
                return (
                  <button key={r} onClick={() => changeRisk(r)} disabled={isBusy} style={{
                    padding: "0.5rem 0.65rem", borderRadius: "8px",
                    border: `1px solid ${active ? color : "#2a2a50"}`,
                    background: active ? `${color}18` : "transparent",
                    color: active ? color : "#8888aa",
                    fontWeight: active ? 700 : 400, fontSize: "0.78rem",
                    cursor: isBusy ? "not-allowed" : "pointer",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    transition: "all 0.15s", textAlign: "left",
                  }}>
                    <span style={{ textTransform: "capitalize" }}>{r}</span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.68rem", color: active ? color : "#555577" }}>up to {maxMult}×</span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.4rem", lineHeight: 1.5 }}>
              {RISK_META[risk].desc}
            </div>
          </div>

          {/* Bet summary */}
          <div style={{ borderTop: "1px solid #2a2a50", paddingTop: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span style={{ color: "#8888aa" }}>Stake</span>
              <span style={{ fontWeight: 700, color: ACCENT }}>{chipValue} GZO</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", marginTop: "0.2rem" }}>
              <span style={{ color: "#555577" }}>Max win</span>
              <span style={{ color: "#8888aa", fontFamily: "monospace" }}>
                {(chipValue * Math.max(...config.segments.map(s => s.multiplier))).toLocaleString()} GZO
              </span>
            </div>
          </div>

          {/* Error display */}
          {spinError && (
            <div style={{ padding: "0.5rem 0.6rem", borderRadius: "7px",
              background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.3)",
              fontSize: "0.72rem", color: "#ff8080", lineHeight: 1.5 }}>
              {spinError}
            </div>
          )}

          {/* Spin button */}
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {isSettled ? (
              <button onClick={handleNewRound} style={{ padding: "0.75rem", borderRadius: "8px",
                border: `1px solid ${ACCENT}44`, background: `${ACCENT}0a`, color: ACCENT,
                fontSize: "0.9375rem", cursor: "pointer", fontWeight: 700 }}>
                New Spin
              </button>
            ) : (
              <div style={{ position: "relative" }}>
                <button onClick={handleSpin} disabled={isBusy}
                  className={canSpin ? "spin-btn-active-wheel" : ""}
                  style={{
                    background: canSpin ? `linear-gradient(135deg, ${ACCENT}, #f97316)` : "#2a2a50",
                    border: canSpin ? `1px solid ${ACCENT}66` : "1px solid #3a3a60",
                    borderRadius: "8px", color: canSpin ? "#0a0a18" : "#666688",
                    fontWeight: 800, fontSize: "0.9375rem", padding: "0.75rem",
                    cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.5 : 1,
                    width: "100%", transition: "all 0.2s ease",
                    boxShadow: canSpin ? `0 0 24px ${ACCENT}55, 0 0 48px ${ACCENT}22` : "none",
                  }}>
                  {loadPhase === "broadcast" ? "Placing bet…" : loadPhase === "vrf" ? "Awaiting VRF…" : spinning ? "Spinning…" : !walletUser ? "Sign in to spin" : "Spin"}
                </button>
                {spinHint && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
                    transform: "translateX(-50%)", background: "#1a1a35", border: `1px solid ${ACCENT}44`,
                    borderRadius: "8px", padding: "0.4rem 0.75rem", fontSize: "0.72rem", color: ACCENT,
                    whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(0,0,0,0.5)", animation: "fadeIn 0.2s ease" }}>
                    {!walletUser ? "Sign in with your wallet to spin" : "Set a stake amount to spin"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* CENTER — Wheel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", height: "100%" }}>
          <div className="card" style={{ padding: "1.5rem", background: `rgba(251,146,60,0.02)`,
            borderColor: `rgba(251,146,60,0.2)`, display: "flex", flexDirection: "column",
            alignItems: "stretch", gap: "1.25rem", position: "relative", flex: 1, minHeight: "420px" }}>

            {/* Atom loader overlay */}
            {loadPhase && (
              <div style={{ position: "absolute", inset: 0, borderRadius: "inherit",
                background: "rgba(10,10,24,0.92)", display: "flex", alignItems: "center",
                justifyContent: "center", zIndex: 20, backdropFilter: "blur(4px)" }}>
                <AtomLoader phase={loadPhase} />
              </div>
            )}

            {/* Pointer + Wheel — responsive square container */}
            <div style={{ position: "relative", width: "calc((100% - 3rem) * 0.8)",
              margin: "0 auto", aspectRatio: "1 / 1" }}>
              {/* Pointer triangle */}
              <div style={{ position: "absolute", top: "-4.4%", left: "50%",
                transform: "translateX(-50%)",
                width: 0, height: 0,
                borderLeft: "11px solid transparent", borderRight: "11px solid transparent",
                borderTop: `18px solid ${ACCENT}`, zIndex: 10,
                filter: `drop-shadow(0 0 6px ${ACCENT}aa)` }} />

              {!isSettled && !spinning && (
                <div className="wheel-idle-glow" style={{
                  position: "absolute", width: "105%", height: "105%",
                  top: "-2.5%", left: "-2.5%",
                  borderRadius: "50%",
                  border: `2px solid ${ACCENT}55`,
                  boxShadow: `0 0 28px ${ACCENT}33, 0 0 56px ${ACCENT}18`,
                  pointerEvents: "none",
                }} />
              )}

              {isSettled && (
                <div style={{
                  position: "absolute", width: "107%", height: "107%",
                  top: "-3.5%", left: "-3.5%",
                  borderRadius: "50%",
                  border: `3px solid ${resultColor}`, boxShadow: `0 0 30px ${resultColor}44`,
                  animation: "pulse 1.5s ease infinite", pointerEvents: "none" }} />
              )}

              <WheelSVG config={config} rotation={rotation} transitioning={transitioning}
                winningSegIdx={winningSegIdx} settled={isSettled} />
            </div>

            {/* Result / status text */}
            {isSettled ? (
              <div style={{ textAlign: "center", animation: "slideUp 0.4s ease" }}>
                <div style={{ fontSize: "2.5rem", fontWeight: 900, fontFamily: "monospace",
                  color: resultColor, animation: "resultGlow 2s ease-in-out infinite" }}>
                  {multiplierDisplay}×
                </div>
                <div style={{ fontSize: "1rem", fontWeight: 700, color: resultColor, marginTop: "0.25rem" }}>
                  {isWin ? "Winner!" : "Better luck next time"}
                </div>
                {isWin && (
                  <div style={{ fontSize: "0.85rem", color: "#8888aa", marginTop: "0.25rem" }}>
                    +{netPayoutDisplay} GZO net payout
                  </div>
                )}
              </div>
            ) : !loadPhase && (
              <div style={{ textAlign: "center", color: "#555577", fontSize: "0.875rem", width: "100%" }}>
                {spinning ? <span style={{ color: ACCENT, fontWeight: 700 }}>Spinning…</span> : "Place your bet and spin"}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — always visible panel */}
        <RightPanel config={config} risk={risk} isSettled={isSettled} isWaiting={isWaiting}
          winSeg={winSeg} multiplierDisplay={multiplierDisplay} isWin={isWin}
          resultColor={resultColor} netPayoutDisplay={netPayoutDisplay}
          stakeNum={chipValue} activeRoundId={activeRoundId} />
      </div>

      {/* ── How to Play ──────────────────────────────────────────────────── */}
      <div className="card" style={{ background: `rgba(251,146,60,0.02)`, borderColor: `rgba(251,146,60,0.15)`,
        marginBottom: "1.25rem", marginTop: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT,
          display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiTarget size={16} color={ACCENT} /> How to Play
        </h2>
        <div className="howto-grid">
          {[
            { step:"1", title:"Sign In",            desc:"Sign in with your wallet. Your GZO balance is managed custodially — no token approvals or gas fees needed.", icon: <SiWallet size={14} color={ACCENT} /> },
            { step:"2", title:"Pick a Chip Value",  desc:"Select your bet amount — 10, 50, 100, or 500 GZO. Or enter a custom amount.", icon: <SiChip size={14} color={ACCENT} /> },
            { step:"3", title:"Choose Risk Mode",   desc:"Low gives smaller but more frequent wins. High gives rare but massive multipliers (up to 100×). Medium is balanced.", icon: <SiSliders size={14} color={ACCENT} /> },
            { step:"4", title:"Hit Spin",           desc:"Click Spin — the house places the bet on-chain. No wallet popup needed. Chainlink VRF generates the provably fair result.", icon: <SiRefresh size={14} color={ACCENT} /> },
            { step:"5", title:"Watch the Wheel",   desc:"The wheel animates and lands on a segment. Each segment shows its multiplier. Larger segments appear more often.", icon: <SiWheel size={14} color={ACCENT} /> },
            { step:"6", title:"Collect Winnings",  desc:"Your payout = stake × multiplier, minus 10% fee on profit. Winnings are credited to your GZO balance instantly.", icon: <SiCoins size={14} color={ACCENT} /> },
          ].map(item => (
            <div key={item.step} style={{ background: `rgba(251,146,60,0.04)`, border: `1px solid rgba(251,146,60,0.12)`,
              borderRadius: "10px", padding: "0.875rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <div style={{ flexShrink: 0, width: "28px", height: "28px", borderRadius: "50%",
                background: `rgba(251,146,60,0.15)`, border: `1px solid rgba(251,146,60,0.3)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.7rem", fontWeight: 800, color: ACCENT }}>{item.step}</div>
              <div>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#f0f0ff", marginBottom: "0.2rem" }}>{item.icon} {item.title}</div>
                <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Play Another Game ─────────────────────────────────────────────── */}
      <OtherGames exclude="wheel" />

      {/* ── How It Works ──────────────────────────────────────────────────── */}
      <div className="card" style={{ background: `rgba(251,146,60,0.02)`, borderColor: `rgba(251,146,60,0.15)`,
        marginBottom: "1.25rem", padding: "1.25rem" }}>
        <h2 style={{ fontSize: "0.9375rem", fontWeight: 700, marginBottom: "1rem", color: ACCENT,
          display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <SiGear size={16} color={ACCENT} /> How It Works
        </h2>
        <div className="stat-grid-2">
          {[
            { icon: <SiLock size={20} color={ACCENT} />, title:"Custodial Bet", desc:"When you click Spin, your GZO stake is debited from your account balance instantly. The house wallet submits the bet on-chain on your behalf — no wallet popup, no gas fee." },
            { icon: <SiDice size={20} color={ACCENT} />, title:"Chainlink VRF Stop Position", desc:"The WheelGame contract calls RandomnessCoordinator, which requests a random number from Chainlink VRF. This number maps to a stop position [0, totalWeight). The result is cryptographically provable and manipulation-proof." },
            { icon: <SiBarChart size={20} color={ACCENT} />, title:"Segment Resolution", desc:"The wheel has 54 total weight units. Each segment occupies a share of that weight. The VRF stop position falls within exactly one segment, determining the multiplier. Larger segments (0×) appear more often." },
            { icon: <SiZap size={20} color={ACCENT} />, title:"Payout & Settlement", desc:"Win payout = stake × multiplier, minus 10% fee on profit only. E.g., 100 GZO stake × 5× = 500 GZO gross → 460 GZO net (40 GZO fee on 400 GZO profit). A 0× result means your stake is absorbed as house bankroll." },
          ].map(item => (
            <div key={item.title} style={{ background: `rgba(251,146,60,0.03)`, border: `1px solid rgba(251,146,60,0.1)`,
              borderRadius: "10px", padding: "0.875rem" }}>
              <div style={{ fontSize: "1rem", marginBottom: "0.35rem" }}>{item.icon}</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: ACCENT, marginBottom: "0.3rem" }}>{item.title}</div>
              <div style={{ fontSize: "0.7rem", color: "#8888aa", lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── History ───────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.875rem", color: "#8888aa" }}>Your History</h2>
        <BetHistory game="WHEEL" refreshTrigger={historyTick} />
      </div>

      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes resultGlow { 0%,100%{text-shadow:0 0 8px currentColor} 50%{text-shadow:0 0 28px currentColor,0 0 48px currentColor} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes vrfSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateX(-50%) translateY(4px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes nucleusPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.25)} }
        @keyframes orbitSpin0 { from{transform:rotateZ(0deg) rotateX(15deg)} to{transform:rotateZ(360deg) rotateX(15deg)} }
        @keyframes orbitSpin1 { from{transform:rotateZ(0deg) rotateX(75deg) rotateZ(60deg)} to{transform:rotateZ(360deg) rotateX(75deg) rotateZ(60deg)} }
        @keyframes orbitSpin2 { from{transform:rotateZ(120deg) rotateX(45deg) rotateZ(0deg)} to{transform:rotateZ(120deg) rotateX(45deg) rotateZ(360deg)} }
        @keyframes progDot { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
        @keyframes spinBtnGlowWheel { 0%,100%{box-shadow:0 0 20px #fb923c55,0 0 40px #fb923c22} 50%{box-shadow:0 0 32px #fb923c88,0 0 64px #fb923c44} }
        @keyframes wheelIdleGlow { 0%,100%{box-shadow:0 0 20px #fb923c22,0 0 44px #fb923c10;border-color:#fb923c33} 50%{box-shadow:0 0 40px #fb923c55,0 0 80px #fb923c22;border-color:#fb923c88} }
        .spin-btn-active-wheel { animation: spinBtnGlowWheel 2s ease-in-out infinite !important; }
        .wheel-idle-glow { animation: wheelIdleGlow 2.4s ease-in-out infinite; }
        .atom-wrap { perspective: 400px; }
        .nucleus { animation: nucleusPulse 1.8s ease-in-out infinite; }
        .orbit-0 { animation: orbitSpin0 2.2s linear infinite; }
        .orbit-1 { animation: orbitSpin1 1.7s linear infinite; }
        .orbit-2 { animation: orbitSpin2 3.1s linear infinite; }
        .prog-dot-0 { animation: progDot 1.4s ease-in-out 0s infinite; }
        .prog-dot-1 { animation: progDot 1.4s ease-in-out 0.2s infinite; }
        .prog-dot-2 { animation: progDot 1.4s ease-in-out 0.4s infinite; }
      `}</style>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.68rem", fontWeight: 700,
  color: "#8888aa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.35rem",
};
const inputStyle: React.CSSProperties = {
  width: "100%", background: "#0d0d1a", border: "1px solid #2a2a50",
  borderRadius: "8px", padding: "0.5rem 0.6rem", color: "#f0f0ff",
  fontSize: "0.9375rem", fontWeight: 700, outline: "none", boxSizing: "border-box",
};
