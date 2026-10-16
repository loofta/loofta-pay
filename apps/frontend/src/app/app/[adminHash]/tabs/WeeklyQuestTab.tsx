"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";

interface Award {
  id: string;
  user_id: string;
  username: string | null;
  email: string | null;
  week_start: string;
  volume_usd: number;
  tickets: number;
  status: "awarding" | "awarded" | "failed" | "skipped_budget" | "disabled";
  lottery_ticket_id: string | null;
  failure_reason: string | null;
  qualified_at: string;
  awarded_at: string | null;
}
interface ProgressRow {
  userId: string;
  username: string | null;
  email: string | null;
  volumeUsd: number;
  qualified: boolean;
  projectedTickets: number;
  award: Award | null;
}
interface Overview {
  settings: { enabled: boolean; targetUsd: number; maxTicketsPerWinner: number; weeklyBudgetUsd: number };
  weekStart: string;
  nextWeekStart: string;
  daysUntilNext: number;
  qualifiedCount: number;
  progress: ProgressRow[];
  awards: Award[];
}

const STATUS_STYLE: Record<string, string> = {
  awarded: "bg-green-900/40 text-green-400",
  awarding: "bg-blue-900/40 text-blue-400",
  failed: "bg-red-900/40 text-red-400",
  skipped_budget: "bg-amber-900/40 text-amber-400",
  disabled: "bg-gray-800 text-gray-400",
};
const money = (n: number) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const who = (r: { username: string | null; email: string | null; userId?: string; user_id?: string }) =>
  r.username ? `@${r.username.replace(/^@/, "")}` : r.email ?? (r.userId ?? r.user_id ?? "").slice(0, 14);

