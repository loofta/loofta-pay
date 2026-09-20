"use client";

import type { NestDepositView, NestTradeView, NestStreak } from "@/services/api/nest";

export interface NestLevel {
  name: string;
  next: string | null;
  hint: string;
}

/**
 * Levels are earned by tenure and funding — things the user controls — never by returns.
 * Egg → Hatchling → Fledgling → Flyer.
 */
export function nestLevel(deposits: NestDepositView[], positions: number): NestLevel {
  const funded = deposits.reduce((s, d) => s + d.amountUsdc, 0);
  const first = deposits.length > 0 ? Math.min(...deposits.map(d => new Date(d.createdAt).getTime())) : null;
  const weeks = first ? Math.floor((Date.now() - first) / (7 * 24 * 60 * 60_000)) : 0;
  if (deposits.length === 0) return { name: "Egg", next: "Hatchling", hint: "Make your first deposit to hatch." };
  if (funded < 200 || weeks < 2) return { name: "Hatchling", next: "Fledgling", hint: "Reach $200 funded and 2 weeks in the nest." };
  if (funded < 1000 || weeks < 8 || positions < 10) return { name: "Fledgling", next: "Flyer", hint: "Reach $1,000 funded, 8 weeks, and 10 positions." };
  return { name: "Flyer", next: null, hint: "Fully fledged. Keep feeding the nest." };
}

interface Milestone {
  date: string;
  title: string;
  detail?: string;
}

/**
 * The nest's own timeline, derived from what actually happened — first deposit, first
 * rebalance, position-count milestones, streak — so progress is visible without a leaderboard
 * or anyone else's numbers.
 */
export function NestJournal({ deposits, history, streak }: { deposits: NestDepositView[]; history: NestTradeView[]; streak: NestStreak | null }) {
  const events: Milestone[] = [];
  const byTime = (a: { createdAt: string }, b: { createdAt: string }) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  const deps = [...deposits].sort(byTime);
  const trades = [...history].sort(byTime);

  if (deps[0]) events.push({ date: deps[0].createdAt, title: "Nest founded", detail: `First deposit: $${deps[0].amountUsdc.toFixed(2)}` });
  if (trades[0]) events.push({ date: trades[0].createdAt, title: "First rebalance", detail: `Engine's first pick: ${trades[0].symbol}` });

  // Position-count milestones: count distinct symbols ever bought, in order of first purchase.
  const seen = new Set<string>();
  for (const t of trades) {
    if (t.side !== "buy" || seen.has(t.symbol)) continue;
    seen.add(t.symbol);
    if (seen.size === 5 || seen.size === 10 || seen.size === 15 || seen.size === 25) {
      events.push({ date: t.createdAt, title: `${seen.size} eggs in the nest`, detail: `${t.symbol} made it ${seen.size}` });
    }
  }

  const funded = deps.reduce<{ total: number; hit: Set<number> }>(
    (acc, d) => {
      acc.total += d.amountUsdc;
      for (const m of [100, 250, 500, 1000, 5000]) {
        if (acc.total >= m && !acc.hit.has(m)) {
          acc.hit.add(m);
          events.push({ date: d.createdAt, title: `$${m.toLocaleString()} funded`, detail: "Counting deposits only — never market moves" });
        }
      }
      return acc;
    },
    { total: 0, hit: new Set() },
  );
  void funded;

  if (streak && streak.weeks >= 2) {
    events.push({ date: new Date().toISOString(), title: `${streak.weeks}-week deposit streak`, detail: streak.freezeUsed ? "One skipped week forgiven" : "Every week, fed" });
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (events.length === 0) return null;

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
      <div className="ns-serif" style={{ fontSize: 22, marginBottom: 12 }}>Nest journal</div>
      <div style={{ position: "relative", paddingLeft: 18 }}>
        <div style={{ position: "absolute", left: 5, top: 6, bottom: 6, width: 1, background: "var(--line)" }} />
        {events.slice(0, 8).map((e, i) => (
          <div key={`${e.title}-${i}`} style={{ position: "relative", paddingBottom: i === Math.min(events.length, 8) - 1 ? 0 : 14 }}>
            <span style={{ position: "absolute", left: -18, top: 5, width: 11, height: 11, borderRadius: "50%", background: i === 0 ? "var(--accent)" : "var(--paper2)", border: "1px solid var(--line)" }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>{e.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)" }}>
              {new Date(e.date).toLocaleDateString()}
              {e.detail ? ` · ${e.detail}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
