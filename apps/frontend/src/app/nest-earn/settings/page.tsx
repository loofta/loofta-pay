"use client";

// Where you can see and change your investing vibe + interests after the initial onboarding —
// the same two things OnboardingFlow.tsx sets, just editable afterward rather than a one-time
// quiz. Backend only stores a 3-tier riskTolerance, so re-selecting a persona here collapses back
// to one of 3 tiers (see RISK_PERSONA in OnboardingFlow.tsx) — re-picking "Play the long game" or
// "Still figuring it out" isn't distinguishable from "Find the middle ground" once saved; that's
// an accepted simplification, not a bug.
import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { getNestProfile, getNestUniverse, upsertNestProfile, getNestDeposits, getNestRoundups, setNestRoundups, type NestUniverseAsset, type NestDepositView, type NestRoundups } from "@/services/api/nest";
import { VIBES, PERSONA_RISK, RISK_PERSONA, TAG_LABELS, VibeQuiz, type Persona } from "@/components/nest/OnboardingFlow";
import { NestLogo } from "@/components/nest/NestLogo";
import { NestFooter } from "@/components/nest/NestFooter";
import { NestLoader } from "@/components/nest/NestLoader";
import { useNestDarkMode, nestRootClass } from "@/components/nest/useNestDarkMode";

