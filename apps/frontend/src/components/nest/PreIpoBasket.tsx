"use client";

import { useState } from "react";
import type { NestPredictionBet, PreIpoAsset, PredictionMarket } from "@/services/api/nest";

const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const price = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const valuation = (n: number) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const AMOUNTS = [50, 100, 250, 500];
const PRACTICE_STAKE = 1;

/**
 * A pre-IPO basket built from PreStocks tokens, weighted equally (same rule as the rest of Nest).
 *
 * Read-only on purpose: nothing here buys a token. Each row shows the token's price against
 * PreStocks' own reference price, because that gap is the honest thing to know before buying a
 * private company through a token: a positive gap means you'd pay more than the reference for the
 * same exposure. Buying happens on PreStocks itself.
 *
 * Where Kalshi lists an IPO-timing market for a company it sits on that row, as a practice bet
 * exactly like the "Call it" cards: real question and live odds, simulated position.
 */
export function PreIpoBasket({
  assets,
  bets,
  onPlace,
  onCancel,
}: {
  assets: PreIpoAsset[];
  bets: NestPredictionBet[];
  onPlace: (market: PredictionMarket, side: "yes" | "no", stakeUsd: number) => Promise<void>;
  onCancel: (betId: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(100);
  if (assets.length === 0) return null;

  const betByMarket = new Map(bets.filter(b => b.status === "active").map(b => [b.marketId, b]));
  const each = amount / assets.length;
  // Weighted by the equal split: what the whole basket costs over its reference value.
  const basketPremium = assets.reduce((sum, a) => sum + a.premiumPct, 0) / assets.length;

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="ns-serif" style={{ fontSize: 32, marginBottom: 4 }}>Pre-IPO basket</div>
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "0 0 12px", maxWidth: 640 }}>
        Pre-IPO means the company isn't on the stock market yet, so you normally can't buy it. PreStocks sells tokens that follow the value of these private companies. A token can cost more or less than PreStocks' own estimate of the company, so check the gap first. You buy on PreStocks. Nothing here moves your money.
      </p>

      <div className="ns-card" style={{ padding: "14px 16px", marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: "var(--ink2)" }}>If you put in</span>
          {AMOUNTS.map(a => (
            <button
              key={a}
              onClick={() => setAmount(a)}
              style={{
                borderRadius: 9999,
                border: `1px solid ${a === amount ? "var(--ink2)" : "var(--line)"}`,
                background: a === amount ? "var(--paper2)" : "transparent",
                color: a === amount ? "var(--ink)" : "var(--ink2)",
                fontSize: 13,
                padding: "5px 12px",
                cursor: "pointer",
              }}
            >
              ${a}
            </button>
          ))}
          <span style={{ fontSize: 13, color: "var(--ink2)" }}>
            that is {money(Math.round(each * 100) / 100)} in each of {assets.length}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink3)" }}>
          On average these tokens trade{" "}
          <span style={{ fontWeight: 700, color: basketPremium > 0 ? "var(--down)" : "var(--up)" }}>{signed(basketPremium)}</span>{" "}
          {basketPremium >= 0 ? "above" : "below"} PreStocks' estimated value.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {assets.map(a => (
          <AssetRow key={a.symbol} asset={a} each={each} bet={a.market ? betByMarket.get(a.market.id) ?? null : null} onPlace={onPlace} onCancel={onCancel} />
        ))}
      </div>
    </div>
  );
}

function AssetRow({
  asset,
  each,
  bet,
  onPlace,
  onCancel,
}: {
  asset: PreIpoAsset;
  each: number;
  bet: NestPredictionBet | null;
  onPlace: (market: PredictionMarket, side: "yes" | "no", stakeUsd: number) => Promise<void>;
  onCancel: (betId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // A token trading above its reference price costs more than the exposure is worth, so a
  // positive gap reads as a cost (down colour) and a negative one as a discount (up colour).
  const gapTone = asset.premiumPct > 0 ? "down" : "up";
  const units = each / asset.tokenPriceUsd;
  const market = asset.market;
  const yes = market ? Math.round((market.yesPrice ?? 0.5) * 100) : 0;

  return (
    <div className="ns-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img src={asset.logoUrl} alt="" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, objectFit: "cover" }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{asset.name}</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>Valued around {valuation(asset.valuationUsd)}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{price(asset.tokenPriceUsd)}</div>
          <div className={`ns-${gapTone}`} style={{ fontSize: 12.5, fontWeight: 600 }}>
            {signed(asset.premiumPct)} vs estimate
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 12.5, color: "var(--ink3)" }}>
        <span>Estimated value {price(asset.markPriceUsd)}</span>
        <span>
          In your split: {units.toLocaleString(undefined, { maximumFractionDigits: 3 })} tokens
        </span>
        <a href={asset.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: "auto", color: "var(--ink2)", textDecoration: "underline" }}>
          Buy on PreStocks
        </a>
      </div>

      {market && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}>{market.question}</div>
          {bet ? (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span>
                You said{" "}
                <span className={`ns-${bet.side === "yes" ? "up" : "down"}`} style={{ fontWeight: 700 }}>
                  {bet.side === "yes" ? "Yes" : "No"}
                </span>
                , {money(bet.payoutUsd)} back if you're right
              </span>
              <button
                disabled={busy}
                onClick={() => run(() => onCancel(bet.id))}
                style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 12.5, cursor: busy ? "default" : "pointer", padding: 0 }}
              >
                Take it back
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: "var(--line)" }}>
                  <div style={{ width: `${yes}%`, background: "var(--up)" }} />
                  <div style={{ width: `${100 - yes}%`, background: "var(--down)", opacity: 0.5 }} />
                </div>
                <span style={{ fontSize: 12.5, color: "var(--ink2)", flexShrink: 0 }}>{yes}% say yes</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {(["yes", "no"] as const).map(side => {
                  const tone = side === "yes" ? "up" : "down";
                  const p = side === "yes" ? market.yesPrice ?? 0.5 : 1 - (market.yesPrice ?? 0.5);
                  return (
                    <button
                      key={side}
                      disabled={busy}
                      onClick={() => run(() => onPlace(market, side, PRACTICE_STAKE))}
                      style={{
                        flex: 1,
                        padding: "8px 0 7px",
                        borderRadius: 12,
                        lineHeight: 1.25,
                        cursor: busy ? "default" : "pointer",
                        opacity: busy ? 0.5 : 1,
                        color: `var(--${tone})`,
                        border: `1px solid color-mix(in oklch, var(--${tone}) 45%, transparent)`,
                        background: `color-mix(in oklch, var(--${tone}) 10%, transparent)`,
                      }}
                    >
                      <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{side === "yes" ? "Yes" : "No"}</span>
                      <span style={{ display: "block", fontSize: 12, opacity: 0.85 }}>win {money(Math.round((PRACTICE_STAKE / p) * 100) / 100)}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink3)" }}>Practice only, {money(PRACTICE_STAKE)} to play. Odds are live from Kalshi.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
