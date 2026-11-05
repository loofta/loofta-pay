"use client";

import { useCallback } from "react";
import bs58 from "bs58";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import posthog from "posthog-js";

/** The upsell buys one seat in PoolRip's Death room for the $25 pack (a seat there is a tenth of the pack). */
export const POOLRIP_SEAT_LANE = "death-25";
export const POOLRIP_SEAT_PRICE_USDC = 2.5;
/** Below this balance the upsell is hidden so it can never eat the whole withdrawal. */
export const POOLRIP_SEAT_MIN_BALANCE_USDC = POOLRIP_SEAT_PRICE_USDC * 2;

type Json = Record<string, any>;

class PoolRipError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

async function poolrip<T = Json>(path: string, token: string | null, method: "GET" | "POST" | "PUT", body?: Json): Promise<T> {
  const res = await fetch(`/api/poolrip/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PoolRipError(data?.error ?? data?.message ?? "PoolRip request failed", res.status, data?.code);
  return data as T;
}

/**
 * Takes a Death room seat in PoolRip from the user's Loofta wallet. PoolRip logs in with the same Privy app, so the
 * same token and the same embedded wallet work there: reserve the seat (nobody is charged if the room is full), pay
 * from the wallet with no pop-up, confirm against the hold, then set round one's pre-vote to "yes" so the seat
 * takes someone out on its own. Soft-fail by design: returns false instead of throwing so a failed add-on never
 * blocks the withdrawal itself, and a released hold means nothing was charged.
 *
 * `source` names the surface that offered the seat (e.g. "withdraw_solana"), sent with every PostHog event.
 */
export function usePoolRipSeat(getAccessToken: () => Promise<string | null>, source: string) {
  const { signAndSendTransaction } = useSignAndSendTransaction();
  return useCallback(async (wallet: { address: string } | undefined | null): Promise<boolean> => {
    if (!wallet?.address) return false;
    let holdId: string | null = null;
    let token: string | null = null;
    try {
      token = await getAccessToken();
      const cfg = await poolrip<{ network?: string }>("config", null, "GET").catch(() => ({} as { network?: string }));
      const chain = cfg.network === "devnet" ? "solana:devnet" : "solana:mainnet";
      const prep = await poolrip<{ txBase64: string; holdId: string | null; queue: boolean }>(
        `lanes/${POOLRIP_SEAT_LANE}/join-tx`, token, "POST", { amountUsdc: POOLRIP_SEAT_PRICE_USDC },
      );
      holdId = prep.holdId;
      const bytes = Uint8Array.from(atob(prep.txBase64), (c) => c.charCodeAt(0));
      const { signature } = await signAndSendTransaction({
        transaction: bytes,
        wallet: wallet as never,
        chain,
        options: { uiOptions: { showWalletUIs: false } },
      } as never);
      const sig = bs58.encode(signature as Uint8Array);
      // The payment is on-chain now, so confirming is retried: it must not give up on a network blip.
      let res: { appliedUsdc: number; refundedUsdc: number; poolId: string | null } | null = null;
      for (let attempt = 0; !res; attempt++) {
        try {
          res = await poolrip(`lanes/${POOLRIP_SEAT_LANE}/join`, await getAccessToken(), "POST", {
            paymentTxHash: sig, amountUsdc: POOLRIP_SEAT_PRICE_USDC, holdId,
          });
        } catch (e) {
          const retriable = !(e instanceof PoolRipError) || e.status >= 500 || /not found on-chain/i.test(e.message);
          if (attempt >= 3 || !retriable) throw e;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      holdId = null; // consumed
      if (res.appliedUsdc <= 0) {
        // The room filled before the payment landed: PoolRip sends the money straight back.
        posthog.capture("poolrip_seat_refunded", { source });
        return false;
      }
      if (res.poolId) {
        // Seat is held; the auto-vote is a bonus, so a failure here never undoes the purchase.
        await poolrip(`pools/${res.poolId}/prevote`, await getAccessToken(), "PUT", { plan: ["yes"] }).catch((e) => console.warn("[poolrip] pre-vote failed:", e));
      }
      posthog.capture("poolrip_seat_purchased", { source, price_usdc: POOLRIP_SEAT_PRICE_USDC });
      return true;
    } catch (err) {
      if (holdId) void poolrip(`holds/${holdId}/release`, token, "POST").catch(() => undefined);
      console.warn("[poolrip] seat add-on failed:", err);
      posthog.capture("poolrip_seat_failed", { source });
      return false;
    }
  }, [getAccessToken, signAndSendTransaction, source]);
}
