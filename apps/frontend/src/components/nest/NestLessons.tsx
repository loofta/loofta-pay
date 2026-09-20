"use client";

import { useEffect, useMemo, useState } from "react";
import { TAG_LABELS } from "@/components/nest/OnboardingFlow";

const STORAGE_KEY = "nest_lessons_learned";

// Two or three plain sentences per category — what it is, why it moves, what to expect. This is
// the "learn-to-hatch" mechanic: understanding what's in your nest, not a trading tutorial.
const LESSONS: Record<string, { what: string; moves: string; expect: string }> = {
  "big-tech": {
    what: "The handful of giant platforms — Apple, Microsoft, Alphabet, Amazon, Meta — that most of the digital economy runs through.",
    moves: "Quarterly earnings, regulation, and whatever the market decides AI is worth this month.",
    expect: "Steadier than most single stocks because they're so big, but they still swing hard on earnings days.",
  },
  ai: {
    what: "Companies whose growth is tied to building or running artificial intelligence — chips, cloud capacity, models, and the tools on top.",
    moves: "Capital-spending announcements, benchmark releases, and hype cycles in both directions.",
    expect: "High expectations are already in the price — the best news can still disappoint.",
  },
  semis: {
    what: "Semiconductor makers and the equipment that makes them — the physical layer under every computer and phone.",
    moves: "Demand cycles (data centers, phones, cars), export rules, and supply gluts or shortages.",
    expect: "Famously cyclical: booms and busts are the normal pattern, not a sign something broke.",
  },
  consumer: {
    what: "Brands you actually buy from — retail, restaurants, streaming, apparel.",
    moves: "Consumer confidence, inflation, and whether people are spending or saving this quarter.",
    expect: "Usually calmer than tech; sensitive to the economy rather than to technology shifts.",
  },
  "crypto-adjacent": {
    what: "Public companies whose value tracks crypto — exchanges, miners, or firms holding a lot of bitcoin on their balance sheet.",
    moves: "The bitcoin price, mostly. Regulation and ETF flows second.",
    expect: "Among the most volatile stocks anywhere. Small weights for a reason.",
  },
  index: {
    what: "Funds that hold hundreds of companies at once — the S&P 500 or Nasdaq 100 in a single position.",
    moves: "The whole market: rates, growth, and broad sentiment rather than any one company.",
    expect: "The boring backbone. Lower highs, higher lows, and it rarely makes the news.",
  },
  finance: {
    what: "Banks, payment networks, asset managers, and insurers — the plumbing money flows through.",
    moves: "Interest rates above all, then credit conditions and trading volumes.",
    expect: "Rate hikes and cuts move this group as a bloc; company news matters less than the Fed.",
  },
  defensive: {
    what: "Businesses people pay for in any economy — staples, utilities, household names with steady demand.",
    moves: "Slowly. They tend to hold up when growth stocks sell off.",
    expect: "Lower growth, lower drama. Their job in a nest is ballast, not lift.",
  },
  healthcare: {
    what: "Pharma, biotech, insurers, and device makers.",
    moves: "Trial results, drug approvals, and policy on pricing and reimbursement.",
    expect: "Individual names can jump or crater overnight on a single trial readout; as a group it's steadier.",
  },
  industrial: {
    what: "Makers of engines, machinery, aircraft, and infrastructure — the physical economy.",
    moves: "Order backlogs, manufacturing activity, and big government or airline contracts.",
    expect: "Tracks the economic cycle with a lag; long-lived contracts smooth the ride.",
  },
  energy: {
    what: "Oil, gas, and the companies that find, refine, and move them.",
    moves: "Commodity prices and geopolitics far more than anything the companies do themselves.",
    expect: "Can rally when everything else falls, which is exactly why it's useful in a mix.",
  },
  ev: {
    what: "Electric-vehicle makers and the battery and charging supply chain.",
    moves: "Delivery numbers, subsidies, and one very active CEO's posts.",
    expect: "Growth-stock volatility with a manufacturing business underneath — expect big swings.",
  },
  "creator-economy": {
    what: "Platforms where creators earn — streaming, social, and the payment rails behind them.",
    moves: "User growth, ad markets, and shifts in where attention goes.",
    expect: "Attention is fickle; these move on trends more than on fundamentals.",
  },
  gaming: {
    what: "Game publishers and the hardware they run on.",
    moves: "Release calendars, console cycles, and hit-or-miss launches.",
    expect: "Lumpy: a great launch year and a quiet one can look like two different companies.",
  },
  telecom: {
    what: "Carriers and network operators — the subscription businesses behind connectivity.",
    moves: "Subscriber churn, spectrum costs, and dividends.",
    expect: "Slow and income-oriented; rarely the exciting egg, often the reliable one.",
  },
  "real-estate": {
    what: "Property owners and developers, usually structured to pass rent through to shareholders.",
    moves: "Interest rates and occupancy — office, housing, and data-center demand.",
    expect: "Rate-sensitive like finance, with income that tends to be steadier than the share price.",
  },
};

