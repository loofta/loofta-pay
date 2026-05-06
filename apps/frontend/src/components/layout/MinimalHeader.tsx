'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { UserMenu } from "@/components/UserMenu";
import { BalanceModal } from "@/components/BalanceModal";
import { LooftaPayLogoLink } from "@/components/layout/LooftaPayLogoLink";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";

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
}: {
  open: boolean;
  onClose: () => void;
  balanceUSD: string;
  loadingBalance: boolean;
  onOpenBalance: () => void;
  onLogout: () => void;
  username: string | null;
  email: string | undefined;
}) {
  const pathname = usePathname();
  if (!open) return null;

  const navLinks = [
    { href: "/rewards", label: "Sparks ⚡", description: "Earn Sparks for your activity" },
    { href: "/app/waitlist", label: "Waitlist", description: "Request mainnet early access" },
    { href: "/app/settings", label: "Profile", description: null },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-72 flex flex-col bg-[#0f0f12] border-l border-white/10 shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-white/10 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {username ? `@${username}` : (email ?? "Account")}
            </p>
            {username && email && (
              <p className="text-xs text-slate-400 truncate">{email}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors shrink-0"
            aria-label="Close menu"
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
              <p className="text-xs text-slate-400 mb-0.5">Balance</p>
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
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors",
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
        <div className="px-3 pb-6 pt-2 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => { onClose(); onLogout(); }}
            className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-400/10 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
    </>
  );
}

export function MinimalHeader() {
  const { authenticated, email, logout } = useAuth();
  const { login: privyLogin } = usePrivy();
  const username = useAuthStore((s) => s.username ?? null);
  const networkMode = useAuthStore((s) => s.networkMode);
  const pathname = usePathname();
  const headerRef = useRef<HTMLElement>(null);

  const [showBalanceModal, setShowBalanceModal] = useState(false);
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
    const handler = () => {
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

  const isRewardsActive = pathname === "/rewards";

  return (
    <>
      <header
        ref={headerRef}
        className="sticky top-0 z-40 flex items-center bg-[#0f0f12]"
        style={{ height: HEADER_HEIGHT }}
      >
        <div className="w-full max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between">
          <div className="flex items-center min-w-0">
            <LooftaPayLogoLink imageWidth={120} imageHeight={36} imageClassName="h-9 w-auto" badgeVariant="on-dark" isMainnet={networkMode === "mainnet"} />
          </div>

          <div className="flex items-center shrink-0 gap-2">
            {authenticated ? (
              <>
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
                  <span>⚡</span>
                  <span>Sparks</span>
                </Link>

                {/* Desktop: Waitlist link */}
                <Link
                  href="/app/waitlist"
                  className={[
                    "hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    pathname === "/app/waitlist"
                      ? "text-green-300 bg-green-500/10"
                      : "text-slate-300 hover:text-white hover:bg-white/10",
                  ].join(" ")}
                >
                  <span>Waitlist</span>
                </Link>

                {/* Desktop: Balance button */}
                <button
                  type="button"
                  onClick={() => setShowBalanceModal(true)}
                  className="hidden sm:flex items-center gap-3 px-3 py-2 rounded-lg bg-white/10 text-slate-200 hover:text-white hover:bg-white/15 transition-colors border border-white/10 text-left"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium leading-tight">Balance</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {loadingBalance ? "…" : `$${balanceUSD}`}
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
                  aria-label="Open menu"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => privyLogin({ loginMethods: ["email", "twitter"], disableSignup: false })}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                Sign in
              </button>
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
          onOpenBalance={() => { setShowBalanceModal(true); refreshBalance(); }}
          onLogout={() => logout()}
          username={username}
          email={email}
        />
      )}
    </>
  );
}
