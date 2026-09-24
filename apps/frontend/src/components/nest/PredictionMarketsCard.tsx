"use client";

import { useState } from "react";
import type { PredictionMarket, NestPredictionBet } from "@/services/api/nest";
import { fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";

const STAKE_STEPS = [1, 2, 5, 10, 25];
const DEFAULT_STAKE = 1;

const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const closesLabel = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};

/**
 * Venue questions are written for traders, not people: "Will Meta Platforms Inc. report Above 14%
 * worldwide ad impressions growth in fiscal 2026?" Trims the corporate scaffolding so the actual
 * question survives at a glance.
 *
 * Only ever removes wording — never rewrites a number, threshold or date. Someone is taking a
 * position on this, so a "clearer" question that quietly means something else would be far worse
 * than a clunky one.
 */
function humanizeQuestion(q: string): string {
  return q
    .replace(/\s*\([^)]*\)\s*/g, " ") // "(full-time & part-time, excl. contractors/temps)"
    .replace(/\b(Inc|Corporation|Corp|Ltd|Platforms|Global|Holdings|Company)\b\.?/g, "")
    .replace(/\breport (?:Above|above)\b/g, "top")
    .replace(/\bwill\b/i, "Will")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\?/, "?")
    .trim();
}

/** The odds in words. A percentage is a number to decode; "most people say no" is a read someone
 *  can act on. The exact figure stays available underneath for anyone who wants it. */
function crowdRead(yesPct: number): string {
  if (yesPct >= 80) return "Almost everyone says yes";
  if (yesPct >= 62) return "Most people say yes";
  if (yesPct > 38) return "People are split on this";
  if (yesPct > 20) return "Most people say no";
  return "Almost everyone says no";
}

/**
 * Real prediction markets on the companies someone holds, as a swipeable row of cards.
 *
 * The questions, odds and close dates are live and real (Kalshi today, via the venue-agnostic
 * provider layer). The bet is a practice bet: no money moves, nothing is placed on any exchange,
 * and it's recorded only in our own table — which is why every surface here says "practice" and
 * the payout is labelled as what it *would* return. Nobody should be able to mistake this for a
 * funded position.
 *
 * Taking a side flips the card to the position: stake, the odds taken, and what it returns if
 * that side wins. The stake defaults to $1 so the first tap is a single decision, and can be
 * raised from the flipped side afterwards rather than forcing a size choice up front.
 *
 * Horizontal scroll rather than a grid: these are browsable, not a checklist, and a row that runs
 * off the edge invites a swipe where a wall of cards competes with the actual portfolio below it.
 */
export function PredictionMarketsCard({
  markets,
  bets,
  onPlace,
  onCancel,
}: {
  markets: PredictionMarket[];
  bets: NestPredictionBet[];
  onPlace: (market: PredictionMarket, side: "yes" | "no", stakeUsd: number) => Promise<void>;
  onCancel: (betId: string) => Promise<void>;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const betByMarket = new Map(bets.filter(b => b.status === "active").map(b => [b.marketId, b]));
  // A market you already have a position on stays, even if dismissed earlier — the position is
  // the point. Everything else honours the dismiss.
  const visible = markets.filter(m => betByMarket.has(m.id) || !dismissed.has(m.id));
  if (visible.length === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="ns-serif" style={{ fontSize: 32, marginBottom: 4 }}>Call it</div>
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "0 0 12px", maxWidth: 640 }}>
        Real questions and live odds from prediction markets, on companies you hold. Playing for practice — no real money is staked and nothing is placed on an exchange.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: 6,
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {visible.map(m => (
          <MarketCard
            key={m.id}
            market={m}
            bet={betByMarket.get(m.id) ?? null}
            onDismiss={() => setDismissed(prev => new Set(prev).add(m.id))}
            onPlace={onPlace}
            onCancel={onCancel}
          />
        ))}
      </div>
    </div>
  );
}

