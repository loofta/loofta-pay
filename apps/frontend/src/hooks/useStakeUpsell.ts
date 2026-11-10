"use client";

import { useCallback, useState } from "react";
import bs58 from "bs58";
import { useSignAndSendTransaction, useSignMessage } from "@privy-io/react-auth/solana";
import posthog from "posthog-js";
import {
  ampleBuildDeposit,
  ampleChallenge,
  ampleLink,
  ampleTxStatus,
  getAmpleStatus,
} from "@/services/api/ample";

/** Smallest stake the withdrawal upsell offers. */
export const STAKE_UPSELL_MIN_USDC = 1;
/** Below this balance the upsell is hidden so it can never eat the whole withdrawal. */
export const STAKE_UPSELL_MIN_BALANCE_USDC = 2;
/** Estimate only (Ample's tickets-per-dollar is not exposed by the API). Matches the /stake page. */
export const TICKETS_PER_DOLLAR = 100;

function toBase(n: number, decimals: number): string {
  const [w, f = ""] = n.toFixed(decimals).split(".");
  return (w + f.padEnd(decimals, "0")).replace(/^0+/, "") || "0";
}

/**
 * "Stake to win" add-on shown on every withdrawal path: stakes a small USDC amount (min $1) from the user's own
 * Loofta wallet into the Ample vault before the withdrawal runs. Soft-fail by design: returns false instead of
 * throwing so the add-on never blocks the withdrawal itself.
 */
export function useStakeUpsell(
  getAccessToken: () => Promise<string | null>,
  userId: string | undefined,
  source: string,
) {
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signMessage } = useSignMessage();
  const [on, setOn] = useState(false);
  const [amount, setAmountState] = useState(STAKE_UPSELL_MIN_USDC);

  const set = useCallback((checked: boolean, next: number) => {
    setOn(checked);
    setAmountState(Math.max(STAKE_UPSELL_MIN_USDC, Math.round((Number.isFinite(next) ? next : STAKE_UPSELL_MIN_USDC) * 100) / 100));
  }, []);

  const buy = useCallback(async (wallet: { address: string } | undefined | null, stakeUsdc: number = amount): Promise<boolean> => {
    if (!wallet?.address || !(stakeUsdc >= STAKE_UPSELL_MIN_USDC)) return false;
    try {
      const o = { userId, accessToken: await getAccessToken().catch(() => null) };
      const status = await getAmpleStatus(o);
      const vault = status.vaults?.[0];
      if (!status.enabled || !vault) return false;
      if (!status.linked) {
        const ch = await ampleChallenge(wallet.address, o);
        const { signature } = await signMessage({
          message: new TextEncoder().encode(ch.message),
          wallet: wallet as never,
          options: { uiOptions: { showWalletUIs: false } },
        } as never);
        await ampleLink({ walletAddress: wallet.address, message: ch.message, signature: bs58.encode(signature as Uint8Array) }, o);
      }
      const decimals = vault.token?.decimals ?? 6;
      const tx = await ampleBuildDeposit(vault.id, toBase(stakeUsdc, decimals), o);
      const bytes = Uint8Array.from(atob(tx.transaction.unsigned), (c) => c.charCodeAt(0));
      const { signature } = await signAndSendTransaction({
        transaction: bytes,
        wallet: wallet as never,
        options: { uiOptions: { showWalletUIs: false } },
      } as never);
      const sig = bs58.encode(signature as Uint8Array);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const st = await ampleTxStatus(sig, o).catch(() => null);
        if (st?.status === "SUCCESS") {
          posthog.capture("stake_upsell_purchased", { source, amount_usdc: stakeUsdc });
          return true;
        }
        if (st?.status === "FAILED") break;
      }
      posthog.capture("stake_upsell_failed", { source });
      return false;
    } catch (err) {
      console.warn("[stake] upsell stake failed:", err);
      posthog.capture("stake_upsell_failed", { source });
      return false;
    }
  }, [amount, getAccessToken, userId, signMessage, signAndSendTransaction, source]);

  return { on, amount, cost: on ? amount : 0, set, buy };
}
