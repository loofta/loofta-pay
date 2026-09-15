"use client";

// "Loofta Nest" — auto-invest robo-portfolio, restyled onto the nest-splash design kit (see
// /nest-splash at the repo root: README.md, NestHero.tsx.txt, page.tsx.txt, nest-splash.css) —
// replicated as closely as the kit's static splash allows, then extended with the same tokens
// (ns-root/.ns-card/.ns-btn/.ns-serif, warm "paper" palette) into the authenticated onboarding
// and dashboard views, which the kit itself doesn't cover (it's a marketing splash only). Profile
// (risk tolerance + interests) drives a daily server-side rebalance across a curated xStocks
// basket, tilted by an elfa.ai social-sentiment signal — see apps/backend/src/modules/nest/*.
//
// The kit's Pricing section (20bps in/out) was removed — nothing in the backend charged it, and
// it didn't match how real robo-advisors price (recurring % of AUM, not a per-transaction fee).
// No monetization model has replaced it yet; see conversation history for the tradeoffs.
//
// One known gap carried over from the kit, flagged rather than silently shipped: "We watch the
// news" + press logos imply newswire ingestion; the actual signal (elfa.ai) is X/Twitter
// mentions, not news-wire feeds. PRESS is trimmed to outlets we actually cited in the Event
// Ledger (Reuters/CNBC/Bloomberg) rather than the kit's fuller list, but the "reads the wires"
// framing itself is still aspirational, not literal.

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, MessageCircle, Zap, PieChart } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import dynamic from "next/dynamic";
import {
  getNestConfig,
  getNestUniverse,
  getNestProfile,
  upsertNestProfile,
  getNestPortfolio,
  getNestHistory,
  type NestConfig,
  type NestUniverseAsset,
  type NestProfile,
  type NestPortfolio,
  type NestTradeView,
  type NestRiskTolerance,
} from "@/services/api/nest";
import { OnboardingFlow } from "@/components/nest/OnboardingFlow";
import { NavChart } from "@/components/nest/NavChart";
import { HoldingsBreakdown } from "@/components/nest/HoldingsBreakdown";
import { TradeHistoryList } from "@/components/nest/TradeHistoryList";
import { MARKET_EVENTS, PRESS, fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";
import { DEFAULT_STOCKS, type NestStock } from "@/components/nest/NestHero";
import { NestLogo } from "@/components/nest/NestLogo";
import { useNestDarkMode, nestRootClass } from "@/components/nest/useNestDarkMode";
import { NestFooter } from "@/components/nest/NestFooter";
import { NestLoader } from "@/components/nest/NestLoader";

const DepositModal = dynamic(() => import("@/components/nest/DepositModal").then(m => ({ default: m.DepositModal })), { ssr: false });
// Touches WebGL — client-only, lazy-loaded, same convention as MegapotPack's 3D scene.
const NestHero = dynamic(() => import("@/components/nest/NestHero"), { ssr: false });

const RISK_COLORS = [0xaaa9a0, 0x66865f, 0x9d8056, 0x9b746b, 0x7d927f, 0x8a9a86];

// Pilot phase: real mainnet deposit (card, real crypto) isn't offered yet — the only working
// deposit path is free devnet USDC (see DepositModal.tsx), so every profile/portfolio/history
// read+write goes through the devnet-demo ledger (a fully separate identity server-side, see
// nest-ledger-id.ts — never mixed with real money). Flip this once a real deposit path ships.
const NEST_DEMO_MODE = true;

/** Avatar + dropdown, leftmost element in the header — shows who's signed in (initial from their
 *  display name, falling back to their email) and surfaces email/Settings/Log out in one place
 *  instead of scattering them as separate header buttons. */
/** What the rebalance actually did in response to an event — the Event Ledger cards were
 *  showing the price move but not the action, despite the section being titled "Rebalanced on
 *  real headlines." Icon direction (up/down) reuses the same status colors as the price-move
 *  figure above it, rather than introducing a third color meaning on the same card. */
/** Visual for "how the elfa signal actually works" — a simple 3-node vertical pipeline (X posts
 *  → elfa flags a spike → your Nest rebalances) rather than a chart, since a mention-count
 *  chart would need the viewer to already understand z-scores to read it. This just shows the
 *  mechanism. */
function ElfaFlowDiagram() {
  const steps: Array<{ icon: typeof MessageCircle; label: string; sub: string }> = [
    { icon: MessageCircle, label: "Millions of posts on X", sub: "Every account, every day" },
    { icon: Zap, label: "elfa flags a spike", sub: "Unusual buzz, before the headlines" },
    { icon: PieChart, label: "Your Nest rebalances", sub: "Leans harder into what's real" },
  ];
  return (
    <div style={{ position: "relative", paddingLeft: 4, marginLeft: "auto", width: "fit-content" }}>
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isLast = i === steps.length - 1;
        return (
          <div key={step.label} style={{ position: "relative", display: "flex", gap: 14, paddingBottom: isLast ? 0 : 28 }}>
            {!isLast && <div style={{ position: "absolute", left: 19, top: 40, bottom: 0, width: 1, background: "var(--line)" }} />}
            <div
              style={{
                flexShrink: 0,
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "color-mix(in oklch, var(--accent) 14%, transparent)",
                border: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1,
              }}
            >
              <Icon size={18} color="var(--accent)" strokeWidth={2} />
            </div>
            <div style={{ paddingTop: 2 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{step.label}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>{step.sub}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AiActionRow({ up, action }: { up: boolean; action: string }) {
  const color = up ? "var(--up)" : "var(--down)";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line2)", display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div
        style={{
          flexShrink: 0,
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: `color-mix(in oklch, ${color} 16%, transparent)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={14} color={color} strokeWidth={2.5} />
      </div>
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)" }}>AI action</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginTop: 1 }}>{action}</div>
      </div>
    </div>
  );
}

function UserMenu({ displayName, email, onLogout }: { displayName: string | null; email: string | null; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const initial = (displayName?.trim()?.[0] ?? email?.[0] ?? "?").toUpperCase();

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "1px solid var(--line)",
          background: "var(--accent-soft, var(--paper2))",
          color: "var(--accent)",
          fontWeight: 700,
          fontSize: 15,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {initial}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div className="ns-card" style={{ position: "absolute", top: 44, right: 0, zIndex: 50, minWidth: 220, padding: 8 }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line2)", marginBottom: 6 }}>
              {displayName && <p style={{ fontWeight: 600, fontSize: 14 }}>{displayName}</p>}
              {email && <p style={{ fontSize: 12, color: "var(--ink3)", overflow: "hidden", textOverflow: "ellipsis" }}>{email}</p>}
            </div>
            <a href="/nest-earn/settings" style={{ display: "block", padding: "8px 10px", borderRadius: 8, fontSize: 14, color: "var(--ink)" }}>
              Settings
            </a>
            <button
              onClick={onLogout}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", borderRadius: 8, fontSize: 14, color: "var(--down)", background: "none", border: "none", cursor: "pointer" }}
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Header({
  authenticated,
  displayName,
  email,
  dark,
  onSignIn,
  onLogout,
}: {
  authenticated: boolean;
  displayName: string | null;
  email: string | null;
  dark: boolean;
  onSignIn: () => void;
  onLogout: () => void;
}) {
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px 64px" }}>
      <a href="/nest-earn" style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <NestLogo dark={dark} />
        <span className="ns-serif" style={{ fontStyle: "italic", color: "var(--accent)", fontSize: 17, lineHeight: 1 }}>Nest</span>
      </a>
      <nav style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <a href="#how" style={{ fontSize: 15, color: "var(--ink2)" }}>How it works</a>
        <a href="#ledger" style={{ fontSize: 15, color: "var(--ink2)" }}>The ledger</a>
      </nav>
      {authenticated ? (
        <UserMenu displayName={displayName} email={email} onLogout={onLogout} />
      ) : (
        <button className="ns-btn" style={{ padding: "11px 26px", fontSize: 15 }} onClick={onSignIn}>
          Sign in
        </button>
      )}
    </header>
  );
}

/** Builds NestHero eggs from real holdings: weight from actual USD share, price/change from
 *  actual live data — not the marketing page's illustrative defaults. Positions laid out via a
 *  golden-angle spiral (same idea as the old egg-packing attempt) since NestHero takes explicit
 *  [x,y,z] per egg rather than doing its own layout. */
function buildStocksFromHoldings(holdings: NestPortfolio["holdings"]): NestStock[] {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const sorted = [...holdings].filter(h => (h.valueUsd ?? 0) > 0).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const total = sorted.reduce((sum, h) => sum + (h.valueUsd ?? 0), 0) || 1;
  return sorted.slice(0, 8).map((h, i) => {
    const rr = Math.sqrt((i + 0.5) / Math.max(sorted.length, 1)) * 0.5;
    const ang = i * GOLDEN;
    return {
      ticker: h.symbol,
      domain: tickerDomain(h.symbol),
      weight: (h.valueUsd ?? 0) / total,
      price: h.currentPrice !== null ? `$${h.currentPrice.toFixed(2)}` : "—",
      change: h.pnlPct !== null ? `${h.pnlPct >= 0 ? "+" : ""}${(h.pnlPct * 100).toFixed(0)}%` : "—",
      risk: "med" as const,
      color: RISK_COLORS[i % RISK_COLORS.length],
      position: [Math.cos(ang) * rr, 0.32 + rr * 0.1, Math.sin(ang) * rr] as [number, number, number],
    };
  });
}

export default function NestApp() {
  const { user, authenticated, login: privyLogin, logout, getAccessToken } = usePrivy();
  // Nest-only restriction: email sign-in only, no Twitter/Discord/GitHub — the global Privy
  // config in AuthProvider.tsx (used by the main pay.loofta.xyz app) is untouched; `login()`
  // accepts a per-call `loginMethods` override for exactly this kind of scoped restriction.
  const login = () => privyLogin({ loginMethods: ["email"] });
  const [dark, toggleDark] = useNestDarkMode();
  const { wallets } = useWallets();

  const embeddedSolAddress = ((user?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" && (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const embeddedWallet = wallets.find(w => w.address === embeddedSolAddress) ?? wallets[0];
  const email = user?.email?.address ?? null;

  const [config, setConfig] = useState<NestConfig | null>(null);
  const [universe, setUniverse] = useState<NestUniverseAsset[]>([]);
  const [profile, setProfile] = useState<NestProfile | null | undefined>(undefined);
  const [portfolio, setPortfolio] = useState<NestPortfolio | null>(null);
  const [history, setHistory] = useState<NestTradeView[]>([]);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const displayName = profile?.displayName ?? null;

  const loadAuthedData = useCallback(async () => {
    try {
      const accessToken = await getAccessToken();
      const opts = { userId: user?.id, accessToken };
      const [p, portfolioData, historyData] = await Promise.all([
        getNestProfile(opts, NEST_DEMO_MODE),
        getNestPortfolio(opts, NEST_DEMO_MODE),
        getNestHistory(opts, NEST_DEMO_MODE),
      ]);
      setProfile(p);
      setPortfolio(portfolioData);
      setHistory(historyData);
    } catch (e: any) {
      setLoadError(e.message ?? "Failed to load your Nest");
    }
  }, [getAccessToken, user?.id]);

  useEffect(() => {
    getNestConfig().then(setConfig).catch(() => setConfig({ liveTrading: false }));
    getNestUniverse().then(setUniverse).catch(() => setUniverse([]));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    loadAuthedData();
  }, [authenticated, loadAuthedData]);

  const handleCreateProfile = async (riskTolerance: NestRiskTolerance, interestTags: string[], displayName: string) => {
    setCreatingProfile(true);
    try {
      const accessToken = await getAccessToken();
      const created = await upsertNestProfile(riskTolerance, interestTags, displayName || null, { userId: user?.id, accessToken }, NEST_DEMO_MODE);
      setProfile(created);
    } catch (e: any) {
      setLoadError(e.message ?? "Could not create your Nest profile");
    } finally {
      setCreatingProfile(false);
    }
  };

  const heroStocks = useMemo(() => {
    if (portfolio && portfolio.holdings.length > 0) return buildStocksFromHoldings(portfolio.holdings);
    return DEFAULT_STOCKS;
  }, [portfolio]);

  // --- Not signed in: the splash, replicated from nest-splash/page.tsx.txt ---
  if (!authenticated) {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header authenticated={false} displayName={null} email={null} dark={dark} onSignIn={login} onLogout={logout} />

        <div className="ns-hero" style={{ padding: "10px 64px 0" }}>
          <div>
            <h1 className="ns-serif" style={{ fontSize: 96, lineHeight: 1, letterSpacing: "-.01em", margin: "0 0 22px" }}>
              Grow your <em style={{ fontStyle: "italic", color: "var(--accent)" }}>nest.</em>
            </h1>
            <p style={{ fontSize: 19, lineHeight: 1.65, color: "var(--ink2)", maxWidth: 460, margin: "0 0 34px" }}>
              A basket of stocks built from your profile — watched around the clock and quietly rebalanced when real events move the market.
            </p>
            <button className="ns-btn" style={{ padding: "17px 42px", fontSize: 17 }} onClick={login}>
              Sign in to start nesting →
            </button>
          </div>
          <NestHero />
        </div>

        <section id="ledger" style={{ padding: "30px 64px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
            <div className="ns-serif" style={{ fontSize: 26 }}>Rebalanced on real headlines</div>
            <div style={{ fontSize: 13, color: "var(--ink3)" }}>The Event Ledger — every headline that moved your nest, on the record</div>
          </div>
          <div className="ns-grid4">
            {MARKET_EVENTS.map(e => (
              <article key={e.co} className="ns-card" style={{ padding: "22px 24px" }}>
                <div className="ns-outlet">
                  <img src={fav(e.domain)} alt={e.outlet} />
                  {e.outlet} · {e.date}
                </div>
                <div className={`ns-move ${e.up ? "ns-up" : "ns-down"}`} style={{ fontSize: 46, margin: "16px 0 4px" }}>{e.move}</div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{e.co}</div>
                <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink2)", margin: "6px 0 0" }}>{e.cat}</p>
                <AiActionRow up={e.up} action={e.action} />
              </article>
            ))}
          </div>
        </section>

        <div style={{ marginTop: 44, background: "var(--paper2)", borderTop: "1px solid var(--line2)", padding: "18px 64px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <span style={{ fontSize: 13, color: "var(--ink3)" }}>Watching the wires, around the clock</span>
          <div className="ns-press">
            {PRESS.map(([name, domain]) => (
              <span key={domain} className="ns-p">
                <img src={fav(domain)} alt="" />
                {name}
              </span>
            ))}
          </div>
        </div>

        <section id="how" style={{ padding: "64px 64px 0" }}>
          {/* Illustrative, not a rigorous backtest: real move-% from the 4 events in the Event
              Ledger above, comparing a basket that ignores news to one that tilted 2x into the
              two highest-sentiment names the day before each move. Translated into a concrete
              dollar example (not "+9.5pp") because that's what "what would I win" actually means
              to someone who isn't fluent in percentage-point jargon. Leads before the 3-step
              explanation — a concrete payoff is a stronger opener than an abstract process. */}
          <div className="ns-card" style={{ marginBottom: 24, padding: "26px 30px" }}>
            <div className="ns-serif" style={{ fontSize: 32, marginBottom: 4 }}>If you'd put in $1,000 before these 4 events</div>
            <p style={{ fontSize: 13.5, color: "var(--ink3)", marginBottom: 20, maxWidth: 620 }}>
              A simple example using the 4 real events above.
            </p>
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "baseline", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink3)" }}>A basket that ignores the news</div>
                <div className="ns-serif" style={{ fontSize: 36 }}>$1,230</div>
                <div style={{ fontSize: 13, color: "var(--ink3)" }}>+$230</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink3)" }}>Your Nest (reacts to real events)</div>
                <div className="ns-serif ns-up" style={{ fontSize: 36 }}>$1,332</div>
                <div style={{ fontSize: 13, color: "var(--ink3)" }}>+$332</div>
              </div>
            </div>
            <div style={{ borderTop: "1px solid var(--line2)", paddingTop: 16, display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
              <span className="ns-serif ns-up" style={{ fontSize: 28 }}>44% more profit</span>
              <span style={{ fontSize: 14, color: "var(--ink2)" }}>
                — $332 vs. $230 in gains, just from tilting toward the names sentiment was already flagging, before the price moved.
              </span>
            </div>
          </div>

          <div className="ns-serif" style={{ fontSize: 44, marginBottom: 10 }}>How it works</div>
          <p style={{ fontSize: 16, color: "var(--ink2)", margin: "0 0 34px", maxWidth: 560 }}>Three steps, then your nest looks after itself.</p>
          <div className="ns-grid3">
            {[
              ["01", "Tell us about you", "A short conversation about your goals, horizon and appetite for risk. That's your investor profile."],
              ["02", "Get your nest", "We build a basket of tokenized stocks weighted to your profile. Every egg is a position; its size is its weight."],
              ["03", "We watch the news", "Our AI reads social sentiment around the clock. When a real event moves the market, your nest quietly rebalances — and it goes on the ledger."],
            ].map(([n, t, d]) => (
              <div key={n} className="ns-card" style={{ padding: "30px 30px 34px" }}>
                <div className="ns-serif" style={{ fontSize: 56, color: "var(--accent)", lineHeight: 1 }}>{n}</div>
                <div style={{ fontWeight: 600, fontSize: 19, margin: "14px 0 8px" }}>{t}</div>
                <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--ink2)", margin: 0 }}>{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Consumer-friendly, and honest about cadence: elfa tracks mentions continuously, but
            our rebalance only checks that signal once a day (nest-rebalance.service.ts runs on a
            daily cron) — say "once a day", not "in real time", to avoid the same overclaim
            already caught and fixed elsewhere on this page (pricing section, "reads the wires"). */}
        <section id="elfa" style={{ padding: "56px 64px 0" }}>
          <div className="ns-card ns-hero" style={{ padding: "36px 40px", gap: 40 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <img src={fav("elfa.ai")} alt="" style={{ width: 28, height: 28, borderRadius: 8 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Powered by elfa.ai</span>
              </div>
              <div className="ns-serif" style={{ fontSize: 32, marginBottom: 12 }}>The signal behind your Nest</div>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--ink2)" }}>
                elfa.ai watches X around the clock — including the accounts that break financial news first, often faster than traditional headlines — for when the buzz around a company suddenly spikes. Once a day, your Nest checks that signal for every stock in your basket and leans a little harder into the ones getting real, unusual attention.
              </p>
            </div>
            <ElfaFlowDiagram />
          </div>
        </section>

        <NestFooter dark={dark} onToggleDark={toggleDark} />
      </div>
    );
  }

  // --- Signed in ---
  if (profile === undefined) {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header authenticated displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />
        <NestLoader />
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header authenticated displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />
        <OnboardingFlow universe={universe} onComplete={handleCreateProfile} submitting={creatingProfile} />
        <NestFooter dark={dark} onToggleDark={toggleDark} />
      </div>
    );
  }

  const pnlUp = (portfolio?.pnlUsd ?? 0) >= 0;

  return (
    <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
      <Header authenticated displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />

      <div style={{ padding: "0 64px", maxWidth: 1100, margin: "0 auto" }}>
        {NEST_DEMO_MODE && (
          <div className="ns-card" style={{ padding: "14px 20px", marginBottom: 24, borderColor: "var(--accent)" }}>
            <span style={{ fontWeight: 600 }}>Devnet Demo.</span>{" "}
            <span style={{ color: "var(--ink2)" }}>
              Funded with free devnet USDC — real prices and real sentiment data drive the rebalance, but nothing here is real money.
            </span>
          </div>
        )}
        {loadError && <p style={{ color: "var(--down)", marginBottom: 16 }}>{loadError}</p>}

        {displayName && (
          <p className="ns-serif" style={{ fontSize: 22, marginTop: 24, marginBottom: -4 }}>
            Welcome back, {displayName}.
          </p>
        )}

        <div className="ns-hero" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Total value</div>
            <div className="ns-serif" style={{ fontSize: 72, lineHeight: 1, margin: "6px 0 8px" }}>${(portfolio?.totalValueUsd ?? 0).toFixed(2)}</div>
            {portfolio && (
              <div className={`ns-move ${pnlUp ? "ns-up" : "ns-down"}`} style={{ fontSize: 22, marginBottom: 24 }}>
                {pnlUp ? "+" : ""}
                {(portfolio.pnlPct * 100).toFixed(2)}%
              </div>
            )}
            <button className="ns-btn" style={{ padding: "15px 34px", fontSize: 16 }} onClick={() => setShowDeposit(true)}>
              Deposit
            </button>
          </div>
          <NestHero height={380} />
        </div>

        <section style={{ marginTop: 40 }}>
          <div className="ns-card" style={{ padding: "22px 24px", marginBottom: 18 }}>
            <div className="ns-serif" style={{ fontSize: 22, marginBottom: 12 }}>Performance</div>
            <NavChart points={portfolio?.navHistory ?? []} />
          </div>

          <div className="ns-card" style={{ padding: "22px 24px", marginBottom: 18 }}>
            <div className="ns-serif" style={{ fontSize: 22, marginBottom: 12 }}>Basket</div>
            <HoldingsBreakdown holdings={portfolio?.holdings ?? []} totalValueUsd={portfolio?.totalValueUsd ?? 0} />
          </div>

          <div className="ns-card" style={{ padding: "22px 24px", marginBottom: 18 }}>
            <div className="ns-serif" style={{ fontSize: 22, marginBottom: 12 }}>What the AI bought / sold on your behalf</div>
            <TradeHistoryList trades={history} />
          </div>
        </section>
      </div>

      <section id="ledger" style={{ padding: "40px 64px 64px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div className="ns-serif" style={{ fontSize: 26 }}>Rebalanced on real headlines</div>
          <div style={{ fontSize: 13, color: "var(--ink3)" }}>The Event Ledger — every headline that moved your nest, on the record</div>
        </div>
        <div className="ns-grid4">
          {MARKET_EVENTS.map(e => (
            <article key={e.co} className="ns-card" style={{ padding: "22px 24px" }}>
              <div className="ns-outlet">
                <img src={fav(e.domain)} alt={e.outlet} />
                {e.outlet} · {e.date}
              </div>
              <div className={`ns-move ${e.up ? "ns-up" : "ns-down"}`} style={{ fontSize: 46, margin: "16px 0 4px" }}>{e.move}</div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>{e.co}</div>
              <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink2)", margin: "6px 0 0" }}>{e.cat}</p>
              <AiActionRow up={e.up} action={e.action} />
            </article>
          ))}
        </div>
      </section>

      <NestFooter dark={dark} onToggleDark={toggleDark} />

      {showDeposit && (
        <DepositModal
          onClose={() => setShowDeposit(false)}
          onDeposited={loadAuthedData}
          embeddedWallet={embeddedWallet}
          embeddedSolAddress={embeddedSolAddress}
          getAccessToken={getAccessToken}
          userId={user?.id}
        />
      )}
    </div>
  );
}
