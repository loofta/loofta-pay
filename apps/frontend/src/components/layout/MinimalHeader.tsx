'use client'

import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { usePrivy } from "@privy-io/react-auth";
import { useAuthStore } from "@/store/auth";
import { UserMenu } from "@/components/UserMenu";
import { BalanceModal } from "@/components/BalanceModal";
import { getSolanaBalanceUSD } from "@/services/solanaBalance";
import { clusterBadgeLabel, isNonMainnetCluster } from "@/lib/solanaCluster";
import { LooftaPayLogoLink } from "@/components/layout/LooftaPayLogoLink";

const HEADER_HEIGHT = 64;

export function MinimalHeader() {
  const solanaClusterTag = clusterBadgeLabel();
  const { authenticated, email, logout } = useAuth();
  const { login: privyLogin, user: privyUser } = usePrivy();
  const username = useAuthStore((s) => s.username ?? null);
  const headerRef = useRef<HTMLElement>(null);

  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceUSD, setBalanceUSD] = useState<string>("0.00");
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [solanaAddress, setSolanaAddress] = useState<string | null>(null);

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

  useEffect(() => {
    if (!authenticated || !privyUser) {
      setBalanceUSD("0.00");
      setSolanaAddress(null);
      return;
    }
    const linkedAccounts = privyUser?.linkedAccounts || [];
    const linkedWallets = linkedAccounts.filter(
      (account: any) => account.type === "wallet" || account.type === "smart_wallet"
    );
    const solanaLinkedWallet = linkedWallets.find((account: any) => {
      const address = account.address;
      return address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    });
    if (!solanaLinkedWallet) {
      setBalanceUSD("0.00");
      setSolanaAddress(null);
      return;
    }
    const addr = (solanaLinkedWallet as { address: string }).address;
    setSolanaAddress(addr);
    setLoadingBalance(true);
    getSolanaBalanceUSD(addr)
      .then((b) => setBalanceUSD(b.toFixed(2)))
      .catch(() => setBalanceUSD("0.00"))
      .finally(() => setLoadingBalance(false));
    const interval = setInterval(() => {
      getSolanaBalanceUSD(addr)
        .then((b) => setBalanceUSD(b.toFixed(2)))
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [authenticated, privyUser]);

  const refreshBalance = useCallback(async () => {
    if (solanaAddress) {
      setLoadingBalance(true);
      try {
        const balance = await getSolanaBalanceUSD(solanaAddress);
        setBalanceUSD(balance.toFixed(2));
      } finally {
        setLoadingBalance(false);
      }
    }
  }, [solanaAddress]);

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
                  <span className="text-[10px] text-slate-500 font-normal leading-tight truncate max-w-[8rem] sm:max-w-none">
                    {isNonMainnetCluster() && solanaClusterTag
                      ? `${solanaClusterTag} USDC`
                      : "Mainnet USDC"}
                  </span>
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
