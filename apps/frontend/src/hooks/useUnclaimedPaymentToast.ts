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
    status?: string;
    paid_at?: string | null;
  }>;
  // recipient_address is present for still-PENDING_EMAIL/PENDING_USERNAME/PENDING_SOCIAL rows —
  // see normalisePayment() in app/api/payments/history/route.ts — which covers an unregistered
  // recipient. But every claim now routes through a burner regardless of registration (universal
  // claim architecture), so a REGISTERED recipient's payment can just as easily be sitting
  // unswept — that case has no recipient_address (it's a real wallet, stripped from the
  // response) but is reliably flagged by status === PRIVATE_TRANSFER_PENDING instead (the same
  // signal the history page's own "Unclaimed" sort already relies on). Check both — but always
  // require paid_at too: an old row can sit at PRIVATE_TRANSFER_PENDING with paid_at still null
  // (the sender's payment never actually completed — abandoned, pre-dates the current burner
  // flow, whatever), and that's not "waiting to land," it's dead. Without this a months-old,
  // never-funded claim surfaces as an urgent nudge every time.
  return received
    .filter((c) => !!c.paid_at && (!!c.recipient_address || String(c.status || "").toUpperCase() === "PRIVATE_TRANSFER_PENDING"))
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
