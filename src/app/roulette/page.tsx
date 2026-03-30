"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import OtherGames from "@/components/OtherGames";
import BetHistory from "@/components/BetHistory";
import { SiTarget, SiGear, SiWallet, SiChip, SiCards, SiRefresh, SiWheel, SiCoins, SiLock, SiDice, SiLayers, SiZap } from "@/components/GameIcons";
import { useDBBalance } from "@/lib/web3/hooks/useDBBalance";
import CasinoChip, { CHIP_OPTIONS } from "@/components/CasinoChip";

// ── Constants ─────────────────────────────────────────────────────────────────
const RED_NUMS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const WHEEL_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const ACCENT = "#e879f9";
const RED = "#ff4444";
const BLACK = "#f0f0ff";
const GREEN_C = "#00ff9d";

function numColor(n: number): "red" | "black" | "green" {
  if (n === 0) return "green";
  return RED_NUMS.has(n) ? "red" : "black";
}
function numStyle(n: number) {
  const c = numColor(n);
  return c === "red" ? RED : c === "green" ? GREEN_C : BLACK;
}
function numBg(n: number) {
  const c = numColor(n);
  return c === "red" ? "rgba(255,68,68,0.18)" : c === "green" ? "rgba(0,255,157,0.18)" : "rgba(255,255,255,0.06)";
}

type Wager = { area: string; stake: number };

const OUTSIDE_BETS = [
  { area: "low",   label: "1-18",  payout: "2×" },
  { area: "even",  label: "Even",  payout: "2×" },
  { area: "red",   label: "Red",   payout: "2×" },
  { area: "black", label: "Black", payout: "2×" },
  { area: "odd",   label: "Odd",   payout: "2×" },
  { area: "high",  label: "19-36", payout: "2×" },
];
const DOZEN_BETS = [
  { area: "dozen1", label: "1st 12", payout: "3×" },
  { area: "dozen2", label: "2nd 12", payout: "3×" },
  { area: "dozen3", label: "3rd 12", payout: "3×" },
];
const COL_BETS = [
  { area: "col1", label: "Col 1" },
  { area: "col2", label: "Col 2" },
  { area: "col3", label: "Col 3" },
];
const GRID_ROWS = [
  [3,6,9,12,15,18,21,24,27,30,33,36],
  [2,5,8,11,14,17,20,23,26,29,32,35],
  [1,4,7,10,13,16,19,22,25,28,31,34],
];
const PAYOUT_REF = [
  { label: "Straight (single number)", payout: "36×", color: ACCENT },
  { label: "Dozen / Column",           payout: "3×",  color: "#00d4ff" },
  { label: "Red / Black",              payout: "2×",  color: RED },
  { label: "Odd / Even",               payout: "2×",  color: "#f0f0ff" },
  { label: "1–18 / 19–36",            payout: "2×",  color: GREEN_C },
];

// ── VRF phase text ─────────────────────────────────────────────────────────────
const VRF_PHASES = [
  { title: "Sending Transaction",     detail: "House wallet submitting your spin to Polygon Amoy…" },
  { title: "Awaiting Confirmation",   detail: "Transaction mined. Waiting for Chainlink VRF callback…" },
  { title: "VRF Randomness Pending",  detail: "A tamper-proof random number is being generated on-chain." },
  { title: "Finalising Result",       detail: "VRF fulfilled — settling your spin result on-chain." },
  { title: "Almost There…",          detail: "Round about to settle. Hang tight!" },
];