function readLearned(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * "Learn to hatch": a two-minute read per category in your nest, ticked off as learned.
 * Progress is per-viewer (localStorage) — nothing is gated behind it, nothing is rewarded with
 * money; it exists so the ring and the trades mean something rather than being tickers.
 */
export function NestLessons({ categories }: { categories: string[] }) {
  const [learned, setLearned] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setLearned(readLearned()), []);

  const ordered = useMemo(() => {
    const inNest = categories.filter(c => LESSONS[c]);
    const rest = Object.keys(LESSONS).filter(c => !inNest.includes(c));
    return [...inNest, ...rest];
  }, [categories]);
  const inNestCount = categories.filter(c => LESSONS[c]).length;
  const learnedInNest = categories.filter(c => learned.has(c)).length;

  const markLearned = (key: string) => {
    const next = new Set(learned);
    next.add(key);
    setLearned(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* private mode */
    }
    setOpen(null);
  };

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div className="ns-serif" style={{ fontSize: 22 }}>Know your nest</div>
        <div style={{ fontSize: 13, color: "var(--ink3)" }}>
          {inNestCount > 0 ? `${learnedInNest} of ${inNestCount} categories in your nest learned` : `${learned.size} of ${ordered.length} learned`}
        </div>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "4px 0 12px" }}>Two minutes per category — what it is, what moves it, what to expect.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {ordered.map(key => {
          const done = learned.has(key);
          const inNest = categories.includes(key);
          return (
            <button
              key={key}
              onClick={() => setOpen(open === key ? null : key)}
              style={{
                borderRadius: 9999,
                padding: "8px 14px",
                fontSize: 13,
                cursor: "pointer",
                border: `1px solid ${done ? "var(--accent)" : "var(--line)"}`,
                background: done ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent",
                color: done ? "var(--accent)" : inNest ? "var(--ink)" : "var(--ink3)",
                fontWeight: inNest ? 600 : 500,
              }}
            >
              {done ? "✓ " : ""}
              {TAG_LABELS[key] ?? key}
            </button>
          );
        })}
      </div>
      {open && LESSONS[open] && (
        <div style={{ marginTop: 14, padding: "14px 16px", borderRadius: 12, background: "var(--paper2)" }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{TAG_LABELS[open] ?? open}</div>
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: "0 0 6px" }}><span style={{ color: "var(--ink3)" }}>What it is · </span>{LESSONS[open].what}</p>
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: "0 0 6px" }}><span style={{ color: "var(--ink3)" }}>What moves it · </span>{LESSONS[open].moves}</p>
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: "0 0 12px" }}><span style={{ color: "var(--ink3)" }}>What to expect · </span>{LESSONS[open].expect}</p>
          {!learned.has(open) ? (
            <button className="ns-btn" style={{ padding: "9px 18px", fontSize: 13 }} onClick={() => markLearned(open)}>
              Got it
            </button>
          ) : (
            <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>Learned</span>
          )}
        </div>
      )}
    </div>
  );
}
