"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";

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
  const { getAccessToken, user, authenticated } = usePrivy();
  const { wallets: standardWallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signTransaction } = useSignTransaction();
  const networkMode = useAuthStore((s) => s.networkMode);
  const [isLoading, setIsLoading] = useState(false);

  // Address resolution: backend gives canonical wallet address; falls back to client-derived.
  // Long stale time — address never changes once set.
  const { data: addressData } = useQuery({
    queryKey: ["solanaPaymentAddress", user?.id, networkMode],
    queryFn: async () => {
      const token = await getAccessToken?.();
      if (!token || !user?.id) throw new Error("Not authenticated");
      const clientAddress = deriveSolanaEmbeddedAddress(user);
      let walletAddress: string | undefined;
      try {
        const r = await fetch(`${BACKEND_URL}/users/me/wallet/balance`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (r.ok) {
          const json = (await r.json()) as { walletAddress?: string };
          walletAddress = json.walletAddress;
        }
      } catch {
        // Backend failed, fall back to client-derived address
      }
      return { walletAddress: walletAddress || clientAddress };
    },
    staleTime: 5 * 60 * 1000,
    enabled: enabled && authenticated === true && !!getAccessToken && !!user?.id,
  });

  // Balance from the shared hook — same cache entry as the header (auto-polls every 5s).
  const { balanceUSD, isLoading: isBalanceFetching, refetch: refreshBalance } =
    useEmbeddedSolanaUsdcBalance({ enabled: enabled && authenticated === true });

  const senderAddress =
    addressData?.walletAddress ?? deriveSolanaEmbeddedAddress(user);
  const isBalanceLoading = enabled && isBalanceFetching;

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
      const accessToken = await getAccessToken?.();
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
        accessToken,
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
      if (isBalanceFetching) return false;
      return balanceUSD < amount;
    },
    hasEnoughBalance: (amount: number) => balanceUSD >= amount,
    refreshBalance,
  };
}
