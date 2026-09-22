"use client";

import type { KalshiMarket } from "@/services/api/nest";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";

/**
 * Live, real Kalshi markets on the companies someone actually holds — CEO changes, earnings/KPI
 * targets, product launches. Event-shaped, never a price-direction bet: Kalshi has no per-stock
 * up/down contract (checked against their live API, 2026-09-21), and we don't invent one.
 *
 * Standalone rather than nested inside a suggestion card: markets are interesting on a quiet day
 * too, and burying them behind "did a suggestion fire?" meant they were invisible almost always.
 *
 * Yes/No are links to Kalshi, NOT order buttons, and are labelled so that's obvious before the
 * tap. Placing a real order needs the user's own KYC'd, funded Kalshi account authenticated with
 * their own API credentials — so an in-app amount field and a Yes button would be theatre unless
 * there's an actual partner arrangement with Kalshi behind it. The odds are Kalshi's own live
 * pricing, never a Loofta view.
 */
export function PredictionMarketsCard({ markets }: { markets: Array<KalshiMarket & { symbol: string }> }) {
  if (markets.length === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div className="ns-serif" style={{ fontSize: 22 }}>Markets on your companies</div>
        <div style={{ fontSize: 12, color: "var(--ink3)" }}>Live odds from Kalshi</div>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "0 0 14px", maxWidth: 640 }}>
        Real money is behind these odds — they're what other people are betting, not our forecast. Tap a side to open it on Kalshi, where the trading actually happens.
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {markets.map(m => {
          const yes = Math.round((m.yesPrice ?? 0.5) * 100);
          const no = 100 - yes;
          const closes = m.closeTime ? new Date(m.closeTime) : null;
          return (
            <div key={`${m.symbol}-${m.ticker}`} className="ns-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <img src={fav(tickerDomain(m.symbol))} alt="" style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)" }}>
                  {m.symbol.replace(/x$/, "")}
                </span>
                {closes && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink3)" }}>
                    closes {closes.toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{m.title}</div>

              {/* Horizontal yes/no split — the shape of the crowd's view at a glance, which a bare
                  "38%" doesn't give you. */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                  <span className="ns-up" style={{ fontWeight: 600 }}>Yes {yes}%</span>
                  <span className="ns-down" style={{ fontWeight: 600 }}>No {no}%</span>
                </div>
                <div style={{ display: "flex", height: 7, borderRadius: 999, overflow: "hidden", background: "var(--line)" }}>
                  <div style={{ width: `${yes}%`, background: "var(--up)" }} />
                  <div style={{ width: `${no}%`, background: "var(--down)", opacity: 0.55 }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "9px 0",
                    borderRadius: 9999,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "var(--up)",
                    border: "1px solid color-mix(in oklch, var(--up) 45%, transparent)",
                    background: "color-mix(in oklch, var(--up) 10%, transparent)",
                  }}
                >
                  Yes · {yes}¢
                </a>
                <a
                  href={m.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "9px 0",
                    borderRadius: 9999,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: "var(--down)",
                    border: "1px solid color-mix(in oklch, var(--down) 45%, transparent)",
                    background: "color-mix(in oklch, var(--down) 10%, transparent)",
                  }}
                >
                  No · {no}¢
                </a>
              </div>

              <div style={{ fontSize: 11, color: "var(--ink3)", textAlign: "center" }}>Opens on Kalshi to place a bet</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
