'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { UserMenu } from "@/components/UserMenu";
import dynamic from "next/dynamic";
const BalanceModal = dynamic(() => import("@/components/BalanceModal").then(m => ({ default: m.BalanceModal })), { ssr: false });
import { LooftaPayLogoLink } from "@/components/layout/LooftaPayLogoLink";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
import { useGachaDevnetBalance } from "@/hooks/useGachaDevnetBalance";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { TIERS, getTierForVolume } from "@/lib/tiers";

const HEADER_HEIGHT = 64;

function MobileMenu({
  open,
  onClose,
  balanceUSD,
  loadingBalance,
  onOpenBalance,
  onLogout,
  username,
  email,
  networkMode,
  setNetworkMode,
  mainnetAccess,
  tier,
  totalVolumeUsd,
}: {
  open: boolean;
  onClose: () => void;
  balanceUSD: string;
  loadingBalance: boolean;
  onOpenBalance: () => void;
  onLogout: () => void;
  username: string | null;
  email: string | undefined;
  networkMode: string;
  setNetworkMode: (mode: "mainnet" | "devnet") => void;
  mainnetAccess: boolean;
  tier: string;
  totalVolumeUsd: number;
}) {
  const t = useTranslations('MinimalHeader');
  const pathname = usePathname();
  if (!open) return null;

  const navLinks = [
    { href: "/", label: "Send & Receive", description: "Send and receive payments" },
    { href: "/rewards", label: t('rewards'), description: t('earnSparks') },
    { href: "/megapot", label: "Lottery", description: "Play the daily jackpot privately" },
    { href: "/terminal", label: "Terminal", description: "Send payments by chat — no wallet steps, just tell it who to pay" },
  ];

  return (
    <>
      {/* Drawer */}
      <div className="fixed inset-0 z-50 flex flex-col bg-[#0f0f12] shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="min-w-0">
            <p className="text-base font-semibold text-white truncate">
              {username ? `@${username}` : (email ?? "Account")}
            </p>
            {username && email && (
              <p className="text-base text-slate-400 truncate">{email}</p>
            )}
            {(() => {
              const info = getTierForVolume(totalVolumeUsd);
              const nextTier = TIERS.find((t) => t.minVolume > totalVolumeUsd);
              const vol = totalVolumeUsd >= 1000
                ? `$${(totalVolumeUsd / 1000).toFixed(totalVolumeUsd % 1000 === 0 ? 0 : 1)}k`
                : `$${totalVolumeUsd.toFixed(0)}`;
              const nextVol = nextTier
                ? nextTier.minVolume >= 1000000
                  ? `$${nextTier.minVolume / 1000000}M`
                  : nextTier.minVolume >= 1000
                    ? `$${nextTier.minVolume / 1000}k`
                    : `$${nextTier.minVolume}`
                : null;
              return (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${info.color} ${info.bg}`}>
                    {info.label}
                  </span>
                  <span className="text-sm text-slate-400">{vol} volume</span>
                  {nextTier && (
                    <span className="text-sm text-slate-500">&middot; {nextVol} to {nextTier.label}</span>
                  )}
                </div>
              );
            })()}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 mt-0.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"
            aria-label={t('closeMenu')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Balance */}
        <div className="px-5 py-4 border-b border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => { onClose(); onOpenBalance(); }}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/8 border border-white/10 hover:bg-white/12 transition-colors text-left"
          >
            <div>
              <p className="text-sm text-slate-400 mb-0.5">{t('balance')}</p>
              <p className="text-lg font-bold text-white tabular-nums">
                {loadingBalance ? "…" : `$${balanceUSD}`}
              </p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {navLinks.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClose}
                className={[
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-base font-medium transition-colors",
                  active
                    ? "bg-white/10 text-white"
                    : "text-slate-300 hover:text-white hover:bg-white/8",
                ].join(" ")}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-6 pt-2 border-t border-white/10 shrink-0 space-y-1">
          {/* Network toggle */}
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors">
            <div className="flex flex-col min-w-0">
              <span className="text-base text-slate-300">
                {t('mainnetBeta')}
              </span>
            </div>
            <Switch
              checked={networkMode === "mainnet"}
              onCheckedChange={(checked) => setNetworkMode(checked ? "mainnet" : "devnet")}
            />
          </div>
          <button
            type="button"
            onClick={() => { onClose(); onLogout(); }}
            className="w-full text-left px-3 py-2.5 rounded-xl text-base font-medium text-red-400 hover:bg-red-400/10 transition-colors"
          >
            {t('logOut')}
          </button>
        </div>
      </div>
    </>
  );
}

export function MinimalHeader() {
  const t = useTranslations('MinimalHeader');
  const { authenticated, email, logout } = useAuth();
  const { login: privyLogin } = usePrivy();
  const username = useAuthStore((s) => s.username ?? null);
  const networkMode = useAuthStore((s) => s.networkMode);
  const networkReady = useAuthStore((s) => !!s.userId); // true once setAuth ran and per-user networkMode is loaded
  const mainnetAccess = useAuthStore((s) => s.mainnetAccess);
  const setNetworkMode = useAuthStore((s) => s.setNetworkMode);
  const tier = useAuthStore((s) => s.tier);
  const totalVolumeUsd = useAuthStore((s) => s.totalVolumeUsd);
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);

  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceModalTab, setBalanceModalTab] = useState<"topup" | "withdraw" | "history">("topup");
  // True when a CTA (e.g. "Add funds to your balance") asked for a specific tab — keeps
  // BalanceModal's own "resume a stuck withdrawal" auto-redirect from stealing focus back to Recent.
  const [balanceModalTabLocked, setBalanceModalTabLocked] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const {
    balanceUSD: balanceNumber,
    walletAddress: solanaAddress,
    isLoading: loadingBalance,
    refetch: refetchEmbeddedBalance,
  } = useEmbeddedSolanaUsdcBalance({ enabled: authenticated });

  const balanceUSD = useMemo(
    () => balanceNumber.toFixed(2),
    [balanceNumber]
  );

  // Gacha devnet USDC-Dev balance — a separate readout from the real balance above (different
  // mint, devnet-only). Opt-in via env so it never shows for anyone who hasn't deliberately
  // turned it on for local/devnet testing; set NEXT_PUBLIC_SHOW_GACHA_DEV_TOOLS=true to see it.
  const showGachaDevTools = process.env.NEXT_PUBLIC_SHOW_GACHA_DEV_TOOLS === "true";
  const { balance: gachaDevnetBalance, refresh: refreshGachaDevnetBalance } = useGachaDevnetBalance({ enabled: showGachaDevTools && authenticated });

  useEffect(() => {
    if (!headerRef.current) return;
    const setVar = () => {
      document.documentElement.style.setProperty("--header-h", `${HEADER_HEIGHT}px`);
    };
    setVar();
    window.addEventListener("resize", setVar);
    return () => {
      window.removeEventListener("resize", setVar);
      document.documentElement.style.setProperty("--header-h", "0px");
    };
  }, []);

  const refreshBalance = useCallback(async () => {
    await refetchEmbeddedBalance();
  }, [refetchEmbeddedBalance]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: string }>).detail;
      const explicitTab = detail?.tab === "withdraw" || detail?.tab === "history" || detail?.tab === "topup";
      setBalanceModalTab(explicitTab ? (detail!.tab as "topup" | "withdraw" | "history") : "topup");
      setBalanceModalTabLocked(explicitTab);
      setShowBalanceModal(true);
      refreshBalance();
    };
    window.addEventListener("openBalanceModal", handler);
    return () => window.removeEventListener("openBalanceModal", handler);
  }, [refreshBalance]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const isRewardsActive = pathname?.startsWith("/rewards");
  const isWinActive = pathname?.includes("/megapot");
  const isTerminalActive = pathname?.startsWith("/terminal");

  return (
    <>
      <header
        ref={headerRef}
        className="sticky top-0 z-40 flex items-center bg-[#0f0f12]"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="w-full max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between">
          <div className="flex items-center min-w-0">
            <LooftaPayLogoLink imageWidth={120} imageHeight={36} imageClassName="h-9 w-auto" />
          </div>

          <div className="flex items-center shrink-0 gap-2">
            {authenticated ? (
              <>
                {/* Desktop: Send & Receive link */}
                <Link
                  href="/"
                  className={[
                    "hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    pathname === "/"
                      ? "text-orange-300 bg-orange-500/10"
                      : "text-slate-300 hover:text-white hover:bg-white/10",
                  ].join(" ")}
                >
                  <span>Send & Receive</span>
                </Link>


                {/* Desktop: Rewards link */}
                <Link
                  href="/rewards"
                  className={[
                    "hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isRewardsActive
                      ? "text-amber-300 bg-amber-500/10"
                      : "text-slate-300 hover:text-white hover:bg-white/10",
                  ].join(" ")}
                >
                  <span>{t('rewards')}</span>
                </Link>

                {/* Desktop: Win (lottery) link */}
                <Link
                  href="/megapot"
                  className={[
                    "hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isWinActive
                      ? "text-yellow-300 bg-yellow-500/10"
                      : "text-slate-300 hover:text-white hover:bg-white/10",
                  ].join(" ")}
                >
                  <span>Lottery</span>
                </Link>

                {/* Desktop: Terminal link */}
                <Link
                  href="/terminal"
                  className={[
                    "hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    isTerminalActive
                      ? "text-sky-300 bg-sky-500/10"
                      : "text-slate-300 hover:text-white hover:bg-white/10",
                  ].join(" ")}
                >
                  <span>Terminal</span>
                </Link>

                {/* Desktop: Balance button */}
                <button
                  type="button"
                  onClick={() => { setBalanceModalTabLocked(false); setShowBalanceModal(true); }}
                  className="hidden sm:flex items-center gap-3 px-3 py-2 rounded-lg bg-white/10 text-slate-200 hover:text-white hover:bg-white/15 transition-colors border border-white/10 text-left"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium leading-tight">{t('balance')}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {loadingBalance ? "…" : `$${balanceUSD}`}
                  </span>
                </button>

                {/* Desktop: Gacha devnet balance — dev-tools only, see NEXT_PUBLIC_SHOW_GACHA_DEV_TOOLS.
                    Separate mint/network from the real balance button above; deliberately not wired
                    through the app's own (retired) devnet toggle — see useGachaDevnetBalance. */}
                {showGachaDevTools && gachaDevnetBalance && (
                  <button
                    type="button"
                    onClick={() => refreshGachaDevnetBalance()}
                    title={gachaDevnetBalance.address}
                    className="hidden sm:flex items-center gap-3 px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15 transition-colors border border-emerald-400/20 text-left"
                  >
                    <span className="text-sm font-medium leading-tight">Devnet</span>
                    <span className="text-sm font-semibold tabular-nums shrink-0">${gachaDevnetBalance.usdcBalance.toFixed(2)}</span>
                  </button>
                )}

                {/* Desktop: UserMenu */}
                <UserMenu
                  username={username}
                  email={email}
                  isDarkPage={true}
                  onLogout={() => logout()}
                />

                {/* Mobile: Hamburger */}
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className="sm:hidden flex items-center justify-center w-10 h-10 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
                  aria-label={t('openMenu')}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => privyLogin({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {t('signIn')}
                </button>
              </>
            )}
          </div>
        </div>

        {authenticated && (
          <BalanceModal
            open={showBalanceModal}
            onClose={() => setShowBalanceModal(false)}
            balanceUSD={balanceUSD}
            balanceExact={balanceNumber}
            loadingBalance={loadingBalance}
            solanaAddress={solanaAddress}
            onRefresh={refreshBalance}
            devnetMode={networkMode === "devnet"}
            initialTab={balanceModalTab}
            lockInitialTab={balanceModalTabLocked}
            dark
          />
        )}
      </header>

      {/* Mobile drawer */}
      {authenticated && (
        <MobileMenu
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          balanceUSD={balanceUSD}
          loadingBalance={loadingBalance}
          onOpenBalance={() => { setBalanceModalTabLocked(false); setShowBalanceModal(true); refreshBalance(); }}
          onLogout={() => logout()}
          username={username}
          email={email}
          networkMode={networkMode}
          setNetworkMode={setNetworkMode}
          mainnetAccess={mainnetAccess ?? false}
          tier={tier}
          totalVolumeUsd={totalVolumeUsd}
        />
      )}
    </>
  );
}
