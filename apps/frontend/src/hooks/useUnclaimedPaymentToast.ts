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
  if (!r.ok) {
    console.log("[unclaimed-nudge] history fetch failed", r.status);
    return [];
  }
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
  const unclaimed = received
    .filter((c) => !!c.recipient_address)
    .map((c) => ({ id: c.id, short_id: c.short_id ?? null, amount: c.amount }));
  console.log(
    "[unclaimed-nudge] received:",
    received.length,
    "unclaimed:",
    unclaimed.length,
    unclaimed.map((c) => c.short_id ?? c.id),
  );
  return unclaimed;
}

function seenKey(userId: string): string {
  return `loofta_unclaimed_toast_seen:${userId}`;
}

/**
 * Nudges the user once per browser session when they have payments sent to their pending
 * username/email/X handle that are funded but not yet claimed. Re-checked whenever the caller
 * invalidates the ["payments", "unclaimed-nudge"] query key — UserMenu does this right after a
 * successful email/Twitter link, since that's exactly when a previously-unmatchable payment can
 * suddenly resolve to this account.
 */
export function useUnclaimedPaymentToast() {
  const { authenticated, userId, getAccessToken } = useAuth();
  const networkMode = useAuthStore((s) => s.networkMode);
  const [visible, setVisible] = useState<UnclaimedPayment[] | null>(null);

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

  useEffect(() => {
    if (!userId || !data || data.length === 0) {
      console.log("[unclaimed-nudge] nothing to show", { userId, dataLength: data?.length });
      return;
    }
    const ids = data.map((p) => p.id).sort().join(",");
    let seen: string | null = null;
    try {
      seen = sessionStorage.getItem(seenKey(userId));
    } catch {
      /* sessionStorage unavailable — just show it */
    }
    console.log("[unclaimed-nudge] ids:", ids, "seen this session:", seen, "will show:", seen !== ids);
    if (seen === ids) return;
    try {
      sessionStorage.setItem(seenKey(userId), ids);
    } catch {
      /* non-critical */
    }
    setVisible(data);
  }, [data, userId]);

  return { unclaimed: visible, dismiss: () => setVisible(null) };
}
