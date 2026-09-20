"use client";

import type { NestTradeView } from "@/services/api/nest";

/** "What the AI bought/sold on your behalf" feed — each row states the reason (sentiment score,
 *  target weight) the rebalance engine recorded, not just the raw fill, so it reads as a decision
 *  log rather than an opaque transaction list. */
export function TradeHistoryList({ trades }: { trades: NestTradeView[] }) {
  if (trades.length === 0) {
    return <p style={{ fontSize: 14, color: "var(--ink3)" }}>No trades yet — your first rebalance runs after you deposit.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {trades.map(trade => {
        const isBuy = trade.side === "buy";
        const simulated = trade.reason?.includes("[SIMULATED]");
        return (
          <div key={trade.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, borderRadius: 10, background: "var(--paper2)", padding: "10px 14px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: isBuy ? "var(--up)" : "var(--down)" }}>
                  {isBuy ? "Bought" : "Sold"}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{trade.symbol}</span>
                {simulated && (
                  <span style={{ borderRadius: 999, border: "1px solid var(--line)", padding: "1px 7px", fontSize: 10, color: "var(--ink3)" }}>Simulated</span>
                )}
              </div>
              {trade.reason && (
                <p style={{ marginTop: 3, fontSize: 12, color: "var(--ink3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {trade.reason.replace("[SIMULATED] ", "").replace("elfa score", "Elfa score")}
                </p>
              )}
            </div>
            <div style={{ flexShrink: 0, textAlign: "right" }}>
              <p style={{ fontSize: 14 }}>${trade.usdValue.toFixed(2)}</p>
              <p style={{ fontSize: 12, color: "var(--ink3)" }}>{new Date(trade.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
