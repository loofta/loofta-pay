"use client";

import { useState } from "react";
import type { NestHoldingView } from "@/services/api/nest";

/**
 * Ranked bar list rather than a donut — composition-by-weight reads more accurately as
 * comparable bar lengths than as angles, and this doubles as the accessible "table view" of the
 * basket (symbol, weight, value, P&L are all direct-labeled, not color-only). Per-position P&L
 * is hidden by default (parts-of-a-whole first — frequent per-holding P&L checking is what
 * widens the behaviour gap); one tap reveals it.
 */
export function HoldingsBreakdown({ holdings, totalValueUsd }: { holdings: NestHoldingView[]; totalValueUsd: number }) {
  const [showPnl, setShowPnl] = useState(false);
  const sorted = [...holdings]
    .filter(h => (h.valueUsd ?? 0) > 0.01)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  if (sorted.length === 0) {
    return <p style={{ fontSize: 14, color: "var(--ink3)" }}>No positions yet — deposit to start building your basket.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setShowPnl(v => !v)} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 9999, padding: "4px 12px", fontSize: 12, color: "var(--ink3)", cursor: "pointer" }}>
          {showPnl ? "Hide P&L" : "Show P&L"}
        </button>
      </div>
      {sorted.map(h => {
        const weight = totalValueUsd > 0 ? (h.valueUsd ?? 0) / totalValueUsd : 0;
        const pnlUp = (h.pnlUsd ?? 0) >= 0;
        return (
          <div key={h.symbol} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 100, flexShrink: 0, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.name}</div>
            <div style={{ position: "relative", height: 8, flex: 1, borderRadius: 999, background: "var(--paper2)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, background: "var(--accent)", opacity: 0.55, width: `${Math.min(weight * 100, 100)}%` }} />
            </div>
            <div style={{ width: 48, flexShrink: 0, textAlign: "right", fontSize: 12, color: "var(--ink3)" }}>{(weight * 100).toFixed(1)}%</div>
            <div style={{ width: 76, flexShrink: 0, textAlign: "right", fontSize: 14 }}>${(h.valueUsd ?? 0).toFixed(2)}</div>
            {showPnl && (
              <div style={{ width: 60, flexShrink: 0, textAlign: "right", fontSize: 13, color: h.currentPrice === null ? "var(--ink3)" : pnlUp ? "var(--up)" : "var(--down)" }}>
                {h.currentPrice === null ? "—" : `${pnlUp ? "+" : ""}${((h.pnlPct ?? 0) * 100).toFixed(1)}%`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
