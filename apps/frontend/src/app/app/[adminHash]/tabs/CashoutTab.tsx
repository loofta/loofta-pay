"use client";

import { Fragment, useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { AddressCell, SolAddressCell, TxCell } from "../admin-shared";
import { cashoutStatusLabel } from "./cashoutStatusLabel";

type CashoutKind = "peer" | "crypto" | "naira";

function UserCell({ row }: { row: any }) {
  if (row.user?.username) return <span className="text-gray-200">@{row.user.username}</span>;
  if (row.user?.email) return <span className="text-gray-300">{row.user.email}</span>;
  return <span className="text-gray-600 font-mono text-sm">{row.user_id}</span>;
}

function formatDetail(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function DetailsRow({ row, colSpan }: { row: any; colSpan: number }) {
  const entries = Object.entries(row).filter(([k]) => k !== "user");
  return (
    <tr className="border-b border-gray-800/50 bg-gray-900/30">
      <td colSpan={colSpan} className="px-4 py-3">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {row.user && (
            <div>
              <dt className="text-sm text-gray-500">user</dt>
              <dd className="text-sm text-gray-200 break-all">
                {[row.user.username && `@${row.user.username}`, row.user.email].filter(Boolean).join(" · ") || "—"}
              </dd>
            </div>
          )}
          {entries.map(([k, v]) => (
            <div key={k}>
              <dt className="text-sm text-gray-500">{k}</dt>
              <dd className="text-sm text-gray-300 font-mono break-all whitespace-pre-wrap">{formatDetail(v)}</dd>
            </div>
          ))}
        </dl>
      </td>
    </tr>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronRight className={`w-4 h-4 text-gray-500 transition-transform ${open ? "rotate-90" : ""}`} />;
}

export function CashoutTab({
  cashoutKind, setCashoutKind,

  statusFilter, setStatusFilter, fetchCashOuts,
  total, loading, loaded, data, page,

  withdrawalsData, withdrawalsLoading, withdrawalsLoaded, withdrawalsTotal, withdrawalsPage,
  withdrawalsTypeFilter, setWithdrawalsTypeFilter, fetchWithdrawals,

  pajCashData, pajCashLoading, pajCashLoaded, pajCashTotal, pajCashPage,
  pajCashStatusFilter, setPajCashStatusFilter, pajCashDirectionFilter, setPajCashDirectionFilter, fetchPajCash,
}: {
  cashoutKind: CashoutKind;
  setCashoutKind: (v: CashoutKind) => void;

  statusFilter: string;
  setStatusFilter: (v: string) => void;
  fetchCashOuts: (page?: number, status?: string) => void;
  total: number;
  loading: boolean;
  loaded: boolean;
  data: any[];
  page: number;

  withdrawalsData: any[];
  withdrawalsLoading: boolean;
  withdrawalsLoaded: boolean;
  withdrawalsTotal: number;
  withdrawalsPage: number;
  withdrawalsTypeFilter: string;
  setWithdrawalsTypeFilter: (v: string) => void;
  fetchWithdrawals: (page?: number, type?: string) => void;

  pajCashData: any[];
  pajCashLoading: boolean;
  pajCashLoaded: boolean;
  pajCashTotal: number;
  pajCashPage: number;
  pajCashStatusFilter: string;
  setPajCashStatusFilter: (v: string) => void;
  pajCashDirectionFilter: string;
  setPajCashDirectionFilter: (v: string) => void;
  fetchPajCash: (page?: number, status?: string, direction?: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      {/* Kind switcher */}
      <div className="flex gap-1.5 border-b border-gray-800 pb-2">
        {([
          { key: "peer", label: "Peer (bank)" },
          { key: "crypto", label: "Crypto (USDC / NEAR Intents)" },
          { key: "naira", label: "Naira (PAJ Cash)" },
        ] as { key: CashoutKind; label: string }[]).map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => {
              setCashoutKind(k.key);
              if (k.key === "peer" && !loaded) fetchCashOuts(1, statusFilter);
              if (k.key === "crypto" && !withdrawalsLoaded) fetchWithdrawals(1, withdrawalsTypeFilter);
              if (k.key === "naira" && !pajCashLoaded) fetchPajCash(1, pajCashStatusFilter, pajCashDirectionFilter);
            }}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${cashoutKind === k.key ? "bg-orange-900/40 text-orange-300" : "text-gray-500 hover:text-gray-300 hover:bg-gray-900/40"}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {cashoutKind === "peer" && (
        <div className="space-y-3">
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
              <option value="DELETED">Deleted by user</option>
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
                    <th className="w-8 px-2 py-2.5" />
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5">Platform</th>
                    <th className="text-left px-4 py-2.5">Identifier</th>
                    <th className="text-right px-4 py-2.5">Amount</th>
                    <th className="text-right px-4 py-2.5">Filled</th>
                    <th className="text-left px-4 py-2.5">Currency</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Time to fill</th>
                    <th className="text-left px-4 py-2.5">Deposit ID</th>
                    <th className="text-left px-4 py-2.5 max-w-[160px]">User</th>
                  </tr>
                </thead>
                <tbody>
                  {data.length === 0 && (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-600">No cash out requests found.</td></tr>
                  )}
                  {data.map((row: any) => {
                    const statusColors: Record<string, string> = {
                      COMPLETE: "text-emerald-400",
                      DEPOSITED: "text-blue-400",
                      BRIDGING: "text-amber-400",
                      "AWAITING APPROVAL": "text-orange-400",
                      PENDING_BRIDGE: "text-gray-400",
                      CANCELLED: "text-gray-500",
                      FAILED: "text-red-400",
                      CANCELLING: "text-orange-400",
                    };
                    const rowKey = `peer:${row.id}`;
                    const open = expanded.has(rowKey);
                    return (
                      <Fragment key={row.id}>
                      <tr onClick={() => toggle(rowKey)} className="border-b border-gray-800/50 hover:bg-gray-900/40 cursor-pointer">
                        <td className="px-2 py-2.5"><Chevron open={open} /></td>
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                          {new Date(row.created_at).toLocaleDateString()} {new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5 font-medium capitalize">{row.platform}</td>
                        <td className="px-4 py-2.5 font-mono">{row.platform_identifier}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">${Number(row.amount_usdc).toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.filled_amount_usdc != null ? (
                            <span className={Number(row.filled_amount_usdc) < Number(row.amount_usdc) && row.status !== "COMPLETE" ? "text-amber-400" : "text-gray-400"}>
                              ${Number(row.filled_amount_usdc).toFixed(2)}
                            </span>
                          ) : <span className="text-gray-700">—</span>}
                          {row.fill_state && <span className="block text-sm text-gray-600 capitalize">{row.fill_state}</span>}
                        </td>
                        <td className="px-4 py-2.5">{row.currency}</td>
                        <td className={`px-4 py-2.5 font-medium ${statusColors[cashoutStatusLabel(row)] ?? "text-gray-400"}`}>{cashoutStatusLabel(row)}</td>
                        <td className="px-4 py-2.5 text-gray-400">
                          {row.eta_label ?? <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-gray-400">
                          {row.zkp2p_deposit_id ?? <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-2.5 max-w-[160px] truncate"><UserCell row={row} /></td>
                      </tr>
                      {open && <DetailsRow row={row} colSpan={11} />}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

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
      )}

      {cashoutKind === "crypto" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={withdrawalsTypeFilter}
              onChange={(e) => { setWithdrawalsTypeFilter(e.target.value); fetchWithdrawals(1, e.target.value); }}
              className="bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 text-base"
            >
              <option value="">All types</option>
              <option value="usdc">USDC (direct)</option>
              <option value="near-intents">NEAR Intents (cross-chain)</option>
            </select>
            <span className="text-base text-gray-500">{withdrawalsTotal} total</span>
          </div>

          {withdrawalsLoading && (
            <div className="flex items-center gap-2 text-base text-gray-400 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading withdrawals…
            </div>
          )}

          {!withdrawalsLoading && withdrawalsLoaded && (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-base text-gray-300">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                    <th className="w-8 px-2 py-2.5" />
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5">Type</th>
                    <th className="text-right px-4 py-2.5">Amount</th>
                    <th className="text-left px-4 py-2.5">Destination</th>
                    <th className="text-left px-4 py-2.5">Tx</th>
                    <th className="text-left px-4 py-2.5">Bridge status</th>
                    <th className="text-left px-4 py-2.5 max-w-[160px]">User</th>
                  </tr>
                </thead>
                <tbody>
                  {withdrawalsData.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">No withdrawals found.</td></tr>
                  )}
                  {withdrawalsData.map((row: any) => {
                    const rowKey = `crypto:${row.id}`;
                    const open = expanded.has(rowKey);
                    return (
                    <Fragment key={row.id}>
                    <tr onClick={() => toggle(rowKey)} className="border-b border-gray-800/50 hover:bg-gray-900/40 cursor-pointer">
                      <td className="px-2 py-2.5"><Chevron open={open} /></td>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                        {new Date(row.created_at).toLocaleDateString()} {new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.is_near_intents ? <span className="text-purple-400 font-medium">NEAR Intents</span> : <span className="text-gray-400">USDC</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                        ${Number(row.amount_usdc).toFixed(2)}
                        {row.is_near_intents && row.estimated_out && (
                          <span className="block text-sm text-gray-500 font-normal">~{row.estimated_out} received</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.destination_chain === "solana" ? (
                          <SolAddressCell address={row.destination_address} />
                        ) : row.destination_chain === "base" ? (
                          <AddressCell address={row.destination_address} />
                        ) : (
                          <span className="font-mono text-gray-400 text-sm">{row.destination_address}</span>
                        )}
                        <span className="block text-sm text-gray-600">{row.destination_chain} · {row.destination_token}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <TxCell hash={row.tx_signature} chain="solana" isDevnet={Boolean(row.is_devnet)} />
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">
                        {row.is_near_intents ? (
                          <span className={row.near_intents_complete ? "text-emerald-400 font-medium" : "text-amber-400 font-medium"}>
                            {row.near_intents_status ?? (row.near_intents_complete ? "COMPLETE" : "PENDING")}
                          </span>
                        ) : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-4 py-2.5 max-w-[160px] truncate">
                        <UserCell row={row} />
                      </td>
                    </tr>
                    {open && <DetailsRow row={row} colSpan={8} />}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {withdrawalsLoaded && withdrawalsTotal > 50 && (
            <div className="flex items-center gap-3 justify-center pt-1">
              <button
                type="button"
                disabled={withdrawalsPage <= 1}
                onClick={() => fetchWithdrawals(withdrawalsPage - 1, withdrawalsTypeFilter)}
                className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
              >← Prev</button>
              <span className="text-base text-gray-500">Page {withdrawalsPage} of {Math.ceil(withdrawalsTotal / 50)}</span>
              <button
                type="button"
                disabled={withdrawalsPage >= Math.ceil(withdrawalsTotal / 50)}
                onClick={() => fetchWithdrawals(withdrawalsPage + 1, withdrawalsTypeFilter)}
                className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
              >Next →</button>
            </div>
          )}
        </div>
      )}

      {cashoutKind === "naira" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={pajCashDirectionFilter}
              onChange={(e) => { setPajCashDirectionFilter(e.target.value); fetchPajCash(1, pajCashStatusFilter, e.target.value); }}
              className="bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 text-base"
            >
              <option value="">All directions</option>
              <option value="ON_RAMP">On-ramp (Naira → USDC)</option>
              <option value="OFF_RAMP">Off-ramp / withdrawal (USDC → Naira)</option>
            </select>
            <select
              value={pajCashStatusFilter}
              onChange={(e) => { setPajCashStatusFilter(e.target.value); fetchPajCash(1, e.target.value, pajCashDirectionFilter); }}
              className="bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 text-base"
            >
              <option value="">All statuses</option>
              <option value="CREATED">Created</option>
              <option value="AWAITING_PAYMENT">Awaiting payment</option>
              <option value="USDC_SENT">USDC sent</option>
              <option value="PAJ_PAID">PAJ paid</option>
              <option value="COMPLETE">Complete</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="EXPIRED">Expired</option>
            </select>
            <span className="text-base text-gray-500">{pajCashTotal} total</span>
          </div>

          {pajCashLoading && (
            <div className="flex items-center gap-2 text-base text-gray-400 py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading Naira orders…
            </div>
          )}

          {!pajCashLoading && pajCashLoaded && (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-base text-gray-300">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                    <th className="w-8 px-2 py-2.5" />
                    <th className="text-left px-4 py-2.5">Date</th>
                    <th className="text-left px-4 py-2.5">Direction</th>
                    <th className="text-right px-4 py-2.5">Fiat</th>
                    <th className="text-right px-4 py-2.5">USDC</th>
                    <th className="text-right px-4 py-2.5">Fee</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5 max-w-[160px]">User</th>
                  </tr>
                </thead>
                <tbody>
                  {pajCashData.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600">No Naira orders found.</td></tr>
                  )}
                  {pajCashData.map((row: any) => {
                    const statusColors: Record<string, string> = {
                      COMPLETE: "text-emerald-400",
                      PAJ_PAID: "text-emerald-400",
                      USDC_SENT: "text-blue-400",
                      AWAITING_PAYMENT: "text-amber-400",
                      CREATED: "text-gray-400",
                      FAILED: "text-red-400",
                      CANCELLED: "text-gray-500",
                      EXPIRED: "text-gray-500",
                    };
                    const rowKey = `naira:${row.id}`;
                    const open = expanded.has(rowKey);
                    return (
                      <Fragment key={row.id}>
                      <tr onClick={() => toggle(rowKey)} className="border-b border-gray-800/50 hover:bg-gray-900/40 cursor-pointer">
                        <td className="px-2 py-2.5"><Chevron open={open} /></td>
                        <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                          {new Date(row.created_at).toLocaleDateString()} {new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.direction === "OFF_RAMP" ? <span className="text-orange-400 font-medium">Withdrawal</span> : <span className="text-gray-400">Deposit</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                          {row.fiat_amount != null ? `₦${Number(row.fiat_amount).toLocaleString()}` : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {row.amount_usdc != null ? `$${Number(row.amount_usdc).toFixed(2)}` : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">
                          {row.fee_usdc != null ? `$${Number(row.fee_usdc).toFixed(4)}` : <span className="text-gray-700">—</span>}
                        </td>
                        <td className={`px-4 py-2.5 font-medium ${statusColors[row.status] ?? "text-gray-400"}`}>
                          {row.status}
                          {row.error_message && <span className="block text-sm text-red-400/70 font-normal max-w-[180px] truncate" title={row.error_message}>{row.error_message}</span>}
                        </td>
                        <td className="px-4 py-2.5 max-w-[160px] truncate"><UserCell row={row} /></td>
                      </tr>
                      {open && <DetailsRow row={row} colSpan={8} />}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pajCashLoaded && pajCashTotal > 50 && (
            <div className="flex items-center gap-3 justify-center pt-1">
              <button
                type="button"
                disabled={pajCashPage <= 1}
                onClick={() => fetchPajCash(pajCashPage - 1, pajCashStatusFilter, pajCashDirectionFilter)}
                className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
              >← Prev</button>
              <span className="text-base text-gray-500">Page {pajCashPage} of {Math.ceil(pajCashTotal / 50)}</span>
              <button
                type="button"
                disabled={pajCashPage >= Math.ceil(pajCashTotal / 50)}
                onClick={() => fetchPajCash(pajCashPage + 1, pajCashStatusFilter, pajCashDirectionFilter)}
                className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
              >Next →</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
