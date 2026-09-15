"use client";

// Adapted from nest-onboarding/OnboardingFlow.tsx.txt (same source as nest-splash — see that
// kit's README). Trimmed from the original 5-question + rules + avoid-list flow down to what
// actually maps to something real:
// - Kept: goal/horizon/drop/persona (Q1-4) — pure "what's your vibe" questions, purely used to
//   pick a risk tier + a friendly label. No backend mismatch.
// - Dropped Q5 ("What should Nest handle?" — suggest-only / ask-first / handle automatically):
//   there's only one mode built (full auto-rebalance), so offering a choice here would be the
//   same "looks real but isn't" problem as the removed Pricing section.
// - Dropped "Set your boundaries" (manual-approval rules, monthly limit) and "Avoid list"
//   (tobacco/weapons/gambling/fossil fuels): no approval-gate or exclusion-screening exists in
//   nest-rebalance.service.ts, and none of those categories were ever in our curated universe to
//   begin with, so there's nothing to avoid — showing the option would imply a feature that isn't
//   there for a problem that doesn't exist.
// - "Personalize your portfolio" now pulls chip options from the REAL backend universe tags
//   (see xstocks.service.ts's NEST_UNIVERSE_ALLOWLIST) instead of the kit's fixed word list, so
//   it only ever offers categories we can actually back, and picks up new ones automatically if
//   the universe grows later.
import { useState } from "react";
import type { NestRiskTolerance, NestUniverseAsset } from "@/services/api/nest";

export type Persona = "Keep it steady" | "Find the middle ground" | "Play the long game" | "I can handle big swings" | "Still figuring it out";

const QUESTIONS = [
  { key: "goal", kicker: "1 of 4 · What's the goal?", title: "Why are you here?", options: ["Grow my money", "Save for something big", "Build my future", "Make some extra income", "I'm just exploring"] },
  { key: "horizon", kicker: "2 of 4 · How long can your money stay invested?", title: "When might you need this money?", options: ["Soon", "In a few years", "5+ years", "I don't know yet"], helper: "Longer timelines usually give your money more time to recover from market drops." },
  { key: "drop", kicker: "3 of 4 · What happens when markets get messy?", title: "Your portfolio drops 20%. What do you do?", options: ["I'm selling", "I'm selling a little", "I'm waiting it out", "I'm buying more", "I need help deciding"] },
  { key: "persona", kicker: "4 of 4 · Pick your money personality", title: "Which feels most like you?", options: ["Keep it steady", "Find the middle ground", "Play the long game", "I can handle big swings", "Still figuring it out"] },
] as const;

export const VIBES: Record<Persona, [string, string]> = {
  "Keep it steady": ["Steady Era", "Stability comes first. Your nest leans on dependable names and keeps the swings small."],
  "Find the middle ground": ["Balanced Builder", "You want your money to grow, but you don't want every market dip to become your problem."],
  "Play the long game": ["Long-Term Mode", "Focused on future wealth. Your nest is built to sit tight and compound."],
  "I can handle big swings": ["Big Swing Energy", "Comfortable with volatility. Your nest takes bigger positions where the upside lives."],
  "Still figuring it out": ["Still Figuring It Out", "Start simple and learn as you go. Your nest stays easy to read and easy to change."],
};

export const PERSONA_RISK: Record<Persona, NestRiskTolerance> = {
  "Keep it steady": "conservative",
  "Find the middle ground": "balanced",
  "Play the long game": "balanced",
  "I can handle big swings": "aggressive",
  "Still figuring it out": "balanced",
};

export const RISK_PERSONA: Record<NestRiskTolerance, Persona> = {
  conservative: "Keep it steady",
  balanced: "Find the middle ground",
  aggressive: "I can handle big swings",
};

export const TAG_LABELS: Record<string, string> = {
  "big-tech": "Big Tech",
  ai: "AI",
  semis: "Semiconductors",
  consumer: "Consumer",
  "crypto-adjacent": "Crypto-adjacent",
  index: "Index funds",
  finance: "Finance",
  defensive: "Defensive",
  healthcare: "Healthcare",
  industrial: "Industrial",
  energy: "Energy",
  ev: "EV",
  "creator-economy": "Creator economy",
  gaming: "Gaming",
  telecom: "Telecom",
  "real-estate": "Real estate",
};

const PROGRESS = [0, 15, 35, 55, 75, 100, 100];

interface Answers {
  name?: string;
  goal?: string;
  horizon?: string;
  drop?: string;
  persona?: Persona;
  themes: string[];
}

/**
 * The Q1-4 "what's your vibe" quiz (goal/horizon/drop/persona), extracted so Settings can offer
 * "retake the assessment" instead of letting people directly pick a persona off a flat list —
 * the vibe is supposed to come out of answering these, not be self-selected.
 */
