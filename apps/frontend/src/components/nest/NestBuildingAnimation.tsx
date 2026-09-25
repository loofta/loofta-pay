"use client";

import { useEffect, useState } from "react";
import { fav } from "@/components/nest/marketEvents";

export interface PreviewTicker {
  symbol: string;
  domain: string;
}

const STAGGER_MS = 160;
const DROP_MS = 700;

/** Plays right after a fresh deposit — a quick "eggs landing in the nest" sequence for each
 *  stock about to go into the basket, so onboarding ends on something that feels alive rather
 *  than dropping straight into an empty dashboard. Purely illustrative (the real basket is only
 *  built by the next rebalance cron), so it never claims these are confirmed holdings. */
export function NestBuildingAnimation({ tickers, explanation, onDone }: { tickers: PreviewTicker[]; explanation?: string | null; onDone: () => void }) {
  const [landed, setLanded] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timers = tickers.map((_, i) =>
      setTimeout(() => setLanded(n => Math.max(n, i + 1)), i * STAGGER_MS + DROP_MS)
    );
    const doneTimer = setTimeout(() => setReady(true), tickers.length * STAGGER_MS + DROP_MS + 300);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(doneTimer);
    };
  }, [tickers]);

  const n = Math.max(tickers.length, 1);
  const spread = Math.min(140, 20 * n);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, padding: "40px var(--page-pad)" }}>
      <style>{`
        @keyframes nestEggDrop {
          0% { transform: translateY(-90px) scale(.4); opacity: 0; }
          65% { transform: translateY(6px) scale(1.06); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>

      <div style={{ position: "relative", width: "min(92vw, 380px)", height: 220 }}>
        <svg width="100%" height="150" viewBox="0 0 220 150" fill="none" style={{ position: "absolute", bottom: 0, left: 0 }}>
          <path d="M10 70 Q10 130 110 130 Q210 130 210 70" stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="6" strokeLinecap="round" strokeDasharray="10 8" />
          <ellipse cx="110" cy="70" rx="100" ry="16" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="4" />
        </svg>
        {tickers.map((t, i) => {
          const frac = n === 1 ? 0.5 : i / (n - 1);
          const x = 50 + (frac - 0.5) * spread;
          const settled = landed > i;
          return (
            <div
              key={t.symbol}
              style={{
                position: "absolute",
                left: `${x}%`,
                bottom: 55 + Math.abs(frac - 0.5) * 20,
                transform: "translateX(-50%)",
                width: 52,
                height: 52,
                borderRadius: "50%",
                background: "var(--paper)",
                border: "2px solid var(--line)",
                boxShadow: "0 8px 20px -8px rgba(0,0,0,.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0,
                animation: `nestEggDrop ${DROP_MS}ms cubic-bezier(.34,1.56,.64,1) forwards`,
                animationDelay: `${i * STAGGER_MS}ms`,
              }}
            >
              <img src={fav(t.domain)} alt={t.symbol} style={{ width: 26, height: 26, borderRadius: 6 }} />
              <span
                style={{
                  position: "absolute",
                  top: -22,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--ink3)",
                  whiteSpace: "nowrap",
                  opacity: settled ? 1 : 0,
                  transition: "opacity .3s",
                }}
              >
                {t.symbol}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ textAlign: "center" }}>
        <div className="ns-serif" style={{ fontSize: 26 }}>
          {ready ? "Your nest is taking shape" : "Adding your picks to the nest…"}
        </div>
        <p style={{ fontSize: 14, color: "var(--ink3)", marginTop: 6, maxWidth: 420 }}>
          {explanation ?? "These are the names your nest will hold. It's built shortly after your deposit lands."}
        </p>
      </div>

      <button
        className="ns-btn"
        style={{ padding: "15px 34px", fontSize: 15, opacity: ready ? 1 : 0, pointerEvents: ready ? "auto" : "none", transition: "opacity .3s" }}
        onClick={onDone}
      >
        Enter your nest →
      </button>
    </div>
  );
}
