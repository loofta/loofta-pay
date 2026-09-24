"use client";

// "Loofta Nest" — auto-invest robo-portfolio, restyled onto the nest-splash design kit (see
// /nest-splash at the repo root: README.md, NestHero.tsx.txt, page.tsx.txt, nest-splash.css) —
// replicated as closely as the kit's static splash allows, then extended with the same tokens
// (ns-root/.ns-card/.ns-btn/.ns-serif, warm "paper" palette) into the authenticated onboarding
// and dashboard views, which the kit itself doesn't cover (it's a marketing splash only). Profile
// (risk tolerance + interests) drives a daily server-side rebalance across a curated xStocks
// basket, equal-weighted across the tag-filtered universe — see apps/backend/src/modules/nest/*.
// (2026-09-21: previously tilted by an elfa.ai social-sentiment signal; backtested against real
// data, that tilt lost to plain equal-weight and showed no statistical edge, so it was dropped
// from the live allocator. Elfa data is still shown as context around holdings, not used to size
// trades — see nest-rebalance.service.ts and scripts/nest-backtest/RESULTS.md.)
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, TrendingDown, MessageCircle, Zap, PieChart, Menu, X } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { useAuth } from "@/hooks/useAuth";
import dynamic from "next/dynamic";
import {
  getNestConfig,
  getNestUniverse,
  getNestBacktest,
  type NestBacktestSummary,
  getNestProfile,
  upsertNestProfile,
  getNestPortfolio,
  getNestHistory,
  getNestLedger,
  getNestDeposits,
  getNestStreak,
  getNestRoundups,
  sweepNestRoundups,
  getNestFlock,
  setNestFlockPublic,
  followNest,
  unfollowNest,
  sendNestKudos,
  getNestSuggestions,
  acceptNestSuggestion,
  dismissNestSuggestion,
  runNestSuggestionScan,
  getPredictionsForHoldings,
  getPreIpoBasket,
  getNestBets,
  placeNestBet,
  cancelNestBet,
  type NestDepositView,
  type NestStreak,
  type NestRoundups,
  type NestFlock,
  type NestConfig,
  type NestUniverseAsset,
  type NestProfile,
  type NestPortfolio,
  type NestTradeView,
  type NestLedgerEvent,
  type NestRiskTolerance,
  type NestSuggestion,
  type PredictionMarket,
  type PreIpoBasket as PreIpoBasketData,
  type NestPredictionBet,
} from "@/services/api/nest";
import { OnboardingFlow, TAG_LABELS, RISK_PERSONA } from "@/components/nest/OnboardingFlow";
import { NavChart } from "@/components/nest/NavChart";
import { HoldingsBreakdown } from "@/components/nest/HoldingsBreakdown";
import { TradeHistoryList } from "@/components/nest/TradeHistoryList";
import { MARKET_EVENTS, PRESS, fav } from "@/components/nest/marketEvents";
import { tickerDomain } from "@/components/nest/tickerDomains";
import { DEFAULT_STOCKS, type NestStock } from "@/components/nest/NestHero";
import { packEggPositions } from "@/components/nest/nestEggPacking";
import { NestLogo } from "@/components/nest/NestLogo";
import { useNestDarkMode, nestRootClass } from "@/components/nest/useNestDarkMode";
import { NestFooter } from "@/components/nest/NestFooter";
import { NestLoader } from "@/components/nest/NestLoader";
import { NestBuildingAnimation } from "@/components/nest/NestBuildingAnimation";
import { CategoryRing } from "@/components/nest/CategoryRing";
import { WhatMovedCard } from "@/components/nest/WhatMovedCard";
import { NestGoalProgress } from "@/components/nest/NestGoalProgress";
import { NestLessons } from "@/components/nest/NestLessons";
import { NestJournal, nestLevel } from "@/components/nest/NestJournal";
import { CrumbsCard } from "@/components/nest/CrumbsCard";
import { humanizeReason } from "@/components/nest/nestCopy";
import { ProjectionCard } from "@/components/nest/ProjectionCard";
import { FlockPanel } from "@/components/nest/FlockPanel";
import { SuggestionCard } from "@/components/nest/SuggestionCard";
import { PredictionMarketsCard } from "@/components/nest/PredictionMarketsCard";
import { PreIpoBasket } from "@/components/nest/PreIpoBasket";

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
/** Visual for "what the attention signal is actually for" — a simple 3-node vertical pipeline (X
 *  posts → your Nest tracks the buzz → shown as context, not a trading trigger) rather than a
 *  chart, since a mention-count chart would need the viewer to already understand z-scores to
 *  read it. Deliberately does NOT end on "so we buy more" — we backtested that and it lost to
 *  just holding an equal-weighted basket (see RESULTS.md); this signal is monitoring only now. */
