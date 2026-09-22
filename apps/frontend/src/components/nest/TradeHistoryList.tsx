"use client";

import { useEffect, useState } from "react";
import type { NestTradeView } from "@/services/api/nest";
import { humanizeReason, isSimulated } from "@/components/nest/nestCopy";

const PAGE_SIZE = 10;

/** "What the engine bought/sold on your behalf" feed — each row states the reason the rebalance
 *  engine recorded (starting position, or rebalancing back to target weight), not just the raw
 *  fill, so it reads as a decision log rather than an opaque transaction list. */
export function TradeHistoryList({ trades }: { trades: NestTradeView[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(trades.length / PAGE_SIZE);

  useEffect(() => {
    setPage(0);
  }, [trades]);

  if (trades.length === 0) {
    return <p style={{ fontSize: 14, color: "var(--ink3)" }}>No trades yet — your first rebalance runs after you deposit.</p>;
  }

  const pageTrades = trades.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {pageTrades.map(trade => {
        const isBuy = trade.side === "buy";
        const simulated = isSimulated(trade.reason);
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
              <p style={{ marginTop: 3, fontSize: 12, color: "var(--ink3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {humanizeReason(trade.reason, trade.side, trade.usdValue)}
              </p>
            </div>
            <div style={{ flexShrink: 0, textAlign: "right" }}>
              <p style={{ fontSize: 14 }}>${trade.usdValue.toFixed(2)}</p>
              <p style={{ fontSize: 12, color: "var(--ink3)" }}>{new Date(trade.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        );
      })}
      {pageCount > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ fontSize: 12, color: page === 0 ? "var(--ink3)" : "var(--ink)", background: "none", border: "none", cursor: page === 0 ? "default" : "pointer", padding: "4px 8px" }}
          >
            Prev
          </button>
          <span style={{ fontSize: 12, color: "var(--ink3)" }}>
            {page + 1} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={page === pageCount - 1}
            style={{ fontSize: 12, color: page === pageCount - 1 ? "var(--ink3)" : "var(--ink)", background: "none", border: "none", cursor: page === pageCount - 1 ? "default" : "pointer", padding: "4px 8px" }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
