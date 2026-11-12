"use client";

// Self-contained, same pattern as SubscriptionsTab.tsx. Who staked from Loofta (Earn) and how much, from the stake_events ledger.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";

interface Staker {
  userId: string;
  username: string | null;
  email: string | null;
  wallet: string;
  depositedUsd: number;
  withdrawnUsd: number;
  wonUsd: number;
  inPoolUsd: number;
  deposits: number;
  firstAt: string;
  lastAt: string;
}
interface Totals { stakers: number; stillIn: number; depositedUsd: number; withdrawnUsd: number; wonUsd: number; inPoolUsd: number }

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (s: string) => (s.length > 12 ? `${s.slice(0, 4)}...${s.slice(-4)}` : s);

export function EarnTab() {
  const { getAccessToken } = usePrivy();
  const [data, setData] = useState<{ totals: Totals; stakers: Staker[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyIn, setOnlyIn] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/admin/ample/stakers", { headers: token ? { authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error("Failed to load stakers");
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load stakers");
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.stakers ?? []).filter((s) => (!onlyIn || s.inPoolUsd >= 0.01) && (!needle || [s.username, s.email, s.wallet, s.userId].some((v) => (v ?? "").toLowerCase().includes(needle))));
  }, [data, q, onlyIn]);

  const t = data?.totals;
  return (
    <div className="space-y-3">
      {t && (
        <div className="rounded-xl border border-gray-800 p-4">
          <div className="text-base font-semibold text-gray-200 mb-3">Earn</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ["Stakers", `${t.stakers} (${t.stillIn} still in)`],
              ["Deposited", usd(t.depositedUsd)],
              ["Withdrawn", usd(t.withdrawnUsd)],
              ["Prizes won", usd(t.wonUsd)],
              ["In the pool now", usd(t.inPoolUsd)],
            ].map(([k, v]) => (
              <div key={k}>
                <div className="text-sm text-gray-500">{k}</div>
                <div className="text-lg font-bold text-gray-200 tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <div className="text-sm text-gray-500 pt-2">From the stake ledger, so only stakes made through Loofta. In the pool = deposited + won - withdrawn.</div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, wallet" className="flex-1 min-w-[200px] rounded-lg bg-white/5 border border-gray-800 px-3 py-2 text-base text-gray-200 outline-none" />
        <label className="flex items-center gap-2 text-sm text-gray-400"><input type="checkbox" checked={onlyIn} onChange={(e) => setOnlyIn(e.target.checked)} /> Still in</label>
        <button onClick={() => void load()} disabled={loading} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm text-gray-300 disabled:opacity-40">{loading ? "Loading..." : "Refresh"}</button>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="rounded-xl border border-gray-800 divide-y divide-gray-800">
        {loading && !data && <div className="p-4 flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>}
        {data && rows.length === 0 && <div className="p-4 text-sm text-gray-500">No stakers found.</div>}
        {rows.map((s) => (
          <div key={s.userId} className="flex items-center justify-between p-4 gap-3">
            <div className="min-w-0">
              <div className="text-base font-medium text-gray-200 truncate">{s.username ? `@${s.username}` : s.email ?? short(s.userId.replace(/^did:privy:/, ""))}</div>
              <div className="text-sm text-gray-500 truncate">
                <a href={`https://solscan.io/account/${s.wallet}`} target="_blank" rel="noreferrer" className="font-mono hover:text-gray-300">{short(s.wallet)}</a>
                {s.username && s.email ? ` · ${s.email}` : ""}
              </div>
              <div className="text-sm text-gray-600">{s.deposits} deposit{s.deposits === 1 ? "" : "s"} · first {new Date(s.firstAt).toLocaleDateString()} · last {new Date(s.lastAt).toLocaleDateString()}</div>
            </div>
            <div className="text-right shrink-0 tabular-nums">
              <div className="text-base font-bold text-gray-200">{usd(s.inPoolUsd)}</div>
              <div className="text-sm text-gray-500">in {usd(s.depositedUsd)}{s.withdrawnUsd > 0 ? ` · out ${usd(s.withdrawnUsd)}` : ""}</div>
              {s.wonUsd > 0 && <div className="text-sm text-emerald-400">won {usd(s.wonUsd)}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
