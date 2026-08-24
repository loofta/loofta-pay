"use client";

import { Loader2 } from "lucide-react";
import type { AnalyticsData } from "../admin-shared";

export function AnalyticsTab({
  loading, loaded, data,
  showAbove5List, setShowAbove5List,
  showRepeatAbove5List, setShowRepeatAbove5List,
  sparksData, sparksLoaded,
}: {
  loading: boolean;
  loaded: boolean;
  data: AnalyticsData | null;
  showAbove5List: boolean;
  setShowAbove5List: (fn: (v: boolean) => boolean) => void;
  showRepeatAbove5List: boolean;
  setShowRepeatAbove5List: (fn: (v: boolean) => boolean) => void;
  sparksData: any[];
  sparksLoaded: boolean;
}) {
  return (
    <div className="space-y-6">
      {loading && (
        <div className="flex items-center gap-2 text-base md:text-sm text-gray-400 py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading analytics…
        </div>
      )}
      {!loading && !loaded && (
        <div className="text-gray-600 text-base md:text-sm py-12 text-center">Click Refresh to load analytics.</div>
      )}
      {!loading && loaded && data && (() => {
        const analyticsData = data;
        const emailPct = analyticsData.total_users > 0
          ? Math.round((analyticsData.users_with_email / analyticsData.total_users) * 100)
          : 0;
        const twitterFromSparks = sparksLoaded
          ? sparksData.filter((u: any) => u.tasks.find((t: any) => t.key === "connect_twitter")?.completed).length
          : null;
        const twitterPct = twitterFromSparks != null && sparksData.length > 0
          ? Math.round((twitterFromSparks / sparksData.length) * 100)
          : null;
        const funnel = analyticsData.funnel_mainnet;
        const stepPct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
        const funnelSteps = [
          { label: "Signed Up", value: funnel.users_signed_up },
          { label: "Created a Link", value: funnel.users_created_link },
          { label: "Funded It", value: funnel.users_funded },
          { label: "Recipient Claimed", value: funnel.users_success },
        ];

        return (
          <>
            {/* Volume section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Transaction Volume</h3>
              <div className="bg-gray-900 border border-amber-900 rounded-lg p-4 mb-3">
                <div className="text-[10px] text-amber-400 uppercase tracking-wider mb-1 font-medium">Total Platform Volume</div>
                <div className="text-3xl font-bold text-white tabular-nums">
                  {analyticsData.volume_total_all.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-sm text-gray-500 mt-0.5">USDC · payments + lottery + deposits + withdrawals (mainnet)</div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-orange-400 uppercase tracking-wider mb-1 font-medium">Devnet Volume</div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {analyticsData.volume_devnet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">USDC success</div>
                  <div className="text-sm text-gray-600 mt-0.5">
                    {analyticsData.volume_devnet_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-orange-400 uppercase tracking-wider mb-1 font-medium">Devnet Transactions</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.tx_devnet_success.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">success · {analyticsData.tx_devnet_total.toLocaleString()} total</div>
                </div>
                <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                  <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Mainnet Volume</div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {analyticsData.volume_mainnet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">USDC success</div>
                  <div className="text-sm text-gray-600 mt-0.5">
                    {analyticsData.volume_mainnet_total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
                  </div>
                </div>
                <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                  <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Mainnet Transactions</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.tx_mainnet_success.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">success · {analyticsData.tx_mainnet_total.toLocaleString()} total</div>
                </div>
                <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                  <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Mainnet Tx &gt; $5</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.tx_mainnet_success_above_5.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">success, above $5 USDC</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAbove5List((v) => !v)}
                  className="bg-gray-900 border border-green-900 rounded-lg p-4 text-left hover:bg-gray-800/60 transition-colors"
                >
                  <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Unique Users &gt; $5</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.users_mainnet_success_above_5.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">distinct senders · {showAbove5List ? "hide list" : "show list"}</div>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRepeatAbove5List((v) => !v)}
                  className="bg-gray-900 border border-green-900 rounded-lg p-4 text-left hover:bg-gray-800/60 transition-colors"
                >
                  <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Repeat Senders</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.users_mainnet_success_above_5_repeat_list.length.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">&gt;2 successful payments, any amount · {showRepeatAbove5List ? "hide list" : "show list"}</div>
                </button>
              </div>
              {showAbove5List && (
                <div className="overflow-x-auto rounded-xl border border-gray-800 mt-3">
                  <table className="w-full text-base md:text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                        <th className="text-left px-4 py-2.5">#</th>
                        <th className="text-left px-4 py-2.5">User</th>
                        <th className="text-center px-3 py-2.5">Payments &gt; $5</th>
                        <th className="text-right px-4 py-2.5">Total (USDC)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.users_mainnet_success_above_5_list.map((u, i) => (
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
                          <td className="px-3 py-2.5 text-center tabular-nums text-white">{u.txCount}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-white">
                            {u.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                      {analyticsData.users_mainnet_success_above_5_list.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">No users yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {showRepeatAbove5List && (
                <div className="overflow-x-auto rounded-xl border border-gray-800 mt-3">
                  <table className="w-full text-base md:text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400 text-sm uppercase tracking-wide">
                        <th className="text-left px-4 py-2.5">#</th>
                        <th className="text-left px-4 py-2.5">User</th>
                        <th className="text-center px-3 py-2.5">Payments</th>
                        <th className="text-right px-4 py-2.5">Total (USDC)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.users_mainnet_success_above_5_repeat_list.map((u, i) => (
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
                          <td className="px-3 py-2.5 text-center tabular-nums text-white">{u.txCount}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-white">
                            {u.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                      {analyticsData.users_mainnet_success_above_5_repeat_list.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">No repeat senders yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Lottery / deposits / withdrawals volume */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Lottery, Deposits &amp; Withdrawals</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1 font-medium">Lottery Volume</div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {analyticsData.volume_lottery.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">USDC · {analyticsData.tx_lottery_count.toLocaleString()} tickets</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1 font-medium">Lottery Users</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.users_lottery.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">unique buyers</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1 font-medium">Lottery Repeat Buyers</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.lottery_repeat_buyers.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">
                    {analyticsData.users_lottery > 0
                      ? Math.round((analyticsData.lottery_repeat_buyers / analyticsData.users_lottery) * 100)
                      : 0}% of buyers · {analyticsData.lottery_one_time_buyers.toLocaleString()} one-time
                  </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-blue-400 uppercase tracking-wider mb-1 font-medium">Deposit Volume</div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {analyticsData.volume_deposits.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">USDC · {analyticsData.tx_deposits_count.toLocaleString()} completed</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-orange-400 uppercase tracking-wider mb-1 font-medium">Withdraw Volume (Devnet)</div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {analyticsData.volume_withdrawals_devnet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">USDC · {analyticsData.tx_withdrawals_devnet_count.toLocaleString()} rows</div>
                </div>
                <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                  <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Withdraw Volume (Mainnet)</div>
                  <div className="text-2xl font-bold text-white tabular-nums">
                    {analyticsData.volume_withdrawals_mainnet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5">USDC · {analyticsData.tx_withdrawals_mainnet_count.toLocaleString()} rows</div>
                </div>
              </div>
            </div>

            {/* Users section */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Users</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-blue-400 uppercase tracking-wider mb-1 font-medium">Total Users</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.total_users.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">registered accounts</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-blue-400 uppercase tracking-wider mb-1 font-medium">Email Connected</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{emailPct}%</div>
                  <div className="text-sm text-gray-500 mt-0.5">{analyticsData.users_with_email.toLocaleString()} of {analyticsData.total_users.toLocaleString()} users</div>
                </div>
                <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                  <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Mainnet Active Users</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.mainnet_active_users.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">sent, received, or bought a lottery ticket</div>
                </div>
                <div className="bg-gray-900 border border-green-900 rounded-lg p-4">
                  <div className="text-[10px] text-green-400 uppercase tracking-wider mb-1 font-medium">Repeat Users</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.mainnet_repeat_users.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">2+ mainnet payments/tickets</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-sky-400 uppercase tracking-wider mb-1 font-medium">X Connected</div>
                  {twitterFromSparks != null ? (
                    <>
                      <div className="text-2xl font-bold text-white tabular-nums">{twitterFromSparks.toLocaleString()}</div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {twitterPct}% of {sparksData.length} tracked users
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-gray-600">—</div>
                      <div className="text-sm text-gray-600 mt-0.5">load Sparks tab first</div>
                    </>
                  )}
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-purple-400 uppercase tracking-wider mb-1 font-medium">Waitlist Applicants</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{analyticsData.waitlist_total.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{analyticsData.waitlist_granted.toLocaleString()} granted · {analyticsData.waitlist_with_twitter.toLocaleString()} with X</div>
                </div>
              </div>
            </div>

            {/* Mainnet payment funnel */}
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Mainnet Payment Funnel</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {funnelSteps.map((step, i) => {
                  const prevValue = i > 0 ? funnelSteps[i - 1].value : null;
                  const fromFirstPct = stepPct(step.value, funnelSteps[0].value);
                  const fromPrevPct = prevValue != null ? stepPct(step.value, prevValue) : null;
                  return (
                    <div key={step.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                      <div className="text-[10px] text-teal-400 uppercase tracking-wider mb-1 font-medium">{step.label}</div>
                      <div className="text-2xl font-bold text-white tabular-nums">{step.value.toLocaleString()}</div>
                      <div className="text-sm text-gray-500 mt-0.5">
                        {fromPrevPct != null ? `${fromPrevPct}% of prev step` : `${fromFirstPct}% of signups`}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mt-3">
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">Links Created</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{funnel.links_created.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">mainnet payment links, any status</div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">Links Funded → Success</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{funnel.links_funded.toLocaleString()} → {funnel.links_success.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{stepPct(funnel.links_success, funnel.links_created)}% of all links completed</div>
                </div>
                <div className="bg-gray-900 border border-red-900 rounded-lg p-4">
                  <div className="text-[10px] text-red-400 uppercase tracking-wider mb-1 font-medium">Expired Unfunded</div>
                  <div className="text-2xl font-bold text-white tabular-nums">{funnel.links_expired.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mt-0.5">{stepPct(funnel.links_expired, funnel.links_created)}% of all links — sender never funded</div>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
