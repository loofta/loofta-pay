"use client";

import type { PredictionMarket } from "@/services/api/nest";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";

const VENUE_LABELS: Record<PredictionMarket["venue"], string> = {
  kalshi: "Kalshi",
  dflow: "DFlow",
  polymarket: "Polymarket",
};
const venueLabel = (v: PredictionMarket["venue"]) => VENUE_LABELS[v] ?? v;

/**
 * Live markets on the companies someone actually holds — CEO changes, earnings/KPI targets,
 * product launches. Event-shaped, never a price-direction bet.
 *
 * Venue-agnostic by design: the card renders from PredictionMarket and never knows who's behind
 * it. The user always sees the same Yes/No with the same split bar; the only thing that changes
 * is what a tap does, driven by `tradeable`. Kalshi can only ever hand off (regulated exchange,
 * the order needs the user's own account), while a tokenized venue like DFlow settles to an SPL
 * token in the wallet they already have — so the same card can become a real in-app bet without
 * the UI changing shape. The footer says which it is, before the tap.
 *
 * Standalone rather than nested inside a suggestion card: markets are interesting on a quiet day
 * too, and burying them behind "did a suggestion fire?" meant they were invisible almost always.
 * The odds are the venue's own live pricing, never a Loofta view.
 */
export function PredictionMarketsCard({ markets }: { markets: PredictionMarket[] }) {
  if (markets.length === 0) return null;
  const venues = `Live odds from ${[...new Set(markets.map(m => venueLabel(m.venue)))].join(", ")}`;

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <div className="ns-serif" style={{ fontSize: 22 }}>Markets on your companies</div>
        <div style={{ fontSize: 12, color: "var(--ink3)" }}>{venues}</div>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "0 0 14px", maxWidth: 640 }}>
        Real money is behind these odds — they're what other people are betting, not our forecast.
      </p>

      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {markets.map(m => {
          const yes = Math.round((m.yesPrice ?? 0.5) * 100);
          const no = 100 - yes;
          const closes = m.closeTime ? new Date(m.closeTime) : null;
          return (
            <div key={m.id} className="ns-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 11 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <img src={fav(tickerDomain(m.symbol ?? ""))} alt="" style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)" }}>
                  {(m.symbol ?? "").replace(/x$/, "")}
                </span>
                {closes && (
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink3)" }}>
                    closes {closes.toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                  </span>
                )}
              </div>

              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{m.question}</div>

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

              <div style={{ fontSize: 11, color: "var(--ink3)", textAlign: "center" }}>
                {m.tradeable ? "Place a bet without leaving" : `Opens on ${venueLabel(m.venue)} to place a bet`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
