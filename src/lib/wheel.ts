/**
 * Wheel game logic — provably fair spinning wheel with risk presets.
 *
 * Pure spin payout model: landed segment multiplier defines payout directly.
 * Three risk modes: low / medium / high.
 *
 * Fairness: stopPosition = floor(bytesToFloat(HMAC) × totalWeight)
 * Then find which segment contains that stop.
 */

import { hmacSha256Bytes, bytesToFloat } from "@/lib/rng";

export const WHEEL_VERSION = 1;

export type WheelRisk = "low" | "medium" | "high";

export interface WheelSegment {
  index: number;
  label: string;
  multiplier: number;
  weight: number;     // out of totalWeight stops
  color: string;      // fill color
  textColor: string;  // label color
}

export interface WheelConfig {
  risk: WheelRisk;
  version: number;
  totalWeight: number;
  segments: WheelSegment[];
}

// ─── Segment Definitions ──────────────────────────────────────────────────────

type SegDef = Omit<WheelSegment, "index">;

const LOW_SEGS: SegDef[] = [
  { label: "0×",   multiplier: 0,   weight: 18, color: "#12122a", textColor: "#555577" },
  { label: "1.2×", multiplier: 1.2, weight: 16, color: "#0d3060", textColor: "#60c8ff" },
  { label: "1.5×", multiplier: 1.5, weight: 10, color: "#0a4030", textColor: "#00ff9d" },
  { label: "2×",   multiplier: 2,   weight: 6,  color: "#1a4400", textColor: "#88ff44" },
  { label: "3×",   multiplier: 3,   weight: 3,  color: "#3d3000", textColor: "#ffd700" },
  { label: "5×",   multiplier: 5,   weight: 1,  color: "#3d1800", textColor: "#ff9d00" },
];

const MEDIUM_SEGS: SegDef[] = [
  { label: "0×",   multiplier: 0,   weight: 25, color: "#12122a", textColor: "#555577" },
  { label: "1.5×", multiplier: 1.5, weight: 13, color: "#0d3060", textColor: "#60c8ff" },
  { label: "2×",   multiplier: 2,   weight: 8,  color: "#0a4030", textColor: "#00ff9d" },
  { label: "5×",   multiplier: 5,   weight: 5,  color: "#3d3000", textColor: "#ffd700" },
  { label: "10×",  multiplier: 10,  weight: 2,  color: "#3d1800", textColor: "#ff9d00" },
  { label: "25×",  multiplier: 25,  weight: 1,  color: "#3d0000", textColor: "#ff5555" },
];

const HIGH_SEGS: SegDef[] = [
  { label: "0×",    multiplier: 0,   weight: 32, color: "#12122a", textColor: "#555577" },
  { label: "2×",    multiplier: 2,   weight: 11, color: "#0d3060", textColor: "#60c8ff" },
  { label: "5×",    multiplier: 5,   weight: 6,  color: "#0a4030", textColor: "#00ff9d" },
  { label: "10×",   multiplier: 10,  weight: 3,  color: "#3d3000", textColor: "#ffd700" },
  { label: "50×",   multiplier: 50,  weight: 1,  color: "#3d0000", textColor: "#ff5555" },
  { label: "100×",  multiplier: 100, weight: 1,  color: "#2d0040", textColor: "#c084fc" },
];

function buildConfig(risk: WheelRisk, defs: SegDef[]): WheelConfig {
  const totalWeight = defs.reduce((s, d) => s + d.weight, 0);
  return {
    risk,
    version: WHEEL_VERSION,
    totalWeight,
    segments: defs.map((d, i) => ({ ...d, index: i })),
  };
}

export const WHEEL_CONFIGS: Record<WheelRisk, WheelConfig> = {
  low:    buildConfig("low",    LOW_SEGS),
  medium: buildConfig("medium", MEDIUM_SEGS),
  high:   buildConfig("high",   HIGH_SEGS),
};

// ─── RNG ──────────────────────────────────────────────────────────────────────

export function computeWheelPublicSeed(userId: string): string {
  return `wheel:${userId}`;
}

export interface WheelSpinResult {
  stopPosition: number;
  segmentIndex: number;
  segmentLabel: string;
  landedMultiplier: number;
}

/**
 * Deterministically select a stop and segment.
 * stopPosition = floor(bytesToFloat(HMAC) × totalWeight) ∈ [0, totalWeight)
 */
export function computeWheelSpin(
  serverSeed: string,
  clientSeed: string,
  publicSeed: string,
  nonce: number,
  risk: WheelRisk
): WheelSpinResult {
  const config = WHEEL_CONFIGS[risk];
  const bytes = hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce);
  const float = bytesToFloat(bytes);
  const stopPosition = Math.floor(float * config.totalWeight);

  let cumulative = 0;
  for (const seg of config.segments) {
    cumulative += seg.weight;
    if (stopPosition < cumulative) {
      return {
        stopPosition,
        segmentIndex: seg.index,
        segmentLabel: seg.label,
        landedMultiplier: seg.multiplier,
      };
    }
  }

  // Fallback (should never hit)
  const last = config.segments[config.segments.length - 1];
  return {
    stopPosition: config.totalWeight - 1,
    segmentIndex: last.index,
    segmentLabel: last.label,
    landedMultiplier: last.multiplier,
  };
}

export function computeWheelGrossPayout(stake: number, multiplier: number): number {
  return Math.floor(stake * multiplier);
}

/**
 * Visual angle (degrees clockwise from top) for the CENTER of a stop.
 * Used to calculate how far to rotate the wheel animation.
 */
export function stopCenterAngle(stopPosition: number, totalWeight: number): number {
  return ((stopPosition + 0.5) / totalWeight) * 360;
}

/**
 * Angular position of the start of segment i (degrees clockwise from top).
 */
export function segmentStartAngle(segmentIndex: number, config: WheelConfig): number {
  let cum = 0;
  for (let i = 0; i < segmentIndex; i++) cum += config.segments[i].weight;
  return (cum / config.totalWeight) * 360;
}
