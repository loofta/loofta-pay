"use client";

import { useState } from "react";
import type { NestBacktestSummary } from "@/services/api/nest";

const QUICK = [100, 500, 1000, 5000];

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/**
 * "What would $X have done" — strictly backward-looking replay of the engine's real strategy
 * (equal-weight across your interests), plus a transparent explainer of the attention-tilt
 * approach we tested and rejected. Deliberately never phrased as a forecast.
 */
export function ProjectionCard({ summary }: { summary: NestBacktestSummary | null }) {
  const [amount, setAmount] = useState(1000);
  const [showWhy, setShowWhy] = useState(false);
  if (!summary) return null;

  const live = summary.liveStrategy;
  const rejected = summary.rejectedTilt;
  const liveEnd = amount * (1 + live.netReturn);
  const p = summary.placebo;
  const start = new Date(summary.periodStart).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const end = new Date(summary.periodEnd).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
      <div className="ns-serif" style={{ fontSize: 22, marginBottom: 4 }}>If you'd put in {usd(amount)} on {start}</div>
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "0 0 14px", maxWidth: 620 }}>
        A replay of the live engine over the {summary.weeks} weeks to {end}, on {summary.universeSize} names, after 0.5% round-trip trading costs. This is what happened — not a forecast.
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

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: "var(--ink3)" }}>Your Nest — equal-weighted across your interests</div>
        <div className={`ns-serif ${live.netReturn >= 0 ? "ns-up" : "ns-down"}`} style={{ fontSize: 34 }}>{usd(liveEnd)}</div>
        <div style={{ fontSize: 13, color: "var(--ink3)" }}>{pct(live.netReturn)} · worst dip {pct(live.maxDrawdown)}</div>
      </div>

      <button
        type="button"
        onClick={() => setShowWhy(v => !v)}
        style={{ fontSize: 12.5, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}
      >
        {showWhy ? "Hide" : "Why equal-weight, not attention-picked?"}
      </button>

      {showWhy && (
        <div style={{ borderTop: "1px solid var(--line2)", marginTop: 10, paddingTop: 12, fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.55 }}>
          <p style={{ margin: "0 0 8px" }}>
            We tried sizing positions by how much social attention each stock was getting. Over this same window it returned{" "}
            <strong>{pct(rejected.netReturn)}</strong> (worst dip {pct(rejected.maxDrawdown)}) — worse than equal-weight's {pct(live.netReturn)} — and landed at only the{" "}
            <strong>{Math.round(p.realPercentile * 100)}th percentile</strong> of {p.shuffles} runs where the same signal was randomly shuffled. That's statistically indistinguishable from noise.
          </p>
          <p style={{ margin: 0 }}>
            So we don't use attention data to size trades. It's still shown around your holdings as context — what's being talked about, and why — just not as a reason to buy more.
          </p>
        </div>
      )}

      <p style={{ fontSize: 11.5, color: "var(--ink3)", margin: "10px 0 0" }}>
        Past performance over one {summary.weeks}-week window. Not investment advice, not a prediction. {summary.caveats?.[0] ? summary.caveats[0] : ""}
      </p>
    </div>
  );
}
