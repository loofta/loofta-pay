"use client";

import { useEffect, useMemo, useState } from "react";
import { TAG_LABELS } from "@/components/nest/OnboardingFlow";

const STORAGE_KEY = "nest_lessons_learned";

// Two or three plain sentences per category — what it is, why it moves, what to expect — plus a
// one-question recall check. This is the "learn-to-hatch" mechanic: understanding what's in your
// nest, not a trading tutorial. The quiz turns "I read it" into "I can recall it" without gating
// anything real behind it. Every option is a real, true fact about *some* category — the wrong
// answers are true statements about adjacent, easily-confused categories, not throwaway jokes —
// so picking correctly requires having actually read this one, not just spotting the silly option.
const LESSONS: Record<string, { what: string; moves: string; expect: string; quiz: { q: string; options: string[]; correct: number } }> = {
  "big-tech": {
    what: "The handful of giant platforms — Apple, Microsoft, Alphabet, Amazon, Meta — that most of the digital economy runs through.",
    moves: "Quarterly earnings, regulation, and whatever the market decides AI is worth this month.",
    expect: "Steadier than most single stocks because they're so big, but they still swing hard on earnings days.",
    quiz: {
      q: "Which of these is actually true about big tech?",
      options: [
        "It's steadier than most single stocks because of its size, but still swings hard around earnings",
        "Expectations are already priced in, so even strong results can send the stock down",
        "Boom-and-bust demand cycles are the normal pattern here, not a sign something broke",
        "It tracks consumer confidence and economic spending more than any single company's news",
      ],
      correct: 0,
    },
  },
  ai: {
    what: "Companies whose growth is tied to building or running artificial intelligence — chips, cloud capacity, models, and the tools on top.",
    moves: "Capital-spending announcements, benchmark releases, and hype cycles in both directions.",
    expect: "High expectations are already in the price — the best news can still disappoint.",
    quiz: {
      q: "Which of these is actually true about AI stocks?",
      options: [
        "It's steadier than most single stocks because of its size, but still swings hard around earnings",
        "Expectations are already priced in, so even strong results can send the stock down",
        "Boom-and-bust demand cycles are the normal pattern here, not a sign something broke",
        "Its share price tracks the price of bitcoin more than its own day-to-day operations",
      ],
      correct: 1,
    },
  },
  semis: {
    what: "Semiconductor makers and the equipment that makes them — the physical layer under every computer and phone.",
    moves: "Demand cycles (data centers, phones, cars), export rules, and supply gluts or shortages.",
    expect: "Famously cyclical: booms and busts are the normal pattern, not a sign something broke.",
    quiz: {
      q: "Which of these is actually true about semiconductor stocks?",
      options: [
        "Expectations are already priced in, so even strong results can send the stock down",
        "It carries growth-stock volatility stacked on top of an actual manufacturing business",
        "Boom-and-bust demand cycles are the normal pattern here, not a sign something broke",
        "Long order backlogs and long-lived contracts mean this group lags the economic cycle",
      ],
      correct: 2,
    },
  },
  consumer: {
    what: "Brands you actually buy from — retail, restaurants, streaming, apparel.",
    moves: "Consumer confidence, inflation, and whether people are spending or saving this quarter.",
    expect: "Usually calmer than tech; sensitive to the economy rather than to technology shifts.",
    quiz: {
      q: "Which of these is actually true about consumer stocks?",
      options: [
        "It's built to hold up when growth stocks are selling off, not to lead a rally",
        "A single clinical trial result can send one of these stocks sharply up or down overnight",
        "It's slow-moving and income-focused — rarely the stock making headlines",
        "It tracks consumer confidence and economic spending more than any single company's news",
      ],
      correct: 3,
    },
  },
  "crypto-adjacent": {
    what: "Public companies whose value tracks crypto — exchanges, miners, or firms holding a lot of bitcoin on their balance sheet.",
    moves: "The bitcoin price, mostly. Regulation and ETF flows second.",
    expect: "Among the most volatile stocks anywhere. Small weights for a reason.",
    quiz: {
      q: "Which of these is actually true about crypto-adjacent stocks?",
      options: [
        "Its share price tracks the price of bitcoin more than its own day-to-day operations",
        "A single position quietly holds hundreds of companies at once",
        "Interest-rate decisions move this whole group together, more than any one company's news",
        "Expectations are already priced in, so even strong results can send the stock down",
      ],
      correct: 0,
    },
  },
  index: {
    what: "Funds that hold hundreds of companies at once — the S&P 500 or Nasdaq 100 in a single position.",
    moves: "The whole market: rates, growth, and broad sentiment rather than any one company.",
    expect: "The boring backbone. Lower highs, higher lows, and it rarely makes the news.",
    quiz: {
      q: "Which of these is actually true about an index position?",
      options: [
        "It's built to hold up when growth stocks are selling off, not to lead a rally",
        "A single position quietly holds hundreds of companies at once",
        "Its share price tracks the price of bitcoin more than its own day-to-day operations",
        "It's steadier than most single stocks because of its size, but still swings hard around earnings",
      ],
      correct: 1,
    },
  },
  finance: {
    what: "Banks, payment networks, asset managers, and insurers — the plumbing money flows through.",
    moves: "Interest rates above all, then credit conditions and trading volumes.",
    expect: "Rate hikes and cuts move this group as a bloc; company news matters less than the Fed.",
    quiz: {
      q: "Which of these is actually true about bank and payment stocks?",
      options: [
        "Interest rates and occupancy levels matter here more than almost anything else",
        "It's built to hold up when growth stocks are selling off, not to lead a rally",
        "Interest-rate decisions move this whole group together, more than any one company's news",
        "Long order backlogs and long-lived contracts mean this group lags the economic cycle",
      ],
      correct: 2,
    },
  },
  defensive: {
    what: "Businesses people pay for in any economy — staples, utilities, household names with steady demand.",
    moves: "Slowly. They tend to hold up when growth stocks sell off.",
    expect: "Lower growth, lower drama. Their job in a nest is ballast, not lift.",
    quiz: {
      q: "Which of these is actually true about defensive stocks?",
      options: [
        "It tracks consumer confidence and economic spending more than any single company's news",
        "It's slow-moving and income-focused — rarely the stock making headlines",
        "Interest-rate decisions move this whole group together, more than any one company's news",
        "It's built to hold up when growth stocks are selling off, not to lead a rally",
      ],
      correct: 3,
    },
  },
  healthcare: {
    what: "Pharma, biotech, insurers, and device makers.",
    moves: "Trial results, drug approvals, and policy on pricing and reimbursement.",
    expect: "Individual names can jump or crater overnight on a single trial readout; as a group it's steadier.",
    quiz: {
      q: "Which of these is actually true about healthcare stocks?",
      options: [
        "A single clinical trial result can send one of these stocks sharply up or down overnight",
        "It tracks consumer confidence and economic spending more than any single company's news",
        "A blockbuster launch year and a quiet year can make it look like two different businesses",
        "Long order backlogs and long-lived contracts mean this group lags the economic cycle",
      ],
      correct: 0,
    },
  },
  industrial: {
    what: "Makers of engines, machinery, aircraft, and infrastructure — the physical economy.",
    moves: "Order backlogs, manufacturing activity, and big government or airline contracts.",
    expect: "Tracks the economic cycle with a lag; long-lived contracts smooth the ride.",
    quiz: {
      q: "Which of these is actually true about industrial stocks?",
      options: [
        "It can rally exactly when the rest of the market is falling, which is its use in a mix",
        "Long order backlogs and long-lived contracts mean this group lags the economic cycle",
        "Boom-and-bust demand cycles are the normal pattern here, not a sign something broke",
        "Interest-rate decisions move this whole group together, more than any one company's news",
      ],
      correct: 1,
    },
  },
  energy: {
    what: "Oil, gas, and the companies that find, refine, and move them.",
    moves: "Commodity prices and geopolitics far more than anything the companies do themselves.",
    expect: "Can rally when everything else falls, which is exactly why it's useful in a mix.",
    quiz: {
      q: "Which of these is actually true about energy stocks?",
      options: [
        "Long order backlogs and long-lived contracts mean this group lags the economic cycle",
        "Interest rates and occupancy levels matter here more than almost anything else",
        "It can rally exactly when the rest of the market is falling, which is its use in a mix",
        "Its share price tracks the price of bitcoin more than its own day-to-day operations",
      ],
      correct: 2,
    },
  },
  ev: {
    what: "Electric-vehicle makers and the battery and charging supply chain.",
    moves: "Delivery numbers, subsidies, and one very active CEO's posts.",
    expect: "Growth-stock volatility with a manufacturing business underneath — expect big swings.",
    quiz: {
      q: "Which of these is actually true about EV stocks?",
      options: [
        "Boom-and-bust demand cycles are the normal pattern here, not a sign something broke",
        "A blockbuster launch year and a quiet year can make it look like two different businesses",
        "Expectations are already priced in, so even strong results can send the stock down",
        "It carries growth-stock volatility stacked on top of an actual manufacturing business",
      ],
      correct: 3,
    },
  },
  "creator-economy": {
    what: "Platforms where creators earn — streaming, social, and the payment rails behind them.",
    moves: "User growth, ad markets, and shifts in where attention goes.",
    expect: "Attention is fickle; these move on trends more than on fundamentals.",
    quiz: {
      q: "Which of these is actually true about creator-economy stocks?",
      options: [
        "It moves on where user attention shifts more than on financial fundamentals",
        "A blockbuster launch year and a quiet year can make it look like two different businesses",
        "It's slow-moving and income-focused — rarely the stock making headlines",
        "It tracks consumer confidence and economic spending more than any single company's news",
      ],
      correct: 0,
    },
  },
  gaming: {
    what: "Game publishers and the hardware they run on.",
    moves: "Release calendars, console cycles, and hit-or-miss launches.",
    expect: "Lumpy: a great launch year and a quiet one can look like two different companies.",
    quiz: {
      q: "Which of these is actually true about gaming stocks?",
      options: [
        "It moves on where user attention shifts more than on financial fundamentals",
        "A blockbuster launch year and a quiet year can make it look like two different businesses",
        "It carries growth-stock volatility stacked on top of an actual manufacturing business",
        "A single clinical trial result can send one of these stocks sharply up or down overnight",
      ],
      correct: 1,
    },
  },
  telecom: {
    what: "Carriers and network operators — the subscription businesses behind connectivity.",
    moves: "Subscriber churn, spectrum costs, and dividends.",
    expect: "Slow and income-oriented; rarely the exciting egg, often the reliable one.",
    quiz: {
      q: "Which of these is actually true about telecom stocks?",
      options: [
        "Interest rates and occupancy levels matter here more than almost anything else",
        "It's built to hold up when growth stocks are selling off, not to lead a rally",
        "It's slow-moving and income-focused — rarely the stock making headlines",
        "Interest-rate decisions move this whole group together, more than any one company's news",
      ],
      correct: 2,
    },
  },
  "real-estate": {
    what: "Property owners and developers, usually structured to pass rent through to shareholders.",
    moves: "Interest rates and occupancy — office, housing, and data-center demand.",
    expect: "Rate-sensitive like finance, with income that tends to be steadier than the share price.",
    quiz: {
      q: "Which of these is actually true about real-estate stocks?",
      options: [
        "Interest-rate decisions move this whole group together, more than any one company's news",
        "It's slow-moving and income-focused — rarely the stock making headlines",
        "It can rally exactly when the rest of the market is falling, which is its use in a mix",
        "Interest rates and occupancy levels matter here more than almost anything else",
      ],
      correct: 3,
    },
  },
};