// ── Atom Loader ───────────────────────────────────────────────────────────────
function AtomLoader({ phaseIndex }: { phaseIndex: number }) {
  const phase = VRF_PHASES[phaseIndex % VRF_PHASES.length];
  const colors: [string, string, string] = [ACCENT, "#00d4ff", GREEN_C];
  const [c0, c1, c2] = colors;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"1.5rem", padding:"2rem 1rem" }}>
      <div className="atom-wrap" style={{ position:"relative", width:"130px", height:"130px" }}>
        <div className="nucleus" style={{
          position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)",
          width:"20px", height:"20px", borderRadius:"50%",
          background:`radial-gradient(circle, white 0%, ${c0} 70%)`,
          boxShadow:`0 0 6px white, 0 0 18px ${c0}, 0 0 36px ${c0}88`, zIndex:10,
        }} />
        <div className="orbit orbit-0" style={{
          position:"absolute", top:"50%", left:"50%", width:"120px", height:"50px",
          marginTop:"-25px", marginLeft:"-60px", border:`1.5px solid ${c0}50`, borderRadius:"50%",
        }}>
          <div style={{ position:"absolute", top:"-5px", left:"calc(50% - 5px)", width:"10px", height:"10px",
            borderRadius:"50%", background:c0, boxShadow:`0 0 8px ${c0}, 0 0 16px ${c0}99` }} />
        </div>
        <div className="orbit orbit-1" style={{
          position:"absolute", top:"50%", left:"50%", width:"120px", height:"50px",
          marginTop:"-25px", marginLeft:"-60px", border:`1.5px solid ${c1}50`, borderRadius:"50%",
        }}>
          <div style={{ position:"absolute", top:"-5px", left:"calc(50% - 5px)", width:"10px", height:"10px",
            borderRadius:"50%", background:c1, boxShadow:`0 0 8px ${c1}, 0 0 16px ${c1}99` }} />
        </div>
        <div className="orbit orbit-2" style={{
          position:"absolute", top:"50%", left:"50%", width:"120px", height:"50px",
          marginTop:"-25px", marginLeft:"-60px", border:`1.5px solid ${c2}40`, borderRadius:"50%",
        }}>
          <div style={{ position:"absolute", top:"-5px", left:"calc(50% - 5px)", width:"10px", height:"10px",
            borderRadius:"50%", background:c2, boxShadow:`0 0 8px ${c2}, 0 0 16px ${c2}99` }} />
        </div>
        <div style={{
          position:"absolute", top:"50%", left:"50%", width:"130px", height:"130px",
          marginTop:"-65px", marginLeft:"-65px", borderRadius:"50%",
          border:`1px solid ${c0}20`, boxShadow:`0 0 30px ${c0}10, inset 0 0 30px ${c0}08`, pointerEvents:"none",
        }} />
      </div>
      <div style={{ textAlign:"center", maxWidth:"280px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"0.4rem", marginBottom:"0.5rem" }}>
          <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:c0, boxShadow:`0 0 8px ${c0}` }} />
          <span style={{ fontSize:"0.95rem", fontWeight:800, color:"#f0f0ff", letterSpacing:"0.01em" }}>
            {phase.title}
          </span>
        </div>
        <p style={{ fontSize:"0.72rem", color:"#8888aa", lineHeight:1.6, margin:0 }}>{phase.detail}</p>
        <div style={{ display:"flex", justifyContent:"center", gap:"0.3rem", marginTop:"0.875rem" }}>
          {[0,1,2].map(i => (
            <div key={i} className={`prog-dot prog-dot-${i}`} style={{
              width:"6px", height:"6px", borderRadius:"50%", background:c0, opacity:0.3,
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Wheel Component ───────────────────────────────────────────────────────────
function RouletteWheel({ spinning, result, onDone }: { spinning: boolean; result: number | null; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const rotRef    = useRef(0);
  const SIZE = 260;
  const R = SIZE / 2 - 4;
  const cx = SIZE / 2, cy = SIZE / 2;

  function drawWheel(rotation: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, SIZE, SIZE);
    const N = WHEEL_ORDER.length;
    const sliceAngle = (2 * Math.PI) / N;

    for (let i = 0; i < N; i++) {
      const num = WHEEL_ORDER[i];
      const startA = rotation + i * sliceAngle - Math.PI / 2;
      const endA   = startA + sliceAngle;
      const c = numColor(num);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, startA, endA);
      ctx.closePath();
      ctx.fillStyle = c === "red" ? "#c0392b" : c === "green" ? "#1a5c3a" : "#111118";
      ctx.fill();
      ctx.strokeStyle = "#1a1a35";
      ctx.lineWidth = 0.5;
      ctx.stroke();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation + (i + 0.5) * sliceAngle - Math.PI / 2);
      ctx.translate(R * 0.72, 0);
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = "#f0f0ff";
      ctx.font = `bold ${R < 120 ? 8 : 9}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(num), 0, 0);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.18, 0, 2 * Math.PI);
    ctx.fillStyle = "#0a0a18";
    ctx.fill();
    ctx.strokeStyle = "#e879f9";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy - R + 8, 5, 0, 2 * Math.PI);
    ctx.fillStyle = "#f0f0ff";
    ctx.fill();
  }

  useEffect(() => { drawWheel(rotRef.current); }, []); // eslint-disable-line

  useEffect(() => {
    if (!spinning || result === null) return;
    cancelAnimationFrame(animRef.current);

    const N = WHEEL_ORDER.length;
    const sliceAngle = (2 * Math.PI) / N;
    const idx = WHEEL_ORDER.indexOf(result);

    const rawTarget = -(idx + 0.5) * sliceAngle;
    const TAU = 2 * Math.PI;
    const targetMod = ((rawTarget % TAU) + TAU) % TAU;
    const startMod  = ((rotRef.current % TAU) + TAU) % TAU;
    let angularDiff  = targetMod - startMod;
    if (angularDiff < 0.01) angularDiff += TAU;
    const delta = 5 * TAU + angularDiff;

    const startRot = rotRef.current;
    const duration = 3800;
    const start    = performance.now();
    function easeOut(t: number) { return 1 - Math.pow(1 - t, 4); }
    function frame(now: number) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      rotRef.current = startRot + delta * easeOut(t);
      drawWheel(rotRef.current);
      if (t < 1) { animRef.current = requestAnimationFrame(frame); } else { onDone(); }
    }
    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [spinning, result]); // eslint-disable-line

  return (
    <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ borderRadius:"50%" }} />
    </div>
  );
}

// ── Betting Table ─────────────────────────────────────────────────────────────
function BettingTable({ wagers, onBet, disabled, lastResult }: {
  wagers: Wager[]; onBet: (area: string) => void;
  disabled: boolean; lastResult: number | null;
}) {
  function stakeOn(area: string) { return wagers.filter(w => w.area === area).reduce((s,w) => s+w.stake, 0); }
  function isWinner(area: string) {
    if (lastResult === null) return false;
    const n = lastResult;
    const c = numColor(n);
    switch (area) {
      case "red": return c === "red";
      case "black": return c === "black";
      case "odd": return n !== 0 && n % 2 === 1;
      case "even": return n !== 0 && n % 2 === 0;
      case "low": return n >= 1 && n <= 18;
      case "high": return n >= 19 && n <= 36;
      case "dozen1": return n >= 1 && n <= 12;
      case "dozen2": return n >= 13 && n <= 24;
      case "dozen3": return n >= 25 && n <= 36;
      case "col1": return n > 0 && n % 3 === 1;
      case "col2": return n > 0 && n % 3 === 2;
      case "col3": return n > 0 && n % 3 === 0;
      default: if (area.startsWith("straight:")) return parseInt(area.split(":")[1]) === n; return false;
    }
  }
  const cellBase: React.CSSProperties = {
    position:"relative", cursor: disabled ? "default" : "pointer",
    border:"1px solid rgba(232,121,249,0.2)", borderRadius:"5px",
    display:"flex", alignItems:"center", justifyContent:"center",
    fontSize:"0.75rem", fontWeight:700, transition:"all 0.15s", userSelect:"none",
  };
  function cellStyle(area: string, bg: string, color: string): React.CSSProperties {
    const won = isWinner(area); const hasStake = stakeOn(area) > 0;
    return { ...cellBase, background:bg, color, minHeight:"36px",
      boxShadow: won ? `0 0 12px ${color}88` : hasStake ? `0 0 8px ${ACCENT}55` : "none",
      border: won ? `2px solid ${color}` : hasStake ? `1px solid ${ACCENT}88` : "1px solid rgba(232,121,249,0.2)",
      animation: won ? "win-pulse 0.6s ease-out" : undefined };
  }
  function ChipOverlay({ area }: { area: string }) {
    const s = stakeOn(area); if (!s) return null;
    return <span style={{ position:"absolute", top:"2px", right:"3px", fontSize:"0.55rem", fontWeight:800,
      color:"#0a0a18", background:ACCENT, borderRadius:"99px", padding:"0.05rem 0.3rem", lineHeight:1.4 }}>{s}</span>;
  }
  return (
    <div style={{ width:"100%" }}>
      <div style={{ display:"grid", gridTemplateColumns:"32px repeat(12, 1fr)", gap:"3px", marginBottom:"4px" }}>
        <div style={{ ...cellBase, gridRow:"1 / span 3", background:"rgba(0,255,157,0.12)", color:GREEN_C,
            border: isWinner("straight:0") ? `2px solid ${GREEN_C}` : "1px solid rgba(0,255,157,0.3)",
            boxShadow: isWinner("straight:0") ? `0 0 14px ${GREEN_C}88` : "none",
            fontSize:"0.9rem", cursor: disabled ? "default" : "pointer" }}
          onClick={() => !disabled && onBet("straight:0")}>
          0<ChipOverlay area="straight:0" />
        </div>
        {GRID_ROWS.map((row) => row.map((num) => {
          const area = `straight:${num}`;
          return <div key={num} style={cellStyle(area, numBg(num), numStyle(num))} onClick={() => !disabled && onBet(area)}>
            {num}<ChipOverlay area={area} />
          </div>;
        }))}
        {COL_BETS.map((cb) => (
          <div key={cb.area} style={cellStyle(cb.area, "rgba(232,121,249,0.06)", ACCENT)} onClick={() => !disabled && onBet(cb.area)}>
            {cb.label}<ChipOverlay area={cb.area} />
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"32px repeat(3, 1fr)", gap:"3px", marginBottom:"3px" }}>
        <div />
        {DOZEN_BETS.map((d) => (
          <div key={d.area} style={cellStyle(d.area, "rgba(232,121,249,0.06)", ACCENT)} onClick={() => !disabled && onBet(d.area)}>
            <span>{d.label}</span><span style={{ marginLeft:"0.25rem", fontSize:"0.6rem", color:"#8888aa" }}>{d.payout}</span>
            <ChipOverlay area={d.area} />
          </div>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"32px repeat(6, 1fr)", gap:"3px" }}>
        <div />
        {OUTSIDE_BETS.map((b) => {
          const bg = b.area === "red" ? "rgba(255,68,68,0.15)" : b.area === "black" ? "rgba(255,255,255,0.06)" : "rgba(232,121,249,0.06)";
          const color = b.area === "red" ? RED : b.area === "black" ? "#f0f0ff" : ACCENT;
          return <div key={b.area} style={cellStyle(b.area, bg, color)} onClick={() => !disabled && onBet(b.area)}>
            <span>{b.label}</span><ChipOverlay area={b.area} />
          </div>;
        })}
      </div>
    </div>
  );
}

// ── Right Panel ───────────────────────────────────────────────────────────────
interface RightPanelProps {
  showResult: boolean;
  winningNumber: number | null;
  isProfit: boolean;
  netPayoutDisplay: string;
  totalGrossDisplay: string;
  totalStake: number;
  activeRoundId: string | undefined;
  isWaiting: boolean;
}
function RightPanel({ showResult, winningNumber, isProfit, netPayoutDisplay, totalGrossDisplay, totalStake, activeRoundId, isWaiting }: RightPanelProps) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
      {showResult && winningNumber !== null ? (
        <div className="card" style={{ padding:"0.875rem",
          background: isProfit ? "rgba(0,255,157,0.04)" : "rgba(255,68,68,0.04)",
          borderColor: isProfit ? "rgba(0,255,157,0.25)" : "rgba(255,68,68,0.25)" }}>
          <div style={{ fontSize:"0.7rem", fontWeight:700, color: isProfit ? GREEN_C : RED,
            textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:"0.625rem" }}>
            {isProfit ? "✓ Result — Win" : "✗ Result — Loss"}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:"0.3rem" }}>
            <RPRow label="Stake"        value={`${totalStake} GZO`} />
            <RPRow label="Gross payout" value={`${totalGrossDisplay} GZO`} />
            <div style={{ borderTop:"1px solid #2a2a50", marginTop:"0.25rem", paddingTop:"0.3rem",
              display:"flex", justifyContent:"space-between", fontSize:"0.82rem", fontWeight:800,
              color: isProfit ? GREEN_C : RED }}>
              <span>Net Payout</span><span>{netPayoutDisplay} GZO</span>
            </div>
          </div>
          {activeRoundId && (
            <div style={{ marginTop:"0.5rem", borderTop:"1px solid #2a2a50", paddingTop:"0.5rem" }}>
              <div style={{ fontSize:"0.62rem", color:"#555577", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:"0.2rem" }}>Round ID</div>
              <div style={{ fontSize:"0.58rem", fontFamily:"monospace", color:"#8888aa", wordBreak:"break-all", lineHeight:1.5 }}>
                {activeRoundId}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding:"0.875rem", background:"#0a0a18", borderColor:"#1a1a35" }}>
          <div style={{ fontSize:"0.7rem", fontWeight:700, color:"#f0f0ff",
            textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:"0.625rem" }}>
            Payout Reference
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:"0.35rem" }}>
            {PAYOUT_REF.map(p => (
              <div key={p.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:"0.72rem" }}>
                <span style={{ color:"#8888aa" }}>{p.label}</span>
                <span style={{ fontWeight:800, color:p.color, fontFamily:"monospace" }}>{p.payout}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:"0.75rem", borderTop:"1px solid #1a1a35", paddingTop:"0.5rem",
            fontSize:"0.65rem", color:"#555577", lineHeight:1.6 }}>
            10% fee on profit only.<br />House edge: 2.7% (European single zero).
          </div>
        </div>
      )}

      <div className="card" style={{ padding:"0.875rem", background:"#0a0a18", borderColor:"#1a1a35" }}>
        <div style={{ fontSize:"0.7rem", fontWeight:700, color:"#f0f0ff",
          textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:"0.5rem" }}>
          Provably Fair
        </div>
        {showResult && winningNumber !== null ? (
          <div style={{ fontSize:"0.7rem", color:"#8888aa", display:"flex", flexDirection:"column", gap:"0.3rem" }}>
            <div><span style={{ color:"#555577" }}>Winning number: </span>
              <span style={{ fontFamily:"monospace", color:numStyle(winningNumber), fontWeight:700 }}>{winningNumber}</span></div>
            <div><span style={{ color:"#555577" }}>Net payout: </span>
              <span style={{ fontFamily:"monospace", color: isProfit ? GREEN_C : RED }}>{netPayoutDisplay} GZO</span></div>
            <p style={{ fontSize:"0.65rem", color:"#555577", marginTop:"0.25rem", lineHeight:1.6 }}>
              Result generated on-chain by Chainlink VRF — fully verifiable, no server involvement.
            </p>
          </div>
        ) : isWaiting ? (
          <div style={{ fontSize:"0.7rem", color:ACCENT, display:"flex", alignItems:"center", gap:"0.4rem" }}>
            <div style={{ width:"10px", height:"10px", border:`2px solid ${ACCENT}`, borderTopColor:"transparent",
              borderRadius:"50%", animation:"vrfSpin 0.8s linear infinite", flexShrink:0 }} />
            Awaiting Chainlink VRF on-chain…
          </div>
        ) : (
          <div style={{ fontSize:"0.7rem", color:"#555577", lineHeight:1.6 }}>
            Every spin is settled by Chainlink VRF on Polygon — a tamper-proof random number generated on-chain. No one, including the house, can predict or manipulate the result.
          </div>
        )}
      </div>
    </div>
  );
}

function RPRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.72rem" }}>
      <span style={{ color:"#8888aa" }}>{label}</span>
      <span style={{ color:"#f0f0ff", fontFamily:"monospace" }}>{value}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function RoulettePage() {
  const { formatted: balance, refetch: refetchBalance } = useDBBalance();

  const [chipValue,   setChipValue]   = useState(10);
  const [wagers,      setWagers]      = useState<Wager[]>([]);
  const [customStake, setCustomStake] = useState(10);
  const [phase,       setPhase]       = useState<"idle" | "spinning" | "pending_vrf" | "animating" | "settled">("idle");
  const [vrfPhaseIdx, setVrfPhaseIdx] = useState(0);
  const [animating,   setAnimating]   = useState(false);
  const [lastNumber,  setLastNumber]  = useState<number | null>(null);
  const [roundId,     setRoundId]     = useState<string | undefined>(undefined);
  const [historyTick, setHistoryTick] = useState(0);
  const [spinHint,    setSpinHint]    = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [result, setResult] = useState<{
    winningNumber: number;
    won: boolean;
    netPayoutGzo: number;
    totalGrossGzo: number;
    totalStakeGzo: number;
  } | null>(null);

  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStart  = useRef<number>(0);
  const savedWagers = useRef<Wager[]>([]);

  const totalStake = wagers.reduce((s, w) => s + w.stake, 0);

  // ── VRF phase text cycling ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "pending_vrf") { setVrfPhaseIdx(0); return; }
    const iv = setInterval(() => setVrfPhaseIdx(p => p + 1), 15_000);
    return () => clearInterval(iv);
  }, [phase]);

  // ── VRF polling ───────────────────────────────────────────────────────────
  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPoll = useCallback((rid: string) => {
    stopPoll();
    pollStart.current = Date.now();

    pollRef.current = setInterval(async () => {
      if (Date.now() - pollStart.current > 8 * 60_000) {
        stopPoll();
        setPhase("idle");
        setError("VRF timed out after 8 minutes. Your stake has been refunded.");
        return;
      }

      try {
        const res  = await fetch(`/api/games/roulette/status?roundId=${rid}`);
        const data = await res.json();

        if (!data.settled) return; // keep polling

        stopPoll();
        setResult({
          winningNumber:  data.winningNumber,
          won:            data.won,
          netPayoutGzo:   data.netPayoutGzo,
          totalGrossGzo:  data.totalGrossGzo,
          totalStakeGzo:  data.totalStakeGzo,
        });
        setLastNumber(data.winningNumber);
        setPhase("animating");
        setAnimating(true);
        refetchBalance();
      } catch {
        // network hiccup — keep polling
      }
    }, 3_000);
  }, [stopPoll, refetchBalance]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  // ── Spin handler ──────────────────────────────────────────────────────────
  async function handleSpin() {
    if (wagers.length === 0) {
      setSpinHint(true);
      setTimeout(() => setSpinHint(false), 3000);
      return;
    }
    setError(null);
    setPhase("spinning");
    savedWagers.current = wagers;

    try {
      const res  = await fetch("/api/games/roulette/spin", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ wagers }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setPhase("idle");
        setError(data.error ?? "Failed to place spin");
        return;
      }

      setRoundId(data.roundId);
      setPhase("pending_vrf");
      startPoll(data.roundId);
    } catch {
      setPhase("idle");
      setError("Network error — please try again.");
    }
  }

  function handleSpinDone() {
    setAnimating(false);
    setPhase("settled");
    refetchBalance();
    setHistoryTick(t => t + 1);
  }

  function handleNewRound() {
    stopPoll();
    setPhase("idle");
    setWagers([]);
    setLastNumber(null);
    setRoundId(undefined);
    setResult(null);
    setError(null);
    setAnimating(false);
    setVrfPhaseIdx(0);
  }

  const MUTEX: Record<string, string> = { red:"black", black:"red", odd:"even", even:"odd", low:"high", high:"low" };

  function addBet(area: string) {
    setWagers(prev => {
      const opposite = MUTEX[area];
      const filtered = opposite ? prev.filter(w => w.area !== opposite) : prev;
      const existing = filtered.find(w => w.area === area);
      if (existing) return filtered.map(w => w.area === area ? { ...w, stake: w.stake + chipValue } : w);
      return [...filtered, { area, stake: chipValue }];
    });
    setSpinHint(false);
  }

  const isBusy      = phase === "spinning" || phase === "pending_vrf" || animating;
  const showResult  = phase === "settled";
  const isWaiting   = phase === "pending_vrf";
  const showLoader  = phase === "spinning" || phase === "pending_vrf";
  const winningNumber: number | null = showResult && result ? result.winningNumber : null;
  const netPayoutGzo  = result?.netPayoutGzo  ?? 0;
  const totalGrossGzo = result?.totalGrossGzo ?? 0;
  const displayStake  = result?.totalStakeGzo ?? totalStake;
  const isProfit      = netPayoutGzo > displayStake;
  const netPayoutDisplay  = netPayoutGzo.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const totalGrossDisplay = totalGrossGzo.toLocaleString(undefined, { maximumFractionDigits: 4 });

  return (
    <div style={{ maxWidth:"1200px", margin:"0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom:"1.25rem" }}>
        <h1 style={{ fontSize:"1.875rem", fontWeight:800, letterSpacing:"-0.5px", marginBottom:"0.25rem",
          background:`linear-gradient(135deg, ${ACCENT}, #c026d3)`,
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
          Roulette
        </h1>
        <p style={{ color:"#8888aa", fontSize:"0.875rem" }}>European Roulette — 0 to 36. Place your bets, spin the wheel.</p>
        <p style={{ color:"#555577", fontSize:"0.8rem", marginTop:"0.25rem" }}>
          Balance: <span style={{ color:ACCENT, fontWeight:700 }}>{balance} GZO</span>
        </p>
      </div>

      {/* 3-col layout */}
      <div className="game-3col">

        {/* LEFT — Controls */}
        <div className="card" style={{ display:"flex", flexDirection:"column", gap:"1rem",
          background:"rgba(232,121,249,0.03)", borderColor:"rgba(232,121,249,0.2)" }}>

          <div>
            <label style={labelStyle}>Select Chip (GZO)</label>
            <div className="chip-row">
              {CHIP_OPTIONS.map(chip => (
                <CasinoChip key={chip.value} value={chip.value} color={chip.color}
                  active={chipValue === chip.value} onClick={() => setChipValue(chip.value)} />
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Custom Amount</label>
            <input type="number" min={1} max={100000} value={customStake}
              onChange={e => { const v = Math.max(1, parseInt(e.target.value)||1); setCustomStake(v); setChipValue(v); }}
              style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Your Bets</label>
            {wagers.length === 0 ? (
              <div style={{ fontSize:"0.75rem", color:"#555577", fontStyle:"italic" }}>Click the table to place bets</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:"0.25rem", maxHeight:"160px", overflowY:"auto" }}>
                {wagers.map((w, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:"0.75rem",
                    padding:"0.25rem 0.4rem", background:"#0a0a18", borderRadius:"5px" }}>
                    <span style={{ color:"#c0c0dd" }}>{formatArea(w.area)}</span>
                    <span style={{ color:ACCENT, fontWeight:700 }}>{w.stake} GZO</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop:"1px solid #2a2a50", paddingTop:"0.5rem" }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.8rem", marginBottom:"0.5rem" }}>
              <span style={{ color:"#8888aa" }}>Total stake</span>
              <span style={{ fontWeight:700, color:ACCENT }}>{totalStake} GZO</span>
            </div>
          </div>

          {error && (
            <div style={{ padding:"0.5rem 0.6rem", borderRadius:"7px",
              background:"rgba(255,68,68,0.08)", border:"1px solid rgba(255,68,68,0.3)",
              fontSize:"0.72rem", color:"#ff6b6b", lineHeight:1.5 }}>
              {error}
            </div>
          )}

          <div style={{ display:"flex", flexDirection:"column", gap:"0.4rem" }}>
            {showResult ? (
              <button onClick={handleNewRound} style={{
                padding:"0.75rem", borderRadius:"8px", border:`1px solid ${ACCENT}44`,
                background:`${ACCENT}0a`, color:ACCENT, fontSize:"0.9375rem", cursor:"pointer", fontWeight:700 }}>
                New Round
              </button>
            ) : (
              <>
                <div style={{ position:"relative" }}>
                  <button onClick={handleSpin} disabled={isBusy}
                    className={!isBusy && wagers.length > 0 ? "spin-btn-active" : ""}
                    style={{
                      background: !isBusy && wagers.length > 0 ? `linear-gradient(135deg, ${ACCENT}, #c026d3)` : "#2a2a50",
                      border: !isBusy && wagers.length > 0 ? `1px solid ${ACCENT}66` : "1px solid #3a3a60",
                      borderRadius:"8px",
                      color: !isBusy && wagers.length > 0 ? "#0a0a18" : "#666688",
                      fontWeight:800, fontSize:"0.9375rem", padding:"0.75rem",
                      cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.5 : 1,
                      width:"100%", transition:"all 0.2s ease",
                      boxShadow: !isBusy && wagers.length > 0 ? `0 0 24px ${ACCENT}55, 0 0 48px ${ACCENT}22` : "none",
                    }}>
                    {phase === "spinning" ? "Placing bet…" : phase === "pending_vrf" ? "Awaiting VRF…" : "Spin"}
                  </button>
                  {spinHint && (
                    <div style={{ position:"absolute", bottom:"calc(100% + 8px)", left:"50%",
                      transform:"translateX(-50%)", background:"#1a1a35", border:`1px solid ${ACCENT}44`,
                      borderRadius:"8px", padding:"0.4rem 0.75rem", fontSize:"0.72rem", color:ACCENT,
                      whiteSpace:"nowrap", boxShadow:"0 4px 16px rgba(0,0,0,0.5)", animation:"fadeIn 0.2s ease" }}>
                      ← Click the table to place bets first
                    </div>
                  )}
                  {!isBusy && !showResult && wagers.length === 0 && !spinHint && (
                    <div style={{ textAlign:"center", fontSize:"0.65rem", color:"#555577", marginTop:"0.3rem" }}>
                      Place bets on the table above
                    </div>
                  )}
                </div>
              </>
            )}
            <div style={{ display:"flex", gap:"0.3rem" }}>
              <button onClick={() => setWagers(p => p.slice(0,-1))} disabled={isBusy || wagers.length === 0}
                style={{ flex:1, padding:"0.4rem", borderRadius:"6px", border:"1px solid #2a2a50",
                  background:"transparent", color:"#8888aa", fontSize:"0.75rem", cursor:"pointer" }}>Undo</button>
              <button onClick={() => setWagers([])} disabled={isBusy || wagers.length === 0}
                style={{ flex:1, padding:"0.4rem", borderRadius:"6px", border:"1px solid #2a2a50",
                  background:"transparent", color:"#8888aa", fontSize:"0.75rem", cursor:"pointer" }}>Clear</button>
            </div>
          </div>
        </div>

        {/* CENTER — Wheel + Table */}
        <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
          <div className="card" style={{ padding:"1.25rem", background:"rgba(232,121,249,0.02)",
            borderColor:"rgba(232,121,249,0.2)", display:"flex", flexDirection:"column", alignItems:"center", gap:"1rem",
            position:"relative", minHeight:"320px" }}>

            {showLoader && (
              <div style={{ position:"absolute", inset:0, borderRadius:"inherit",
                background:"rgba(10,10,24,0.92)", display:"flex", alignItems:"center", justifyContent:"center",
                zIndex:20, backdropFilter:"blur(4px)" }}>
                <AtomLoader phaseIndex={vrfPhaseIdx} />
              </div>
            )}

            <RouletteWheel spinning={animating} result={lastNumber} onDone={handleSpinDone} />

            {showResult && winningNumber !== null && !animating && (
              <div style={{ textAlign:"center", animation:"result-reveal 0.5s ease-out" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"0.75rem" }}>
                  <div style={{ width:"48px", height:"48px", borderRadius:"50%",
                    background:numBg(winningNumber), border:`3px solid ${numStyle(winningNumber)}`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:"1.25rem", fontWeight:900, color:numStyle(winningNumber),
                    boxShadow:`0 0 24px ${numStyle(winningNumber)}66` }}>
                    {winningNumber}
                  </div>
                  <div>
                    <div style={{ fontSize:"0.75rem", color:"#8888aa", textTransform:"uppercase", letterSpacing:"0.06em" }}>
                      {numColor(winningNumber)} · {winningNumber % 2 === 0 && winningNumber !== 0 ? "Even" : winningNumber !== 0 ? "Odd" : ""}
                    </div>
                    <div style={{ fontSize:"1.1rem", fontWeight:800, color: isProfit ? GREEN_C : RED }}>
                      {netPayoutDisplay} GZO
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="card roulette-bet-table" style={{ padding:"0.875rem", background:"rgba(232,121,249,0.01)", borderColor:"rgba(232,121,249,0.15)", position:"relative" }}>
            {isBusy && !animating && (
              <div style={{ position:"absolute", inset:0, borderRadius:"inherit",
                background:"rgba(10,10,24,0.6)", zIndex:5, pointerEvents:"none" }} />
            )}
            <div style={{ fontSize:"0.65rem", color:"#555577", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:"0.5rem" }}>
              Betting Table — chip: {chipValue} GZO · click to place
            </div>
            <BettingTable wagers={wagers} onBet={addBet} disabled={isBusy}
              lastResult={showResult && !animating && winningNumber !== null ? winningNumber : null} />
          </div>
        </div>

        {/* RIGHT */}
        <RightPanel
          showResult={showResult}
          winningNumber={winningNumber}
          isProfit={isProfit}
          netPayoutDisplay={netPayoutDisplay}
          totalGrossDisplay={totalGrossDisplay}
          totalStake={displayStake}
          activeRoundId={roundId}
          isWaiting={isWaiting}
        />
      </div>

      {/* How to Play */}
      <div className="card" style={{ background:"rgba(0,212,255,0.03)", borderColor:"rgba(0,212,255,0.2)",
        marginBottom:"1.25rem", padding:"1.25rem" }}>
        <h2 style={{ fontSize:"0.9375rem", fontWeight:700, marginBottom:"1rem", color:"#00d4ff",
          display:"flex", alignItems:"center", gap:"0.5rem" }}>
          <SiTarget size={16} color="#00d4ff" /> How to Play
        </h2>
        <div className="howto-grid">
          {[
            { step:"1", title:"Sign In",           desc:"Log in with your account to access your custodial GZO balance.", icon: <SiWallet size={14} color="#00d4ff" /> },
            { step:"2", title:"Pick a Chip",       desc:"Choose your bet size — 10, 50, 100, 500 GZO, or enter a custom amount.", icon: <SiChip size={14} color="#00d4ff" /> },
            { step:"3", title:"Place Your Bets",   desc:"Click any number, color, dozen, column, or outside bet. Click again to stack more chips.", icon: <SiCards size={14} color="#00d4ff" /> },
            { step:"4", title:"Hit Spin",          desc:"Stake debited from your custodial balance. House wallet calls the contract; Chainlink VRF generates randomness.", icon: <SiRefresh size={14} color="#00d4ff" /> },
            { step:"5", title:"Watch the Wheel",   desc:"The wheel lands on a number. All bets are evaluated simultaneously against that single result.", icon: <SiWheel size={14} color="#00d4ff" /> },
            { step:"6", title:"Collect Winnings",  desc:"Straight 36×, dozens/columns 3×, outside bets 2×. Winnings go straight to your custodial balance.", icon: <SiCoins size={14} color="#00d4ff" /> },
          ].map(item => (
            <div key={item.step} style={{ background:"rgba(0,212,255,0.04)", border:"1px solid rgba(0,212,255,0.12)",
              borderRadius:"10px", padding:"0.875rem", display:"flex", gap:"0.75rem", alignItems:"flex-start" }}>
              <div style={{ flexShrink:0, width:"28px", height:"28px", borderRadius:"50%",
                background:"rgba(0,212,255,0.15)", border:"1px solid rgba(0,212,255,0.3)",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:"0.7rem", fontWeight:800, color:"#00d4ff" }}>
                {item.step}
              </div>
              <div>
                <div style={{ fontSize:"0.78rem", fontWeight:700, color:"#f0f0ff", marginBottom:"0.2rem" }}>
                  {item.icon} {item.title}
                </div>
                <div style={{ fontSize:"0.7rem", color:"#8888aa", lineHeight:1.5 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <OtherGames exclude="roulette" />

      {/* How It Works */}
      <div className="card" style={{ background:"rgba(232,121,249,0.02)", borderColor:"rgba(232,121,249,0.15)",
        marginBottom:"1.25rem", padding:"1.25rem" }}>
        <h2 style={{ fontSize:"0.9375rem", fontWeight:700, marginBottom:"1rem", color:ACCENT,
          display:"flex", alignItems:"center", gap:"0.5rem" }}>
          <SiGear size={16} color={ACCENT} /> How It Works
        </h2>
        <div className="stat-grid-2">
          {[
            { icon: <SiLock size={20} color={ACCENT} />,  title:"Custodial Balance",     desc:"Your GZO balance is tracked in our database. No on-chain token approval needed — stake is debited instantly when you spin." },
            { icon: <SiDice size={20} color={ACCENT} />,  title:"Chainlink VRF",         desc:"The game contract requests a random number from Chainlink VRF. The winning number [0–36] is cryptographically provable and impossible to predict." },
            { icon: <SiLayers size={20} color={ACCENT} />,title:"Multi-Bet Evaluation",  desc:"Place up to 15 bets per spin. Once VRF delivers the winning number, each bet is evaluated independently and payouts are credited instantly." },
            { icon: <SiZap size={20} color={ACCENT} />,   title:"Settlement & Fees",     desc:"Net payout = gross winnings minus 10% fee on profit only. E.g., stake 100 GZO, gross 200 GZO → you receive 190 GZO (10 GZO fee on profit)." },
          ].map(item => (
            <div key={item.title} style={{ background:"rgba(232,121,249,0.03)", border:"1px solid rgba(232,121,249,0.1)",
              borderRadius:"10px", padding:"0.875rem" }}>
              <div style={{ fontSize:"1rem", marginBottom:"0.35rem" }}>{item.icon}</div>
              <div style={{ fontSize:"0.78rem", fontWeight:700, color:ACCENT, marginBottom:"0.3rem" }}>{item.title}</div>
              <div style={{ fontSize:"0.7rem", color:"#8888aa", lineHeight:1.6 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div style={{ marginBottom:"1.25rem" }}>
        <h2 style={{ fontSize:"1rem", fontWeight:700, marginBottom:"0.875rem", color:"#8888aa" }}>Your History</h2>
        <BetHistory game="ROULETTE" refreshTrigger={historyTick} />
      </div>

      <style>{`
        @keyframes win-pulse { 0%{opacity:0;transform:scale(.85)} 60%{transform:scale(1.05)} 100%{opacity:1;transform:scale(1)} }
        @keyframes result-reveal { 0%{opacity:0;transform:translateY(8px)} 100%{opacity:1;transform:translateY(0)} }
        @keyframes vrfSpin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes spinBtnGlow { 0%,100%{box-shadow:0 0 20px #e879f955,0 0 40px #e879f922} 50%{box-shadow:0 0 32px #e879f988,0 0 64px #e879f944} }
        @keyframes fadeIn { from{opacity:0;transform:translateX(-50%) translateY(4px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes nucleusPulse { 0%,100%{transform:translate(-50%,-50%) scale(1)} 50%{transform:translate(-50%,-50%) scale(1.25)} }
        @keyframes orbitSpin0 { from{transform:rotateZ(0deg) rotateX(15deg)} to{transform:rotateZ(360deg) rotateX(15deg)} }
        @keyframes orbitSpin1 { from{transform:rotateZ(0deg) rotateX(75deg) rotateZ(60deg)} to{transform:rotateZ(360deg) rotateX(75deg) rotateZ(60deg)} }
        @keyframes orbitSpin2 { from{transform:rotateZ(120deg) rotateX(45deg) rotateZ(0deg)} to{transform:rotateZ(120deg) rotateX(45deg) rotateZ(360deg)} }
        @keyframes progDot { 0%,80%,100%{opacity:.25;transform:scale(1)} 40%{opacity:1;transform:scale(1.4)} }
        .spin-btn-active { animation: spinBtnGlow 2s ease-in-out infinite !important; }
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatArea(area: string): string {
  if (area.startsWith("straight:")) return `Number ${area.split(":")[1]}`;
  const labels: Record<string,string> = {
    red:"Red", black:"Black", odd:"Odd", even:"Even",
    low:"1-18", high:"19-36", dozen1:"1st Dozen", dozen2:"2nd Dozen",
    dozen3:"3rd Dozen", col1:"Column 1", col2:"Column 2", col3:"Column 3",
  };
  return labels[area] ?? area;
}

const labelStyle: React.CSSProperties = {
  display:"block", fontSize:"0.68rem", fontWeight:700,
  color:"#8888aa", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:"0.35rem",
};

const inputStyle: React.CSSProperties = {
  width:"100%", padding:"0.375rem 0.5rem", background:"#0a0a18",
  border:"1px solid #2a2a50", borderRadius:"6px", color:"#f0f0ff",
  fontSize:"0.875rem", outline:"none", boxSizing:"border-box",
};
