"use client";

// Self-contained (fetches/holds its own state, unlike the other admin tabs which lift state
// into AdminDashboard.tsx) — this panel is small enough that mirroring that pattern would mean
// touching AdminDashboard's already-large state block for little benefit.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface AdminPackTier {
  tierKey: string;
  ticketsAwarded: number;
  weight: number;
  rarity: string;
  enabled: boolean;
  displayOrder: number;
}

function oddsLabel(weight: number): string {
  if (weight >= 0.01) return `${(weight * 100).toFixed(2)}%`;
  return `1 in ${Math.round(1 / weight).toLocaleString()}`;
}

export function PacksTab() {
  const { getAccessToken } = usePrivy();
  const [tiers, setTiers] = useState<AdminPackTier[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const fetchTiers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/lottery/packs/tiers", { headers: await authHeaders() });
      if (!res.ok) throw new Error("Failed to load pack tiers");
      setTiers(await res.json());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pack tiers");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchTiers(); }, [fetchTiers]);

  // Toggling a tier never touches any other tier's weight — a disabled tier's roll just falls
  // back to the next-lower enabled one (see PackService.rollTier) — so this is always a safe,
  // isolated, instantly-reversible flip with zero effect on the other tiers' real odds.
  const toggleTier = useCallback(async (tierKey: string, enabled: boolean) => {
    setTogglingKey(tierKey);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lottery/packs/tiers/${tierKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed to update tier");
      const updated: AdminPackTier = await res.json();
      setTiers(prev => prev?.map(t => (t.tierKey === updated.tierKey ? updated : t)) ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to update tier");
    } finally {
      setTogglingKey(null);
    }
  }, [authHeaders]);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-800 p-4 space-y-1">
        <div className="text-base font-semibold text-gray-200">Mystery Pack tiers</div>
        <div className="text-sm text-gray-500">
          Disabling a tier doesn&apos;t change any odds shown to users or any other tier&apos;s weight —
          its roll just falls back to the next-lower enabled tier. Safe to flip on/off any time.
        </div>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
        {loading && !tiers && (
          <div className="p-4 flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {tiers?.map(tier => (
          <div key={tier.tierKey} className="flex items-center justify-between p-4">
            <div>
              <div className="text-base font-medium text-gray-200 flex items-center gap-2">
                {tier.ticketsAwarded} ticket{tier.ticketsAwarded === 1 ? "" : "s"}
                <span className="text-xs uppercase tracking-wide text-gray-500">{tier.rarity}</span>
              </div>
              <div className="text-sm text-gray-500 tabular-nums">{oddsLabel(tier.weight)}</div>
            </div>
            <div className="flex items-center gap-2">
              {togglingKey === tier.tierKey && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
              <Switch
                checked={tier.enabled}
                disabled={togglingKey === tier.tierKey}
                onCheckedChange={(checked) => toggleTier(tier.tierKey, checked)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
