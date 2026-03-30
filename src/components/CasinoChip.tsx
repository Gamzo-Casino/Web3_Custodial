"use client";

export const CHIP_OPTIONS = [
  { value: 10,  color: "#00d4ff", label: "10"  },
  { value: 50,  color: "#00ff9d", label: "50"  },
  { value: 100, color: "#e879f9", label: "100" },
  { value: 500, color: "#ff4444", label: "500" },
];

interface CasinoChipProps {
  value: number;
  color: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export default function CasinoChip({ value, color, active, onClick, disabled }: CasinoChipProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "52px",
        height: "52px",
        borderRadius: "50%",
        flexShrink: 0,
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
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1px",
        outline: "none",
      }}
    >
      <div style={{
        position: "absolute", inset: "5px", borderRadius: "50%",
        border: `1px dashed ${color}${active ? "66" : "33"}`,
        pointerEvents: "none",
      }} />
      <span style={{
        fontSize: value >= 100 ? "0.62rem" : "0.72rem",
        fontWeight: 900,
        color: active ? color : color + "cc",
        fontFamily: "monospace",
        letterSpacing: "-0.03em",
        lineHeight: 1,
        position: "relative",
        zIndex: 1,
      }}>
        {value}
      </span>
      <span style={{
        fontSize: "0.45rem",
        color: active ? color + "cc" : color + "66",
        fontWeight: 600,
        position: "relative",
        zIndex: 1,
        letterSpacing: "0.04em",
      }}>
        GZO
      </span>
    </button>
  );
}