export function WeeklyQuestTab() {
  const { getAccessToken } = usePrivy();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState("");
  const [budget, setBudget] = useState("");
  const [tickets, setTickets] = useState("");

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const t = await getAccessToken().catch(() => null);
    return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  }, [getAccessToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/weekly-quest", { headers: await headers(), cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Failed to load");
      const d = (await res.json()) as Overview;
      setData(d);
      setTarget(String(d.settings.targetUsd));
      setBudget(String(d.settings.weeklyBudgetUsd));
      setTickets(String(d.settings.maxTicketsPerWinner));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/weekly-quest", { method: "PATCH", headers: await headers(), body: JSON.stringify(patch) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? "Failed to save");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const retry = async (awardId: string) => {
    if (!window.confirm("Retry this award? Only do this after confirming no ticket was already bought for it.")) return;
    const res = await fetch("/api/admin/weekly-quest", { method: "POST", headers: await headers(), body: JSON.stringify({ awardId }) });
    if (!res.ok) setError((await res.json().catch(() => ({})))?.message ?? "Retry failed");
    await load();
  };

  const awardNow = async (userId: string, label: string) => {
    if (!window.confirm(`Buy free ticket(s) for ${label} now? This spends treasury funds.`)) return;
    const res = await fetch("/api/admin/weekly-quest", { method: "POST", headers: await headers(), body: JSON.stringify({ userId }) });
    if (!res.ok) setError((await res.json().catch(() => ({})))?.message ?? "Award failed");
    else setError(null);
    await load();
  };

  if (!data) return <div className="p-6 text-gray-400">{error ?? <Loader2 className="h-5 w-5 animate-spin" />}</div>;
  const s = data.settings;

  return (
    <div className="space-y-6">
      {error && <p className="text-base text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Next quest starts in</div>
          <div className="text-2xl font-bold text-white">{data.daysUntilNext} {data.daysUntilNext === 1 ? "day" : "days"}</div>
          <div className="text-sm text-gray-500">{new Date(data.nextWeekStart).toUTCString().slice(0, 16)} (UTC)</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Qualified this week</div>
          <div className="text-2xl font-bold text-white">{data.qualifiedCount}</div>
          <div className="text-sm text-gray-500">hit {money(s.targetUsd)}</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Auto-award (end of week)</div>
          <div className="mt-1 flex items-center gap-3">
            <Switch checked={s.enabled} disabled={saving} onCheckedChange={(v) => save({ enabled: v })} />
            <span className={`text-base font-semibold ${s.enabled ? "text-green-400" : "text-gray-400"}`}>{s.enabled ? "ON" : "OFF"}</span>
          </div>
          <div className="mt-1 text-sm text-gray-500">{s.enabled ? "Pays last week every Monday UTC" : "Nothing is bought while off"}</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Week started</div>
          <div className="text-2xl font-bold text-white">{new Date(data.weekStart).toUTCString().slice(5, 11)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Settings (budget is never shown to users)</h3>
        <div className="flex flex-wrap items-end gap-3">
          {([["Target (USD)", target, setTarget], ["Max tickets per user", tickets, setTickets], ["Weekly budget (USD)", budget, setBudget]] as const).map(([label, val, set]) => (
            <label key={label} className="text-sm text-gray-400">
              {label}
              <input value={val} onChange={(e) => set(e.target.value.replace(/[^0-9.]/g, ""))} className="mt-1 block w-36 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-base text-white" />
            </label>
          ))}
          <button type="button" disabled={saving} onClick={() => save({ targetUsd: Number(target), maxTicketsPerWinner: Number(tickets), weeklyBudgetUsd: Number(budget) })}
            className="rounded-md bg-teal-600 px-4 py-2 text-base font-semibold text-white disabled:opacity-50">Save</button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500">This week: progress ({data.progress.length} users with activity)</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-left text-base">
            <thead className="bg-gray-900 text-sm text-gray-500"><tr><th className="p-3">User</th><th className="p-3">Volume</th><th className="p-3">Progress</th><th className="p-3">Tickets if paid</th><th className="p-3">Award</th></tr></thead>
            <tbody>
              {data.progress.map((p) => (
                <tr key={p.userId} className="border-t border-gray-800">
                  <td className="p-3 text-white">{who(p)}</td>
                  <td className="p-3 tabular-nums text-white">{money(p.volumeUsd)}</td>
                  <td className="p-3"><div className="h-2 w-32 overflow-hidden rounded-full bg-gray-800"><div className={`h-full ${p.qualified ? "bg-green-500" : "bg-orange-500"}`} style={{ width: `${Math.min(100, (p.volumeUsd / s.targetUsd) * 100)}%` }} /></div></td>
                  <td className="p-3 text-white">{p.projectedTickets || "-"}</td>
                  <td className="p-3">{p.award ? <span className={`rounded px-2 py-0.5 text-sm ${STATUS_STYLE[p.award.status]}`}>{p.award.status}</span> : p.qualified ? (
                    <span className="flex items-center gap-2">
                      <span className="text-sm text-amber-400">qualified</span>
                      <button type="button" onClick={() => awardNow(p.userId, who(p))} className="rounded bg-teal-600 px-3 py-1 text-sm font-semibold text-white">Award now</button>
                    </span>
                  ) : <span className="text-sm text-gray-600">-</span>}</td>
                </tr>
              ))}
              {data.progress.length === 0 && <tr><td className="p-4 text-gray-500" colSpan={5}>No activity this week yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500">Awards (this and last week)</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-left text-base">
            <thead className="bg-gray-900 text-sm text-gray-500"><tr><th className="p-3">User</th><th className="p-3">Week</th><th className="p-3">Volume</th><th className="p-3">Tickets</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody>
              {data.awards.map((a) => (
                <tr key={a.id} className="border-t border-gray-800">
                  <td className="p-3 text-white">{who(a)}</td>
                  <td className="p-3 text-gray-400">{a.week_start}</td>
                  <td className="p-3 tabular-nums text-white">{money(a.volume_usd)}</td>
                  <td className="p-3 text-white">{a.tickets}</td>
                  <td className="p-3">
                    <span className={`rounded px-2 py-0.5 text-sm ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                    {a.failure_reason && <div className="mt-1 max-w-xs truncate text-sm text-red-400" title={a.failure_reason}>{a.failure_reason}</div>}
                  </td>
                  <td className="p-3">{(a.status === "failed" || a.status === "skipped_budget") && !a.lottery_ticket_id && <button type="button" onClick={() => retry(a.id)} className="rounded bg-gray-800 px-3 py-1 text-sm text-white">Retry</button>}</td>
                </tr>
              ))}
              {data.awards.length === 0 && <tr><td className="p-4 text-gray-500" colSpan={6}>No awards yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
