"use client";

import { useMemo, useState } from "react";

export interface NavPoint {
  date: string;
  totalValueUsd: number;
  totalCostUsd: number;
}

const WIDTH = 640;
const HEIGHT = 220;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;
const PAD_TOP = 16;
const PAD_BOTTOM = 24;

/**
 * Daily NAV-over-time chart: portfolio value (solid area, status-colored by current P&L sign —
 * never a decorative hue) against cost basis (thin dashed neutral reference line, not a second
 * "series" competing for identity). Single axis, no dual-scale trick. Hand-rolled SVG rather than
 * a charting dependency. Colors read from the nest-splash CSS vars (--up/--down/--ink*) so it
 * matches whichever ns- palette (light or .ns-dark) it's rendered inside.
 */
export function NavChart({ points }: { points: NavPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { pathD, areaD, costD, xFor, yFor } = useMemo(() => {
    if (points.length === 0) {
      return { pathD: "", areaD: "", costD: "", xFor: () => 0, yFor: () => 0 };
    }
    const values = points.flatMap(p => [p.totalValueUsd, p.totalCostUsd]);
    const minY = Math.min(...values) * 0.98;
    const maxY = Math.max(...values) * 1.02 || 1;
    const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const xFor = (i: number) => PAD_LEFT + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const yFor = (v: number) => PAD_TOP + innerH - ((v - minY) / (maxY - minY || 1)) * innerH;

    const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.totalValueUsd)}`).join(" ");
    const areaD = `${pathD} L ${xFor(points.length - 1)} ${HEIGHT - PAD_BOTTOM} L ${xFor(0)} ${HEIGHT - PAD_BOTTOM} Z`;
    const costD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(p.totalCostUsd)}`).join(" ");
    return { pathD, areaD, costD, xFor, yFor };
  }, [points]);

  if (points.length === 0) {
    return (
      <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, border: "1px solid var(--line2)", fontSize: 14, color: "var(--ink3)" }}>
        No performance history yet — the first daily rebalance will start this chart.
      </div>
    );
  }

  const latest = points[points.length - 1];
  const isUp = latest.totalValueUsd >= latest.totalCostUsd;
  const statusColor = isUp ? "var(--up)" : "var(--down)";
  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: "100%" }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * WIDTH;
          const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
          const ratio = Math.min(1, Math.max(0, (relX - PAD_LEFT) / innerW));
          setHoverIdx(Math.round(ratio * (points.length - 1)));
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="nestNavFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={statusColor} stopOpacity={0.2} />
            <stop offset="100%" stopColor={statusColor} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* recessive gridlines */}
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={PAD_TOP + f * (HEIGHT - PAD_TOP - PAD_BOTTOM)} y2={PAD_TOP + f * (HEIGHT - PAD_TOP - PAD_BOTTOM)} stroke="var(--line)" strokeWidth={1} />
        ))}

        <path d={areaD} fill="url(#nestNavFill)" />
        <path d={costD} fill="none" stroke="var(--ink3)" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="4 4" />
        <path d={pathD} fill="none" stroke={statusColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {hoverIdx !== null && <line x1={xFor(hoverIdx)} x2={xFor(hoverIdx)} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} stroke="var(--line)" strokeWidth={1.5} />}
        {hoverIdx !== null && hovered && <circle cx={xFor(hoverIdx)} cy={yFor(hovered.totalValueUsd)} r={4} fill={statusColor} stroke="var(--paper)" strokeWidth={2} />}
      </svg>

      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--ink3)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", height: 2, width: 12, borderRadius: 999, backgroundColor: statusColor }} />
          Portfolio value
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", height: 0, width: 12, borderTop: "1px dashed var(--ink3)" }} />
          Cost basis (what you put in)
        </span>
      </div>

      {hovered && (
        <div className="ns-card" style={{ position: "absolute", top: 0, right: 0, padding: "8px 12px", pointerEvents: "none" }}>
          <p style={{ fontSize: 12, color: "var(--ink3)" }}>{hovered.date}</p>
          <p style={{ fontSize: 13, fontWeight: 600 }}>${hovered.totalValueUsd.toFixed(2)}</p>
          <p style={{ fontSize: 12, color: "var(--ink3)" }}>cost ${hovered.totalCostUsd.toFixed(2)}</p>
        </div>
      )}
    </div>
  );
}
