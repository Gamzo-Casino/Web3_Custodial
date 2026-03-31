"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import WalletButton from "./WalletButton";
import {
  CoinFlipIcon, DiceIcon, PlinkoIcon,
  KenoIcon, MinesIcon, RouletteIcon, BlackjackIcon, HiloIcon, WheelIcon, AviatorIcon,
} from "./GameIcons";

type GameIconComponent = React.ComponentType<{ size?: number; color: string }>;

const SINGLE_PLAYER_GAMES: {
  href: string; label: string; Icon: GameIconComponent; color: string; desc: string;
}[] = [
  { href: "/dice",      label: "Dice",      Icon: DiceIcon,      color: "#00d4ff", desc: "Roll under your target" },
  { href: "/plinko",    label: "Plinko",    Icon: PlinkoIcon,    color: "#ffd700", desc: "Drop a ball, hit a bin" },
  { href: "/keno",      label: "Keno",      Icon: KenoIcon,      color: "#a855f7", desc: "Pick your numbers" },
  { href: "/mines",     label: "Mines",     Icon: MinesIcon,     color: "#ff3d7a", desc: "Avoid the bombs" },
  { href: "/roulette",  label: "Roulette",  Icon: RouletteIcon,  color: "#e879f9", desc: "Spin the wheel" },
  { href: "/blackjack", label: "Blackjack", Icon: BlackjackIcon, color: "#14b8a6", desc: "Beat the dealer" },
  { href: "/hilo",      label: "Hilo",      Icon: HiloIcon,      color: "#818cf8", desc: "Higher, lower, or same?" },
  { href: "/wheel",     label: "Wheel",     Icon: WheelIcon,     color: "#fb923c", desc: "Spin for a multiplier" },
  { href: "/aviator",   label: "Aviator",   Icon: AviatorIcon,   color: "#ff6b35", desc: "Fly before the crash" },
];

const TOOLS_NAV = [
  { href: "/history", label: "History" },
  { href: "/verify",  label: "Verify" },
];