function ElfaFlowDiagram() {
  const steps: Array<{ icon: typeof MessageCircle; label: string; sub: string }> = [
    { icon: MessageCircle, label: "Millions of posts on X", sub: "Every account, every day" },
    { icon: Zap, label: "Your Nest tracks the buzz", sub: "Unusual attention, before the headlines" },
    { icon: PieChart, label: "Shown next to your holdings", sub: "Context on what's moving — not a reason to buy more" },
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

/** "What the engine did", not "AI action" — the allocator is deterministic equal-weight
 *  rebalancing (nest-rebalance.service.ts), and calling that an AI decision oversells it. */
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
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--ink3)" }}>What the engine did</div>
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

/** `variant="home"` is the marketing page (How it works / The ledger anchors); `variant="app"`
 *  is the signed-in nest at /nest-earn/app — no marketing links, logo goes back to the app. */
function Header({
  variant,
  authenticated,
  authKnown,
  displayName,
  email,
  dark,
  onSignIn,
  onLogout,
}: {
  variant: "home" | "app";
  authenticated: boolean;
  // False for the first client render (before the mount effect below flips it) — `authenticated`
  // itself can't be trusted to paint yet at that point (see the `mounted` comment in NestApp),
  // so every authed/unauthed decision here waits on this instead of just `authenticated`.
  authKnown: boolean;
  displayName: string | null;
  email: string | null;
  dark: boolean;
  onSignIn: () => void;
  onLogout: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);
  const home = variant === "home";
  const logoHref = home ? "/nest-earn" : "/nest-earn/app";

  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "28px var(--page-pad)" }}>
      <a href={logoHref} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
        <NestLogo dark={dark} />
        <span className="ns-serif" style={{ fontStyle: "italic", color: "var(--accent)", fontSize: 17, lineHeight: 1 }}>Nest</span>
      </a>
      <nav className="ns-nav-desktop">
        {home ? (
          <>
            <a href="#how" style={{ fontSize: 15, color: "var(--ink2)" }}>How it works</a>
            <a href="#ledger" style={{ fontSize: 15, color: "var(--ink2)" }}>The ledger</a>
          </>
        ) : (
          <a href="/nest-earn" style={{ fontSize: 15, color: "var(--ink2)" }}>Home</a>
        )}
      </nav>
      <div className="ns-header-actions">
        {authKnown && home && authenticated && (
          <button
            className="ns-btn"
            style={{ padding: "11px 26px", fontSize: 15 }}
            onClick={() => { window.location.href = "/nest-earn/app"; }}
          >
            Open my nest →
          </button>
        )}
        {!authKnown ? (
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--line2)" }} />
        ) : authenticated ? (
          <UserMenu displayName={displayName} email={email} onLogout={onLogout} />
        ) : (
          <button className="ns-btn" style={{ padding: "11px 26px", fontSize: 15 }} onClick={onSignIn}>
            Sign in
          </button>
        )}
        <button className="ns-burger" aria-label="Menu" onClick={() => setMobileOpen(true)}>
          <Menu size={26} />
        </button>
      </div>

      {mobileOpen && (
        <div className="ns-mobile-menu">
          <div className="ns-mobile-menu-head">
            <a href={logoHref} style={{ display: "flex", alignItems: "flex-start", gap: 6 }} onClick={closeMobile}>
              <NestLogo dark={dark} />
              <span className="ns-serif" style={{ fontStyle: "italic", color: "var(--accent)", fontSize: 17, lineHeight: 1 }}>Nest</span>
            </a>
            <button aria-label="Close menu" onClick={closeMobile} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink)", padding: 8, margin: -8 }}>
              <X size={26} />
            </button>
          </div>
          <nav>
            {home ? (
              <>
                <a href="#how" onClick={closeMobile}>How it works</a>
                <a href="#ledger" onClick={closeMobile}>The ledger</a>
                {authenticated && <a href="/nest-earn/app" onClick={closeMobile}>Open my nest →</a>}
              </>
            ) : (
              <a href="/nest-earn" onClick={closeMobile}>Home</a>
            )}
            {authenticated && <a href="/nest-earn/settings" onClick={closeMobile}>Settings</a>}
          </nav>
          {authenticated ? (
            <button
              className="ns-btn"
              style={{ background: "transparent", color: "var(--down)", border: "1px solid var(--line)", boxShadow: "none" }}
              onClick={() => {
                closeMobile();
                onLogout();
              }}
            >
              Log out
            </button>
          ) : (
            <button
              className="ns-btn"
              onClick={() => {
                closeMobile();
                onSignIn();
              }}
            >
              Sign in
            </button>
          )}
        </div>
      )}
    </header>
  );
}

/** Builds NestHero eggs from real holdings: weight from actual USD share, price/change from
 *  actual live data — not the marketing page's illustrative defaults. Positions come from
 *  packEggPositions (same packer as the homepage's DEFAULT_STOCKS) so real holdings can't
 *  collide either — a golden-angle spiral used to place these at a fixed radius regardless of
 *  each egg's actual (weight-driven) size, which overlapped for anything but evenly-weighted
 *  baskets. */
function buildStocksFromHoldings(holdings: NestPortfolio["holdings"]): NestStock[] {
  const sorted = [...holdings].filter(h => (h.valueUsd ?? 0) > 0).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)).slice(0, 8);
  const total = sorted.reduce((sum, h) => sum + (h.valueUsd ?? 0), 0) || 1;
  const weights = sorted.map(h => (h.valueUsd ?? 0) / total);
  const positions = packEggPositions(weights);
  return sorted.map((h, i) => {
    return {
      ticker: h.symbol,
      domain: tickerDomain(h.symbol),
      weight: weights[i],
      price: h.currentPrice !== null ? `$${h.currentPrice.toFixed(2)}` : "—",
      change: h.pnlPct !== null ? `${h.pnlPct >= 0 ? "+" : ""}${(h.pnlPct * 100).toFixed(0)}%` : "—",
      risk: "med" as const,
      color: RISK_COLORS[i % RISK_COLORS.length],
      position: positions[i],
    };
  });
}

/** `mode="home"` (/nest-earn): the marketing splash, for everyone — signed-in users get an
 *  "Open my nest" link and are sent to the app right after signing in here. `mode="app"`
 *  (/nest-earn/app): the nest itself — onboarding, dashboard, tabs. */
