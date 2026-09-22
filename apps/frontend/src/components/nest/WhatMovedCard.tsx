"use client";

import type { NestHoldingView, NestLedgerEvent, NestTradeView } from "@/services/api/nest";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";
import { humanizeReason } from "@/components/nest/nestCopy";

const MIN_MOVE_PCT = 0.05; // below this, nothing "moved" — say so rather than showing +0.0%

/**
 * One story card a day: the position that moved most, what the engine did about it (always
 * rebalancing back to target weight, never a reaction to buzz), and the Elfa-surfaced post as
 * context for the move. Deliberately no buy/sell button and no "top movers" list (a ranked list
 * would nudge herding; a signal that doesn't drive trades shouldn't drive attention either).
 * When nothing has moved (markets closed, or quotes not live) it shows the latest engine action
 * instead of a meaningless "+0.0%".
 */
export function WhatMovedCard({
  holdings,
  ledger,
  history,
  totalValueUsd,
  quotesLive,
}: {
  holdings: NestHoldingView[];
  ledger: NestLedgerEvent[];
  history: NestTradeView[];
  totalValueUsd: number;
  quotesLive: boolean;
}) {
  const priced = holdings.filter(h => h.symbol !== "USD" && h.currentPrice !== null && (h.valueUsd ?? 0) > 0 && h.pnlPct !== null);
  const mover = priced.length > 0 ? priced.reduce((best, h) => (Math.abs(h.pnlPct ?? 0) > Math.abs(best.pnlPct ?? 0) ? h : best), priced[0]) : null;
  const pct = mover ? (mover.pnlPct ?? 0) * 100 : 0;
  const hasMove = quotesLive && mover !== null && Math.abs(pct) >= MIN_MOVE_PCT;
  const latestTrade = history[0] ?? null;

  if (!hasMove && !latestTrade) return null;

  const symbol = hasMove ? mover!.symbol : latestTrade!.symbol;
  const name = hasMove ? mover!.name : holdings.find(h => h.symbol === symbol)?.name ?? symbol;
  const trade = history.find(t => t.symbol === symbol) ?? null;
  const post = ledger.find(e => e.symbol === symbol)?.post ?? null;
  const weight = totalValueUsd > 0 ? ((holdings.find(h => h.symbol === symbol)?.valueUsd ?? 0) / totalValueUsd) * 100 : 0;
  const up = hasMove ? pct >= 0 : trade?.side === "buy";

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18, display: "flex", gap: 14, alignItems: "flex-start" }}>
      <img src={fav(tickerDomain(symbol))} alt="" style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)" }}>
          {hasMove ? "What moved" : quotesLive ? "Latest engine action" : "Markets closed · latest engine action"}
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
          {hasMove ? (
            <>
              Your {name} egg {up ? "grew" : "shrank"}{" "}
              <span className={up ? "ns-up" : "ns-down"}>{up ? "+" : ""}{pct.toFixed(1)}%</span>
            </>
          ) : (
            <>
              Engine {trade?.side === "buy" ? "added" : "trimmed"} {name}
            </>
          )}
          {weight > 0 && <span style={{ color: "var(--ink3)", fontWeight: 400 }}> · {weight.toFixed(1)}% of your nest</span>}
        </div>
        {trade ? (
          <p style={{ fontSize: 13.5, color: "var(--ink2)", margin: "6px 0 0", lineHeight: 1.5 }}>
            {humanizeReason(trade.reason, trade.side, trade.usdValue)} · {new Date(trade.createdAt).toLocaleDateString()}
            {post && (
              <>
                {" · "}
                <a href={post.link} target="_blank" rel="noreferrer">the X post behind it →</a>
              </>
            )}
          </p>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--ink3)", margin: "6px 0 0" }}>No engine action on this one yet — it's moving on price alone.</p>
        )}
        {!quotesLive && (
          <p style={{ fontSize: 12, color: "var(--ink3)", margin: "6px 0 0" }}>Live quotes resume when the market opens — values shown are as of the last close.</p>
        )}
      </div>
    </div>
  );
}
