"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets,
  useSignAndSendTransaction,
} from "@privy-io/react-auth/solana";
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { buildUSDCTransferTransaction } from "@/services/solanaTransfer";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "https://loofta-pay-preview.up.railway.app";
const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (process.env.NEXT_PUBLIC_HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_HELIUS_API_KEY}`
    : "https://api.mainnet-beta.solana.com");

function deriveSolanaEmbeddedAddress(user: { linked_accounts?: Array<{ type?: string; address?: string }>; linkedAccounts?: Array<{ type?: string; address?: string }> } | null): string | null {
  if (!user) return null;
  const linkedAccounts = ((user as any)?.linkedAccounts ?? (user as any)?.linked_accounts ?? []) as Array<{ type?: string; address?: string }>;
  const base58 = (a: { address?: string }) =>
    a?.address && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.address);
  const embedded = linkedAccounts.find(
    (a) =>
      (a.type === "solana_embedded_wallet" || a.type === "solana") && base58(a)
  );
  if (embedded?.address) return embedded.address;
  const wallet = linkedAccounts.find((a) => a.type === "wallet" && base58(a));
  return wallet?.address ?? null;
}

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
  const [isLoading, setIsLoading] = useState(false);

  const { data: balanceData, refetch: refreshBalance } = useQuery({
    queryKey: ["solanaPaymentBalance", user?.id],
    queryFn: async () => {
      const token = await getAccessToken?.();
      if (!token || !user?.id) throw new Error("Not authenticated");
      const r = await fetch(`${BACKEND_URL}/users/me/wallet/balance`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-privy-user-id": user.id,
        },
      });
      if (!r.ok) throw new Error("Failed to fetch balance");
      const json = (await r.json()) as {
        balanceUSD?: number;
        walletAddress?: string;
      };
      return json;
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
      const conn = new Connection(SOLANA_RPC_URL, "confirmed");
      const unsignedTx = await buildUSDCTransferTransaction({
        senderAddress,
        recipientAddress: config.recipientAddress.trim(),
        amountUSDC: config.amount,
        connection: conn,
      });
      const { signature } = await signAndSendTransaction({
        transaction: unsignedTx.serialize(),
        wallet,
        options: { sponsor: true } as never,
      });
      return bs58.encode(signature);
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
