"use client";

// Self-contained, same pattern as EarnTab.tsx. Every wallet top-up order from user_deposits, with a type and status filter.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";

interface Deposit {
  id: string;
  user_id: string;
  username: string | null;
  email: string | null;
  type: string;
  status: string;
  amount_usdc: number | null;
  deposit_address: string | null;
  bridge_status: string | null;
  provider_order_id: string | null;
  created_at: string;
  updated_at: string | null;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s);
const TYPE_LABEL: Record<string, string> = {
  "peer-pay": "Payment app (Peer)",
  "near-intents": "Crypto (Near Intents)",
  blink: "Blink",
  coinbase: "Coinbase",
  moonpay: "MoonPay",
  "card-onramp": "Card / bank",
  "usdc-wallet": "USDC wallet",
};
const STATUS_COLOR: Record<string, string> = {
  complete: "text-emerald-400",
  pending: "text-amber-400",
  failed: "text-red-400",
  cancelled: "text-gray-500",
};

export function DepositsTab() {
  const { getAccessToken } = usePrivy();
  const [rows, setRows] = useState<Deposit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/admin/deposits", { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Failed to load deposits");
      setRows((await res.json()).deposits);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load deposits");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  const types = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.type))).sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (type === "all" || r.type === type) &&
        (status === "all" || r.status === status) &&
        (!needle || [r.username, r.email, r.user_id, r.deposit_address, r.provider_order_id, r.id].some((v) => (v ?? "").toLowerCase().includes(needle))),
    );
  }, [rows, q, type, status]);

  const totals = useMemo(() => {
    const done = filtered.filter((r) => r.status === "complete");
    return {
      orders: filtered.length,
      completed: done.length,
      pending: filtered.filter((r) => r.status === "pending").length,
      failed: filtered.filter((r) => r.status === "failed" || r.status === "cancelled").length,
      volume: done.reduce((a, r) => a + Number(r.amount_usdc ?? 0), 0),
    };
  }, [filtered]);

  const selectCls = "rounded-lg bg-white/5 border border-gray-800 px-3 py-2 text-base text-gray-200 outline-none";
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-800 p-4">
        <div className="text-base font-semibold text-gray-200 mb-3">Deposit orders</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            ["Orders", String(totals.orders)],
            ["Completed", String(totals.completed)],
            ["Pending", String(totals.pending)],
            ["Failed or cancelled", String(totals.failed)],
            ["Completed volume", usd(totals.volume)],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="text-sm text-gray-500">{k}</div>
              <div className="text-lg font-bold text-gray-200 tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="text-sm text-gray-500 pt-2">Volume counts completed orders only. Totals follow the filters below.</div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, address, order id" className="flex-1 min-w-[200px] rounded-lg bg-white/5 border border-gray-800 px-3 py-2 text-base text-gray-200 outline-none" />
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
          <option value="all">All types</option>
          {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
          <option value="all">All statuses</option>
          {["complete", "pending", "failed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-gray-300 disabled:opacity-40">{loading ? "Loading..." : "Refresh"}</button>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
        {loading && !rows && <div className="p-4 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>}
        {rows && filtered.length === 0 && <div className="p-4 text-sm text-gray-500">No deposits found.</div>}
        {filtered.map((r) => (
          <div key={r.id} className="flex items-center justify-between p-4 gap-3">
            <div className="min-w-0">
              <div className="text-base font-medium text-gray-200 truncate">{r.username ? `@${r.username}` : r.email ?? short(r.user_id.replace(/^did:privy:/, ""))}</div>
              <div className="text-sm text-gray-500 truncate">
                {TYPE_LABEL[r.type] ?? r.type}
                {r.provider_order_id ? ` · order ${short(r.provider_order_id)}` : ""}
                {r.deposit_address ? ` · ${short(r.deposit_address)}` : ""}
              </div>
              <div className="text-sm text-gray-600">{new Date(r.created_at).toLocaleString()}{r.bridge_status ? ` · bridge ${r.bridge_status}` : ""}</div>
            </div>
            <div className="text-right shrink-0 tabular-nums">
              <div className="text-base font-bold text-gray-200">{r.amount_usdc != null ? usd(Number(r.amount_usdc)) : "-"}</div>
              <div className={`text-sm ${STATUS_COLOR[r.status] ?? "text-gray-400"}`}>{r.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