const TOTAL_LESSONS = Object.keys(LESSONS).length;

function readLearned(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export interface NestIQ {
  name: string;
  next: string | null;
  hint: string;
}

/**
 * A second, learning-only axis alongside Nest level — earned by correct quiz recall, never by
 * funding or returns. Thresholds scale with the lesson count so adding categories doesn't
 * silently make Sage easier.
 */
export function nestIQ(learnedCount: number, total: number = TOTAL_LESSONS): NestIQ {
  const scout = Math.max(1, Math.ceil(total * 0.2));
  const analyst = Math.max(scout + 1, Math.ceil(total * 0.6));
  if (learnedCount === 0) return { name: "Sprout", next: "Scout", hint: `Pass your first quiz to become a Scout.` };
  if (learnedCount < scout) return { name: "Sprout", next: "Scout", hint: `Pass ${scout} quizzes to become a Scout.` };
  if (learnedCount < analyst) return { name: "Scout", next: "Analyst", hint: `Pass ${analyst} quizzes to become an Analyst.` };
  if (learnedCount < total) return { name: "Analyst", next: "Sage", hint: `Pass all ${total} quizzes to become a Sage.` };
  return { name: "Sage", next: null, hint: "Every category in the deck, understood." };
}

/**
 * "Learn to hatch": a two-minute read per category in your nest, then a one-question recall
 * check ties off as learned. Progress is per-viewer (localStorage) — nothing is gated behind it,
 * nothing is rewarded with money; it exists so the ring and the trades mean something rather
 * than being tickers.
 */
export function NestLessons({ categories }: { categories: string[] }) {
  const [learned, setLearned] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [ruledOut, setRuledOut] = useState<Set<number>>(new Set());
  const [showIQHint, setShowIQHint] = useState(false);
  useEffect(() => setLearned(readLearned()), []);

  const ordered = useMemo(() => {
    const inNest = categories.filter(c => LESSONS[c]);
    const rest = Object.keys(LESSONS).filter(c => !inNest.includes(c));
    return [...inNest, ...rest];
  }, [categories]);
  const inNestCount = categories.filter(c => LESSONS[c]).length;
  const learnedInNest = categories.filter(c => learned.has(c)).length;
  const iq = nestIQ(learned.size);

  const openLesson = (key: string) => {
    setOpen(open === key ? null : key);
    setSelected(null);
    setRuledOut(new Set());
  };

  const answer = (key: string, index: number) => {
    setSelected(index);
    if (index === LESSONS[key].quiz.correct) {
      const next = new Set(learned);
      next.add(key);
      setLearned(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode */
      }
    } else {
      // Wrong picks are ruled out rather than re-selectable, so the question can't be solved by
      // clicking every option in order — you have to actually reason about what's left.
      setRuledOut(prev => new Set(prev).add(index));
    }
  };

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="ns-serif" style={{ fontSize: 22 }}>Know your nest</div>
          <button
            onClick={() => setShowIQHint(v => !v)}
            aria-expanded={showIQHint}
            style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 9999, border: "1px solid var(--line)", color: "var(--accent)", background: "transparent", cursor: "pointer" }}
          >
            Nest IQ: {iq.name}
          </button>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink3)" }}>
          {inNestCount > 0 && learnedInNest === inNestCount
            ? "Every category in your nest, understood."
            : inNestCount > 0
              ? `${learnedInNest} of ${inNestCount} categories in your nest learned`
              : `${learned.size} of ${ordered.length} learned`}
        </div>
      </div>
      {showIQHint && (
        <p style={{ fontSize: 13, color: "var(--ink3)", margin: "8px 0 0", maxWidth: 560, lineHeight: 1.5 }}>
          Nest IQ is earned by answering the recall question after each lesson correctly — never by funding or returns. Sprout → Scout → Analyst → Sage.
          {iq.next ? ` Next: ${iq.next} — ${iq.hint}` : ` ${iq.hint}`}
        </p>
      )}
      <p style={{ fontSize: 13, color: "var(--ink3)", margin: "4px 0 12px" }}>Two minutes per category — what it is, what moves it, what to expect — then a quick check.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {ordered.map(key => {
          const done = learned.has(key);
          const inNest = categories.includes(key);
          return (
            <button
              key={key}
              onClick={() => openLesson(key)}
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
          {learned.has(open) ? (
            <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>✓ Learned — quiz passed</span>
          ) : (
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, margin: "0 0 8px" }}>{LESSONS[open].quiz.q}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {LESSONS[open].quiz.options.map((opt, i) => {
                  const out = ruledOut.has(i);
                  return (
                    <button
                      key={opt}
                      disabled={out}
                      onClick={() => answer(open, i)}
                      style={{
                        textAlign: "left",
                        padding: "9px 14px",
                        borderRadius: 8,
                        fontSize: 13.5,
                        cursor: out ? "not-allowed" : "pointer",
                        border: `1px solid ${out ? "var(--down)" : "var(--line)"}`,
                        background: out ? "color-mix(in oklch, var(--down) 8%, transparent)" : "var(--paper)",
                        color: out ? "var(--ink3)" : "var(--ink)",
                        textDecoration: out ? "line-through" : "none",
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {selected !== null && selected !== LESSONS[open].quiz.correct && (
                <p style={{ fontSize: 12.5, color: "var(--down)", margin: "8px 0 0" }}>
                  Not quite — that's true, just not about this one. Re-read above and try again.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
