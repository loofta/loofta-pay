"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";
import { isNonMainnetCluster } from "@/lib/solanaCluster";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import {
  EMBEDDED_SOLANA_USDC_BALANCE_STALE_MS,
  embeddedSolanaUsdcBalanceQueryKey,
  fetchEmbeddedSolanaUsdcBalance,
} from "@/services/solanaBalance";

export interface UseEmbeddedSolanaUsdcBalanceOptions {
  /** When false, no RPC runs (e.g. logged out). */
  enabled?: boolean;
}

/**
 * USDC (USD) balance for the user's Privy-linked Solana embedded / payment address.
 * Shares a React Query cache with {@link useSolanaPayment} so the header and pay modal do not double-hit RPC.
 * Gated on Solana `useWallets().ready` so we do not race the embedded wallet iframe.
 *
 * Note: Privy does not expose token balances on the wallet object; this still reads chain state via RPC,
 * but requests are deduped and no longer polled on a fixed short interval.
 */
export function useEmbeddedSolanaUsdcBalance(
  options: UseEmbeddedSolanaUsdcBalanceOptions = {}
) {
  const { enabled = true } = options;
  const { user, authenticated } = usePrivy();
  const { ready: walletsReady } = useWallets();
  const address = deriveSolanaEmbeddedAddress(user ?? null);

  const query = useQuery({
    queryKey: address
      ? embeddedSolanaUsdcBalanceQueryKey(address)
      : (["embeddedSolanaUsdcBalance", "__none__", isNonMainnetCluster() ? "dev" : "main"] as const),
    queryFn: async () => {
      if (!address) {
        throw new Error("Missing Solana address for balance query");
      }
      return fetchEmbeddedSolanaUsdcBalance(address);
    },
    staleTime: EMBEDDED_SOLANA_USDC_BALANCE_STALE_MS,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    enabled:
      enabled &&
      authenticated === true &&
      walletsReady &&
      typeof address === "string" &&
      address.length > 0,
  });

  return {
    balanceUSD: query.data?.balanceUSD ?? 0,
    walletAddress: query.data?.walletAddress ?? address ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
