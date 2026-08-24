"use client";

// Self-contained (fetches/holds its own state), same pattern as PacksTab.tsx — this panel is
// small enough that lifting state into AdminDashboard.tsx would add little benefit.

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";

interface AdminSubscription {
  id: string;
  created_at: string;
  user_id: string;
  username: string | null;
  tickets_per_day: number;
  total_tickets: number;
  tickets_bought: number;
  price_usdc: number;
  status: "active" | "completed" | "cancelled" | "expired";
  payment_tx_hash: string | null;
  refund_tx_hash: string | null;
  refund_usdc: number | null;
}

interface SubscriptionRevenue {
  grossUsdc: number;
  refundsUsdc: number;
  ticketCostUsdc: number;
  netRevenueUsdc: number;
  subscriptionsSold: number;
  ticketsDelivered: number;
}

const STATUS_STYLE: Record<string, string> = {
  active: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  completed: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
  cancelled: "text-gray-500 border-gray-500/30 bg-gray-500/10",
  expired: "text-red-400 border-red-400/30 bg-red-400/10",
};

function shortUserId(userId: string): string {
  const bare = userId.replace(/^did:privy:/, "");
  return bare.length > 10 ? `${bare.slice(0, 10)}…` : bare;
}

export function SubscriptionsTab() {
  const { getAccessToken } = usePrivy();
  const [revenue, setRevenue] = useState<SubscriptionRevenue | null>(null);
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const fetchRevenue = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/lottery/subscriptions/revenue", { headers: await authHeaders() });
      if (!res.ok) return;
      setRevenue(await res.json());
    } catch { /* non-critical */ }
  }, [authHeaders]);

  const fetchSubscriptions = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lottery/subscriptions?page=${p}`, { headers: await authHeaders() });
      if (!res.ok) throw new Error("Failed to load subscriptions");
      const data = await res.json();
      setSubscriptions(data.data ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { fetchRevenue(); fetchSubscriptions(1); }, [fetchRevenue, fetchSubscriptions]);

  return (
    <div className="space-y-3">
      {/* Net revenue = $28 bundles collected minus refunds issued (full refunds for pre-first-
          batch cancellations, prorated refunds for the 30-month stale safety net, and any manual
          failed-batch refunds) minus what the tickets actually delivered cost — see
          MegapotSubscriptionService.getRevenue. */}
      {revenue && (
        <div className="rounded-xl border border-gray-800 p-4">
          <div className="text-base font-semibold text-gray-200 mb-3">Ticket subscription revenue</div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <div className="text-sm text-gray-500">Collected</div>
              <div className="text-lg font-bold text-gray-200 tabular-nums">${revenue.grossUsdc.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Refunded</div>
              <div className="text-lg font-bold text-gray-200 tabular-nums">${revenue.refundsUsdc.toFixed(2)}</div>
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
            {revenue.subscriptionsSold} subscription{revenue.subscriptionsSold === 1 ? "" : "s"} sold, {revenue.ticketsDelivered} ticket{revenue.ticketsDelivered === 1 ? "" : "s"} delivered
          </div>
        </div>
      )}

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="rounded-xl border border-gray-800 p-4 space-y-1">
        <div className="text-base font-semibold text-gray-200">Subscriptions</div>
        <div className="text-sm text-gray-500">{total} total — $28 for 30 tickets, cadence chosen by the user at signup</div>
      </div>
      <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
        {loading && !subscriptions && (
          <div className="p-4 flex items-center gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {subscriptions?.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No subscriptions yet.</div>
        )}
        {subscriptions?.map(s => (
          <div key={s.id} className="flex items-center justify-between p-4 gap-3">
            <div className="min-w-0">
              <div className="text-base font-medium text-gray-200 flex items-center gap-2 flex-wrap">
                {s.username ? <span className="font-medium text-gray-400">@{s.username}</span> : <span className="font-mono">{shortUserId(s.user_id)}</span>}
                <span className={`text-xs uppercase tracking-wide rounded-full px-1.5 py-0.5 border ${STATUS_STYLE[s.status] ?? ""}`}>
                  {s.status}
                </span>
              </div>
              <div className="text-sm text-gray-500 tabular-nums">
                {s.tickets_bought}/{s.total_tickets} tickets · {s.tickets_per_day}/day
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm text-gray-400 tabular-nums">${s.price_usdc.toFixed(2)}</div>
              {s.refund_usdc != null && (
                <div className="text-sm text-amber-400 tabular-nums">refunded ${s.refund_usdc.toFixed(2)}</div>
              )}
              <div className="text-sm text-gray-600 tabular-nums">{new Date(s.created_at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
      {total > 50 && (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            onClick={() => fetchSubscriptions(page - 1)}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-gray-300 disabled:opacity-40 transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">Page {page}</span>
          <button
            onClick={() => fetchSubscriptions(page + 1)}
            disabled={page * 50 >= total || loading}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-gray-300 disabled:opacity-40 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
