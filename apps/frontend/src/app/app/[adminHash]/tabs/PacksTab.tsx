"use client";

// Self-contained (fetches/holds its own state, unlike the other admin tabs which lift state
// into AdminDashboard.tsx) — this panel is small enough that mirroring that pattern would mean
// touching AdminDashboard's already-large state block for little benefit.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, AlertTriangle, AtSign, Mail } from "lucide-react";
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

interface PackRevenue {
  grossUsdc: number;
  ticketCostUsdc: number;
  netRevenueUsdc: number;
  packsOpened: number;
  ticketsAwarded: number;
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
  free_spin_id: string | null;
  lottery_ticket_id: string | null;
  status: string;
  purchase_failure_reason: string | null;
  retry_count: number;
}

interface AdminFreeSpin {
  id: string;
  created_at: string;
  user_id: string;
  username: string | null;
  granted_by_admin_id: string;
  note: string | null;
  status: "unclaimed" | "consumed" | "cancelled";
  consumed_at: string | null;
  pack_opening_id: string | null;
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
  const [revenue, setRevenue] = useState<PackRevenue | null>(null);

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

  // Grant a free spin — recipient must already have a Loofta account (a free spin is redeemed
  // in-app, unlike a ticket gift there's no claim-link fallback for an unregistered identifier).
  const [grantIdentifier, setGrantIdentifier] = useState("");
  const [grantNote, setGrantNote] = useState("");
  const [granting, setGranting] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantSuccess, setGrantSuccess] = useState<string | null>(null);

  const [freeSpins, setFreeSpins] = useState<AdminFreeSpin[] | null>(null);
  const [freeSpinsTotal, setFreeSpinsTotal] = useState(0);
  const [freeSpinsPage, setFreeSpinsPage] = useState(1);
  const [freeSpinsLoading, setFreeSpinsLoading] = useState(false);

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

  const fetchRevenue = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/lottery/packs/revenue", { headers: await authHeaders() });
      if (!res.ok) return;
      setRevenue(await res.json());
    } catch { /* non-critical */ }
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

  const fetchFreeSpins = useCallback(async (page: number) => {
    setFreeSpinsLoading(true);
    try {
      const res = await fetch(`/api/admin/lottery/packs/free-spins?page=${page}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error("Failed to load free spins");
      const data = await res.json();
      setFreeSpins(data.data ?? []);
      setFreeSpinsTotal(data.total ?? 0);
      setFreeSpinsPage(page);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load free spins");
    } finally {
      setFreeSpinsLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchTiers(); fetchTreasury(); fetchRevenue(); fetchSettings(); fetchOpenings(1); fetchFreeSpins(1); }, [fetchTiers, fetchTreasury, fetchRevenue, fetchSettings, fetchOpenings, fetchFreeSpins]);

  // recipientType is auto-detected the same way the Megapot ticket gift form does — an "@" +
  // "." reads as an email, anything else as an X handle or Loofta username.
  const grantFreeSpin = useCallback(async () => {
    const identifier = grantIdentifier.trim();
    if (!identifier) return;
    setGranting(true);
    setGrantError(null);
    setGrantSuccess(null);
    try {
      const recipientType = identifier.includes("@") && identifier.includes(".") ? "email" : "handle";
      const res = await fetch("/api/admin/lottery/packs/grant-free-spin", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ recipientType, recipientIdentifier: identifier, note: grantNote.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Failed to grant free spin");
      setGrantSuccess(`Free spin granted to ${identifier}`);
      setGrantIdentifier("");
      setGrantNote("");
      fetchFreeSpins(1);
    } catch (e: any) {
      setGrantError(e?.message ?? "Failed to grant free spin");
    } finally {
      setGranting(false);
    }
  }, [grantIdentifier, grantNote, authHeaders, fetchFreeSpins]);

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
      {/* Net revenue = real (non-demo) pack payments collected minus what the tickets those wins
          awarded actually cost (tickets_awarded × TICKET_PRICE_USDC, same constant LotteryService
          funds them with). Demo opens never appear here — see PackService.getRevenue. */}
      {revenue && (
        <div className="rounded-xl border border-gray-800 p-4">
          <div className="text-base font-semibold text-gray-200 mb-3">Mystery Pack revenue</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-sm text-gray-500">Collected</div>
              <div className="text-lg font-bold text-gray-200 tabular-nums">${revenue.grossUsdc.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Tickets cost</div>
              <div className="text-lg font-bold text-gray-200 tabular-nums">${revenue.ticketCostUsdc.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Net</div>
              <div className={`text-lg font-bold tabular-nums ${revenue.netRevenueUsdc >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                ${revenue.netRevenueUsdc.toFixed(2)}
              </div>
            </div>
          </div>
          <div className="text-sm text-gray-500 pt-2">
            {revenue.packsOpened} real pack{revenue.packsOpened === 1 ? "" : "s"} opened, {revenue.ticketsAwarded} ticket{revenue.ticketsAwarded === 1 ? "" : "s"} awarded
          </div>
        </div>
      )}

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

      {/* Grant a free spin — a distinct entitlement from a demo open: it still rolls the real
          tier ladder and buys a real Megapot ticket, funded from the same treasury as a paid
          pack. Recipient must already have a Loofta account (redeemed in-app, no claim link). */}
      <div className="rounded-xl border border-gray-800 p-4 space-y-3">
        <div className="text-base font-semibold text-gray-200">Grant a free Mystery Pack spin</div>
        <div className="text-sm text-gray-500">
          Costs the recipient nothing, but still awards a real ticket funded from the treasury — not a demo open.
          Recipient must already have a Loofta account.
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              {grantIdentifier.includes("@") && grantIdentifier.includes(".")
                ? <Mail className="w-4 h-4" /> : <AtSign className="w-4 h-4" />}
            </span>
            <input
              placeholder="Email, X handle, or Loofta username"
              value={grantIdentifier}
              onChange={(e) => setGrantIdentifier(e.target.value.replace(/^@+/, ""))}
              className="w-full rounded-lg bg-gray-900 border border-gray-700 pl-9 pr-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>
        </div>
        <textarea
          placeholder="Optional note to include in the email…"
          value={grantNote}
          onChange={(e) => setGrantNote(e.target.value)}
          className="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 min-h-[60px] focus:outline-none focus:border-gray-500"
        />
        <button
          onClick={grantFreeSpin}
          disabled={granting || !grantIdentifier.trim()}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-600 text-sm font-medium text-white disabled:opacity-60 transition-colors"
        >
          {granting && <Loader2 className="w-4 h-4 animate-spin" />}
          Grant free spin
        </button>
        {grantError && <div className="text-sm text-red-400">{grantError}</div>}
        {grantSuccess && <div className="text-sm text-emerald-400">{grantSuccess}</div>}
      </div>

      {/* Recent free-spin grants, newest first — mirrors the ticket-gift list on the Lottery tab. */}
      <div className="rounded-xl border border-gray-800 p-4 space-y-1">
        <div className="text-base font-semibold text-gray-200">Recent free-spin grants</div>
        <div className="text-sm text-gray-500">{freeSpinsTotal} total</div>
      </div>
      <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
        {freeSpinsLoading && !freeSpins && (
          <div className="p-4 flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {freeSpins?.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No free spins granted yet.</div>
        )}
        {freeSpins?.map(s => (
          <div key={s.id} className="flex items-center justify-between p-4 gap-3">
            <div className="min-w-0">
              <div className="text-base font-medium text-gray-200 flex items-center gap-2 flex-wrap">
                {s.username ? <span className="font-medium text-gray-400">@{s.username}</span> : <span className="font-mono">{shortUserId(s.user_id)}</span>}
                <span className={`text-xs uppercase tracking-wide rounded-full px-1.5 py-0.5 border ${
                  s.status === "unclaimed" ? "text-sky-400 border-sky-400/30 bg-sky-400/10"
                  : s.status === "consumed" ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10"
                  : "text-gray-500 border-gray-500/30 bg-gray-500/10"
                }`}>
                  {s.status}
                </span>
              </div>
              {s.note && <div className="text-sm text-gray-500 truncate">{s.note}</div>}
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm text-gray-600 tabular-nums">{new Date(s.created_at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
      {freeSpinsTotal > 50 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={() => fetchFreeSpins(freeSpinsPage - 1)}
            disabled={freeSpinsPage <= 1 || freeSpinsLoading}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-gray-300 disabled:opacity-40 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {freeSpinsPage}</span>
          <button
            onClick={() => fetchFreeSpins(freeSpinsPage + 1)}
            disabled={freeSpinsPage * 50 >= freeSpinsTotal || freeSpinsLoading}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-gray-300 disabled:opacity-40 transition-colors"
          >
            Next
          </button>
        </div>
      )}

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
                {o.free_spin_id && (
                  <span className="text-xs uppercase tracking-wide text-violet-400 border border-violet-400/30 bg-violet-400/10 rounded-full px-1.5 py-0.5">free spin</span>
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
