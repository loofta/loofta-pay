"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets,
  useSignAndSendTransaction,
  useSignTransaction,
} from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import { sendUsdcWithPrivyEmbeddedWallet } from "@/services/privyEmbeddedUsdcSend";
import { useAuthStore } from "@/store/auth";
import { getRpcForMode, getUsdcMintForMode, getPrivySolanaChainForMode } from "@/lib/solanaRpc";
import { deriveSolanaEmbeddedAddress } from "@/lib/privySolanaEmbeddedAddress";
import {
  EMBEDDED_SOLANA_USDC_BALANCE_STALE_MS,
  embeddedSolanaUsdcBalanceQueryKey,
  fetchEmbeddedSolanaUsdcBalance,
} from "@/services/solanaBalance";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

export interface SolanaPaymentConfig {
  amount: number;
  recipientAddress: string;
  claimId?: string;
}

export interface UseSolanaPaymentOptions {
  /** When true, fetches balance from backend (e.g. when Pay Now modal is open). */
  enabled?: boolean;
}

/**
 * Solana USDC payment via Privy embedded wallet (Pay with Loofta).
 * Mirrors the pattern of usePayment on Base: makePayment(config), balance, hasInsufficientBalance.
 */
export function useSolanaPayment(options: UseSolanaPaymentOptions = {}) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const { getAccessToken, user, authenticated } = usePrivy();
  const { wallets: standardWallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signTransaction } = useSignTransaction();
  const networkMode = useAuthStore((s) => s.networkMode);
  const [isLoading, setIsLoading] = useState(false);

  const { data: balanceData, refetch: refreshBalance } = useQuery({
    queryKey: ["solanaPaymentBalance", user?.id, networkMode],
    queryFn: async () => {
      const token = await getAccessToken?.();
      if (!token || !user?.id) throw new Error("Not authenticated");
      const clientAddress = deriveSolanaEmbeddedAddress(user);
      // Use backend only to resolve the canonical wallet address.
      // Backend balance is cluster-locked (reflects backend's configured network, not networkMode),
      // so always fetch balance client-side with the correct networkMode RPC.
      let walletAddress: string | undefined;
      try {
        const r = await fetch(`${BACKEND_URL}/users/me/wallet/balance`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const json = (await r.json()) as { balanceUSD?: number; walletAddress?: string };
          walletAddress = json.walletAddress;
        }
      } catch {
        // Backend failed, fall back to client-derived address
      }
      const address = walletAddress || clientAddress;

      // Always fetch balance client-side so networkMode (mainnet vs devnet) is respected.
      let balanceUSD = 0;
      if (address) {
        const row = await queryClient.fetchQuery({
          queryKey: embeddedSolanaUsdcBalanceQueryKey(address, networkMode),
          queryFn: () => fetchEmbeddedSolanaUsdcBalance(address, networkMode),
          staleTime: EMBEDDED_SOLANA_USDC_BALANCE_STALE_MS,
        });
        balanceUSD = row.balanceUSD;
      }
      return { balanceUSD, walletAddress: address ?? undefined };
    },
    enabled: enabled && authenticated === true && !!getAccessToken && !!user?.id,
  });

  const balanceUSD = balanceData?.balanceUSD ?? 0;
  const senderAddress =
    balanceData?.walletAddress ?? deriveSolanaEmbeddedAddress(user);
  const isBalanceLoading = enabled && balanceData === undefined;

  const makePayment = async (
    config: SolanaPaymentConfig
  ): Promise<string> => {
    if (!senderAddress) {
      throw new Error(
        "Embedded wallet not found. Please try logging out and logging back in."
      );
    }
    if (balanceUSD < config.amount) {
      throw new Error(
        `Insufficient USDC balance. Required: ${config.amount.toFixed(2)} USDC, Available: ${balanceUSD.toFixed(4)} USDC. Please top up your wallet.`
      );
    }
    const wallet = standardWallets?.find((w) => w.address === senderAddress);
    if (!wallet) {
      throw new Error(
        "No embedded wallet found. Please try logging out and logging back in."
      );
    }

    setIsLoading(true);
    try {
      const conn = new Connection(getRpcForMode(networkMode), "confirmed");
      return await sendUsdcWithPrivyEmbeddedWallet({
        senderAddress,
        recipientAddress: config.recipientAddress.trim(),
        amountUSDC: config.amount,
        connection: conn,
        wallet,
        privyUserId: user?.id,
        signTransaction,
        signAndSendTransaction,
        usdcMint: getUsdcMintForMode(networkMode),
        chain: getPrivySolanaChainForMode(networkMode),
        skipLooftaFeePayer: networkMode === "mainnet",
      });
    } catch (error: any) {
      if (
        error?.message?.includes("user rejected") ||
        error?.message?.includes("denied") ||
        error?.message?.includes("User denied")
      ) {
        throw new Error("Payment was cancelled by user");
      }
      if (
        error?.message?.includes("insufficient") ||
        error?.message?.includes("Insufficient")
      ) {
        throw new Error(
          "Insufficient USDC balance for this transaction. Please try again."
        );
      }
      if (
        error?.message?.includes("network") ||
        error?.message?.includes("connection") ||
        error?.message?.includes("simulation")
      ) {
        throw new Error(
          "Network or simulation error. Please check your connection and try again."
        );
      }
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    makePayment,
    isLoading,
    senderAddress,
    balanceUSD,
    isBalanceLoading,
    hasInsufficientBalance: (amount: number) => {
      if (balanceData === undefined) return false;
      return balanceUSD < amount;
    },
    hasEnoughBalance: (amount: number) => balanceUSD >= amount,
    refreshBalance,
  };
}
