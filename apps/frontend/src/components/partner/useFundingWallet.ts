"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallets as useSolanaWallets } from "@privy-io/react-auth/solana";
import { Connection, PublicKey } from "@solana/web3.js";
import { useAuthStore } from "@/store/auth";
import { getRpcForMode, getUsdcMintForMode } from "@/lib/solanaRpc";

/**
 * The wallet that funds payouts and its USDC balance, shared by the header (which shows the
 * balance) and the Payouts tab (which picks the wallet and signs with it).
 */
export function useFundingWallet(enabled = true) {
  const networkMode = useAuthStore((s) => s.networkMode);
  const mode = networkMode === "mainnet" ? "mainnet" : "devnet";
  const { wallets } = useSolanaWallets();
  const [selected, setSelected] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);

  const wallet = wallets.find((w) => w.address === selected) ?? wallets[0] ?? null;
  const address = wallet?.address ?? null;

  const refresh = useCallback(async () => {
    if (!address || !enabled) return;
    try {
      const conn = new Connection(getRpcForMode(mode), "confirmed");
      const tokens = await conn.getParsedTokenAccountsByOwner(new PublicKey(address), { mint: getUsdcMintForMode(mode) });
      setUsdc(tokens.value.reduce((a, t) => a + (Number(t.account.data.parsed?.info?.tokenAmount?.uiAmount) || 0), 0));
    } catch {
      setUsdc(null);
    }
  }, [address, mode, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { wallets, wallet, address, select: setSelected, usdc, refresh };
}

export type FundingWallet = ReturnType<typeof useFundingWallet>;
