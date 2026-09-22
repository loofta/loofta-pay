"use client";

import { useState } from "react";
import { type NestSuggestion } from "@/services/api/nest";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";

/**
 * "Suggest, don't auto-trade" (2026-09-21 pivot — see nest-suggestions.service.ts): either a real
 * price move on a held symbol (shown with the news behind it) or a position that has grown or
 * shrunk well away from its intended share of the nest. Nothing here executes on its own — the
 * confirm button is the only path that ever moves money.
 *
 * Every label says plainly whether this is a BUY or a SELL, in dollars, including on the button.
 * The first cut said "Trim back to target · $3.62" under a heading of "drifted off target" and a
 * real user's reaction was, verbatim, "what should we do buy or sell" — the product's own jargon
 * had made the one thing that matters unreadable. Nothing here should need decoding.
 *
 * Deliberately shows NO prediction markets. They were attached here first and it read as a
 * non-sequitur: "trim Meta, it's 3.5x oversized" sitting above four bets on Meta's 2026 ad
 * impressions answers a question nobody asked. Rebalancing is mechanical; no market informs it.
 * Markets live in PredictionMarketsCard, on their own terms.
 */
export function SuggestionCard({
  suggestion,
  name,
  onAccept,
  onDismiss,
}: {
  suggestion: NestSuggestion;
  name?: string;
  onAccept: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const up = suggestion.movePct >= 0;
  // A drift suggestion carries no meaningful price move — labelling it "MOVED +0.5%" makes it
  // look like news when it explicitly isn't. Anything under the detector's own bar is drift.
  const isNewsMove = Math.abs(suggestion.movePct) >= 0.03;
  const isSell = suggestion.action === "trim";
  const label = name ?? suggestion.symbol.replace(/x$/, "");
  const amount = `$${Math.abs(suggestion.deltaUsd).toFixed(2)}`;

  const act = async (which: "accept" | "dismiss") => {
    setBusy(which);
    try {
      await (which === "accept" ? onAccept(suggestion.id) : onDismiss(suggestion.id));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 12, display: "flex", gap: 14, alignItems: "flex-start" }}>
      <img src={fav(tickerDomain(suggestion.symbol))} alt="" style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)" }}>
          {isNewsMove ? (
            <>
              {label} moved <span className={up ? "ns-up" : "ns-down"}>{up ? "+" : ""}{(suggestion.movePct * 100).toFixed(1)}%</span>
            </>
          ) : isSell ? (
            <>{label} · bigger slice than planned</>
          ) : (
            <>{label} · smaller slice than planned</>
          )}
        </div>

        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 3 }}>
          <span className={isSell ? "ns-down" : "ns-up"}>{isSell ? "Sell" : "Buy"} {amount}</span>
          <span style={{ color: "var(--ink3)", fontWeight: 400 }}> of {label}</span>
        </div>

        <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "7px 0 0", lineHeight: 1.5 }}>{suggestion.reason}</p>

        {!isNewsMove && (
          <p style={{ fontSize: 12.5, color: "var(--ink3)", margin: "6px 0 0", lineHeight: 1.5 }}>
            Your nest holds every pick at about the same size. {isSell
              ? `Selling ${amount} of ${label} puts it back in line and spreads that money across your other picks, so one winner doesn't quietly become most of your nest.`
              : `Buying ${amount} more of ${label} brings it back up to the same size as everything else.`}
          </p>
        )}

        {suggestion.sourceLinks.length > 0 && (
          <p style={{ margin: "6px 0 0" }}>
            <a href={suggestion.sourceLinks[0]} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "var(--accent)" }}>
              See the post →
            </a>
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button
            className="ns-btn"
            disabled={busy !== null}
            onClick={() => act("accept")}
            style={{ padding: "9px 18px", fontSize: 14, opacity: busy === "accept" ? 0.6 : 1 }}
          >
            {busy === "accept" ? "Working…" : `${isSell ? "Sell" : "Buy"} ${amount}`}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => act("dismiss")}
            style={{ background: "none", border: "1px solid var(--line)", borderRadius: 9999, padding: "9px 16px", fontSize: 14, color: "var(--ink3)", cursor: busy ? "default" : "pointer" }}
          >
            {busy === "dismiss" ? "…" : "Not now"}
          </button>
        </div>
      </div>
    </div>
  );
}
