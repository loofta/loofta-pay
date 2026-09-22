"use client";

import { useEffect, useState } from "react";
import { getKalshiMarkets, type NestSuggestion, type KalshiMarket } from "@/services/api/nest";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";

/**
 * "Suggest, don't auto-trade" (2026-09-21 pivot — see nest-suggestions.service.ts): a real, large
 * price move on a held symbol surfaces one of these, with the actual news behind it. Nothing here
 * executes on its own — Accept is the only path that ever moves money, and Dismiss just clears it.
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
  const [kalshi, setKalshi] = useState<KalshiMarket[]>([]);
  const up = suggestion.movePct >= 0;
  const actionLabel = suggestion.action === "trim" ? "Trim back to target" : "Buy the dip back to target";
  const amount = `$${Math.abs(suggestion.deltaUsd).toFixed(2)}`;

  useEffect(() => {
    getKalshiMarkets(suggestion.symbol).then(setKalshi);
  }, [suggestion.symbol]);

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
          {suggestion.symbol} moved <span className={up ? "ns-up" : "ns-down"}>{up ? "+" : ""}{(suggestion.movePct * 100).toFixed(1)}%</span>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
          {actionLabel} <span style={{ color: "var(--ink3)", fontWeight: 400 }}>· {amount}</span>
        </div>
        <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "6px 0 0", lineHeight: 1.5 }}>{suggestion.reason}</p>
        {suggestion.sourceLinks.length > 0 && (
          <p style={{ margin: "4px 0 0" }}>
            <a href={suggestion.sourceLinks[0]} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "var(--accent)" }}>
              See the post →
            </a>
          </p>
        )}
        {kalshi.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)" }}>Real markets on this</div>
            {kalshi.map(m => (
              <a
                key={m.ticker}
                href={m.url}
                target="_blank"
                rel="noreferrer"
                style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, color: "var(--ink2)", border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}
              >
                <span>{m.title}</span>
                {m.yesPrice !== null && <span style={{ flexShrink: 0, color: "var(--ink3)" }}>Yes {Math.round(m.yesPrice * 100)}%</span>}
              </a>
            ))}
          </div>
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
