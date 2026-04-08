'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { UserMenu } from "@/components/UserMenu";
import { BalanceModal } from "@/components/BalanceModal";
import { LooftaPayLogoLink } from "@/components/layout/LooftaPayLogoLink";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";

const HEADER_HEIGHT = 64;

export function MinimalHeader() {
  const { authenticated, email, logout } = useAuth();
  const { login: privyLogin } = usePrivy();
  const username = useAuthStore((s) => s.username ?? null);
  const headerRef = useRef<HTMLElement>(null);

  const [showBalanceModal, setShowBalanceModal] = useState(false);

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

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 flex items-center bg-[#0f0f12]"
      style={{ height: HEADER_HEIGHT }}
    >
      <div className="w-full max-w-7xl mx-auto px-4 md:px-8 flex items-center justify-between">
        <div className="flex items-center min-w-0">
          <LooftaPayLogoLink imageWidth={120} imageHeight={36} imageClassName="h-9 w-auto" badgeVariant="on-dark" />
        </div>
        <div className="flex items-center shrink-0 gap-2">
          {authenticated ? (
            <>
              <button
                type="button"
                onClick={() => setShowBalanceModal(true)}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/10 text-slate-200 hover:text-white hover:bg-white/15 transition-colors border border-white/10 text-left"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium leading-tight">Balance</span>
                </div>
                <span className="text-sm font-semibold tabular-nums shrink-0">
                  {loadingBalance ? "…" : `$${balanceUSD}`}
                </span>
              </button>
              <UserMenu
                username={username}
                email={email}
                isDarkPage={true}
                onLogout={() => logout()}
              />
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
          loadingBalance={loadingBalance}
          solanaAddress={solanaAddress}
          onRefresh={refreshBalance}
          dark
        />
      )}
    </header>
  );
}
