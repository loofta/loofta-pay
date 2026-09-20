"use client";

import { useMemo, useState } from "react";
import type { NestHoldingView, NestUniverseAsset } from "@/services/api/nest";
import { TAG_LABELS } from "@/components/nest/OnboardingFlow";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";

// Muted, nest-palette segment colors (same family as the egg colors in NestHero) — enough for
// the handful of categories a basket realistically spans; cycles after that.
const SEGMENT_COLORS = ["#66865f", "#9d8056", "#7d927f", "#9b746b", "#8a9a86", "#aaa9a0", "#b39a6e", "#6f8f8a", "#a08a9a", "#8d9f6c"];
const CASH_COLOR = "#d7d2c6";

interface Segment {
  key: string;
  label: string;
  valueUsd: number;
  weight: number;
  color: string;
  holdings: NestHoldingView[];
}

/**
 * The nest as a ring: one segment per interest category, sized by allocation — "how am I
 * invested" at a glance, tap a segment to see the stocks inside it. Per-stock P&L is deliberately
 * not on the ring (parts-of-a-whole first; the breakdown list reveals P&L on request).
 */
export function CategoryRing({ holdings, universe, totalValueUsd }: { holdings: NestHoldingView[]; universe: NestUniverseAsset[]; totalValueUsd: number }) {
  const [selected, setSelected] = useState<string | null>(null);

  const segments = useMemo<Segment[]>(() => {
    const tagBySymbol = new Map(universe.map(a => [a.symbol, a.tags[0] ?? "other"]));
    const groups = new Map<string, NestHoldingView[]>();
    for (const h of holdings) {
      if ((h.valueUsd ?? 0) <= 0) continue;
      const key = h.symbol === "USD" ? "cash" : tagBySymbol.get(h.symbol) ?? "other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(h);
    }
    const total = totalValueUsd > 0 ? totalValueUsd : 1;
    const out = [...groups.entries()]
      .map(([key, hs]) => ({ key, valueUsd: hs.reduce((s, h) => s + (h.valueUsd ?? 0), 0), holdings: hs.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)) }))
      .sort((a, b) => (a.key === "cash" ? 1 : b.key === "cash" ? -1 : b.valueUsd - a.valueUsd));
    return out.map((g, i) => ({
      ...g,
      label: g.key === "cash" ? "Cash" : TAG_LABELS[g.key] ?? g.key,
      weight: g.valueUsd / total,
      color: g.key === "cash" ? CASH_COLOR : SEGMENT_COLORS[i % SEGMENT_COLORS.length],
    }));
  }, [holdings, universe, totalValueUsd]);

  if (segments.length === 0) {
    return <p style={{ fontSize: 14, color: "var(--ink3)" }}>Your ring fills in once the first rebalance runs — shortly after you deposit.</p>;
  }

  const size = 220, stroke = 26, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 3 : 0;
  let offset = 0;
  const active = segments.find(s => s.key === selected) ?? null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0, margin: "0 auto" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          {segments.map(s => {
            const len = Math.max(s.weight * c - gap, 0);
            const el = (
              <circle
                key={s.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={selected === s.key ? stroke + 6 : stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                style={{ cursor: "pointer", opacity: selected && selected !== s.key ? 0.35 : 1, transition: "opacity .2s, stroke-width .2s" }}
                onClick={() => setSelected(selected === s.key ? null : s.key)}
              />
            );
            offset += s.weight * c;
            return el;
          })}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", pointerEvents: "none", padding: 40 }}>
          <div className="ns-serif" style={{ fontSize: 28, lineHeight: 1 }}>{active ? `${(active.weight * 100).toFixed(0)}%` : segments.filter(s => s.key !== "cash").length}</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>{active ? active.label : "categories"}</div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 220 }}>
        {!active ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {segments.map(s => (
              <button
                key={s.key}
                onClick={() => setSelected(s.key)}
                style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: "6px 0", cursor: "pointer", textAlign: "left", color: "var(--ink)" }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14 }}>{s.label}</span>
                <span style={{ fontSize: 13, color: "var(--ink3)" }}>{(s.weight * 100).toFixed(1)}%</span>
                <span style={{ fontSize: 13, width: 70, textAlign: "right" }}>${s.valueUsd.toFixed(2)}</span>
              </button>
            ))}
            <p style={{ fontSize: 12, color: "var(--ink3)", marginTop: 4 }}>Tap a category to see what's in it.</p>
          </div>
        ) : (
          <div>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 10 }}>
              ← All categories
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {active.holdings.map(h => {
                const w = totalValueUsd > 0 ? (h.valueUsd ?? 0) / totalValueUsd : 0;
                return (
                  <div key={h.symbol} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {h.symbol !== "USD" && <img src={fav(tickerDomain(h.symbol))} alt="" style={{ width: 18, height: 18, borderRadius: 5 }} />}
                    <span style={{ flex: 1, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                    <span style={{ fontSize: 13, color: "var(--ink3)" }}>{(w * 100).toFixed(1)}%</span>
                    <span style={{ fontSize: 13, width: 70, textAlign: "right" }}>${(h.valueUsd ?? 0).toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
