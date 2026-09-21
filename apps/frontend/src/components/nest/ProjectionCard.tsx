"use client";

import { useState } from "react";
import type { NestBacktestSummary } from "@/services/api/nest";

const QUICK = [100, 500, 1000, 5000];

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * "What would $X have done" — strictly backward-looking: the committed backtest's real window,
 * shown as a comparison against equal-weight with the worst dip along the way, and an honest
 * read of whether the engine's edge beat a shuffled-signal placebo. Deliberately never phrased
 * as a forecast or a projection of future returns.
 */
export function ProjectionCard({ summary }: { summary: NestBacktestSummary | null }) {
  const [amount, setAmount] = useState(1000);
  if (!summary) return null;

  const strat = summary.strategyHysteresis ?? summary.strategy;
  const eq = summary.equalWeight;
  const stratEnd = amount * (1 + strat.netReturn);
  const eqEnd = amount * (1 + eq.netReturn);
  const diff = stratEnd - eqEnd;
  const p = summary.placebo;
  const beatNoise = p.realPercentile >= 0.95;
  const start = new Date(summary.periodStart).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const end = new Date(summary.periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
      <div className="ns-serif" style={{ fontSize: 22, marginBottom: 4 }}>If you'd put in {usd(amount)} on {start}</div>
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "0 0 14px", maxWidth: 620 }}>
        A replay of the engine over the {summary.weeks} weeks to {end}, on {summary.universeSize} names, after 0.5% round-trip trading costs. This is what happened — not a forecast.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {QUICK.map(q => (
          <button
            key={q}
            onClick={() => setAmount(q)}
            style={{ borderRadius: 9999, padding: "7px 14px", fontSize: 13, cursor: "pointer", border: `1px solid ${amount === q ? "var(--accent)" : "var(--line)"}`, background: amount === q ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent", color: amount === q ? "var(--accent)" : "var(--ink2)" }}
          >
            {usd(q)}
          </button>
        ))}
        <input
          type="number"
          min={1}
          value={amount}
          onChange={e => setAmount(Math.max(1, Number(e.target.value) || 0))}
          style={{ width: 120, fontSize: 14, padding: "7px 12px", borderRadius: 9999, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }}
        />
      </div>

      <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "baseline", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--ink3)" }}>Your Nest (with the attention signal)</div>
          <div className={`ns-serif ${strat.netReturn >= 0 ? "ns-up" : "ns-down"}`} style={{ fontSize: 34 }}>{usd(stratEnd)}</div>
          <div style={{ fontSize: 13, color: "var(--ink3)" }}>{pct(strat.netReturn)} · worst dip {pct(strat.maxDrawdown)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: "var(--ink3)" }}>Same names, plain equal weights</div>
          <div className="ns-serif" style={{ fontSize: 34 }}>{usd(eqEnd)}</div>
          <div style={{ fontSize: 13, color: "var(--ink3)" }}>{pct(eq.netReturn)} · worst dip {pct(eq.maxDrawdown)}</div>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--line2)", paddingTop: 12, fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55 }}>
        {Math.abs(diff) < 1 ? (
          <>Over this window the signal made <strong>no meaningful difference</strong> versus equal weights.</>
        ) : (
          <>
            That's <strong className={diff >= 0 ? "ns-up" : "ns-down"}>{diff >= 0 ? "+" : "−"}{usd(Math.abs(diff))}</strong> {diff >= 0 ? "more" : "less"} than equal weights.{" "}
          </>
        )}{" "}
        {beatNoise ? (
          <>In {p.shuffles} runs with the signal randomly shuffled, the real one landed in the top {Math.round((1 - p.realPercentile) * 100) || 5}% — hard to explain by luck alone.</>
        ) : (
          <>Against {p.shuffles} runs with the signal randomly shuffled, the real one landed at the {Math.round(p.realPercentile * 100)}th percentile — within the range luck alone produces, so treat the difference as noise for now.</>
        )}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--ink3)", margin: "10px 0 0" }}>
        Past performance over one {summary.weeks}-week window. Not investment advice, not a prediction. {summary.caveats?.[0] ? summary.caveats[0] : ""}
      </p>
    </div>
  );
}
