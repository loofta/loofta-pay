"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cashoutStatusLabel } from "./cashoutStatusLabel";

const STATUS_COLOR: Record<string, string> = {
  COMPLETE: "text-emerald-400",
  DEPOSITED: "text-blue-400",
  BRIDGING: "text-amber-400",
  "AWAITING APPROVAL": "text-orange-400",
  PENDING_BRIDGE: "text-gray-400",
  CANCELLED: "text-gray-500",
  FAILED: "text-red-400",
  CANCELLING: "text-orange-400",
};

/** Peer cash outs are shared as pay links (/pay/<short_id>), so they are listed beside payments. */
export function PayLinkCashouts({ authHeaders }: { authHeaders: () => Promise<Record<string, string>> }) {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/offramp?page=1", { headers: await authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setRows((data.data ?? []).filter((r: any) => r.short_id));
        setTotal(data.total ?? 0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authHeaders]);

  return (
    <div className="mb-4 rounded-lg border border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-900/40"
      >
        <ChevronRight className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="font-medium">Cash-out pay links</span>
        <span className="text-gray-500">{loading ? "" : `${rows.length} of ${total} latest`}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-gray-800">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <table className="w-full text-sm text-gray-300">
              <thead>
                <tr className="text-gray-500 text-[10px] uppercase tracking-wider border-b border-gray-800">
                  <th className="text-left px-3 py-2">Created</th>
                  <th className="text-left px-3 py-2">Link</th>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Pays out to</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-600">No pay links yet.</td></tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-gray-500">
                      {new Date(r.created_at).toLocaleDateString()} {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      <a href={`/app/pay/${r.short_id}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">{r.short_id}</a>
                    </td>
                    <td className="px-3 py-2">
                      {r.user?.username ? <span className="text-gray-200">@{r.user.username}</span>
                        : r.user?.email ? <span className="text-gray-300">{r.user.email}</span>
                        : <span className="text-gray-600 font-mono">{r.user_id}</span>}
                    </td>
                    <td className="px-3 py-2"><span className="capitalize">{r.platform}</span> <span className="font-mono text-gray-400">{r.platform_identifier}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">${Number(r.amount_usdc).toFixed(2)}</td>
                    <td className={`px-3 py-2 font-medium ${STATUS_COLOR[cashoutStatusLabel(r)] ?? "text-gray-400"}`}>{cashoutStatusLabel(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
