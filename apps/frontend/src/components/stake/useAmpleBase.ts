"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RequestOptions } from "@/services/api/client";
import { getAmpleEvmOverview, getAmpleEvmStats, getAmpleEvmStatus, type AmpleEvmOverview, type AmpleEvmStatus, type AmpleStats } from "@/services/api/ample";

const STATS_CACHE_KEY = "loofta_earn_stats_v1";

/**
 * Earn's larger pool (on Base). The person never touches Base: their Earn account is held by the backend with the gas
 * paid by Rhinestone, funded from and returned to their Solana wallet. This hook only reads the state; the money
 * moves through the /ample/evm/fund and /ample/evm/withdraw routes.
 */
export function useAmpleBase({ enabled, opts }: { enabled: boolean; opts: () => Promise<RequestOptions> }) {
  const [status, setStatus] = useState<AmpleEvmStatus | null>(null);
  const [overview, setOverview] = useState<AmpleEvmOverview | null>(null);
  const [loading, setLoading] = useState(true);
  // The public numbers need no sign-in, so they load straight away. The last values are remembered, so the page shows
  // them instantly next time and never flashes a different number while it loads.
  const [cached, setCached] = useState<AmpleStats | null>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem(STATS_CACHE_KEY); if (raw) setCached(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  const stats = useQuery({
    queryKey: ["ample-evm-stats"],
    queryFn: async () => {
      const d = await getAmpleEvmStats();
      try { if (d) localStorage.setItem(STATS_CACHE_KEY, JSON.stringify(d)); } catch { /* ignore */ }
      return d;
    },
    staleTime: 120_000,
    retry: 1,
  });

  const refresh = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    try {
      const o = await opts();
      const s = await getAmpleEvmStatus(o);
      setStatus(s);
      // Nothing is linked until the first deposit, so there is nothing to read before then.
      setOverview(s.enabled && s.linked ? await getAmpleEvmOverview(o).catch(() => null) : null);
    } catch {
      /* the page keeps working on the old pool if this cannot load */
    } finally {
      setLoading(false);
    }
  }, [enabled, opts]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { status, overview, loading, stats: stats.data ?? cached, statsLoading: stats.isLoading && !cached, vault: status?.vault ?? null, refresh };
}
