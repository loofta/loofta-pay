"use client";

import { useState } from "react";
import type { NestFlock, FlockMember } from "@/services/api/nest";
import { TAG_LABELS } from "@/components/nest/OnboardingFlow";

const BAR_COLORS = ["#66865f", "#9d8056", "#7d927f", "#9b746b", "#8a9a86", "#aaa9a0", "#b39a6e", "#6f8f8a"];

function MemberCard({ m, onKudos, onUnfollow, busy }: { m: FlockMember; onKudos: () => void; onUnfollow: () => void; busy: boolean }) {
  return (
    <div className="ns-card" style={{ padding: "var(--card-pad)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{m.displayName ?? `@${m.username}`}</span>
          {m.displayName && <span style={{ fontSize: 13, color: "var(--ink3)" }}> @{m.username}</span>}
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", padding: "3px 9px", borderRadius: 9999, border: "1px solid var(--line)", color: "var(--accent)" }}>
          {m.level}
        </span>
      </div>
      {/* One stacked bar: category shares only. No dollars, no returns — by design. */}
      <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--paper2)", margin: "12px 0 8px" }}>
        {m.categories.map((c, i) => (
          <span key={c.label} title={`${TAG_LABELS[c.label] ?? c.label} ${(c.weight * 100).toFixed(0)}%`} style={{ width: `${c.weight * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: 12.5, color: "var(--ink2)" }}>
        {m.categories.slice(0, 5).map((c, i) => (
          <span key={c.label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: BAR_COLORS[i % BAR_COLORS.length] }} />
            {TAG_LABELS[c.label] ?? c.label} {(c.weight * 100).toFixed(0)}%
          </span>
        ))}
        {m.categories.length === 0 && <span style={{ color: "var(--ink3)" }}>Nest not built yet</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--ink3)" }}>
          {m.streakWeeks > 0 ? `${m.streakWeeks}-week streak` : "No streak yet"} · {m.kudosReceived} kudos
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            disabled={busy || m.kudosSentToday}
            onClick={onKudos}
            className="ns-btn"
            style={{ padding: "7px 14px", fontSize: 13, opacity: m.kudosSentToday ? 0.55 : 1 }}
          >
            {m.kudosSentToday ? "Kudos sent" : "Send kudos"}
          </button>
          <button disabled={busy} onClick={onUnfollow} style={{ background: "none", border: "1px solid var(--line)", borderRadius: 9999, padding: "7px 12px", fontSize: 13, color: "var(--ink3)", cursor: "pointer" }}>
            Unfollow
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The flock: people you follow, as category shares + level + streak. Deliberately no balances,
 * no returns, no ranking, no copy button — the research is unambiguous that those raise
 * risk-taking and draw regulators. Kudos are one per person per day.
 */
export function FlockPanel({
  flock,
  busy,
  onSetPublic,
  onFollow,
  onUnfollow,
  onKudos,
}: {
  flock: NestFlock | null;
  busy: boolean;
  onSetPublic: (isPublic: boolean) => void;
  onFollow: (username: string) => Promise<string | null>;
  onUnfollow: (username: string) => void;
  onKudos: (username: string) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!flock) return null;

  const submit = async () => {
    const u = input.trim().replace(/^@/, "");
    if (!u) return;
    setError(null);
    const err = await onFollow(u);
    if (err) setError(err);
    else setInput("");
  };

  return (
    <section>
      <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Your nest in the flock</div>
            <p style={{ fontSize: 13, color: "var(--ink3)", margin: "4px 0 0" }}>
              {flock.isPublic
                ? `Visible${flock.username ? ` as @${flock.username}` : ""} — friends see your category mix, level and streak. Never your balance.`
                : "Hidden. Turn it on so friends can follow your nest — they'll see category percentages, level and streak, never amounts."}
            </p>
          </div>
          <button
            disabled={busy}
            onClick={() => onSetPublic(!flock.isPublic)}
            style={{ border: "1px solid var(--line)", background: flock.isPublic ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent", borderRadius: 9999, padding: "9px 16px", fontSize: 13, color: flock.isPublic ? "var(--accent)" : "var(--ink2)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {flock.isPublic ? "Visible to flock" : "Make visible"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 12.5, color: "var(--ink3)", marginTop: 10 }}>
          <span>{flock.followers} following you</span>
          <span>{flock.kudosReceived} kudos received</span>
        </div>
      </div>

      <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Follow a nest</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            placeholder="Loofta username"
            style={{ flex: 1, minWidth: 0, fontSize: 15, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }}
          />
          <button className="ns-btn" disabled={busy} onClick={submit} style={{ padding: "10px 18px", fontSize: 14 }}>
            Follow
          </button>
        </div>
        {error && <p style={{ fontSize: 13, color: "var(--down)", margin: "8px 0 0" }}>{error}</p>}
      </div>

      {flock.following.length === 0 ? (
        <div className="ns-card" style={{ padding: "var(--card-pad)" }}>
          <p style={{ fontSize: 14, color: "var(--ink3)" }}>No nests followed yet. Ask a friend for their Loofta username — they need to make their nest visible first.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {flock.following.map(m => (
            <MemberCard key={m.username} m={m} busy={busy} onKudos={() => onKudos(m.username)} onUnfollow={() => onUnfollow(m.username)} />
          ))}
        </div>
      )}
    </section>
  );
}
