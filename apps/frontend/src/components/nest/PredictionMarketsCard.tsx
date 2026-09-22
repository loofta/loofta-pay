"use client";

import type { KalshiMarket } from "@/services/api/nest";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";

/**
 * Live, real Kalshi markets on the companies someone actually holds — CEO changes, earnings/KPI
 * targets, product launches. Event-shaped, never a price-direction bet: Kalshi has no per-stock
 * up/down contract (checked against their live API, 2026-09-21), and we don't invent one.
 *
 * Deliberately standalone rather than nested inside a suggestion card: markets are interesting on
 * a quiet day too, and burying them behind "did a suggestion fire?" meant they were invisible
 * almost always. The odds shown are Kalshi's own live pricing, never a Loofta view — trading
 * happens on Kalshi, under their account and their rules, not here.
 */
export function PredictionMarketsCard({ markets }: { markets: Array<KalshiMarket & { symbol: string }> }) {
  if (markets.length === 0) return null;

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div className="ns-serif" style={{ fontSize: 22 }}>Markets on your companies</div>
        <div style={{ fontSize: 12, color: "var(--ink3)" }}>Live odds from Kalshi</div>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "0 0 14px", maxWidth: 620 }}>
        Real prediction markets on things that could happen at companies you hold. These are other people's odds, not our forecast — and trading them happens on Kalshi, not here.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {markets.map(m => (
          <a
            key={`${m.symbol}-${m.ticker}`}
            href={m.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--paper2)",
              padding: "10px 14px",
            }}
          >
            <img src={fav(tickerDomain(m.symbol))} alt="" style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink2)" }}>{m.title}</span>
            {m.yesPrice !== null && (
              <span style={{ flexShrink: 0, textAlign: "right" }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{Math.round(m.yesPrice * 100)}%</span>
                <span style={{ fontSize: 11, color: "var(--ink3)", display: "block", lineHeight: 1 }}>yes</span>
              </span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
