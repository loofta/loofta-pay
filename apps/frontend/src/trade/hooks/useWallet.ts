"use client";

import { useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";

/** The user's Privy embedded Solana wallet plus the signer. Same wallet as the web app for the same Privy user. */
export function useWallet() {
  const { user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();
  const wallet = useMemo(() => {
    const list = wallets ?? [];
    return list.find((w) => (w as { walletClientType?: string }).walletClientType === "privy") ?? list[0];
  }, [wallets]);
  return { wallet, address: wallet?.address ?? null, userId: user?.id ?? null, getAccessToken, signTransaction };
}
