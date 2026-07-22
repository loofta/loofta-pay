"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search } from "lucide-react";
import { SortableHeader, WAITLIST_LIMIT } from "../admin-shared";

export function WaitlistTab({
  searchInput, setSearchInput, applySearch,
  accessFilter, setAccessFilter, fetchWaitlist,
  grantEmailInput, setGrantEmailInput, grantAccessByEmail, grantingByEmail,
  grantTwitterInput, setGrantTwitterInput, grantAccessByTwitter, grantingByTwitter,
  loading, loaded, data,
  sortCol, sortDir, onSort,
  grantingAccess, grantAccess,
  resendingEmail, resendBetaEmail,
  page, total, search,
}: {
  searchInput: string;
  setSearchInput: (v: string) => void;
  applySearch: () => void;
  accessFilter: "all" | "granted" | "not_granted";
  setAccessFilter: (v: "all" | "granted" | "not_granted") => void;
  fetchWaitlist: (page?: number, opts?: { search: string; access: string; sortCol: string; sortDir: "asc" | "desc" }) => void;
  grantEmailInput: string;
  setGrantEmailInput: (v: string) => void;
  grantAccessByEmail: () => void;
  grantingByEmail: boolean;
  grantTwitterInput: string;
  setGrantTwitterInput: (v: string) => void;
  grantAccessByTwitter: () => void;
  grantingByTwitter: boolean;
  loading: boolean;
  loaded: boolean;
  data: any[];
  sortCol: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  grantingAccess: string | null;
  grantAccess: (id: string, grant: boolean) => void;
  resendingEmail: string | null;
  resendBetaEmail: (id: string) => void;
  page: number;
  total: number;
  search: string;
}) {
  return (
    <div className="space-y-3">

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-500 pointer-events-none" />
          <Input
            placeholder="Search email, name, privy ID, telegram, twitter…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            className="pl-9 bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm"
          />
        </div>
        <Select value={accessFilter} onValueChange={(v: "all" | "granted" | "not_granted") => {
          setAccessFilter(v);
          fetchWaitlist(1, { search, access: v, sortCol, sortDir });
        }}>
          <SelectTrigger className="w-40 bg-gray-900 border-gray-700 text-gray-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-900 border-gray-700 text-gray-100">
            <SelectItem value="all">All entries</SelectItem>
            <SelectItem value="granted">Access granted</SelectItem>
            <SelectItem value="not_granted">Not granted</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={applySearch} className="bg-blue-700 hover:bg-blue-600 text-white">
          Search
        </Button>
      </div>

      {/* Grant by email */}
      <div className="flex gap-2">
        <Input
          placeholder="Grant mainnet access by email address…"
          value={grantEmailInput}
          onChange={(e) => setGrantEmailInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && grantAccessByEmail()}
          className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm flex-1"
        />
        <Button
          size="sm"
          onClick={grantAccessByEmail}
          disabled={grantingByEmail || !grantEmailInput.trim()}
          className="bg-green-700 hover:bg-green-600 text-white shrink-0"
        >
          {grantingByEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : "Grant Access"}
        </Button>
      </div>

      {/* Grant by Twitter username */}
      <div className="flex gap-2">
        <Input
          placeholder="Grant mainnet access by Twitter username (e.g. @handle)…"
          value={grantTwitterInput}
          onChange={(e) => setGrantTwitterInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && grantAccessByTwitter()}
          className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm flex-1"
        />
        <Button
          size="sm"
          onClick={grantAccessByTwitter}
          disabled={grantingByTwitter || !grantTwitterInput.trim()}
          className="bg-sky-700 hover:bg-sky-600 text-white shrink-0"
        >
          {grantingByTwitter ? <Loader2 className="w-4 h-4 animate-spin" /> : "Grant Access"}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
          </div>
        )}
        {!loading && loaded && (
          <table className="w-full text-sm text-gray-300">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60 text-gray-500 uppercase tracking-wider text-left text-[10px]">
                <th className="px-4 py-2.5">#</th>
                <SortableHeader col="display_name" label="Name" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortableHeader col="email" label="Email" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th className="px-4 py-2.5">Telegram</th>
                <th className="px-4 py-2.5">Twitter</th>
                <SortableHeader col="occupation" label="Occupation" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortableHeader col="payment_volume" label="Volume" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th className="px-4 py-2.5">Rails</th>
                <th className="px-4 py-2.5">Privy ID</th>
                <SortableHeader col="created_at" label="Applied" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortableHeader col="mainnet_access" label="Mainnet" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {data.map((e: any, i: number) => (
                <tr key={e.id} className="border-b border-gray-800/60 hover:bg-gray-900/50">
                  <td className="px-4 py-2.5 text-gray-600 tabular-nums">{(page - 1) * WAITLIST_LIMIT + i + 1}</td>
                  <td className="px-4 py-2.5 font-medium text-white">{e.display_name || "—"}</td>
                  <td className="px-4 py-2.5">{e.email || "—"}</td>
                  <td className="px-4 py-2.5">{e.telegram_handle || "—"}</td>
                  <td className="px-4 py-2.5">{e.twitter_username || "—"}</td>
                  <td className="px-4 py-2.5">{e.occupation || "—"}</td>
                  <td className="px-4 py-2.5">{e.payment_volume || "—"}</td>
                  <td className="px-4 py-2.5 max-w-[140px] truncate">{Array.isArray(e.withdrawal_rails) ? e.withdrawal_rails.join(", ") : (e.withdrawal_rails || "—")}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-500 max-w-[120px] truncate" title={e.privy_user_id}>{e.privy_user_id || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">{new Date(e.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {e.mainnet_access ? (
                        <button
                          type="button"
                          disabled={grantingAccess === e.id}
                          onClick={() => grantAccess(e.id, false)}
                          className="group px-2.5 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-50 bg-green-900/60 text-green-400 hover:bg-red-900/60 hover:text-red-400"
                        >
                          {grantingAccess === e.id ? "…" : <><span className="group-hover:hidden">Granted</span><span className="hidden group-hover:inline">Revoke</span></>}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={grantingAccess === e.id}
                          onClick={() => grantAccess(e.id, true)}
                          className="px-2.5 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-50 bg-gray-800 text-gray-500 hover:bg-gray-700 hover:text-gray-300"
                        >
                          {grantingAccess === e.id ? "…" : "Grant"}
                        </button>
                      )}
                      {e.mainnet_access && e.email && (
                        <button
                          type="button"
                          disabled={resendingEmail === e.id}
                          onClick={() => resendBetaEmail(e.id)}
                          className="px-2.5 py-1 rounded-full text-sm font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-colors disabled:opacity-50"
                          title="Resend beta access email"
                        >
                          {resendingEmail === e.id ? "…" : "✉︎"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-600">No entries found</td></tr>
              )}
            </tbody>
          </table>
        )}
        {!loading && !loaded && (
          <div className="text-gray-600 text-base md:text-sm py-8 text-center">Click Refresh to load waitlist.</div>
        )}
      </div>

      {/* Pagination */}
      {total > WAITLIST_LIMIT && (
        <div className="flex items-center justify-between text-base md:text-sm text-gray-400">
          <span>{total} total · page {page} of {Math.ceil(total / WAITLIST_LIMIT)}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => fetchWaitlist(page - 1, { search, access: accessFilter, sortCol, sortDir })}
              className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
            >
              ← Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= Math.ceil(total / WAITLIST_LIMIT) || loading}
              onClick={() => fetchWaitlist(page + 1, { search, access: accessFilter, sortCol, sortDir })}
              className="border-gray-700 text-gray-300 bg-gray-900 hover:bg-gray-800"
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
