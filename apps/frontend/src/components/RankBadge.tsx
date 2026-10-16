"use client";

import { useId } from "react";
import type { TierKey } from "@/lib/tiers";

// Game-style rank emblems: a chunky shield with a bevel, a darker "thick" bottom edge (the
// Duolingo 3D look) and a tier-specific mark on top. Pure SVG, no assets.
const RANKS: Record<TierKey, { top: string; bottom: string; edge: string; shine: string; mark: "chevron1" | "chevron2" | "chevron3" | "crown" | "star" }> = {
  peon:    { top: "#C98A5A", bottom: "#8C5530", edge: "#5E361A", shine: "#F0C9A4", mark: "chevron1" },
  hustler: { top: "#D9DEE8", bottom: "#97A1B5", edge: "#5F6A80", shine: "#FFFFFF", mark: "chevron2" },
  whale:   { top: "#5BC4FF", bottom: "#2272E6", edge: "#143F8F", shine: "#C8EBFF", mark: "chevron3" },
  mogul:   { top: "#FFD84A", bottom: "#F09A00", edge: "#9A5A00", shine: "#FFF3B0", mark: "crown" },
  legend:  { top: "#D77BFF", bottom: "#7A2BE0", edge: "#45148F", shine: "#F2CCFF", mark: "star" },
};

function Mark({ kind }: { kind: (typeof RANKS)[TierKey]["mark"] }) {
  const w = { fill: "#fff", stroke: "rgba(0,0,0,0.28)", strokeWidth: 1.2, strokeLinejoin: "round" as const };
  if (kind === "crown") return <path {...w} d="M20 38 L22 24 L28 31 L32 21 L36 31 L42 24 L44 38 Z" />;
  if (kind === "star") return <path {...w} d="M32 19 L35.6 27.4 L44.6 28.2 L37.8 34.1 L39.9 42.9 L32 38.2 L24.1 42.9 L26.2 34.1 L19.4 28.2 L28.4 27.4 Z" />;
  const n = kind === "chevron1" ? 1 : kind === "chevron2" ? 2 : 3;
  const gap = 8;
  const y0 = 38 - ((n - 1) * gap) / 2 - 4;
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <path key={i} {...w} d={`M21 ${y0 + i * gap + 7} L32 ${y0 + i * gap - 2} L43 ${y0 + i * gap + 7} L43 ${y0 + i * gap + 12} L32 ${y0 + i * gap + 3} L21 ${y0 + i * gap + 12} Z`} />
      ))}
    </>
  );
}

export function RankBadge({ tier, size = 44, label = false }: { tier: TierKey; size?: number; label?: string | false }) {
  const id = useId().replace(/:/g, "");
  const r = RANKS[tier];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }} title={typeof label === "string" ? label : undefined}>
      <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={typeof label === "string" ? `${label} rank` : "rank"} style={{ filter: "drop-shadow(0 3px 0 rgba(0,0,0,0.35))" }}>
        <defs>
          <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={r.top} />
            <stop offset="1" stopColor={r.bottom} />
          </linearGradient>
        </defs>
        {/* thick bottom edge */}
        <path d="M32 61 L9 50 L9 17 Q9 13 13 12 L32 5 L51 12 Q55 13 55 17 L55 50 Z" fill={r.edge} />
        {/* face */}
        <path d="M32 57 L11 47 L11 17 Q11 14.5 13.5 13.6 L32 7 L50.5 13.6 Q53 14.5 53 17 L53 47 Z" fill={`url(#${id}f)`} stroke={r.shine} strokeOpacity="0.6" strokeWidth="1.5" />
        {/* top shine */}
        <path d="M14 17 Q14 15.8 15.4 15.3 L32 9.5 L48.6 15.3 Q50 15.8 50 17 L50 24 Q32 18 14 24 Z" fill={r.shine} opacity="0.35" />
        <Mark kind={r.mark} />
      </svg>
      {label ? (
        <span style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.04em", textTransform: "uppercase", color: r.top, textShadow: "0 2px 0 rgba(0,0,0,0.35)" }}>{label}</span>
      ) : null}
    </span>
  );
}
