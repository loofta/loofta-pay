"use client";

import { useState } from "react";
import { type NestSuggestion } from "@/services/api/nest";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";

/**
 * "Suggest, don't auto-trade" (2026-09-21 pivot — see nest-suggestions.service.ts): either a real
 * price move on a held symbol (shown with the news behind it) or a position that has drifted far
 * from its target weight. Nothing here executes on its own — Accept is the only path that ever
 * moves money, and Dismiss just clears it.
 *
 * Deliberately shows NO prediction markets. They were attached here first and it read as a
 * non-sequitur: "trim Meta, it's 3.5x oversized" sitting above four bets on Meta's 2026 ad
 * impressions answers a question nobody asked. Rebalancing is mechanical; no market informs it.
 * Markets live in PredictionMarketsCard, on their own terms.
 */
export function SuggestionCard({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: NestSuggestion;
  onAccept: (id: string) => Promise<void>;
  onDismiss: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"accept" | "dismiss" | null>(null);
  const up = suggestion.movePct >= 0;
  // A drift suggestion carries no meaningful price move — labelling it "MOVED +0.5%" makes it
  // look like news when it explicitly isn't. Anything under the detector's own bar is drift.
  const isNewsMove = Math.abs(suggestion.movePct) >= 0.03;
  const actionLabel = suggestion.action === "trim" ? "Trim back to target" : "Top back up to target";
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
              {suggestion.symbol} moved <span className={up ? "ns-up" : "ns-down"}>{up ? "+" : ""}{(suggestion.movePct * 100).toFixed(1)}%</span>
            </>
          ) : (
            <>{suggestion.symbol} · drifted off target</>
          )}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
          {actionLabel} <span style={{ color: "var(--ink3)", fontWeight: 400 }}>· {amount}</span>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "6px 0 0", lineHeight: 1.5 }}>{suggestion.reason}</p>
        {!isNewsMove && (
          <p style={{ fontSize: 12.5, color: "var(--ink3)", margin: "6px 0 0", lineHeight: 1.5 }}>
            Your nest aims to hold each pick at about the same size. Selling {amount} here spreads it back across the rest, so one winner doesn't quietly become most of your nest.
          </p>
        )}
        {suggestion.sourceLinks.length > 0 && (
          <p style={{ margin: "4px 0 0" }}>
            <a href={suggestion.sourceLinks[0]} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "var(--accent)" }}>
              See the post →
            </a>
          </p>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            className="ns-btn"
            disabled={busy !== null}
            onClick={() => act("accept")}
            style={{ padding: "8px 16px", fontSize: 13.5, opacity: busy === "accept" ? 0.6 : 1 }}
          >
            {busy === "accept" ? "Working…" : "Accept"}
          </button>
          <button
            disabled={busy !== null}
            onClick={() => act("dismiss")}
            style={{ background: "none", border: "1px solid var(--line)", borderRadius: 9999, padding: "8px 14px", fontSize: 13.5, color: "var(--ink3)", cursor: busy ? "default" : "pointer" }}
          >
            {busy === "dismiss" ? "…" : "Dismiss"}
          </button>
        </div>
      </div>
    </div>
  );
}
