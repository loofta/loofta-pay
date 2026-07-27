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

interface AdminPackOpening {
  id: string;
  created_at: string;
  user_id: string;
  username: string | null;
  tier_key: string;
  tickets_awarded: number;
  rarity: string;
  cost_usdc: number;
  is_test: boolean;
  payment_tx_hash: string | null;
  lottery_ticket_id: string | null;
  status: string;
  purchase_failure_reason: string | null;
  retry_count: number;
}

function oddsLabel(weight: number): string {
  if (weight >= 0.01) return `${(weight * 100).toFixed(2)}%`;
  return `1 in ${Math.round(1 / weight).toLocaleString()}`;
}

function shortUserId(userId: string): string {
  const bare = userId.replace(/^did:privy:/, "");
  return bare.length > 10 ? `${bare.slice(0, 10)}…` : bare;
}

export function PacksTab() {
  const { getAccessToken } = usePrivy();
  const [tiers, setTiers] = useState<AdminPackTier[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [treasury, setTreasury] = useState<TreasuryStatus | null>(null);

  const [dailyLimit, setDailyLimit] = useState<number | null>(null);
  const [dailyLimitInput, setDailyLimitInput] = useState<string>("");
  const [savingLimit, setSavingLimit] = useState(false);

  const [openings, setOpenings] = useState<AdminPackOpening[] | null>(null);
  // total = every row (real+demo), what pagination is based on; realTotal excludes demo opens —
  // that's the number shown as "how many packs have actually been opened."
  const [openingsTotal, setOpeningsTotal] = useState(0);
  const [openingsRealTotal, setOpeningsRealTotal] = useState(0);
  const [openingsPage, setOpeningsPage] = useState(1);
  const [openingsLoading, setOpeningsLoading] = useState(false);

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

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/lottery/packs/settings", { headers: await authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setDailyLimit(data.dailyOpenLimit ?? null);
      setDailyLimitInput(data.dailyOpenLimit != null ? String(data.dailyOpenLimit) : "");
    } catch { /* non-critical */ }
  }, [authHeaders]);

  const fetchOpenings = useCallback(async (page: number) => {
    setOpeningsLoading(true);
    try {
      const res = await fetch(`/api/admin/lottery/packs/openings?page=${page}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error("Failed to load pack openings");
      const data = await res.json();
      setOpenings(data.data ?? []);
      setOpeningsTotal(data.total ?? 0);
      setOpeningsRealTotal(data.realTotal ?? 0);
      setOpeningsPage(page);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pack openings");
    } finally {
      setOpeningsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchTiers(); fetchTreasury(); fetchSettings(); fetchOpenings(1); }, [fetchTiers, fetchTreasury, fetchSettings, fetchOpenings]);

  // Empty input clears the limit (unlimited) — anything else must be a positive integer, matching
  // PackService.setDailyOpenLimit's own validation (this is just the earlier, friendlier check).
  const saveDailyLimit = useCallback(async () => {
    const trimmed = dailyLimitInput.trim();
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1)) {
      setError("Daily limit must be a positive whole number, or empty for unlimited");
      return;
    }
    setSavingLimit(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/lottery/packs/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ dailyOpenLimit: parsed }),
      });
      if (!res.ok) throw new Error("Failed to update daily limit");
      const data = await res.json();
      setDailyLimit(data.dailyOpenLimit ?? null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to update daily limit");
    } finally {
      setSavingLimit(false);
    }
  }, [authHeaders, dailyLimitInput]);

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

      {/* Daily open limit — enforced server-side in PackService.buildPaymentTx (refuses to build
          the charge at all once a user hits it, same "block before payment" approach as the
          treasury check above) and surfaced to the consumer page via GET /packs/my-status. */}
      <div className="rounded-xl border border-gray-800 p-4 space-y-2">
        <div className="text-base font-semibold text-gray-200">Daily open limit per user</div>
        <div className="text-sm text-gray-500">
          Leave empty for unlimited. Demo opens never count toward this — only real, paid opens do.
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input
            type="number"
            min={1}
            step={1}
            placeholder="Unlimited"
            value={dailyLimitInput}
            onChange={(e) => setDailyLimitInput(e.target.value)}
            className="w-32 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-gray-500"
          />
          <button
            onClick={saveDailyLimit}
            disabled={savingLimit}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-medium text-gray-200 disabled:opacity-60 transition-colors"
          >
            {savingLimit && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </button>
          {dailyLimit !== null && (
            <span className="text-sm text-gray-500">Currently: {dailyLimit}/day</span>
          )}
        </div>
      </div>

      {/* Recent openings — real + demo, newest first. is_test rows are opens with no charge and
          no real ticket purchase (see PackService.openPackDemo), kept visually distinct here. */}
      <div className="rounded-xl border border-gray-800 p-4 space-y-1">
        <div className="text-base font-semibold text-gray-200">Recent pack openings</div>
        <div className="text-sm text-gray-500">{openingsRealTotal} total (excludes demo opens)</div>
      </div>
      <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
        {openingsLoading && !openings && (
          <div className="p-4 flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {openings?.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No pack openings yet.</div>
        )}
        {openings?.map(o => (
          <div key={o.id} className="flex items-center justify-between p-4 gap-3">
            <div className="min-w-0">
              <div className="text-base font-medium text-gray-200 flex items-center gap-2 flex-wrap">
                {o.tickets_awarded} ticket{o.tickets_awarded === 1 ? "" : "s"}
                <span className="text-xs uppercase tracking-wide text-gray-500">{o.rarity}</span>
                {o.is_test && (
                  <span className="text-xs uppercase tracking-wide text-sky-400 border border-sky-400/30 bg-sky-400/10 rounded-full px-1.5 py-0.5">demo</span>
                )}
                {o.status === "failed" && (
                  <span className="text-xs uppercase tracking-wide text-red-400 border border-red-400/30 bg-red-400/10 rounded-full px-1.5 py-0.5">purchase failed</span>
                )}
              </div>
              <div className="text-sm text-gray-500 truncate">
                {o.username ? <span className="font-medium text-gray-400">@{o.username}</span> : <span className="font-mono">{shortUserId(o.user_id)}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm text-gray-400 tabular-nums">${o.cost_usdc.toFixed(2)}</div>
              <div className="text-sm text-gray-600 tabular-nums">{new Date(o.created_at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
      {openingsTotal > 50 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={() => fetchOpenings(openingsPage - 1)}
            disabled={openingsPage <= 1 || openingsLoading}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-gray-300 disabled:opacity-40 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {openingsPage}</span>
          <button
            onClick={() => fetchOpenings(openingsPage + 1)}
            disabled={openingsPage * 50 >= openingsTotal || openingsLoading}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-gray-300 disabled:opacity-40 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
