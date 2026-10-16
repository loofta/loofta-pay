"use client";

import { useCallback } from "react";
import bs58 from "bs58";
import { useSignAndSendTransaction } from "@privy-io/react-auth/solana";

/** One chance to win today costs this much USDC, taken from the user's balance. */
export const CHANCE_PRICE_USDC = 1;
/** Below this balance the upsell is hidden so it can never eat the whole withdrawal. */
export const CHANCE_MIN_BALANCE_USDC = CHANCE_PRICE_USDC * 2;

function quickPick() {
  const s = new Set<number>();
  while (s.size < 5) s.add(Math.ceil(Math.random() * 30));
  return { main: [...s].sort((a, b) => a - b), bonus: Math.ceil(Math.random() * 5) };
}

/**
 * Buys one quick-pick chance for the daily draw from the user's Loofta wallet (same
 * /api/lottery/buy + buy-confirm public route as the Megapot page). Soft-fail by design:
 * returns false instead of throwing so a failed add-on never blocks the withdrawal itself.
 */
/** Most chances one purchase can add (matches the per-call cap on picked tickets). */
export const MAX_CHANCES_PER_BUY = 10;

export function useChanceTicket(getAccessToken: () => Promise<string | null>) {
  const { signAndSendTransaction } = useSignAndSendTransaction();
  return useCallback(async (wallet: { address: string } | undefined | null, count = 1): Promise<boolean> => {
    if (!wallet?.address) return false;
    const n = Math.min(MAX_CHANCES_PER_BUY, Math.max(1, Math.floor(count)));
    try {
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const picks = Array.from({ length: n }, quickPick);
      const initRes = await fetch("/api/lottery/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          numTickets: n,
          userSolanaAddress: wallet.address,
          tickets: picks.map((p) => ({ main: p.main, bonus: p.bonus })),
          route: "solana_public",
        }),
      });
      if (!initRes.ok) throw new Error("Failed to buy chance");
      const { ticketId, txBase64 } = await initRes.json();
      const { signature } = await signAndSendTransaction({
        transaction: Buffer.from(txBase64, "base64") as unknown as Uint8Array,
        wallet: wallet as never,
      });
      await fetch("/api/lottery/buy-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ ticketId, senderTxHash: bs58.encode(signature as Uint8Array) }),
      });
      return true;
    } catch (err) {
      console.warn("[chance] add-on failed:", err);
      return false;
    }
  }, [getAccessToken, signAndSendTransaction]);
}