export default function NestSettingsPage() {
  const { user, authenticated, login: privyLogin, logout, getAccessToken } = usePrivy();
  // Nest-only restriction: email sign-in only — see the matching comment in NestApp.tsx.
  const login = () => privyLogin({ loginMethods: ["email"] });
  const [dark, toggleDark] = useNestDarkMode();
  const [universe, setUniverse] = useState<NestUniverseAsset[]>([]);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [deposits, setDeposits] = useState<NestDepositView[]>([]);
  const [roundups, setRoundups] = useState<NestRoundups | null>(null);
  const [roundupsBusy, setRoundupsBusy] = useState(false);
  const [persona, setPersona] = useState<Persona>("Find the middle ground");
  const [themes, setThemes] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retaking, setRetaking] = useState(false);

  useEffect(() => {
    getNestUniverse().then(setUniverse).catch(() => setUniverse([]));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      const accessToken = await getAccessToken();
      const profile = await getNestProfile({ userId: user?.id, accessToken }, true).catch(() => null);
      if (profile) {
        setName(profile.displayName ?? "");
        setGoal(profile.goalUsd ? String(profile.goalUsd) : "");
        setPersona(RISK_PERSONA[profile.riskTolerance]);
        setThemes(profile.interestTags);
      }
      getNestDeposits({ userId: user?.id, accessToken }, true).then(setDeposits).catch(() => setDeposits([]));
      getNestRoundups({ userId: user?.id, accessToken }, true).then(setRoundups).catch(() => setRoundups(null));
      setLoaded(true);
    })();
  }, [authenticated, getAccessToken, user?.id]);

  const toggleTheme = (tag: string) => setThemes(p => (p.includes(tag) ? p.filter(x => x !== tag) : [...p, tag]));

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const accessToken = await getAccessToken();
      const goalNum = Number(goal);
      await upsertNestProfile(PERSONA_RISK[persona], themes, name.trim() || null, { userId: user?.id, accessToken }, true, goal.trim() === "" ? null : Number.isFinite(goalNum) && goalNum > 0 ? goalNum : undefined);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const availableTags = [...new Set(universe.flatMap(u => u.tags))];

  const chooseRoundups = async (unit: number | null) => {
    setRoundupsBusy(true);
    try {
      const accessToken = await getAccessToken();
      setRoundups(await setNestRoundups(unit, { userId: user?.id, accessToken }, true));
    } finally {
      setRoundupsBusy(false);
    }
  };

  if (!authenticated) {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ color: "var(--ink2)" }}>Sign in to see your Nest settings.</p>
        <button className="ns-btn" style={{ padding: "13px 30px", fontSize: 15 }} onClick={login}>Sign in</button>
      </div>
    );
  }

  return (
    <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px var(--page-pad)" }}>
        <Link href="/nest-earn/app" style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
          <NestLogo dark={dark} />
          <span className="ns-serif" style={{ fontStyle: "italic", color: "var(--accent)", fontSize: 17, lineHeight: 1 }}>Nest</span>
        </Link>
        <button
          onClick={logout}
          style={{ border: "1px solid var(--line)", background: "transparent", borderRadius: 9999, padding: "10px 22px", fontSize: 14, color: "var(--ink2)", cursor: "pointer" }}
        >
          Log out
        </button>
      </header>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "8px 24px 80px" }}>
        <Link href="/nest-earn/app" style={{ fontSize: 14, color: "var(--ink3)" }}>← Back to your nest</Link>
        <div className="ns-serif" style={{ fontSize: 40, marginTop: 16 }}>Your nest settings</div>
        <p style={{ fontSize: 15, color: "var(--ink2)", marginTop: 8, marginBottom: 32 }}>
          Change your vibe or what you're into — it's picked up on the next daily rebalance.
        </p>

        {!loaded ? (
          <NestLoader label="Loading your settings…" />
        ) : (
          <>
            <div style={{ marginBottom: 28 }}>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>What should we call you?</p>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={40}
                placeholder="e.g. Alex"
                style={{ width: "100%", maxWidth: 320, fontSize: 16, padding: "12px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }}
              />
            </div>

            <div id="goal" style={{ marginBottom: 28 }}>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Nest goal</p>
              <p style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 12 }}>A dollar target for what you'll put in. The egg on your dashboard cracks at 25/50/75/100% funded — measured on deposits, never on the market.</p>
              <div style={{ position: "relative", maxWidth: 320 }}>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink3)", fontSize: 16 }}>$</span>
                <input
                  type="number"
                  min={1}
                  step={50}
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  placeholder="e.g. 1000"
                  style={{ width: "100%", fontSize: 16, padding: "12px 16px 12px 28px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" }}
                />
              </div>
            </div>

            <div id="roundups" style={{ marginBottom: 28 }}>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Crumbs (round-ups)</p>
              <p style={{ fontSize: 13, color: "var(--ink3)", marginBottom: 12 }}>
                Round each payment you send through Loofta up to the next $1 or $5. The spare change shows up on your dashboard as crumbs; you feed it to the nest with one tap — nothing moves on its own.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {([[null, "Off"], [1, "Round up to $1"], [5, "Round up to $5"]] as const).map(([unit, label]) => {
                  const active = (roundups?.unit ?? null) === unit;
                  return (
                    <button
                      key={label}
                      disabled={roundupsBusy || !roundups}
                      onClick={() => chooseRoundups(unit)}
                      style={{ borderRadius: 9999, padding: "9px 16px", fontSize: 14, cursor: "pointer", border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`, background: active ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent", color: active ? "var(--accent)" : "var(--ink2)" }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {roundups?.enabled && (
                <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 10 }}>
                  ${roundups.pendingUsd.toFixed(2)} in crumbs from {roundups.paymentCount} payment{roundups.paymentCount === 1 ? "" : "s"} waiting on your dashboard.
                </p>
              )}
            </div>

            <div style={{ marginBottom: 28 }}>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Your investing vibe</p>
              {retaking ? (
                <div className="ns-card" style={{ padding: "var(--card-pad)" }}>
                  <VibeQuiz
                    onDone={p => {
                      setPersona(p);
                      setRetaking(false);
                    }}
                  />
                </div>
              ) : (
                <div className="ns-card" style={{ padding: "var(--card-pad)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 15 }}>{VIBES[persona][0]}</p>
                    <p style={{ fontSize: 13, color: "var(--ink3)", marginTop: 3 }}>{VIBES[persona][1]}</p>
                  </div>
                  <button
                    onClick={() => setRetaking(true)}
                    style={{ flexShrink: 0, border: "1px solid var(--line)", background: "transparent", borderRadius: 9999, padding: "9px 18px", fontSize: 13, color: "var(--ink2)", cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    Retake quiz
                  </button>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 32 }}>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>What are you into?</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {availableTags.map(tag => {
                  const active = themes.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTheme(tag)}
                      style={{
                        borderRadius: 9999,
                        padding: "7px 14px",
                        fontSize: 14,
                        cursor: "pointer",
                        border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
                        background: active ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent",
                        color: active ? "var(--accent)" : "var(--ink2)",
                      }}
                    >
                      {TAG_LABELS[tag] ?? tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <button className="ns-btn" style={{ width: "100%", justifyContent: "center", padding: "16px", fontSize: 16, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
            </button>

            <div style={{ marginTop: 40 }}>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Deposit history</p>
              {deposits.length === 0 ? (
                <p style={{ fontSize: 14, color: "var(--ink3)" }}>No deposits yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {deposits.map(d => (
                    <div key={d.txHash} className="ns-card" style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>${d.amountUsdc.toFixed(2)}</div>
                        <div style={{ fontSize: 12, color: "var(--ink3)" }}>{new Date(d.createdAt).toLocaleString()} · {d.network}</div>
                      </div>
                      <a
                        href={`https://solscan.io/tx/${d.txHash}${d.network === "devnet" ? "?cluster=devnet" : ""}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 13, whiteSpace: "nowrap" }}
                      >
                        View tx →
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <NestFooter dark={dark} onToggleDark={toggleDark} />
    </div>
  );
}