function MarketCard({
  market,
  bet,
  onDismiss,
  onPlace,
  onCancel,
}: {
  market: PredictionMarket;
  bet: NestPredictionBet | null;
  onDismiss: () => void;
  onPlace: (market: PredictionMarket, side: "yes" | "no", stakeUsd: number) => Promise<void>;
  onCancel: (betId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const yes = Math.round((market.yesPrice ?? 0.5) * 100);
  const no = 100 - yes;
  const closes = closesLabel(market.closeTime);
  const flipped = bet !== null;

  const place = async (side: "yes" | "no", stake: number) => {
    setBusy(true);
    try {
      await onPlace(market, side, stake);
    } finally {
      setBusy(false);
    }
  };

  const shell: React.CSSProperties = {
    flex: "0 0 300px",
    scrollSnapAlign: "start",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    // The flip is a colour/content change rather than a 3D rotation: a rotateY card has to
    // duplicate its content into two absolutely-positioned faces to avoid mirrored text, and
    // that's a lot of machinery for a transition nobody asked to watch twice.
    transition: "border-color .18s ease, background .18s ease",
    ...(flipped
      ? {
          borderColor: `color-mix(in oklch, var(--${bet!.side === "yes" ? "up" : "down"}) 45%, var(--line))`,
          background: `color-mix(in oklch, var(--${bet!.side === "yes" ? "up" : "down"}) 7%, var(--paper2))`,
        }
      : {}),
  };

  return (
    <div className="ns-card" style={shell}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <img src={fav(tickerDomain(market.symbol ?? ""))} alt="" style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)" }}>
          {(market.symbol ?? "").replace(/x$/, "")}
        </span>
        {closes && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink3)" }}>by {closes}</span>}
        {!flipped && (
          <button
            onClick={onDismiss}
            aria-label="Hide this market"
            style={{ marginLeft: closes ? 6 : "auto", background: "none", border: "none", color: "var(--ink3)", fontSize: 15, lineHeight: 1, cursor: "pointer", padding: "0 2px" }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, minHeight: 60 }}>{humanizeQuestion(market.question)}</div>

      {flipped ? <BetFace bet={bet!} busy={busy} setBusy={setBusy} onPlace={place} onCancel={onCancel} /> : (
        <>
          <div>
            <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 6 }}>{crowdRead(yes)}</div>
            <div style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: "var(--line)" }}>
              <div style={{ width: `${yes}%`, background: "var(--up)" }} />
              <div style={{ width: `${no}%`, background: "var(--down)", opacity: 0.5 }} />
            </div>
          </div>

          {/* Each side leads with what it pays, not what a contract costs. "Win $2.00" is the
              thing someone is actually deciding about; "50¢" is the price of a share of a binary
              contract, which is a concept nobody should have to learn to tap a button. */}
          <div style={{ display: "flex", gap: 8 }}>
            <SideButton side="yes" payout={DEFAULT_STAKE / (market.yesPrice ?? 0.5)} busy={busy} onClick={() => place("yes", DEFAULT_STAKE)} />
            <SideButton side="no" payout={DEFAULT_STAKE / (1 - (market.yesPrice ?? 0.5))} busy={busy} onClick={() => place("no", DEFAULT_STAKE)} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", textAlign: "center" }}>
            {money(DEFAULT_STAKE)} to play · raise it after
          </div>
        </>
      )}
    </div>
  );
}

function SideButton({ side, payout, busy, onClick }: { side: "yes" | "no"; payout: number; busy: boolean; onClick: () => void }) {
  const tone = side === "yes" ? "up" : "down";
  return (
    <button
      disabled={busy}
      onClick={onClick}
      style={{
        flex: 1,
        padding: "10px 0 9px",
        borderRadius: 14,
        lineHeight: 1.25,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.5 : 1,
        color: `var(--${tone})`,
        border: `1px solid color-mix(in oklch, var(--${tone}) 45%, transparent)`,
        background: `color-mix(in oklch, var(--${tone}) 10%, transparent)`,
      }}
    >
      <span style={{ display: "block", fontSize: 15, fontWeight: 700 }}>{side === "yes" ? "Yes" : "No"}</span>
      <span style={{ display: "block", fontSize: 11.5, opacity: 0.85 }}>win {money(payout)}</span>
    </button>
  );
}

/** The flipped side: what you took, and what it pays if you're right. */
function BetFace({
  bet,
  busy,
  setBusy,
  onPlace,
  onCancel,
}: {
  bet: NestPredictionBet;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onPlace: (side: "yes" | "no", stake: number) => Promise<void>;
  onCancel: (betId: string) => Promise<void>;
}) {
  const tone = bet.side === "yes" ? "up" : "down";
  const profit = bet.payoutUsd - bet.stakeUsd;

  return (
    <>
      <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>
        You said <span className={`ns-${tone}`} style={{ fontWeight: 700 }}>{bet.side === "yes" ? "Yes" : "No"}</span>
      </div>

      {/* The payout leads, because it's what the choice was about. The stake is context, and the
          price they took is deliberately absent — it's the mechanism, not the outcome. */}
      <div>
        <div className={`ns-${tone}`} style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>{money(bet.payoutUsd)}</div>
        <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>
          back if you're right · {money(bet.stakeUsd)} in, {money(profit)} profit
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {STAKE_STEPS.map(step => (
          <button
            key={step}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onPlace(bet.side, step);
              } finally {
                setBusy(false);
              }
            }}
            style={{
              borderRadius: 9999,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--ink2)",
              fontSize: 12.5,
              padding: "5px 10px",
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            +${step}
          </button>
        ))}
      </div>

      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onCancel(bet.id);
          } finally {
            setBusy(false);
          }
        }}
        style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 12, cursor: busy ? "default" : "pointer", padding: 0, textAlign: "left" }}
      >
        Take it back
      </button>
    </>
  );
}
