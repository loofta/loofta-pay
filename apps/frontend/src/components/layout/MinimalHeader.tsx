'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useResumePeerCashout } from "@/hooks/useResumePeerCashout";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { UserMenu } from "@/components/UserMenu";
import dynamic from "next/dynamic";
const BalanceModal = dynamic(() => import("@/components/BalanceModal").then(m => ({ default: m.BalanceModal })), { ssr: false });
const DepositSheet = dynamic(() => import("@/components/deposit/DepositSheet").then(m => ({ default: m.DepositSheet })), { ssr: false });
import { LooftaPayLogoLink } from "@/components/layout/LooftaPayLogoLink";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { TIERS, getTierForVolume } from "@/lib/tiers";
import type { PeerPayRequest } from "@/lib/peerPlatforms";

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
    { href: "/app", label: "Home", description: "Your balance and recent activity" },
    { href: "/app/send", label: "Send & Receive", description: "Send and receive payments" },
    { href: "/terminal", label: "Terminal", description: "Send payments by chat — no wallet steps, just tell it who to pay" },
    { href: "/rewards", label: t('rewards'), description: t('earnSparks') },
    { href: "/megapot", label: "Megapot", description: "Play the daily jackpot privately" },
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
            const active =
              link.href === "/app"
                ? pathname === "/app"
                : link.href === "/app/send"
                  ? !!pathname && (pathname.startsWith("/app/send") || pathname.startsWith("/app/receive") || pathname.startsWith("/app/history"))
                  : pathname === link.href || (link.href !== "/" && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex items-center px-3.5 py-2.5 rounded-full text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
                  active
                    ? "bg-[#2A2A32] text-white"
                    : "text-[#8E8C96] hover:text-white",
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
  const [showDeposit, setShowDeposit] = useState(false);
  const [depositMode, setDepositMode] = useState<"deposit" | "withdraw">("deposit");
  const [depositScreen, setDepositScreen] = useState<"home" | "solana" | "address" | "card" | "paj">("home");
  const [balanceModalTab, setBalanceModalTab] = useState<"topup" | "withdraw" | "history">("topup");
  // True when a CTA (e.g. "Add funds to your balance") asked for a specific tab — keeps
  // BalanceModal's own "resume a stuck withdrawal" auto-redirect from stealing focus back to Recent.
  const [balanceModalTabLocked, setBalanceModalTabLocked] = useState(false);
  /** Optional deep-link into a withdraw rail: peer | paj | crypto (from ?method= or claim cash-out). */
  const [balanceModalWithdrawMethod, setBalanceModalWithdrawMethod] = useState<"peer" | "paj" | "crypto" | "near" | undefined>(undefined);
  const [balanceTopUpAmount, setBalanceTopUpAmount] = useState<number | undefined>(undefined);
  const [peerPay, setPeerPay] = useState<PeerPayRequest | null>(null);
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
      const detail = (e as CustomEvent<{
        tab?: string;
        method?: string;
        amountUsd?: number;
        peerPay?: PeerPayRequest;
      }>).detail;
      const m = detail?.method;
      const pay = detail?.peerPay;
      const peerPayDetail = pay && pay.platformId && pay.identifier && typeof pay.amountUsd === "number" && pay.amountUsd > 0
        ? pay
        : null;
      const legacyWithdraw = detail?.tab === "history" || m === "peer" || m === "paj" || !!peerPayDetail;
      setBalanceTopUpAmount(typeof detail?.amountUsd === "number" && detail.amountUsd > 0 ? detail.amountUsd : undefined);
      setPeerPay(peerPayDetail);
      setBalanceModalWithdrawMethod(
        m === "peer" || m === "paj" || m === "crypto" || m === "near" ? m : undefined,
      );
      if (legacyWithdraw) {
        const explicitTab = detail?.tab === "withdraw" || detail?.tab === "history";
        setBalanceModalTab(detail?.tab === "history" ? "history" : "withdraw");
        setBalanceModalTabLocked(explicitTab);
        setShowDeposit(false);
        setShowBalanceModal(true);
      } else if (detail?.tab === "withdraw") {
        setShowBalanceModal(false);
        setDepositMode("withdraw");
        setDepositScreen(m === "crypto" || m === "near" ? "address" : m === "cash" ? "card" : "home");
        setShowDeposit(true);
      } else {
        setShowBalanceModal(false);
        setDepositMode("deposit");
        setDepositScreen("home");
        setShowDeposit(true);
      }
      refreshBalance();
    };
    window.addEventListener("openBalanceModal", handler);
    return () => window.removeEventListener("openBalanceModal", handler);
  }, [refreshBalance]);

  // Deep link from the Telegram bot's Fund button: /app?deposit=1 opens the deposit sheet directly.
  // Waits for sign-in (the sheet only renders when authenticated), then removes the param so a
  // refresh or back navigation doesn't pop the sheet again.
  useEffect(() => {
    if (!authenticated || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("deposit") !== "1") return;
    url.searchParams.delete("deposit");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    setShowBalanceModal(false);
    setDepositMode("deposit");
    setDepositScreen("home");
    setShowDeposit(true);
  }, [authenticated]);

  // Finishes a pay / cash out whose tab was closed after the bridge, silently.
  useResumePeerCashout(authenticated);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const isRewardsActive = pathname?.startsWith("/rewards");
  const isWinActive = pathname?.includes("/megapot");
  const isTerminalActive = pathname?.startsWith("/terminal");
  const isAppHome = pathname === "/app";
  const isSendReceive =
    !!pathname &&
    (pathname.startsWith("/app/send") ||
      pathname.startsWith("/app/receive") ||
      pathname.startsWith("/app/history") ||
      pathname.startsWith("/app/c/"));
  const navItems = [
    { href: "/app", label: "Home", active: isAppHome },
    { href: "/app/send", label: "Send & Receive", active: isSendReceive },
    { href: "/terminal", label: "Terminal", active: isTerminalActive },
    { href: "/rewards", label: t("rewards"), active: isRewardsActive },
    { href: "/megapot", label: "Megapot", active: isWinActive },
  ];

  return (
    <>
      <header
        ref={headerRef}
        className="sticky top-0 z-40 flex items-center bg-[#0B0B0E] relative"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#4a3428]/80 to-transparent" />
        <div className="w-full max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between">
          <div className="flex items-center min-w-0">
            <LooftaPayLogoLink imageWidth={140} imageHeight={34} imageClassName="h-[34px] w-auto" />
          </div>

          <div className="flex items-center shrink-0 gap-2">
            {authenticated ? (
              <>
                <nav className="hidden sm:flex items-center gap-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={item.active ? "page" : undefined}
                      className={[
                        "rounded-full px-3.5 py-2 text-sm font-medium leading-none transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30",
                        item.active
                          ? "bg-[#2A2A32] text-white"
                          : "text-[#8E8C96] hover:text-white",
                      ].join(" ")}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>

                {/* Desktop: Balance button */}
                <button
                  type="button"
                  onClick={() => { setDepositMode("deposit"); setDepositScreen("home"); setShowDeposit(true); refreshBalance(); }}
                  className="hidden sm:flex items-center gap-2 ml-2 h-10 pl-3.5 pr-1 rounded-full bg-[#141418] border border-white/10 hover:border-white/20 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  <span className="text-sm font-medium text-[#8E8C96]">{t('balance')}</span>
                  <span className="text-sm font-semibold text-white tabular-nums shrink-0">
                    {loadingBalance ? "…" : `$${balanceUSD}`}
                  </span>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[#FF3D12] to-[#F5B000] text-white text-base font-semibold leading-none">
                    +
                  </span>
                </button>

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
                  onClick={() => privyLogin({ loginMethods: ["email", "twitter", "discord", "github", "telegram"], disableSignup: false })}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {t('signIn')}
                </button>
              </>
            )}
          </div>
        </div>

        {authenticated && (
          <DepositSheet
            open={showDeposit}
            onClose={() => {
              setShowDeposit(false);
              window.dispatchEvent(new CustomEvent("balanceModalClosed"));
            }}
            balanceUsd={balanceUSD}
            balanceExact={balanceNumber}
            solanaAddress={solanaAddress}
            devnetMode={networkMode === "devnet"}
            onRefresh={refreshBalance}
            showModeSwitch
            initialMode={depositMode}
            initialScreen={depositScreen}
            onCashOut={(pay) => {
              setShowDeposit(false);
              setPeerPay(pay);
              setBalanceModalTab("withdraw");
              setBalanceModalWithdrawMethod("peer");
              setBalanceModalTabLocked(true);
              setShowBalanceModal(true);
            }}
          />
        )}
        {authenticated && (
          <BalanceModal
            open={showBalanceModal}
            onClose={() => {
              setShowBalanceModal(false);
              setBalanceModalWithdrawMethod(undefined);
              setBalanceTopUpAmount(undefined);
              setPeerPay(null);
              window.dispatchEvent(new CustomEvent("balanceModalClosed"));
            }}
            balanceUSD={balanceUSD}
            balanceExact={balanceNumber}
            loadingBalance={loadingBalance}
            solanaAddress={solanaAddress}
            onRefresh={refreshBalance}
            devnetMode={networkMode === "devnet"}
            initialTab={balanceModalTab}
            lockInitialTab={balanceModalTabLocked}
            initialWithdrawMethod={balanceModalWithdrawMethod}
            topUpAmountUsd={balanceTopUpAmount}
            peerPay={peerPay}
            onAddFunds={() => {
              setShowBalanceModal(false);
              setBalanceModalWithdrawMethod(undefined);
              setBalanceTopUpAmount(undefined);
              setPeerPay(null);
              setDepositMode("deposit");
              setDepositScreen("home");
              setShowDeposit(true);
              refreshBalance();
            }}
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
          onOpenBalance={() => { setDepositMode("deposit"); setDepositScreen("home"); setShowDeposit(true); refreshBalance(); }}
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
