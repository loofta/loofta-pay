"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";
import { getMyUnclaimedGifts, type UnclaimedGift } from "@/services/api/lotteryGift";

/**
 * Surfaces a persistent nudge whenever the user has Megapot ticket gifts sent to them that are
 * still unclaimed — same recipe as useUnclaimedPaymentToast.ts, just querying lottery_gifts
 * (via GET /lottery/my-unclaimed-gifts) instead of the payments table. Shows on every
 * authenticated page load, not just once, until claimed or explicitly dismissed for the session.
 */
export function useUnclaimedGiftToast() {
  const { authenticated, userId, getAccessToken } = useAuth();
  const networkMode = useAuthStore((s) => s.networkMode);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["lottery", "unclaimed-gifts", userId ?? "", networkMode],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      if (!userId) return [] as UnclaimedGift[];
      return getMyUnclaimedGifts(userId, token).catch(() => [] as UnclaimedGift[]);
    },
    enabled: Boolean(authenticated && userId),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  // If the unclaimed set changes (a new one arrives, or the count shrinks after claiming one of
  // several) un-dismiss so the nudge reflects the current true state instead of a stale dismiss.
  const idsKey = (data ?? []).map((g) => g.shortId).sort().join(",");
  useEffect(() => {
    setDismissed(false);
  }, [idsKey]);

  const unclaimed = data && data.length > 0 && !dismissed ? data : null;
  return { unclaimed, dismiss: () => setDismissed(true) };
}
