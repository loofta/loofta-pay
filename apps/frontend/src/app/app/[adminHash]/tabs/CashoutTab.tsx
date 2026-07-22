"use client";

import { Loader2 } from "lucide-react";

export function CashoutTab({
  statusFilter, setStatusFilter, fetchCashOuts,
  total, loading, loaded, data, page,
}: {
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  fetchCashOuts: (page?: number, status?: string) => void;
  total: number;
  loading: boolean;
  loaded: boolean;
  data: any[];
  page: number;
}) {
  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); fetchCashOuts(1, e.target.value); }}
          className="bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 text-base"
        >
          <option value="">All statuses</option>
          <option value="PENDING_BRIDGE">Pending Bridge</option>
          <option value="BRIDGING">Bridging</option>
          <option value="DEPOSITED">Deposited — awaiting peer</option>
          <option value="COMPLETE">Complete</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="FAILED">Failed</option>
        </select>
        <span className="text-base text-gray-500">{total} total</span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-base text-gray-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading cash outs…
        </div>
      )}

      {!loading && loaded && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-base text-gray-300">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Platform</th>
                <th className="text-left px-4 py-2.5">Identifier</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                <th className="text-left px-4 py-2.5">Currency</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Deposit ID</th>
                <th className="text-left px-4 py-2.5 max-w-[120px]">User ID</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">No cash out requests found.</td></tr>
              )}
              {data.map((row: any) => {
                const statusColors: Record<string, string> = {
                  COMPLETE: "text-emerald-400",
                  DEPOSITED: "text-blue-400",
                  BRIDGING: "text-amber-400",
                  PENDING_BRIDGE: "text-gray-400",
                  CANCELLED: "text-gray-500",
                  FAILED: "text-red-400",
                  CANCELLING: "text-orange-400",
                };
                return (
                  <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                      {new Date(row.created_at).toLocaleDateString()} {new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2.5 font-medium capitalize">{row.platform}</td>
                    <td className="px-4 py-2.5 font-mono">{row.platform_identifier}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">${Number(row.amount_usdc).toFixed(2)}</td>
                    <td className="px-4 py-2.5">{row.currency}</td>
                    <td className={`px-4 py-2.5 font-medium ${statusColors[row.status] ?? "text-gray-400"}`}>{row.status}</td>
                    <td className="px-4 py-2.5 font-mono text-gray-400">
                      {row.zkp2p_deposit_id ?? <span className="text-gray-700">—</span>}
                    </td>
                    <td className="px-4 py-2.5 max-w-[120px] truncate text-gray-600 font-mono text-sm">{row.user_id}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {loaded && total > 50 && (
        <div className="flex items-center gap-3 justify-center pt-1">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => fetchCashOuts(page - 1, statusFilter)}
            className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
          >← Prev</button>
          <span className="text-base text-gray-500">Page {page} of {Math.ceil(total / 50)}</span>
          <button
            type="button"
            disabled={page >= Math.ceil(total / 50)}
            onClick={() => fetchCashOuts(page + 1, statusFilter)}
            className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
          >Next →</button>
        </div>
      )}
    </div>
  );
}