export function VibeQuiz({ onDone }: { onDone: (persona: Persona) => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<"goal" | "horizon" | "drop" | "persona", string>>>({});

  const pick = (key: "goal" | "horizon" | "drop" | "persona", value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (step === QUESTIONS.length - 1) {
      setTimeout(() => onDone(value as Persona), 300);
    } else {
      setTimeout(() => setStep(s => s + 1), 300);
    }
  };

  const q = QUESTIONS[step];
  const pct = Math.round(((step + 1) / QUESTIONS.length) * 100);

  return (
    <div className="nob-wrap" style={{ padding: 0, maxWidth: 480 }}>
      <div className="nob-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <section className="nob-step" key={q.key} style={{ padding: "28px 0 0" }}>
        {step > 0 && (
          <button className="nob-back" onClick={() => setStep(s => s - 1)}>← Back</button>
        )}
        <div className="nob-kicker">{q.kicker}</div>
        <h1 style={{ fontSize: 28 }}>{q.title}</h1>
        <div className="nob-opts">
          {q.options.map(o => (
            <button key={o} className={`nob-opt${answers[q.key as keyof typeof answers] === o ? " sel" : ""}`} onClick={() => pick(q.key as any, o)}>
              <span className="nob-dot" />
              {o}
            </button>
          ))}
        </div>
        {"helper" in q && q.helper && <p className="nob-helper">{q.helper}</p>}
      </section>
    </div>
  );
}

export function OnboardingFlow({
  universe,
  onComplete,
  submitting,
}: {
  universe: NestUniverseAsset[];
  onComplete: (riskTolerance: NestRiskTolerance, interestTags: string[], displayName: string) => void;
  submitting: boolean;
}) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>({ themes: [] });
  const [nameDraft, setNameDraft] = useState("");

  const availableTags = [...new Set(universe.flatMap(u => u.tags))];

  const go = (n: number) => {
    setStep(n);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };
  const pick = (key: keyof Answers, value: string, next: number) => {
    setA(p => ({ ...p, [key]: value }));
    setTimeout(() => go(next), 350);
  };
  const toggleTheme = (tag: string) => setA(p => ({ ...p, themes: p.themes.includes(tag) ? p.themes.filter(x => x !== tag) : [...p.themes, tag] }));

  const persona = a.persona ?? "Find the middle ground";
  const vibe = VIBES[persona];
  const pct = PROGRESS[step];

  const finish = () => onComplete(PERSONA_RISK[persona], a.themes, a.name ?? "");

  return (
    <div className="nob">
      <div className="nob-wrap">
        <div className="nob-bar">
          <i style={{ width: `${pct}%` }} />
        </div>

        {step === 0 && (
          <section className="nob-step">
            <div className="nob-kicker">Welcome to your nest</div>
            <h1>How should I call you?</h1>
            <p className="nob-sub">Just a first name or nickname — this is how your nest will greet you.</p>
            <input
              type="text"
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && nameDraft.trim()) {
                  setA(p => ({ ...p, name: nameDraft.trim() }));
                  go(1);
                }
              }}
              placeholder="Your name"
              autoFocus
              maxLength={40}
              style={{
                display: "block",
                width: "100%",
                maxWidth: 380,
                fontFamily: "var(--serif)",
                fontSize: 44,
                lineHeight: 1.2,
                padding: "6px 2px 14px",
                background: "transparent",
                border: "none",
                borderBottom: "2px solid var(--line)",
                borderRadius: 0,
                color: "var(--ink)",
                outline: "none",
                transition: "border-color .2s",
              }}
              onFocus={e => (e.currentTarget.style.borderBottomColor = "var(--accent)")}
              onBlur={e => (e.currentTarget.style.borderBottomColor = "var(--line)")}
            />
            <div style={{ marginTop: 32 }}>
              <button
                className="nob-btn"
                disabled={!nameDraft.trim()}
                style={{ opacity: nameDraft.trim() ? 1 : 0.4 }}
                onClick={() => {
                  setA(p => ({ ...p, name: nameDraft.trim() }));
                  go(1);
                }}
              >
                Continue
              </button>
            </div>
          </section>
        )}

        {step >= 1 && step <= 4 && (() => {
          const q = QUESTIONS[step - 1];
          return (
            <section className="nob-step" key={q.key}>
              <button className="nob-back" onClick={() => go(step - 1)}>← Back</button>
              <div className="nob-kicker">{q.kicker}</div>
              <h1>{q.title}</h1>
              <div className="nob-opts">
                {q.options.map(o => (
                  <button key={o} className={`nob-opt${(a as any)[q.key] === o ? " sel" : ""}`} onClick={() => pick(q.key as keyof Answers, o, step + 1)}>
                    <span className="nob-dot" />
                    {o}
                  </button>
                ))}
              </div>
              {"helper" in q && q.helper && <p className="nob-helper">{q.helper}</p>}
            </section>
          );
        })()}

        {step === 5 && (
          <section className="nob-step">
            <div className="nob-kicker">{a.name ? `Nice to meet you, ${a.name}` : "Your investing vibe"}</div>
            <h1>{vibe[0]}</h1>
            <p className="nob-sub">{vibe[1]}</p>
            <div className="nob-card">
              <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ink3)", marginBottom: 12 }}>Your starter setup</div>
              <ul className="nob-setup" style={{ margin: 0, paddingLeft: 20 }}>
                <li>A basket built around your picks</li>
                <li>Automatic daily rebalancing</li>
                <li>Tilted toward names with real momentum</li>
                <li>Every move logged on the ledger</li>
              </ul>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 30 }}>
              <button className="nob-btn" onClick={() => go(6)}>Personalize it</button>
              <button className="nob-ghost" onClick={() => go(1)}>That doesn't sound like me</button>
            </div>
          </section>
        )}

        {step === 6 && (
          <section className="nob-step">
            <div className="nob-kicker">Optional — skip anytime</div>
            <h1>Want to make this more you?</h1>
            <p className="nob-sub">Your nest already works. This just tunes what it invests in.</p>

            <div className="nob-secthead">What are you into?</div>
            <p className="nob-sectsub">Pick anything you care about — leave it empty for the full universe.</p>
            <div className="nob-chips">
              {availableTags.map(tag => (
                <button key={tag} className={`nob-chip${a.themes.includes(tag) ? " sel" : ""}`} onClick={() => toggleTheme(tag)}>
                  {TAG_LABELS[tag] ?? tag}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 40 }}>
              <button className="nob-btn" onClick={finish} disabled={submitting}>
                {submitting ? "Building…" : "Build my nest"}
              </button>
              <button className="nob-ghost" onClick={finish} disabled={submitting}>Skip for now</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
