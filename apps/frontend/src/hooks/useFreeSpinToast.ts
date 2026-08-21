"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";
import { getMyPackStatus } from "@/services/api/packs";

/**
 * Surfaces a persistent nudge whenever the user has an admin-granted, unclaimed free Mystery
 * Pack spin waiting — same recipe as useUnclaimedGiftToast.ts, just reading
 * GET /lottery/packs/my-status instead of GET /lottery/my-unclaimed-gifts. Shows on every
 * authenticated page load, not just once, until opened or explicitly dismissed for the session.
 */
export function useFreeSpinToast() {
  const { authenticated, userId, getAccessToken } = useAuth();
  const networkMode = useAuthStore((s) => s.networkMode);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["megapot-packs", "free-spin", userId ?? "", networkMode],
    queryFn: async () => {
      const token = await getAccessToken().catch(() => null);
      if (!userId) return false;
      return getMyPackStatus(userId, token).then((s) => s.hasFreeSpin).catch(() => false);
    },
    enabled: Boolean(authenticated && userId),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  // If the free spin appears (a new grant lands) after an earlier dismiss, un-dismiss so the
  // nudge reflects the current true state instead of a stale dismiss.
  useEffect(() => {
    setDismissed(false);
  }, [data]);

  const hasFreeSpin = data === true && !dismissed;
  return { hasFreeSpin, dismiss: () => setDismissed(true) };
}
