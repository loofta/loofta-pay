/**
 * Single source of truth for the connected wallet's SOL/USDC/skrDomain, shared by the header's
 * WalletChip and the Profile screen so they don't each poll independently and drift out of sync.
 * Cache-first: paints the last known balance instantly on mount, then refreshes from the network.
 * Callers that change the wallet's on-chain balance (e.g. a ticket purchase) should call
 * refreshBalances() right after so the header chip doesn't sit on a stale number.
 */
import { usePrivy } from '@privy-io/expo';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getWalletBalances } from '../api/users';
import { getCachedWalletBalances, setCachedWalletBalances } from '../storage/walletBalances';

interface BalanceContextValue {
  solBalance: number | null;
  usdcBalance: number | null;
  skrDomain: string | null;
  /** True once the first fetch attempt (success or failure) has settled — lets consumers tell
   *  "no .skr domain" (skrDomain === null, loaded) apart from "haven't fetched yet". */
  balancesLoaded: boolean;
  refreshBalances: () => Promise<void>;
}

const BalanceContext = createContext<BalanceContextValue>({
  solBalance: null,
  usdcBalance: null,
  skrDomain: null,
  balancesLoaded: false,
  refreshBalances: async () => {},
});

export function useBalances() {
  return useContext(BalanceContext);
}

export function BalanceProvider({ children }: { children: ReactNode }) {
  const { user, getAccessToken } = usePrivy();
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [skrDomain, setSkrDomain] = useState<string | null>(null);
  const [balancesLoaded, setBalancesLoaded] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;

  const refreshBalances = useCallback(async () => {
    if (!userRef.current) return;
    try {
      const accessToken = await getAccessToken();
      const balances = await getWalletBalances(accessToken);
      setSolBalance(balances.solBalance);
      setUsdcBalance(balances.usdcBalance);
      setSkrDomain(balances.skrDomain);
      void setCachedWalletBalances({ solBalance: balances.solBalance, usdcBalance: balances.usdcBalance });
    } catch {
      // transient — keep the last known (possibly cached) value; next refresh call/mount retries
    } finally {
      setBalancesLoaded(true);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!user) {
      setSolBalance(null);
      setUsdcBalance(null);
      setSkrDomain(null);
      setBalancesLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await getCachedWalletBalances();
      if (cached && !cancelled) {
        setSolBalance(cached.solBalance);
        setUsdcBalance(cached.usdcBalance);
      }
      if (!cancelled) refreshBalances();
    })();
    return () => {
      cancelled = true;
    };
  }, [user, refreshBalances]);

  return (
    <BalanceContext.Provider value={{ solBalance, usdcBalance, skrDomain, balancesLoaded, refreshBalances }}>
      {children}
    </BalanceContext.Provider>
  );
}
