"use client";

// Shared building blocks ported 1:1 from pack-party/preview/pack-party-screens.jsx's Shell/Chip
// (the design reference every gacha screen is built from now). Real screens compose these with
// real data instead of the reference's simulated state — see /app/gacha/play and
// /app/gacha/[roomId] for the actual per-status screens built on top. Do not reinterpret these
// through Tailwind utility classes — the pp-* classes in src/styles/pack-party.css are the source
// of truth; if the reference changes, re-port from there instead of hand-tuning drift here.

import type { ReactNode } from "react";
import Mascot, { type MascotMood } from "@/components/Mascot";

export const GRAD_STYLE = {
  background: "linear-gradient(90deg,#FF1301,#FF6A00,#EAB308)",
  WebkitBackgroundClip: "text" as const,
  backgroundClip: "text" as const,
  color: "transparent",
};

export const money = (v: number) => "$" + v.toFixed(2);

export function Shell({
  kicker,
  title,
  titleGrad,
  sub,
  children,
  footer,
}: {
  kicker?: ReactNode;
  title?: ReactNode;
  titleGrad?: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="pp-shell">
      <div className="pp-glow" />
      <header className="pp-head" style={{ justifyContent: "flex-end" }}>
        {kicker && <span className="pp-kicker">{kicker}</span>}
      </header>
      <main className="pp-main">
        {title && (
          <h1 className="pp-h1">
            {title} {titleGrad && <span style={GRAD_STYLE}>{titleGrad}</span>}
          </h1>
        )}
        {sub && <p className="pp-sub">{sub}</p>}
        {children}
      </main>
      {footer && <footer className="pp-foot">{footer}</footer>}
    </div>
  );
}

export interface ChipPlayer {
  seatNumber: number;
  mascotKey: string | null;
  name: string;
  isMe: boolean;
  excluded?: boolean;
}

export function Chip({
  p,
  mood,
  size = 84,
  dim,
  ring,
  tag,
}: {
  p: ChipPlayer;
  mood?: MascotMood;
  size?: number;
  dim?: boolean;
  ring?: string | null;
  tag?: ReactNode;
}) {
  return (
    <div className={"pp-chip" + (dim ? " dim" : "")} style={ring ? ({ "--ring": ring } as React.CSSProperties) : undefined}>
      <div className="pp-chip-av">
        {p.mascotKey && <Mascot name={p.mascotKey} mood={mood ?? (p.excluded ? "sad" : "idle")} size={size} title={p.name} />}
      </div>
      <div className="pp-chip-name">
        {p.name}
        {p.isMe && <span className="pp-you">YOU</span>}
      </div>
      {tag && <div className="pp-chip-tag">{tag}</div>}
    </div>
  );
}
