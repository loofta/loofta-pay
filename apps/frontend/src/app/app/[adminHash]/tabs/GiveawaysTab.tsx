"use client";

// Self-contained (fetches/holds its own state) — same convention as OrganizationsTab.tsx / PacksTab.tsx.
// Calls the NestJS backend directly (not a Next.js API proxy route) because approval triggers
// real business logic (minting the giveaway's burner wallet) that only lives in GiveawaysService —
// a raw Supabase status-flip route (like /api/admin/organizations) would silently skip that.

import { Fragment, useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, Gift, Check, X, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface AdminGiveaway {
  id: string;
  title: string;
  created_by: string;
  created_by_email: string | null;
  winner_count: number;
  selection_mode: "random" | "first_come" | "manual";
  prize_amount_usd: string;
  entries_close_at: string;
  status: string;
  created_at: string;
}

interface EscalationCompletion {
  id: string;
  giveaway_entry_id: string;
  giveaway_task_id: string;
  verification_status: string;
  verification_detail: Record<string, unknown> | null;
  updated_at: string;
}

interface AdminGiveawayDetail {
  id: string;
  description: string | null;
  entries_close_at: string;
  eligibility: { min_followers?: number; min_account_age_days?: number };
  funding_required_usd: string | null;
  funding_confirmed_usd: string;
  burner_address: string | null;
  entry_count: number;
  tasks: Array<{ id: string; task_type: string; config: { target?: string; instructions?: string; comment_requirement?: string } }>;
}

export function GiveawaysTab() {
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const [pending, setPending] = useState<AdminGiveaway[] | null>(null);
  const [escalations, setEscalations] = useState<EscalationCompletion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AdminGiveawayDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  // Public detail endpoint works regardless of status (not just OPEN), and needs no auth —
  // safe to reuse here for a pending giveaway's full description/tasks/eligibility.
  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    setExpandedDetail(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/public/${id}`);
      if (!res.ok) throw new Error(await res.text());
      setExpandedDetail(await res.json());
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load details", description: err.message });
    } finally {
      setLoadingDetail(false);
    }
  }, [expandedId, toast]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const [pendingRes, escalationsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/giveaways/admin/pending`, { headers }),
        fetch(`${BACKEND_URL}/giveaways/admin/review-queue`, { headers }),
      ]);
      if (!pendingRes.ok) throw new Error(await pendingRes.text());
      if (!escalationsRes.ok) throw new Error(await escalationsRes.text());
      setPending((await pendingRes.json()).giveaways ?? []);
      setEscalations((await escalationsRes.json()).items ?? []);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load giveaways", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const review = useCallback(async (id: string, decision: "approve" | "reject") => {
    if (decision === "reject" && !window.confirm("Reject this giveaway?")) return;
    setBusyId(id);
    try {
      const rejection_reason = decision === "reject" ? window.prompt("Rejection reason:") ?? "" : undefined;
      if (decision === "reject" && !rejection_reason) { setBusyId(null); return; }
      const res = await fetch(`${BACKEND_URL}/giveaways/admin/${id}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ decision, rejection_reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: decision === "approve" ? "Giveaway approved — burner minted" : "Giveaway rejected" });
      fetchAll();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to review giveaway", description: err.message });
    } finally {
      setBusyId(null);
    }
  }, [authHeaders, toast, fetchAll]);

  const reviewCompletion = useCallback(async (completionId: string, decision: "verified" | "rejected") => {
    setBusyId(completionId);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/admin/completions/${completionId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: `Completion marked ${decision}` });
      fetchAll();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to review completion", description: err.message });
    } finally {
      setBusyId(null);
    }
  }, [authHeaders, toast, fetchAll]);

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Gift className="w-4 h-4 text-gray-400" />
          <span className="text-base md:text-sm font-medium text-gray-300">Giveaways awaiting approval</span>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-500 ml-2" />}
        </div>
        <div className="border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-500 text-left">
              <tr>
                <th className="px-3 py-2 font-medium w-6"></th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Creator</th>
                <th className="px-3 py-2 font-medium">Winners</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Prize/winner</th>
                <th className="px-3 py-2 font-medium">Closes</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(pending ?? []).length === 0 && !loading && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-600">No giveaways pending approval</td></tr>
              )}
              {(pending ?? []).map((g) => (
                <Fragment key={g.id}>
                <tr
                  onClick={() => toggleExpand(g.id)}
                  className="border-t border-gray-800 text-gray-300 cursor-pointer hover:bg-gray-900/60"
                >
                  <td className="px-3 py-2 text-gray-500">
                    {expandedId === g.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </td>
                  <td className="px-3 py-2">{g.title}</td>
                  <td className="px-3 py-2 text-gray-400">
                    {g.created_by_email ?? <span className="font-mono text-gray-600">{g.created_by.slice(0, 14)}…</span>}
                  </td>
                  <td className="px-3 py-2">{g.winner_count}</td>
                  <td className="px-3 py-2">{g.selection_mode}</td>
                  <td className="px-3 py-2">${g.prize_amount_usd}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(g.entries_close_at).toLocaleString()}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === g.id}
                        onClick={() => review(g.id, "approve")}
                        className="p-1.5 rounded bg-green-900/40 text-green-400 hover:bg-green-900/70 disabled:opacity-50"
                        aria-label="Approve"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === g.id}
                        onClick={() => review(g.id, "reject")}
                        className="p-1.5 rounded bg-red-900/40 text-red-400 hover:bg-red-900/70 disabled:opacity-50"
                        aria-label="Reject"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                {expandedId === g.id && (
                  <tr className="border-t border-gray-800 bg-gray-950/60">
                    <td colSpan={8} className="px-4 py-3">
                      {loadingDetail ? (
                        <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                      ) : expandedDetail ? (
                        <div className="space-y-2 text-gray-300">
                          {expandedDetail.description && <p className="text-gray-400">{expandedDetail.description}</p>}
                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-gray-500">
                            <span>Entries close: {new Date(expandedDetail.entries_close_at).toLocaleString()}</span>
                            <span>Entries so far: {expandedDetail.entry_count}</span>
                            {expandedDetail.eligibility?.min_followers != null && (
                              <span>Min followers: {expandedDetail.eligibility.min_followers}</span>
                            )}
                            {expandedDetail.eligibility?.min_account_age_days != null && (
                              <span>Min account age: {expandedDetail.eligibility.min_account_age_days}d</span>
                            )}
                          </div>
                          <div>
                            <p className="text-gray-500 mb-1">Tasks ({expandedDetail.tasks.length})</p>
                            <ul className="space-y-1">
                              {expandedDetail.tasks.map((t) => (
                                <li key={t.id} className="text-gray-400">
                                  <span className="text-gray-300">{t.task_type.replace(/_/g, " ")}</span>
                                  {t.config.target && <span> — {t.config.target}</span>}
                                  {t.config.instructions && <span> — {t.config.instructions}</span>}
                                  {t.config.comment_requirement && <span> — {t.config.comment_requirement}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ) : (
                        <p className="text-gray-600">Failed to load details</p>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-gray-400" />
          <span className="text-base md:text-sm font-medium text-gray-300">X-verification escalations</span>
          <span className="text-sm text-gray-600">(the X-API checker couldn&apos;t resolve these — decide manually)</span>
        </div>
        <div className="border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-500 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Completion</th>
                <th className="px-3 py-2 font-medium">Detail</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(escalations ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-600">Nothing escalated right now</td></tr>
              )}
              {(escalations ?? []).map((c) => (
                <tr key={c.id} className="border-t border-gray-800 text-gray-300">
                  <td className="px-3 py-2 font-mono text-gray-500">{c.id.slice(0, 8)}…</td>
                  <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{JSON.stringify(c.verification_detail ?? {})}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(c.updated_at).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => reviewCompletion(c.id, "verified")}
                        className="p-1.5 rounded bg-green-900/40 text-green-400 hover:bg-green-900/70 disabled:opacity-50"
                        aria-label="Mark verified"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => reviewCompletion(c.id, "rejected")}
                        className="p-1.5 rounded bg-red-900/40 text-red-400 hover:bg-red-900/70 disabled:opacity-50"
                        aria-label="Mark rejected"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
