"use client";

import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";

export function SparksTab({ loading, loaded, data, search, setSearch }: {
  loading: boolean;
  loaded: boolean;
  data: any[];
  search: string;
  setSearch: (v: string) => void;
}) {
  return (
    <div>
      {loading && (
        <div className="flex items-center gap-2 text-base md:text-sm text-gray-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading Sparks…
        </div>
      )}
      {!loading && loaded && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              <Input
                placeholder="Search by username or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-gray-900 border-gray-700 text-sm"
              />
            </div>
            <span className="text-sm text-gray-500 whitespace-nowrap">
              {search
                ? `${data.filter((u: any) => {
                    const q = search.toLowerCase();
                    return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                  }).length} / ${data.length}`
                : `${data.length} users`}
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-base md:text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">#</th>
                  <th className="text-left px-4 py-2.5">User</th>
                  <th className="text-right px-4 py-2.5">⚡ Sparks</th>
                  <th className="text-center px-3 py-2.5">Email</th>
                  <th className="text-center px-3 py-2.5">X</th>
                  <th className="text-center px-3 py-2.5">1st pay</th>
                  <th className="text-center px-3 py-2.5">Unreg.</th>
                  <th className="text-center px-3 py-2.5">Link paid</th>
                  <th className="text-center px-3 py-2.5">10 pays</th>
                  <th className="text-right px-4 py-2.5">Sent</th>
                </tr>
              </thead>
              <tbody>
                {data
                  .filter((u: any) => {
                    if (!search) return true;
                    const q = search.toLowerCase();
                    return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                  })
                  .map((u: any, i: number) => {
                    const byKey = Object.fromEntries(u.tasks.map((t: any) => [t.key, t]));
                    return (
                      <tr key={u.privyUserId} className="border-b border-gray-800/60 hover:bg-gray-900/50">
                        <td className="px-4 py-2.5 text-gray-600 tabular-nums">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-white">{u.username ? `@${u.username}` : "—"}</div>
                          {u.email ? (
                            <div className="text-sm text-gray-500 truncate max-w-[200px]">{u.email}</div>
                          ) : (
                            <div className="text-sm text-gray-500 font-mono break-all select-all" title={u.privyUserId}>{u.privyUserId}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold text-amber-400 tabular-nums">{u.totalSparks.toLocaleString()}</td>
                        {["connect_email","connect_twitter","first_payment","payment_to_unregistered","payment_link_paid","ten_payments"].map((key) => (
                          <td key={key} className="px-3 py-2.5 text-center">
                            {byKey[key]?.completed
                              ? <span className="text-green-400">✓</span>
                              : key === "ten_payments" && byKey[key]?.progress > 0
                                ? <span className="text-amber-400 text-sm">{byKey[key].progress}/10</span>
                                : <span className="text-gray-700">–</span>}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right text-gray-300 tabular-nums text-sm">
                          {byKey["ten_payments"]?.progress ?? 0}
                        </td>
                      </tr>
                    );
                  })}
                {data.filter((u: any) => {
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                }).length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-600">
                    {search ? `No users matching "${search}"` : "No data"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!loading && !loaded && (
        <div className="text-gray-600 text-base md:text-sm py-8 text-center">Click Refresh to load Sparks data.</div>
      )}
    </div>
  );
}