export default function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);          // desktop single-player dropdown
  const [mobileOpen, setMobileOpen] = useState(false); // mobile full menu
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close both menus on route change
  useEffect(() => {
    setOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const isGameActive = SINGLE_PLAYER_GAMES.some((g) => pathname === g.href);

  return (
    <header
      style={{
        background: "rgba(13, 13, 26, 0.95)",
        borderBottom: "1px solid #2a2a50",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <nav
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "0 1.25rem",
          height: "64px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
        }}
      >
        {/* Logo */}
        <Link
          href="/"
          style={{
            fontSize: "1.4rem",
            fontWeight: 800,
            background: "linear-gradient(135deg, #00ff9d, #00d4ff)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            textDecoration: "none",
            letterSpacing: "-0.5px",
            flexShrink: 0,
          }}
        >
          Gamzo
        </Link>

        {/* Desktop nav links — hidden on mobile */}
        <div
          className="desktop-nav"
          style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
        >
          {/* Coin Flip — PvP */}
          <Link
            href="/coinflip"
            className={`nav-link${pathname === "/coinflip" ? " active" : ""}`}
            style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}
          >
            <CoinFlipIcon size={16} color={pathname === "/coinflip" ? "#00ff9d" : "#8888aa"} />
            Coin Flip
          </Link>

          {/* Single Player dropdown */}
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              onClick={() => setOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "0.4rem 0.75rem",
                borderRadius: "8px",
                border: "none",
                background: open || isGameActive ? "rgba(0,212,255,0.12)" : "transparent",
                color: open || isGameActive ? "#00d4ff" : "#8888aa",
                fontSize: "0.875rem",
                fontWeight: open || isGameActive ? 700 : 400,
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              Single Player
              <svg
                width="12" height="12" viewBox="0 0 12 12" fill="none"
                style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {open && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "#0d0d1f",
                  border: "1px solid #2a2a50",
                  borderRadius: "14px",
                  padding: "0.5rem",
                  minWidth: "240px",
                  boxShadow: "0 20px 56px rgba(0,0,0,0.7)",
                  zIndex: 100,
                }}
              >
                <div style={{
                  fontSize: "0.6rem", fontWeight: 700, color: "#555577",
                  textTransform: "uppercase", letterSpacing: "0.08em",
                  padding: "0.3rem 0.6rem 0.5rem",
                }}>
                  Single Player
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px" }}>
                  {SINGLE_PLAYER_GAMES.map(({ href, label, Icon, color, desc }) => {
                    const active = pathname === href;
                    return (
                      <Link
                        key={href}
                        href={href}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.45rem 0.55rem",
                          borderRadius: "8px",
                          textDecoration: "none",
                          background: active ? `${color}12` : "transparent",
                          border: active ? `1px solid ${color}30` : "1px solid transparent",
                          transition: "background 0.12s",
                        }}
                        onMouseEnter={(e) => {
                          if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                        }}
                        onMouseLeave={(e) => {
                          if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                        }}
                      >
                        <span style={{ flexShrink: 0, display: "flex" }}>
                          <Icon size={20} color={active ? color : "#555577"} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: "0.8rem", fontWeight: 600,
                            color: active ? color : "#f0f0ff",
                            whiteSpace: "nowrap",
                          }}>
                            {label}
                          </div>
                          <div style={{ fontSize: "0.65rem", color: "#555577", marginTop: "0.05rem", whiteSpace: "nowrap" }}>
                            {desc}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <span style={{ width: "1px", height: "16px", background: "#2a2a50", margin: "0 0.25rem" }} />

          {TOOLS_NAV.map(({ href, label }) => (
            <Link key={href} href={href} className={`nav-link${pathname === href ? " active" : ""}`}>
              {label}
            </Link>
          ))}
        </div>

        {/* Right side: wallet button + hamburger */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexShrink: 0 }}>
          {/* Wallet button always visible */}
          <div className="wallet-btn-wrap">
            <WalletButton />
          </div>

          {/* Hamburger — only on mobile */}
          <button
            className="hamburger-btn"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            style={{
              display: "none",  /* shown via CSS on mobile */
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              gap: "5px",
              width: "40px",
              height: "40px",
              borderRadius: "8px",
              border: "1px solid #2a2a50",
              background: mobileOpen ? "rgba(0,212,255,0.08)" : "transparent",
              cursor: "pointer",
              flexShrink: 0,
              padding: 0,
            }}
          >
            <span style={{
              display: "block", width: "18px", height: "2px",
              background: mobileOpen ? "#00d4ff" : "#8888aa",
              borderRadius: "2px",
              transition: "transform 0.2s, opacity 0.2s",
              transform: mobileOpen ? "rotate(45deg) translate(5px, 5px)" : "none",
            }} />
            <span style={{
              display: "block", width: "18px", height: "2px",
              background: mobileOpen ? "#00d4ff" : "#8888aa",
              borderRadius: "2px",
              transition: "opacity 0.2s",
              opacity: mobileOpen ? 0 : 1,
            }} />
            <span style={{
              display: "block", width: "18px", height: "2px",
              background: mobileOpen ? "#00d4ff" : "#8888aa",
              borderRadius: "2px",
              transition: "transform 0.2s, opacity 0.2s",
              transform: mobileOpen ? "rotate(-45deg) translate(5px, -5px)" : "none",
            }} />
          </button>
        </div>
      </nav>

      {/* ── Mobile Menu Drawer — always in DOM, animated ───────────── */}

      {/* Overlay */}
      <div
        className={`mobile-menu-overlay${mobileOpen ? " open" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Drawer */}
      <div className={`mobile-menu-drawer${mobileOpen ? " open" : ""}`}>

        {/* Drawer header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 1.25rem",
          height: "64px",
          borderBottom: "1px solid #2a2a50",
          flexShrink: 0,
        }}>
          <Link href="/" onClick={() => setMobileOpen(false)} style={{
            fontSize: "1.4rem", fontWeight: 800,
            background: "linear-gradient(135deg, #00ff9d, #00d4ff)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            backgroundClip: "text", textDecoration: "none", letterSpacing: "-0.5px",
          }}>
            Gamzo
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            style={{
              width: 36, height: 36, borderRadius: "8px",
              border: "1px solid #2a2a50", background: "transparent",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              color: "#8888aa", fontSize: "1.1rem", lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Drawer body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem 1rem" }}>

          {/* PvP */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{
              fontSize: "0.6rem", fontWeight: 700, color: "#555577",
              textTransform: "uppercase", letterSpacing: "0.1em",
              marginBottom: "0.5rem", paddingLeft: "0.25rem",
            }}>
              PvP
            </div>
            <Link
              href="/coinflip"
              onClick={() => setMobileOpen(false)}
              style={{
                display: "flex", alignItems: "center", gap: "0.875rem",
                padding: "0.75rem 0.875rem", borderRadius: "12px",
                textDecoration: "none",
                background: pathname === "/coinflip" ? "rgba(0,255,157,0.08)" : "rgba(255,255,255,0.02)",
                border: pathname === "/coinflip" ? "1px solid rgba(0,255,157,0.25)" : "1px solid #2a2a50",
              }}
            >
              <CoinFlipIcon size={24} color={pathname === "/coinflip" ? "#00ff9d" : "#555577"} />
              <div>
                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: pathname === "/coinflip" ? "#00ff9d" : "#f0f0ff" }}>
                  Coin Flip
                </div>
                <div style={{ fontSize: "0.68rem", color: "#555577", marginTop: "1px" }}>
                  PvP match — winner takes the pot
                </div>
              </div>
            </Link>
          </div>

          {/* Single Player */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{
              fontSize: "0.6rem", fontWeight: 700, color: "#555577",
              textTransform: "uppercase", letterSpacing: "0.1em",
              marginBottom: "0.5rem", paddingLeft: "0.25rem",
            }}>
              Single Player
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {SINGLE_PLAYER_GAMES.map(({ href, label, Icon, color, desc }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.875rem",
                      padding: "0.65rem 0.875rem", borderRadius: "10px",
                      textDecoration: "none",
                      background: active ? `${color}12` : "transparent",
                      border: active ? `1px solid ${color}30` : "1px solid transparent",
                      transition: "background 0.12s",
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>
                      <Icon size={22} color={active ? color : "#555577"} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.875rem", fontWeight: 600, color: active ? color : "#f0f0ff" }}>
                        {label}
                      </div>
                      <div style={{ fontSize: "0.66rem", color: "#555577", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {desc}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Tools */}
          <div style={{ borderTop: "1px solid #2a2a50", paddingTop: "1.25rem" }}>
            <div style={{
              fontSize: "0.6rem", fontWeight: 700, color: "#555577",
              textTransform: "uppercase", letterSpacing: "0.1em",
              marginBottom: "0.5rem", paddingLeft: "0.25rem",
            }}>
              Tools
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              {TOOLS_NAV.map(({ href, label }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    style={{
                      display: "flex", alignItems: "center", gap: "0.875rem",
                      padding: "0.65rem 0.875rem", borderRadius: "10px",
                      textDecoration: "none", fontWeight: active ? 700 : 500,
                      fontSize: "0.875rem",
                      color: active ? "#00ff9d" : "#c0c0dd",
                      background: active ? "rgba(0,255,157,0.08)" : "transparent",
                      border: active ? "1px solid rgba(0,255,157,0.2)" : "1px solid transparent",
                    }}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Inline responsive styles for nav */}
      <style>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .hamburger-btn { display: flex !important; }
        }
        @media (min-width: 769px) {
          .mobile-menu-overlay,
          .mobile-menu-drawer { display: none !important; }
        }
        @media (max-width: 400px) {
          .wallet-btn-wrap button,
          .wallet-btn-wrap div[role="button"] {
            font-size: 0.75rem !important;
            padding: 0.375rem 0.625rem !important;
          }
        }
      `}</style>
    </header>
  );
}
