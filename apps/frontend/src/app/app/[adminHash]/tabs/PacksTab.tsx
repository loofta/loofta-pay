"use client";

// Self-contained (fetches/holds its own state, unlike the other admin tabs which lift state
// into AdminDashboard.tsx) — this panel is small enough that mirroring that pattern would mean
// touching AdminDashboard's already-large state block for little benefit.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface AdminPackTier {
  tierKey: string;
  ticketsAwarded: number;
  weight: number;
  rarity: string;
  enabled: boolean;
  displayOrder: number;
}

interface TreasuryStatus {
  balanceUsdc: number;
  minRequiredUsdc: number;
  sufficient: boolean;
  treasuryAddress: string;
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
  const [treasury, setTreasury] = useState<TreasuryStatus | null>(null);

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

  const fetchTreasury = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/lottery/packs/treasury", { headers: await authHeaders() });
      if (!res.ok) return;
      setTreasury(await res.json());
    } catch { /* non-critical — tier list above still loads/works without this */ }
  }, [authHeaders]);

  useEffect(() => { fetchTiers(); fetchTreasury(); }, [fetchTiers, fetchTreasury]);

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
      {/* Treasury funds every pack win's real ticket purchase — if it can't cover the largest
          payout an enabled tier could hit, buildPaymentTx refuses to charge anyone (see
          pack.service.ts) and the consumer page shows packs as paused. This is the "add funds"
          signal so that's caught here, before a real user ever hits it. */}
      {treasury && !treasury.sufficient && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-base font-semibold text-amber-300">
            <AlertTriangle className="w-4 h-4" /> Add funds — treasury balance low
          </div>
          <div className="text-sm text-amber-200/80">
            Treasury holds ${treasury.balanceUsdc.toFixed(2)} USDC, below the ${treasury.minRequiredUsdc} needed to
            cover the largest current payout. Packs are paused for users until this is topped up.
          </div>
          <div className="text-sm font-mono text-amber-200/60 break-all">{treasury.treasuryAddress}</div>
        </div>
      )}

      <div className="rounded-xl border border-gray-800 p-4 space-y-1">
        <div className="text-base font-semibold text-gray-200">Mystery Pack tiers</div>
        <div className="text-sm text-gray-500">
          Disabling a tier doesn&apos;t change any odds shown to users or any other tier&apos;s weight —
          its roll just falls back to the next-lower enabled tier. Safe to flip on/off any time.
        </div>
        {treasury && (
          <div className="text-sm text-gray-500 tabular-nums pt-1">
            Treasury balance: <span className={treasury.sufficient ? "text-emerald-400" : "text-amber-300"}>${treasury.balanceUsdc.toFixed(2)}</span> USDC
          </div>
        )}
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
