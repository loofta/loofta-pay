"use client";

import type { NestStreak } from "@/services/api/nest";

const MILESTONES = [0.25, 0.5, 0.75, 1];

/** Small egg that cracks a little more at each funding milestone. */
function HatchingEgg({ progress }: { progress: number }) {
  const cracks = MILESTONES.filter(m => progress >= m).length;
  return (
    <svg width="44" height="56" viewBox="0 0 44 56" fill="none" aria-hidden>
      <ellipse cx="22" cy="30" rx="18" ry="24" fill="var(--accent)" fillOpacity="0.85" />
      {cracks >= 1 && <path d="M14 22 l4 4 l-3 4 l5 4" stroke="var(--paper)" strokeWidth="1.8" strokeLinecap="round" fill="none" />}
      {cracks >= 2 && <path d="M27 14 l3 5 l-4 3 l4 5" stroke="var(--paper)" strokeWidth="1.8" strokeLinecap="round" fill="none" />}
      {cracks >= 3 && <path d="M12 38 l5 2 l2 5 l5 1" stroke="var(--paper)" strokeWidth="1.8" strokeLinecap="round" fill="none" />}
      {cracks >= 4 && <path d="M4 30 Q12 26 18 32 Q26 38 40 30" stroke="var(--paper)" strokeWidth="2.2" strokeLinecap="round" fill="none" />}
    </svg>
  );
}

/**
 * "Hatching": progress toward a user-named nest goal, measured on money *deposited* — never on
 * P&L. Milestones (25/50/75/100%) are the only things we celebrate, and only with a line of
 * text; no confetti, no trade-linked rewards (see the gamification research: that's exactly
 * what Robinhood was fined for). Streak is weekly deposits, with one forgiven skip per 4 weeks.
 */
export function NestGoalProgress({ goalUsd, depositedUsd, streak, onSetGoal }: { goalUsd: number | null; depositedUsd: number; streak: NestStreak | null; onSetGoal: () => void }) {
  const progress = goalUsd && goalUsd > 0 ? Math.min(depositedUsd / goalUsd, 1) : 0;
  const reached = MILESTONES.filter(m => progress >= m);
  const latest = reached.length > 0 ? reached[reached.length - 1] : null;

  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18, display: "flex", gap: 16, alignItems: "center" }}>
      <HatchingEgg progress={progress} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {goalUsd ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                ${depositedUsd.toFixed(0)} <span style={{ color: "var(--ink3)", fontWeight: 400 }}>of ${goalUsd.toLocaleString()} nest goal</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--ink3)" }}>{(progress * 100).toFixed(0)}% funded</div>
            </div>
            <div style={{ position: "relative", height: 8, borderRadius: 999, background: "var(--paper2)", overflow: "hidden", margin: "8px 0 6px" }}>
              <div style={{ height: "100%", width: `${progress * 100}%`, background: "var(--accent)", borderRadius: 999, transition: "width .6s cubic-bezier(.22,1,.36,1)" }} />
              {MILESTONES.slice(0, 3).map(m => (
                <span key={m} style={{ position: "absolute", left: `${m * 100}%`, top: 0, bottom: 0, width: 2, background: "var(--paper)", opacity: 0.8 }} />
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", display: "flex", gap: 12, flexWrap: "wrap" }}>
              {latest === 1 ? <span className="ns-up" style={{ fontWeight: 600 }}>Hatched — goal fully funded</span> : latest ? <span>Milestone reached: {latest * 100}% funded</span> : <span>First crack at 25%</span>}
              {streak && streak.weeks > 0 && (
                <span>
                  · {streak.weeks}-week deposit streak{streak.freezeUsed ? " (one skip forgiven)" : ""}
                  {!streak.depositedThisWeek ? " · feed the nest this week to keep it" : ""}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Give your nest a goal</div>
            <p style={{ fontSize: 13, color: "var(--ink3)", margin: "4px 0 8px" }}>
              Name a dollar target and watch the egg crack as you fund it — progress is measured on what you put in, not on the market.
            </p>
            <button onClick={onSetGoal} style={{ border: "1px solid var(--line)", background: "transparent", borderRadius: 9999, padding: "8px 16px", fontSize: 13, color: "var(--ink2)", cursor: "pointer" }}>
              Set a goal
            </button>
          </>
        )}
      </div>
    </div>
  );
}
