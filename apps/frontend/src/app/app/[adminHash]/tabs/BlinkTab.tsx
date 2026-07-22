"use client";

import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";

export function BlinkTab({ loading, loaded, data, search, setSearch }: {
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
          <Loader2 className="w-4 h-4 animate-spin" /> Loading Blink campaign data…
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
              {(() => {
                const qualified = data.filter((u: any) => u.qualified).length;
                const filtered = search
                  ? data.filter((u: any) => {
                      const q = search.toLowerCase();
                      return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                    }).length
                  : data.length;
                return search ? `${filtered} / ${data.length}` : `${qualified} qualified / ${data.length} users`;
              })()}
            </span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-base md:text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5">#</th>
                  <th className="text-left px-4 py-2.5">User</th>
                  <th className="text-center px-3 py-2.5">Passkeys</th>
                  <th className="text-center px-3 py-2.5">Deposits</th>
                  <th className="text-center px-3 py-2.5">Priv. pays</th>
                  <th className="text-center px-3 py-2.5">Qualified</th>
                </tr>
              </thead>
              <tbody>
                {data
                  .filter((u: any) => {
                    if (!search) return true;
                    const q = search.toLowerCase();
                    return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                  })
                  .sort((a: any, b: any) => {
                    if (b.qualified !== a.qualified) return (b.qualified ? 1 : 0) - (a.qualified ? 1 : 0);
                    const scoreA = (a.hasPasskeys ? 1 : 0) + Math.min(a.depositCount, 2) + Math.min(a.privatePaymentsCount, 2);
                    const scoreB = (b.hasPasskeys ? 1 : 0) + Math.min(b.depositCount, 2) + Math.min(b.privatePaymentsCount, 2);
                    return scoreB - scoreA;
                  })
                  .map((u: any, i: number) => (
                    <tr key={u.privyUserId} className={`border-b border-gray-800/60 hover:bg-gray-900/50 ${u.qualified ? "bg-cyan-950/20" : ""}`}>
                      <td className="px-4 py-2.5 text-gray-600 tabular-nums">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-white">{u.username ? `@${u.username}` : "—"}</div>
                        {u.email ? (
                          <div className="text-sm text-gray-500 truncate max-w-[200px]">{u.email}</div>
                        ) : (
                          <div className="text-sm text-gray-500 font-mono break-all select-all" title={u.privyUserId}>{u.privyUserId}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {u.hasPasskeys ? <span className="text-green-400">✓</span> : <span className="text-gray-700">–</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {u.depositLookupError
                          ? <span className="text-red-400" title={`Blink lookup failed: ${u.depositLookupError} — count below is unreliable`}>⚠ {u.depositCount}/2</span>
                          : u.depositCount >= 2
                            ? <span className="text-green-400">✓ {u.depositCount}</span>
                            : u.depositCount > 0
                              ? <span className="text-amber-400">{u.depositCount}/2</span>
                              : <span className="text-gray-700">0/2</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {u.privatePaymentsCount >= 2
                          ? <span className="text-green-400">✓ {u.privatePaymentsCount}</span>
                          : u.privatePaymentsCount > 0
                            ? <span className="text-amber-400">{u.privatePaymentsCount}/2</span>
                            : <span className="text-gray-700">0/2</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {u.qualified
                          ? <span className="text-cyan-400 font-semibold">✓ Done</span>
                          : <span className="text-gray-700">–</span>}
                      </td>
                    </tr>
                  ))}
                {data.filter((u: any) => {
                  if (!search) return true;
                  const q = search.toLowerCase();
                  return (u.username ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
                }).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600">
                    {search ? `No users matching "${search}"` : "No data"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {!loading && !loaded && (
        <div className="text-gray-600 text-base md:text-sm py-8 text-center">Click Refresh to load Blink campaign data.</div>
      )}
    </div>
  );
}
