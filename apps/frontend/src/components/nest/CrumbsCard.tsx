"use client";

import type { NestRoundups } from "@/services/api/nest";

/**
 * Round-up "crumbs" from payments the user sent through Loofta since they last fed the nest.
 * Nothing moves automatically: the button opens the normal, self-signed deposit flow prefilled
 * with the crumb total. Celebrates deposits, never trades.
 */
export function CrumbsCard({ roundups, onFeed, onEnable }: { roundups: NestRoundups | null; onFeed: (amountUsd: number) => void; onEnable: () => void }) {
  if (!roundups) return null;

  if (!roundups.enabled) {
    return (
      <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Round-ups: crumbs for the nest</div>
          <p style={{ fontSize: 13, color: "var(--ink3)", margin: "4px 0 0" }}>
            Round each payment you send through Loofta up to the next $1 or $5 and keep the change for your nest — send $12.40, and $0.60 becomes crumbs. You feed them in with one tap; nothing moves on its own. Off until you turn it on.
          </p>
        </div>
        <button onClick={onEnable} style={{ border: "1px solid var(--line)", background: "transparent", borderRadius: 9999, padding: "9px 16px", fontSize: 13, color: "var(--ink2)", cursor: "pointer", whiteSpace: "nowrap" }}>
          Turn on round-ups
        </button>
      </div>
    );
  }

  const ready = roundups.pendingUsd >= 1;
  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)" }}>Round-up crumbs</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
          ${roundups.pendingUsd.toFixed(2)}{" "}
          <span style={{ color: "var(--ink3)", fontWeight: 400 }}>
            from {roundups.paymentCount} payment{roundups.paymentCount === 1 ? "" : "s"} · rounding to ${roundups.unit}
          </span>
        </div>
        {!ready && <p style={{ fontSize: 13, color: "var(--ink3)", margin: "4px 0 0" }}>Send a few more payments — crumbs feed the nest once they reach $1.</p>}
      </div>
      {ready && (
        <button className="ns-btn" style={{ padding: "11px 20px", fontSize: 14 }} onClick={() => onFeed(roundups.pendingUsd)}>
          Feed the nest
        </button>
      )}
    </div>
  );
}
