"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";

export type UnclaimedPayment = { id: string; short_id: string | null; amount: string };

async function fetchUnclaimedPayments(
  accessToken: string | null,
  networkMode?: string,
): Promise<UnclaimedPayment[]> {
  const headers: Record<string, string> = accessToken ? { authorization: `Bearer ${accessToken}` } : {};
  const params = networkMode ? `?network=${networkMode}` : "";
  const r = await fetch(`/api/payments/history${params}`, { headers, cache: "no-store" });
  if (!r.ok) return [];
  const data = await r.json().catch(() => null);
  const received = (data?.received ?? []) as Array<{
    id: string;
    short_id?: string | null;
    amount: string;
    recipient_address?: string;
  }>;
  // recipient_address is only ever present for still-PENDING_EMAIL/PENDING_USERNAME rows —
  // see normalisePayment() in app/api/payments/history/route.ts. Its presence alone means
  // "funded but not yet swept to this user's wallet," i.e. unclaimed.
  return received
    .filter((c) => !!c.recipient_address)
    .map((c) => ({ id: c.id, short_id: c.short_id ?? null, amount: c.amount }));
}

/**
 * Surfaces a persistent nudge whenever the user has payments sent to their pending
 * username/email/X handle that are funded but not yet claimed. Shows on every authenticated
 * page load, not just once — the money genuinely hasn't moved, so it should keep showing until
 * either claimed or explicitly dismissed for the current visit. Re-checked whenever the caller
 * invalidates the ["payments", "unclaimed-nudge"] query key — UserMenu does this right after a
 * successful email/Twitter link, since that's exactly when a previously-unmatchable payment can
 * suddenly resolve to this account.
 */
export function useUnclaimedPaymentToast() {
  const { authenticated, userId, getAccessToken } = useAuth();
  const networkMode = useAuthStore((s) => s.networkMode);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["payments", "unclaimed-nudge", userId ?? "", networkMode],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      return fetchUnclaimedPayments(token, networkMode);
    },
    enabled: Boolean(authenticated && userId),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  // If the unclaimed set changes (a new one arrives, or the count shrinks after claiming one of
  // several) un-dismiss so the nudge reflects the current true state instead of a stale dismiss.
  const idsKey = (data ?? []).map((p) => p.id).sort().join(",");
  useEffect(() => {
    setDismissed(false);
  }, [idsKey]);

  const unclaimed = data && data.length > 0 && !dismissed ? data : null;
  return { unclaimed, dismiss: () => setDismissed(true) };
}