export default function NestApp({ mode = "app" }: { mode?: "home" | "app" }) {
  const { user } = usePrivy();
  // useAuth() (not usePrivy() directly) — it serves `authenticated` from the persisted
  // loofta.auth.v1 zustand store while Privy is still initializing on reload, so this page (and
  // the header CTA) render the signed-in state immediately instead of flashing "Sign in" /
  // "Start nesting" for the beat before Privy rehydrates. Same cache the main pay.loofta.xyz app
  // uses — one Privy session, one cache, valid across both surfaces. `ready` (real Privy
  // readiness, not the cached guess) still gates loadAuthedData below.
  const { ready, authenticated, login: privyLogin, logout, getAccessToken } = useAuth();
  // The cached `authenticated` above still can't paint on the very first render: this page is
  // server-rendered with no localStorage, so React requires that first client render to match
  // the server's (logged-out) output or it throws a hydration-mismatch away. The cached value
  // only becomes safe to show once we're past that first paint — flip `mounted` true in an
  // effect (fires right after mount, before the user can really perceive it) and gate every
  // authed/unauthed branch on it so nobody sees a confidently-wrong "Start nesting"/"Sign in"
  // painted from the SSR default before flipping to the real state.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Nest-only restriction: email sign-in only, no Twitter/Discord/GitHub — the global Privy
  // config in AuthProvider.tsx (used by the main pay.loofta.xyz app) is untouched; `login()`
  // accepts a per-call `loginMethods` override for exactly this kind of scoped restriction.
  const loginStartedHere = useRef(false);
  const login = () => {
    loginStartedHere.current = true;
    privyLogin({ loginMethods: ["email"] });
  };
  // Signing in from the home page lands you in the app, not on the same marketing page.
  useEffect(() => {
    if (mode === "home" && authenticated && loginStartedHere.current) window.location.assign("/nest-earn/app");
  }, [mode, authenticated]);
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
  const [ledger, setLedger] = useState<NestLedgerEvent[]>([]);
  const [deposits, setDeposits] = useState<NestDepositView[]>([]);
  const [streak, setStreak] = useState<NestStreak | null>(null);
  const [roundups, setRoundups] = useState<NestRoundups | null>(null);
  const [flock, setFlock] = useState<NestFlock | null>(null);
  const [suggestions, setSuggestions] = useState<NestSuggestion[]>([]);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [predictionMarkets, setPredictionMarkets] = useState<PredictionMarket[]>([]);
  const [predictionBets, setPredictionBets] = useState<NestPredictionBet[]>([]);
  const [preIpo, setPreIpo] = useState<PreIpoBasketData | null>(null);
  const [flockBusy, setFlockBusy] = useState(false);
  // Set when the deposit modal was opened from the crumbs card, so the pending crumbs are marked
  // as fed once that specific deposit confirms (and not after an unrelated deposit).
  const [crumbsDeposit, setCrumbsDeposit] = useState<number | null>(null);
  const [tab, setTab] = useState<"overview" | "portfolio" | "history" | "news" | "markets" | "flock">("overview");
  const [showLevelHint, setShowLevelHint] = useState(false);
  const [backtest, setBacktest] = useState<NestBacktestSummary | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [showDeposit, setShowDeposit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Right after onboarding: prompt for a deposit before dropping into the (still-empty)
  // dashboard, then play the basket-building animation once that first deposit lands.
  const [postOnboarding, setPostOnboarding] = useState<"deposit" | "building" | null>(null);
  const displayName = profile?.displayName ?? null;

  const loadAuthedData = useCallback(async () => {
    try {
      const accessToken = await getAccessToken();
      const opts = { userId: user?.id, accessToken };
      const [p, portfolioData, historyData, ledgerData, depositsData, streakData] = await Promise.all([
        getNestProfile(opts, NEST_DEMO_MODE),
        getNestPortfolio(opts, NEST_DEMO_MODE),
        getNestHistory(opts, NEST_DEMO_MODE),
        getNestLedger(opts, NEST_DEMO_MODE),
        getNestDeposits(opts, NEST_DEMO_MODE).catch(() => [] as NestDepositView[]),
        getNestStreak(opts, NEST_DEMO_MODE).catch(() => null),
      ]);
      setProfile(p);
      setPortfolio(portfolioData);
      setHistory(historyData);
      setLedger(ledgerData);
      setDeposits(depositsData);
      setStreak(streakData);
      // Social bits are non-critical: never let them block or fail the main load.
      getNestRoundups(opts, NEST_DEMO_MODE).then(setRoundups).catch(() => setRoundups(null));
      getNestFlock(opts, NEST_DEMO_MODE).then(setFlock).catch(() => setFlock(null));
      getNestSuggestions(opts, NEST_DEMO_MODE).then(setSuggestions).catch(() => setSuggestions([]));
      getPredictionsForHoldings(opts, NEST_DEMO_MODE).then(setPredictionMarkets).catch(() => setPredictionMarkets([]));
      getNestBets(opts, NEST_DEMO_MODE).then(setPredictionBets).catch(() => setPredictionBets([]));
      getPreIpoBasket().then(setPreIpo);
    } catch (e: any) {
      setLoadError(e.message ?? "Failed to load your Nest");
    }
  }, [getAccessToken, user?.id]);

  const refreshSuggestions = useCallback(async () => {
    const opts = { userId: user?.id, accessToken: await getAccessToken() };
    const fresh = await getNestSuggestions(opts, NEST_DEMO_MODE).catch(() => [] as NestSuggestion[]);
    setSuggestions(fresh);
  }, [getAccessToken, user?.id]);

  // Optimistic: the card goes the instant it's tapped, because from the user's side the decision
  // is already made — waiting on a round-trip behind a "Working…" spinner makes a deliberate
  // choice feel like it might not have registered. The request runs behind it; if it actually
  // fails the list is refetched (so state is truthful, not guessed) and the reason surfaces in a
  // banner where it's still visible after the card is gone.
  // Optimistic like the suggestion cards: the position appears the moment a side is tapped. The
  // server is authoritative on price (it reads the live market), so the real row replaces this
  // one on response; a failure rolls back to whatever the server says is actually there.
  const handlePlaceBet = useCallback(
    async (market: PredictionMarket, side: "yes" | "no", stakeUsd: number) => {
      const opts = { userId: user?.id, accessToken: await getAccessToken() };
      try {
        const saved = await placeNestBet(market.id, side, stakeUsd, market.symbol, opts, NEST_DEMO_MODE);
        setPredictionBets(prev => [saved, ...prev.filter(b => b.id !== saved.id)]);
      } catch {
        const fresh = await getNestBets(opts, NEST_DEMO_MODE).catch(() => [] as NestPredictionBet[]);
        setPredictionBets(fresh);
      }
    },
    [getAccessToken, user?.id],
  );

  const handleCancelBet = useCallback(
    async (betId: string) => {
      const opts = { userId: user?.id, accessToken: await getAccessToken() };
      setPredictionBets(prev => prev.filter(b => b.id !== betId));
      try {
        await cancelNestBet(betId, opts, NEST_DEMO_MODE);
      } catch {
        const fresh = await getNestBets(opts, NEST_DEMO_MODE).catch(() => [] as NestPredictionBet[]);
        setPredictionBets(fresh);
      }
    },
    [getAccessToken, user?.id],
  );

  const runSuggestionAction = useCallback(
    async (id: string, run: (opts: { userId?: string; accessToken: string | null }) => Promise<unknown>, onDone?: () => void) => {
      setSuggestionError(null);
      setSuggestions(prev => prev.filter(s => s.id !== id));
      try {
        const opts = { userId: user?.id, accessToken: await getAccessToken() };
        await run(opts);
        onDone?.();
      } catch (e: any) {
        await refreshSuggestions();
        setSuggestionError(e?.message ?? "That didn't go through — nothing was changed.");
      }
    },
    [getAccessToken, user?.id, refreshSuggestions],
  );

  const handleAcceptSuggestion = useCallback(
    (id: string) => runSuggestionAction(id, opts => acceptNestSuggestion(id, opts, NEST_DEMO_MODE), () => loadAuthedData()),
    [runSuggestionAction, loadAuthedData],
  );

  const handleDismissSuggestion = useCallback(
    (id: string) => runSuggestionAction(id, opts => dismissNestSuggestion(id, opts, NEST_DEMO_MODE)),
    [runSuggestionAction],
  );

  const [scanning, setScanning] = useState(false);
  const handleScanNow = useCallback(async () => {
    setScanning(true);
    try {
      const opts = { userId: user?.id, accessToken: await getAccessToken() };
      await runNestSuggestionScan(opts);
      const fresh = await getNestSuggestions(opts, NEST_DEMO_MODE);
      setSuggestions(fresh);
    } finally {
      setScanning(false);
    }
  }, [getAccessToken, user?.id]);

  useEffect(() => {
    getNestConfig().then(setConfig).catch(() => setConfig({ liveTrading: false }));
    getNestUniverse().then(setUniverse).catch(() => setUniverse([]));
    getNestBacktest().then(setBacktest);
  }, []);

  useEffect(() => {
    // Gated on real Privy `ready`, not the cached `authenticated` guess: getAccessToken() isn't
    // reliable before Privy actually initializes, so firing this on the optimistic value alone
    // would 401 and surface a false "Failed to load your Nest" right after a reload.
    if (!ready || !authenticated) return;
    loadAuthedData();
  }, [ready, authenticated, loadAuthedData]);

  const handleCreateProfile = async (riskTolerance: NestRiskTolerance, interestTags: string[], displayName: string, wantsPreIpo: boolean) => {
    setCreatingProfile(true);
    try {
      const accessToken = await getAccessToken();
      const created = await upsertNestProfile(riskTolerance, interestTags, displayName || null, { userId: user?.id, accessToken }, NEST_DEMO_MODE);
      setProfile(created);
      if (wantsPreIpo) setTab("markets");
      setPostOnboarding("deposit");
    } catch (e: any) {
      setLoadError(e.message ?? "Could not create your Nest profile");
    } finally {
      setCreatingProfile(false);
    }
  };

  const handleDeposited = () => {
    if (crumbsDeposit !== null) {
      setCrumbsDeposit(null);
      getAccessToken()
        .then(accessToken => sweepNestRoundups({ userId: user?.id, accessToken }, NEST_DEMO_MODE))
        .then(setRoundups)
        .catch(() => {});
    }
    loadAuthedData();
    if (postOnboarding === "deposit") setPostOnboarding("building");
  };

  const flockAction = async (fn: (accessToken: string | null) => Promise<unknown>): Promise<string | null> => {
    setFlockBusy(true);
    try {
      const accessToken = await getAccessToken();
      await fn(accessToken);
      setFlock(await getNestFlock({ userId: user?.id, accessToken }, NEST_DEMO_MODE));
      return null;
    } catch (e: any) {
      return e?.message ?? "Something went wrong";
    } finally {
      setFlockBusy(false);
    }
  };

  const heroStocks = useMemo(() => {
    if (portfolio && portfolio.holdings.length > 0) return buildStocksFromHoldings(portfolio.holdings);
    return DEFAULT_STOCKS;
  }, [portfolio]);

  // Basket hasn't been built yet at this point (that only happens on the next rebalance cron),
  // so the building animation previews from the profile's own interest tags instead of real
  // holdings — filtered to the universe, falling back to the full universe if no tags were picked.
  const previewTickers = useMemo(() => {
    const tags = profile?.interestTags ?? [];
    const pool = tags.length > 0 ? universe.filter(u => u.tags.some(t => tags.includes(t))) : universe;
    const source = pool.length > 0 ? pool : universe;
    return source.slice(0, 6).map(u => ({ symbol: u.symbol, domain: tickerDomain(u.symbol) }));
  }, [universe, profile?.interestTags]);

  // Answers the "how did you pick these / how are they weighted" question directly, tying the
  // basket back to the actual onboarding answers (interestTags/riskTolerance) and naming the
  // real mechanism (equal weight, computeTargetWeights in nest-rebalance.service.ts) — rather
  // than leaving the selection logic invisible.
  const basketExplanation = useMemo(() => {
    if (!profile) return null;
    const tags = profile.interestTags.length > 0 ? profile.interestTags.map(t => TAG_LABELS[t] ?? t).join(", ") : "the full universe";
    const persona = RISK_PERSONA[profile.riskTolerance];
    return `Picked from ${tags}, sized for your "${persona}" risk pick — then split evenly across every name, capped so no single pick can dominate the basket. Checked daily and traded back to that even split.`;
  }, [profile]);

  // --- Home (/nest-earn): the splash, replicated from nest-splash/page.tsx.txt — for everyone ---
  if (mode === "home") {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header variant="home" authenticated={authenticated} authKnown={mounted} displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />

        <div className="ns-hero" style={{ padding: "10px var(--page-pad) 0" }}>
          <div>
            <h1 className="ns-serif" style={{ fontSize: 96, lineHeight: 1, letterSpacing: "-.01em", margin: "0 0 22px" }}>
              Grow your <em style={{ fontStyle: "italic", color: "var(--accent)" }}>nest.</em>
            </h1>
            <p style={{ fontSize: 19, lineHeight: 1.65, color: "var(--ink2)", maxWidth: 460, margin: "0 0 34px" }}>
              An equal-weighted basket of stocks built from your profile — checked daily and quietly kept in balance, so no single move takes over your nest.
            </p>
            {!mounted ? (
              // Neutral placeholder until we're past the first client render (see the `mounted`
              // comment above) — never guess "Start nesting" here, since that's exactly the
              // wrong-then-right flash a returning signed-in user was seeing.
              <button className="ns-btn" style={{ padding: "17px 42px", fontSize: 17, opacity: 0.5 }} disabled>
                Loading…
              </button>
            ) : authenticated ? (
              <button
                className="ns-btn"
                style={{ padding: "17px 42px", fontSize: 17 }}
                onClick={() => { window.location.href = "/nest-earn/app"; }}
              >
                Open my nest →
              </button>
            ) : (
              <button className="ns-btn" style={{ padding: "17px 42px", fontSize: 17 }} onClick={login}>
                Start nesting →
              </button>
            )}
          </div>
          <NestHero />
        </div>

        <section id="ledger" style={{ padding: "30px var(--page-pad) 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            <div className="ns-serif" style={{ fontSize: 26 }}>No chasing the news</div>
            <div style={{ fontSize: 13, color: "var(--ink3)" }}>The Event Ledger — real headlines, and what your nest actually did about them</div>
          </div>
          <div className="ns-grid4">
            {MARKET_EVENTS.map(e => (
              <article key={e.co} className="ns-card" style={{ padding: "var(--card-pad)" }}>
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

        <div style={{ marginTop: 44, background: "var(--paper2)", borderTop: "1px solid var(--line2)", padding: "18px var(--page-pad)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
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

        <section id="how" style={{ padding: "var(--section-pad) var(--page-pad) 0" }}>
          {/* Real committed backtest (scripts/nest-backtest/RESULTS.md, 2026-09-21), not a
              fabricated example: 26 weeks, 30 names, equal-weight, after 0.5% round-trip trading
              costs — this is exactly what the live engine runs. We also tested tilting weight
              toward high-attention names; it lost to this number and showed no statistical edge,
              so it isn't what powers the basket. */}
          <div className="ns-card" style={{ marginBottom: 24, padding: "var(--card-pad-lg)" }}>
            <div className="ns-serif" style={{ fontSize: 32, marginBottom: 4 }}>If you'd put in $1,000 on March 20</div>
            <p style={{ fontSize: 13.5, color: "var(--ink3)", marginBottom: 20, maxWidth: 620 }}>
              A real replay of the engine over the following 26 weeks, on 30 names, after trading costs. This is what happened — not a forecast.
            </p>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "var(--ink3)" }}>Your Nest — equal-weighted, rebalanced weekly</div>
              <div className="ns-serif ns-up" style={{ fontSize: 36 }}>$1,186</div>
              <div style={{ fontSize: 13, color: "var(--ink3)" }}>+$186 · worst dip -10.1% along the way</div>
            </div>
            <div style={{ borderTop: "1px solid var(--line2)", paddingTop: 16, fontSize: 14, color: "var(--ink2)", lineHeight: 1.55 }}>
              Look at the 4 events below: Moderna and HPE ran up, so the basket trimmed them back to target instead of chasing; UnitedHealth dropped, so it bought the dip back to target instead of selling into fear. Staying diversified did the work — no news-reaction trading required.
            </div>
          </div>

          <div className="ns-serif" style={{ fontSize: 44, marginBottom: 10 }}>How it works</div>
          <p style={{ fontSize: 16, color: "var(--ink2)", margin: "0 0 34px", maxWidth: 560 }}>Three steps, then your nest looks after itself.</p>
          <div className="ns-grid3">
            {[
              ["01", "Tell us about you", "A short conversation about your goals, horizon and appetite for risk. That's your investor profile."],
              ["02", "Get your nest", "We build a basket of tokenized stocks weighted to your profile. Every egg is a position; its size is its weight."],
              ["03", "We suggest, you decide", "Every day we check each position against its target weight. When a real event moves one a lot, we surface exactly what we'd do — trim the winner, or buy the dip — with the news behind it. You accept it or dismiss it. Nothing trades without you."],
            ].map(([n, t, d]) => (
              <div key={n} className="ns-card" style={{ padding: "var(--card-pad-lg)" }}>
                <div className="ns-serif" style={{ fontSize: 56, color: "var(--accent)", lineHeight: 1 }}>{n}</div>
                <div style={{ fontWeight: 600, fontSize: 19, margin: "14px 0 8px" }}>{t}</div>
                <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--ink2)", margin: 0 }}>{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Honest about what the attention signal is FOR, not just its cadence: we tested tilting
            weight by it (with real X mention data) and it lost to plain equal-weight, statistically
            indistinguishable from noise — see scripts/nest-backtest/RESULTS.md. So it's monitoring
            context now, never phrased as something that changes what's held. */}
        <section id="elfa" style={{ padding: "var(--section-pad) var(--page-pad) 0" }}>
          <div className="ns-card ns-hero" style={{ padding: "var(--card-pad-lg)", gap: "clamp(22px, 5vw, 40px)" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <img src={fav("elfa.ai")} alt="" style={{ width: 28, height: 28, borderRadius: 8 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Context, not a trigger</span>
              </div>
              <div className="ns-serif" style={{ fontSize: 32, marginBottom: 12 }}>Why we watch the buzz</div>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--ink2)" }}>
                Your Nest watches X around the clock — including the accounts that break financial news first — for when the buzz around a company suddenly spikes. We show that next to your holdings so you know what's happening and why. We tested using it to size trades and it didn't hold up against a plain equal-weighted basket, so it doesn't move your money — it just keeps you informed.
              </p>
              <p style={{ fontSize: 12, color: "var(--ink3)", marginTop: 10 }}>X mention data via Elfa.</p>
            </div>
            <ElfaFlowDiagram />
          </div>
        </section>

        <NestFooter dark={dark} onToggleDark={toggleDark} />
      </div>
    );
  }

  // --- App (/nest-earn/app) ---
  if (!mounted) {
    // Same first-render constraint as the home page's hero: don't decide sign-in-vs-dashboard
    // before we're past the mismatch-prone first client render, or a signed-in user reloading
    // this page flashes the "Sign in to open your nest" screen instead of their dashboard.
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header variant="app" authenticated={false} authKnown={false} displayName={null} email={null} dark={dark} onSignIn={login} onLogout={logout} />
        <NestLoader />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header variant="app" authenticated={false} authKnown={mounted} displayName={null} email={null} dark={dark} onSignIn={login} onLogout={logout} />
        <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "40px var(--page-pad)", textAlign: "center" }}>
          <div className="ns-serif" style={{ fontSize: 32 }}>Sign in to open your nest</div>
          <p style={{ fontSize: 15, color: "var(--ink2)", maxWidth: 380 }}>Email only — no passwords, no wallet setup.</p>
          <button className="ns-btn" style={{ padding: "15px 34px", fontSize: 16 }} onClick={login}>Sign in</button>
          <a href="/nest-earn" style={{ fontSize: 13, color: "var(--ink3)" }}>What is Nest?</a>
        </div>
        <NestFooter dark={dark} onToggleDark={toggleDark} />
      </div>
    );
  }

  if (profile === undefined) {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header variant="app" authenticated authKnown={mounted} displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />
        {loadError ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "80px 64px" }}>
            <p style={{ color: "var(--down)" }}>{loadError}</p>
            <button className="ns-btn" style={{ padding: "12px 26px", fontSize: 14 }} onClick={loadAuthedData}>
              Try again
            </button>
          </div>
        ) : (
          <NestLoader />
        )}
      </div>
    );
  }

  if (profile === null) {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header variant="app" authenticated authKnown={mounted} displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />
        <OnboardingFlow universe={universe} onComplete={handleCreateProfile} submitting={creatingProfile} dark={dark} />
        <NestFooter dark={dark} onToggleDark={toggleDark} />
      </div>
    );
  }

  const depositModal = showDeposit && (
    <DepositModal
      onClose={() => {
        setShowDeposit(false);
        setCrumbsDeposit(null);
      }}
      initialAmount={crumbsDeposit ?? undefined}
      intro={crumbsDeposit !== null ? `Feeding $${crumbsDeposit.toFixed(2)} of round-up crumbs to your nest.` : undefined}
      onDeposited={handleDeposited}
      embeddedWallet={embeddedWallet}
      embeddedSolAddress={embeddedSolAddress}
      getAccessToken={getAccessToken}
      userId={user?.id}
    />
  );

  if (postOnboarding === "deposit") {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header variant="app" authenticated authKnown={mounted} displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />
        <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: "40px var(--page-pad)", textAlign: "center" }}>
          <div className="ns-serif" style={{ fontSize: 34 }}>{displayName ? `${displayName}, let's` : "Let's"} fund your nest</div>
          <p style={{ fontSize: 15, color: "var(--ink2)", maxWidth: 420 }}>
            Deposit to start your basket. Your nest is built shortly after, splitting your deposit evenly across your picks.
          </p>
          <button className="ns-btn" style={{ padding: "16px 36px", fontSize: 16 }} onClick={() => setShowDeposit(true)}>
            Deposit now
          </button>
          <button style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 13, cursor: "pointer" }} onClick={() => setPostOnboarding(null)}>
            I'll do this later
          </button>
        </div>
        <NestFooter dark={dark} onToggleDark={toggleDark} />
        {depositModal}
      </div>
    );
  }

  if (postOnboarding === "building") {
    return (
      <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
        <Header variant="app" authenticated authKnown={mounted} displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />
        <NestBuildingAnimation tickers={previewTickers} explanation={basketExplanation} onDone={() => setPostOnboarding(null)} />
      </div>
    );
  }

  const pnlUp = (portfolio?.pnlUsd ?? 0) >= 0;

  return (
    <div className={nestRootClass(dark)} style={{ minHeight: "100vh" }}>
      <Header variant="app" authenticated authKnown={mounted} displayName={displayName} email={email} dark={dark} onSignIn={login} onLogout={logout} />

      <div style={{ padding: "0 var(--page-pad)", maxWidth: 1100, margin: "0 auto" }}>
        {NEST_DEMO_MODE && (
          <div className="ns-card" style={{ padding: "14px 20px", marginBottom: 24, borderColor: "var(--accent)" }}>
            <span style={{ fontWeight: 600 }}>Devnet Demo.</span>{" "}
            <span style={{ color: "var(--ink2)" }}>
              Funded with free devnet USDC — real prices drive the rebalance, but nothing here is real money.
            </span>
          </div>
        )}
        {loadError && <p style={{ color: "var(--down)", marginBottom: 16 }}>{loadError}</p>}

        {(() => {
          const level = nestLevel(deposits, (portfolio?.holdings ?? []).filter(h => h.symbol !== "USD" && (h.valueUsd ?? 0) > 0).length);
          return (
            <div style={{ marginTop: 24, marginBottom: -4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {displayName && <p className="ns-serif" style={{ fontSize: 22, margin: 0 }}>Welcome back, {displayName}.</p>}
                <button
                  onClick={() => setShowLevelHint(v => !v)}
                  aria-expanded={showLevelHint}
                  style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 9999, border: "1px solid var(--line)", color: "var(--accent)", background: "transparent", cursor: "pointer" }}
                >
                  Nest level: {level.name}
                </button>
              </div>
              {showLevelHint && (
                <p style={{ fontSize: 13, color: "var(--ink3)", margin: "8px 0 0", maxWidth: 560, lineHeight: 1.5 }}>
                  Levels are earned by feeding the nest and sticking with it — never by returns. Egg → Hatchling (first deposit) → Fledgling ($200 funded, 2 weeks) → Flyer ($1,000, 8 weeks, 10 positions).
                  {level.next ? ` Next: ${level.next} — ${level.hint}` : ` ${level.hint}`}
                </p>
              )}
            </div>
          );
        })()}

        <div className="ns-hero" style={{ marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--ink3)", textTransform: "uppercase", letterSpacing: ".06em" }}>Total value</div>
            <div className="ns-serif" style={{ fontSize: "clamp(40px, 11vw, 72px)", lineHeight: 1, margin: "6px 0 8px" }}>${(portfolio?.totalValueUsd ?? 0).toFixed(2)}</div>
            {portfolio && (
              <div style={{ marginBottom: 24 }}>
                <div className={`ns-move ${pnlUp ? "ns-up" : "ns-down"}`} style={{ fontSize: 22 }}>
                  {pnlUp ? "+" : ""}
                  {(portfolio.pnlPct * 100).toFixed(2)}%
                </div>
                {!portfolio.quotesLive && portfolio.holdings.some(h => h.symbol !== "USD") && (
                  <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 4 }}>Markets closed — as of last close. Live quotes resume at the open.</div>
                )}
              </div>
            )}
            <button className="ns-btn" style={{ padding: "15px 34px", fontSize: 16 }} onClick={() => setShowDeposit(true)}>
              Deposit
            </button>
          </div>
          <NestHero height={380} />
        </div>

        <NestGoalProgress
          goalUsd={profile?.goalUsd ?? null}
          depositedUsd={deposits.reduce((s, d) => s + d.amountUsdc, 0)}
          streak={streak}
          onSetGoal={() => { window.location.href = "/nest-earn/settings#goal"; }}
        />

        {/* Mobile-native tabs: the dashboard is one screen per concern, not one long scroll. */}
        <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 18, borderBottom: "1px solid var(--line2)", overflowX: "auto", scrollbarWidth: "none" }}>
          {([["overview", "Overview"], ["portfolio", "Portfolio"], ["history", "History"], ["markets", "Markets"], ["news", "News"], ["flock", "Flock"]] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              style={{
                background: "none",
                border: "none",
                borderBottom: `2px solid ${tab === key ? "var(--accent)" : "transparent"}`,
                marginBottom: -1,
                padding: "10px 14px",
                fontSize: 15,
                fontWeight: tab === key ? 600 : 500,
                color: tab === key ? "var(--ink)" : "var(--ink3)",
                cursor: "pointer",
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {label}
              {key === "history" && history.length > 0 ? ` · ${history.length}` : ""}
            </button>
          ))}
        </div>

        {/* Both betting surfaces in one place: they share the same practice-bet mechanic, and
            splitting "call it on a company you hold" from "call it on a company going public"
            across two tabs made each look thinner than it is — while leaving Overview to carry a
            horizontal market rail on top of everything else. */}
        {tab === "markets" && (
          <section>
            <PredictionMarketsCard markets={predictionMarkets} bets={predictionBets} onPlace={handlePlaceBet} onCancel={handleCancelBet} />
            <PreIpoBasket assets={preIpo?.assets ?? []} bets={predictionBets} onPlace={handlePlaceBet} onCancel={handleCancelBet} />
          </section>
        )}

        {tab === "flock" && (
          <FlockPanel
            flock={flock}
            busy={flockBusy}
            onSetPublic={isPublic => void flockAction(t => setNestFlockPublic(isPublic, { userId: user?.id, accessToken: t }, NEST_DEMO_MODE))}
            onFollow={username => flockAction(t => followNest(username, { userId: user?.id, accessToken: t }))}
            onUnfollow={username => void flockAction(t => unfollowNest(username, { userId: user?.id, accessToken: t }))}
            onKudos={username => void flockAction(t => sendNestKudos(username, { userId: user?.id, accessToken: t }))}
          />
        )}

        {tab === "overview" && (
          <section>
            {suggestionError && (
              <div
                className="ns-card"
                style={{ padding: "12px 16px", marginBottom: 12, display: "flex", alignItems: "flex-start", gap: 10, borderColor: "color-mix(in oklch, var(--down) 40%, var(--line))" }}
              >
                <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.45 }}>{suggestionError}</span>
                <button
                  onClick={() => setSuggestionError(null)}
                  style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 13, cursor: "pointer", flexShrink: 0 }}
                >
                  Dismiss
                </button>
              </div>
            )}
            {suggestions.map(s => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                name={universe.find(u => u.symbol === s.symbol)?.name}
                onAccept={handleAcceptSuggestion}
                onDismiss={handleDismissSuggestion}
              />
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: suggestions.length > 0 ? 0 : 12 }}>
              <button
                onClick={handleScanNow}
                disabled={scanning}
                style={{ background: "none", border: "none", color: "var(--ink3)", fontSize: 12, cursor: scanning ? "default" : "pointer", padding: "2px 0" }}
              >
                {scanning ? "Checking for news…" : "Check for news now"}
              </button>
            </div>
            <WhatMovedCard holdings={portfolio?.holdings ?? []} ledger={ledger} history={history} totalValueUsd={portfolio?.totalValueUsd ?? 0} quotesLive={portfolio?.quotesLive ?? true} />

            <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
              <div className="ns-serif" style={{ fontSize: 22, marginBottom: 12 }}>Performance</div>
              <NavChart points={portfolio?.navHistory ?? []} />
            </div>
          </section>
        )}

        {tab === "portfolio" && (
          <section>
            <CrumbsCard
              roundups={roundups}
              onFeed={amount => {
                setCrumbsDeposit(amount);
                setShowDeposit(true);
              }}
              onEnable={() => { window.location.href = "/nest-earn/settings#roundups"; }}
            />
            <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
              <div className="ns-serif" style={{ fontSize: 22, marginBottom: 4 }}>Your nest, by category</div>
              {basketExplanation && (
                <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--ink3)", margin: "0 0 16px", maxWidth: 620 }}>{basketExplanation}</p>
              )}
              <CategoryRing holdings={portfolio?.holdings ?? []} universe={universe} totalValueUsd={portfolio?.totalValueUsd ?? 0} />
            </div>

            <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
              <div className="ns-serif" style={{ fontSize: 22, marginBottom: 12 }}>Every position</div>
              <HoldingsBreakdown holdings={portfolio?.holdings ?? []} totalValueUsd={portfolio?.totalValueUsd ?? 0} />
            </div>

            <NestLessons
              categories={[...new Set(
                (portfolio?.holdings ?? [])
                  .filter(h => h.symbol !== "USD" && (h.valueUsd ?? 0) > 0)
                  .map(h => universe.find(a => a.symbol === h.symbol)?.tags[0])
                  .filter((t): t is string => !!t),
              )]}
            />

            <ProjectionCard summary={backtest} />
          </section>
        )}

        {tab === "history" && (
          <section>
            <div className="ns-card" style={{ padding: "var(--card-pad)", marginBottom: 18 }}>
              <div className="ns-serif" style={{ fontSize: 22, marginBottom: 12 }}>What the AI bought / sold on your behalf</div>
              <TradeHistoryList trades={history} />
            </div>

            <NestJournal deposits={deposits} history={history} streak={streak} />
          </section>
        )}
      </div>

      {tab === "news" && (
      <section id="ledger" style={{ padding: "0 var(--page-pad) var(--section-pad)", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <div className="ns-serif" style={{ fontSize: 26 }}>What's happening around your nest</div>
          <div style={{ fontSize: 13, color: "var(--ink3)" }}>Your own trades, with the X post about that company for context</div>
        </div>
        {ledger.length === 0 ? (
          <div className="ns-card" style={{ padding: "var(--card-pad)" }}>
            <p style={{ fontSize: 14, color: "var(--ink3)" }}>No rebalances yet — this fills in after your first one runs, shortly after you deposit.</p>
          </div>
        ) : (
          <div className="ns-grid4">
            {ledger.map(e => {
              const up = e.side === "buy";
              return (
                <article key={`${e.symbol}-${e.createdAt}`} className="ns-card" style={{ padding: "var(--card-pad)" }}>
                  <div className="ns-outlet">
                    <img src={fav(tickerDomain(e.symbol))} alt={e.symbol} />
                    {e.post ? `@${e.post.username} on X` : "Your Nest"} · {new Date(e.createdAt).toLocaleDateString()}
                  </div>
                  <div className={`ns-move ${up ? "ns-up" : "ns-down"}`} style={{ fontSize: 40, margin: "16px 0 4px" }}>
                    {up ? "+" : "−"}${e.usdValue.toFixed(2)}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{e.name}</div>
                  {e.post ? (
                    <a href={e.post.link} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 13.5, color: "var(--ink2)", margin: "6px 0 0" }}>
                      See the X post behind this{e.post.likeCount > 0 ? ` (${e.post.likeCount.toLocaleString()} likes)` : ""} →
                    </a>
                  ) : (
                    <p style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink3)", margin: "6px 0 0" }}>No recent X post found for this ticker.</p>
                  )}
                  <AiActionRow up={up} action={humanizeReason(e.reason, e.side, e.usdValue)} />
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}

      <NestFooter dark={dark} onToggleDark={toggleDark} />

      {depositModal}
    </div>
  );
}
