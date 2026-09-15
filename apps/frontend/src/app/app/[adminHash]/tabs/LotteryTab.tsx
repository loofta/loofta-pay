"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AtSign, ChevronDown, ChevronRight, Copy, ExternalLink, Loader2, Mail } from "lucide-react";
import { AddressCell, SolAddressCell, trunc, TxCell } from "../admin-shared";

export function LotteryTab({
  giftIdentifierInput, setGiftIdentifierInput,
  giftNumTicketsInput, setGiftNumTicketsInput,
  giftNoteInput, setGiftNoteInput,
  gifting, createGiftTicket, lastGiftLink, copyText,

  referralFeesLoading, referralFeesLoaded, referralFeesBalance, referralFeesWallet, referralFeesBasescanUrl,
  referralFeesClaimedTotal, referralFeesClaims,
  connectedEvmAddress, connectEvmWallet, claimingReferralFees, claimReferralFeesOnChain,

  giftsLoaded, giftsData,

  statusFilter, setStatusFilter, fetchLottery,
  total, totalTickets, activeTicketsTotal, revenueToday, loading, loaded, data, page,
  expandedId, setExpandedId,
}: {
  giftIdentifierInput: string;
  setGiftIdentifierInput: (v: string) => void;
  giftNumTicketsInput: string;
  setGiftNumTicketsInput: (v: string) => void;
  giftNoteInput: string;
  setGiftNoteInput: (v: string) => void;
  gifting: boolean;
  createGiftTicket: () => void;
  lastGiftLink: string | null;
  copyText: (s: string) => void;

  referralFeesLoading: boolean;
  referralFeesLoaded: boolean;
  referralFeesBalance: number | null;
  referralFeesWallet: string | null;
  referralFeesBasescanUrl: string | null;
  referralFeesClaimedTotal: number;
  referralFeesClaims: any[];
  connectedEvmAddress: string | null;
  connectEvmWallet: () => void;
  claimingReferralFees: boolean;
  claimReferralFeesOnChain: () => void;

  giftsLoaded: boolean;
  giftsData: any[];

  statusFilter: string;
  setStatusFilter: (v: string) => void;
  fetchLottery: (page?: number, status?: string) => void;
  total: number;
  totalTickets: number;
  activeTicketsTotal: number;
  revenueToday: number;
  loading: boolean;
  loaded: boolean;
  data: any[];
  page: number;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}) {
  // Collapsed by default — the gift form + gifts list otherwise push the tickets table (the thing
  // admins usually land here to check) far down the page, requiring a scroll past both every time.
  const [giftSectionOpen, setGiftSectionOpen] = React.useState(false);

  return (
    <div className="space-y-3">
      {/* Top-line stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-800 p-4">
          <div className="text-sm text-gray-500 uppercase tracking-wide">Revenue today</div>
          <div className="text-2xl font-semibold text-emerald-400 tabular-nums mt-1">
            ${revenueToday.toFixed(2)}
          </div>
        </div>
        <div className="rounded-xl border border-gray-800 p-4">
          <div className="text-sm text-gray-500 uppercase tracking-wide">Active tickets</div>
          <div className="text-2xl font-semibold text-blue-400 tabular-nums mt-1">
            {activeTicketsTotal.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Gift a Megapot ticket — foldable, see giftSectionOpen above */}
      <div className="rounded-xl border border-gray-800 p-4 space-y-3">
        <button
          type="button"
          onClick={() => setGiftSectionOpen(!giftSectionOpen)}
          className="w-full flex items-center justify-between text-left"
        >
          <span className="text-base font-semibold text-gray-200">
            Gifts{giftsLoaded && giftsData.length > 0 ? ` (${giftsData.length})` : ""}
          </span>
          {giftSectionOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
        </button>
        {giftSectionOpen && (
          <>
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                  {giftIdentifierInput.includes("@") && giftIdentifierInput.includes(".")
                    ? <Mail className="w-4 h-4" /> : <AtSign className="w-4 h-4" />}
                </span>
                <Input
                  placeholder="Email, X handle, or Loofta username"
                  value={giftIdentifierInput}
                  onChange={(e) => setGiftIdentifierInput(e.target.value.replace(/^@+/, ""))}
                  className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm pl-9 w-full"
                />
              </div>
              <Input
                type="number"
                min={1}
                max={100}
                value={giftNumTicketsInput}
                onChange={(e) => setGiftNumTicketsInput(e.target.value)}
                className="bg-gray-900 border-gray-700 text-gray-100 text-base md:text-sm w-24"
              />
            </div>
            <Textarea
              placeholder="Optional note to include in the email…"
              value={giftNoteInput}
              onChange={(e) => setGiftNoteInput(e.target.value)}
              className="bg-gray-900 border-gray-700 text-gray-100 placeholder:text-gray-600 text-base md:text-sm min-h-[60px]"
            />
            <Button
              size="sm"
              onClick={createGiftTicket}
              disabled={gifting || !giftIdentifierInput.trim()}
              className="bg-teal-700 hover:bg-teal-600 text-white"
            >
              {gifting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Gift ticket(s)"}
            </Button>
            {lastGiftLink && (
              <div className="flex items-center gap-2 text-base md:text-sm text-gray-400">
                <span className="truncate">{lastGiftLink}</span>
                <button type="button" onClick={() => copyText(lastGiftLink)} title="Copy" className="shrink-0">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Megapot referral fees — unclaimed balance is read-only on-chain; claiming is done from
          the admin's own connected EVM wallet, then recorded here for tracking. */}
      <div className="rounded-xl border border-gray-800 p-4 space-y-3">
        <div className="text-base font-semibold text-gray-200">Megapot referral fees</div>
        <p className="text-sm text-gray-500">
          Accrues automatically from Loofta-referred tickets (10% of winners&apos; payouts). This backend never
          holds that wallet&apos;s private key — connect the wallet that controls it below to claim.
        </p>
        {referralFeesLoading && (
          <div className="flex items-center gap-2 text-base text-gray-400 py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading balance…
          </div>
        )}
        {!referralFeesLoading && referralFeesLoaded && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-sm text-gray-500 uppercase tracking-wide">Unclaimed</div>
                <div className="text-2xl font-semibold text-emerald-400 tabular-nums mt-1">
                  ${(referralFeesBalance ?? 0).toFixed(6)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-500 uppercase tracking-wide">Claimed total</div>
                <div className="text-2xl font-semibold text-blue-400 tabular-nums mt-1">
                  ${referralFeesClaimedTotal.toFixed(6)}
                </div>
              </div>
            </div>
            {referralFeesWallet && (
              <div className="text-sm text-gray-500 font-mono">Referrer wallet: {referralFeesWallet}</div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!connectedEvmAddress ? (
                <Button size="sm" onClick={connectEvmWallet} className="bg-teal-700 hover:bg-teal-600 text-white">
                  Connect EVM wallet
                </Button>
              ) : (
                <>
                  <span className="text-sm text-gray-400 font-mono">{trunc(connectedEvmAddress, 10)}</span>
                  <Button
                    size="sm"
                    onClick={claimReferralFeesOnChain}
                    disabled={claimingReferralFees || (referralFeesBalance ?? 0) <= 0}
                    className="bg-emerald-700 hover:bg-emerald-600 text-white"
                  >
                    {claimingReferralFees ? <Loader2 className="w-4 h-4 animate-spin" /> : "Claim referral fees"}
                  </Button>
                </>
              )}
              {referralFeesBasescanUrl && (
                <a
                  href={referralFeesBasescanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 underline underline-offset-2"
                >
                  Or claim on Basescan <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            {referralFeesClaims.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-gray-800 mt-1">
                <table className="w-full text-sm text-gray-300">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-500 text-sm uppercase tracking-wide">
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-right px-3 py-2">Amount</th>
                      <th className="text-left px-3 py-2">Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referralFeesClaims.map((c: any) => (
                      <tr key={c.id} className="border-b border-gray-800/50">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-gray-500">
                          {new Date(c.claimed_at).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-400">${Number(c.amount_usdc).toFixed(6)}</td>
                        <td className="px-3 py-2">
                          <a
                            href={`https://basescan.org/tx/${c.tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-gray-500 hover:text-teal-400"
                          >
                            {trunc(c.tx_hash, 12)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Gifts list — folds together with the gift form above, same giftSectionOpen toggle */}
      {giftSectionOpen && giftsLoaded && giftsData.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-base text-gray-300">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Recipient</th>
                <th className="text-right px-4 py-2.5">Tickets</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Ticket</th>
                <th className="text-left px-4 py-2.5">Claim link</th>
              </tr>
            </thead>
            <tbody>
              {giftsData.map((row: any) => {
                const giftStatusColors: Record<string, string> = {
                  unclaimed: "text-amber-400",
                  claimed: "text-emerald-400",
                  cancelled: "text-gray-500",
                  failed: "text-red-400",
                };
                return (
                  <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.recipient_type === "handle" ? `@${row.recipient_identifier}` : row.recipient_identifier}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.num_tickets}</td>
                    <td className={`px-4 py-2.5 font-medium ${giftStatusColors[row.status] ?? "text-gray-400"}`}>
                      {row.status}{row.failure_reason ? ` — ${row.failure_reason}` : ""}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-sm text-gray-500">
                      {row.resulting_ticket_id ?? <span className="text-gray-700">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {row.claimUrl ? (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          <span className="truncate max-w-[220px]">{row.claimUrl}</span>
                          <button type="button" onClick={() => copyText(row.claimUrl)} title="Copy" className="shrink-0">
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <a href={row.claimUrl} target="_blank" rel="noopener noreferrer" title="Open" className="shrink-0">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); fetchLottery(1, e.target.value); }}
          className="bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-3 py-1.5 text-base"
        >
          <option value="">All statuses</option>
          <option value="pending_send">Pending send</option>
          <option value="sent">Sent</option>
          <option value="bridging">Bridging</option>
          <option value="buying">Buying</option>
          <option value="active">Active (in draw)</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="failed">Failed</option>
          <option value="withdrawn">Withdrawn</option>
        </select>
        <span className="text-base text-gray-500">
          {totalTickets.toLocaleString()} tickets{total !== totalTickets ? ` (${total.toLocaleString()} entries)` : ""}
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-base text-gray-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading lottery tickets…
        </div>
      )}

      {!loading && loaded && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-base text-gray-300">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                <th className="text-left px-4 py-2.5 w-6"></th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-right px-4 py-2.5">Tickets</th>
                <th className="text-right px-4 py-2.5">Cost</th>
                <th className="text-left px-4 py-2.5">Route</th>
                <th className="text-left px-4 py-2.5">Platform</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Round</th>
                <th className="text-right px-4 py-2.5">Win</th>
                <th className="text-left px-4 py-2.5 max-w-[160px]">User</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-600">No lottery tickets found.</td></tr>
              )}
              {data.map((row: any) => {
                const statusColors: Record<string, string> = {
                  active: "text-blue-400",
                  won: "text-emerald-400",
                  withdrawn: "text-emerald-400",
                  lost: "text-gray-500",
                  failed: "text-red-400",
                  pending_send: "text-gray-400",
                  sent: "text-amber-400",
                  bridging: "text-amber-400",
                  buying: "text-amber-400",
                };
                const isSeeker = !!row.user?.username?.startsWith("skr-");
                const isExpanded = expandedId === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className="border-b border-gray-800/50 hover:bg-gray-900/40 cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : row.id)}
                    >
                      <td className="px-4 py-2.5 text-gray-500">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-gray-500">
                        {new Date(row.created_at).toLocaleDateString()} {new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.num_tickets}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">${Number(row.cost_usdc).toFixed(2)}</td>
                      <td className="px-4 py-2.5">{row.burner_sol_address ? "Private" : "Public"}</td>
                      <td className="px-4 py-2.5">
                        {isSeeker ? (
                          <span className="text-purple-400 font-medium">Seeker</span>
                        ) : (
                          <span className="text-gray-400">Web</span>
                        )}
                      </td>
                      <td className={`px-4 py-2.5 font-medium ${statusColors[row.status] ?? "text-gray-400"}`}>{row.status}</td>
                      <td className="px-4 py-2.5 text-gray-400">{row.round_id ?? <span className="text-gray-700">—</span>}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {row.win_amount_usdc ? <span className="text-emerald-400 font-medium">${Number(row.win_amount_usdc).toFixed(2)}</span> : <span className="text-gray-700">—</span>}
                      </td>
                      <td className="px-4 py-2.5 max-w-[160px] truncate">
                        {row.user?.username ? (
                          <span className="text-gray-200">@{row.user.username}</span>
                        ) : row.user?.email ? (
                          <span className="text-gray-300">{row.user.email}</span>
                        ) : (
                          <span className="text-gray-600 font-mono text-sm">{row.user_id}</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-gray-800/50 bg-gray-900/30">
                        <td colSpan={10} className="px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                            <div>
                              <span className="text-gray-500">Ticket ID </span>
                              <span className="font-mono text-gray-300">{row.id}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Solana address </span>
                              {row.user_solana_address ? (
                                <span className="font-mono text-gray-300">{trunc(row.user_solana_address, 14)}</span>
                              ) : <span className="text-gray-700">—</span>}
                            </div>
                            <div>
                              <span className="text-gray-500">Bridge status </span>
                              <span className="text-gray-300">{row.bridge_status ?? <span className="text-gray-700">—</span>}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Buy tx </span>
                              <TxCell hash={row.sender_tx_hash} chain="solana" isDevnet={false} />
                            </div>
                            <div>
                              <span className="text-gray-500">Claim tx </span>
                              <TxCell hash={row.claim_tx_hash} chain="base" isDevnet={false} />
                            </div>
                            <div>
                              <span className="text-gray-500">Fee </span>
                              <span className="text-gray-300">{row.fee_amount_usdc ? `$${Number(row.fee_amount_usdc).toFixed(4)}` : <span className="text-gray-700">—</span>}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Ticket numbers </span>
                              <span className="font-mono text-gray-300">{row.ticket_numbers ? JSON.stringify(row.ticket_numbers) : <span className="text-gray-700">—</span>}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Winning numbers </span>
                              <span className="font-mono text-gray-300">{row.winning_numbers ? JSON.stringify(row.winning_numbers) : <span className="text-gray-700">—</span>}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Companion address </span>
                              <AddressCell address={row.companion_address} />
                            </div>
                            <div>
                              <span className="text-gray-500">Burner Solana address </span>
                              <SolAddressCell address={row.burner_sol_address} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
            onClick={() => fetchLottery(page - 1, statusFilter)}
            className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
          >← Prev</button>
          <span className="text-base text-gray-500">Page {page} of {Math.ceil(total / 50)}</span>
          <button
            type="button"
            disabled={page >= Math.ceil(total / 50)}
            onClick={() => fetchLottery(page + 1, statusFilter)}
            className="px-3 py-1 rounded border border-gray-700 text-gray-400 disabled:opacity-40 hover:bg-gray-800"
          >Next →</button>
        </div>
      )}
    </div>
  );
}
