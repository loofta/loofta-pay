"use client";

// Self-contained (fetches/holds its own state) — same convention as OrganizationsTab.tsx / PacksTab.tsx.
// Calls the NestJS backend directly (not a Next.js API proxy route) because approval triggers
// real business logic (minting the giveaway's burner wallet) that only lives in GiveawaysService —
// a raw Supabase status-flip route (like /api/admin/organizations) would silently skip that.

import { Fragment, useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Loader2, Gift, Check, X, AlertTriangle, ChevronDown, ChevronRight, Ban, Search, Pencil } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED", "REJECTED", "REFUNDED", "UNDERFUNDED_EXPIRED"]);

interface EditForm {
  title: string;
  description: string;
  entries_close_at: string;
  min_followers: string;
  min_account_age_days: string;
}

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
  updated_at: string;
  cancel_reason: string | null;
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
  const [cancelled, setCancelled] = useState<AdminGiveaway[] | null>(null);
  const [escalations, setEscalations] = useState<EscalationCompletion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<AdminGiveawayDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // "All giveaways" — support-mediated edit, since self-service editing is intentionally not a
  // thing for creators (see AdminEditGiveawayDto). This is the only way to find a giveaway that's
  // already past PENDING_APPROVAL (e.g. funded/open) in order to edit it.
  const [allGiveaways, setAllGiveaways] = useState<AdminGiveaway[] | null>(null);
  const [allLoading, setAllLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [loadingEditDetail, setLoadingEditDetail] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

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
      const [pendingRes, cancelledRes, escalationsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/giveaways/admin/pending`, { headers }),
        fetch(`${BACKEND_URL}/giveaways/admin/cancelled`, { headers }),
        fetch(`${BACKEND_URL}/giveaways/admin/review-queue`, { headers }),
      ]);
      if (!pendingRes.ok) throw new Error(await pendingRes.text());
      if (!cancelledRes.ok) throw new Error(await cancelledRes.text());
      if (!escalationsRes.ok) throw new Error(await escalationsRes.text());
      setPending((await pendingRes.json()).giveaways ?? []);
      setCancelled((await cancelledRes.json()).giveaways ?? []);
      setEscalations((await escalationsRes.json()).items ?? []);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load giveaways", description: err.message });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const searchAll = useCallback(async (search: string) => {
    setAllLoading(true);
    try {
      const headers = await authHeaders();
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const res = await fetch(`${BACKEND_URL}/giveaways/admin/all${qs}`, { headers });
      if (!res.ok) throw new Error(await res.text());
      setAllGiveaways((await res.json()).giveaways ?? []);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load giveaways", description: err.message });
    } finally {
      setAllLoading(false);
    }
  }, [authHeaders, toast]);

  useEffect(() => { searchAll(""); }, [searchAll]);

  const startEdit = useCallback(async (g: AdminGiveaway) => {
    if (editingId === g.id) {
      setEditingId(null);
      setEditForm(null);
      return;
    }
    setEditingId(g.id);
    setEditForm(null);
    setLoadingEditDetail(true);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/public/${g.id}`);
      if (!res.ok) throw new Error(await res.text());
      const detail: AdminGiveawayDetail = await res.json();
      setEditForm({
        title: g.title,
        description: detail.description ?? "",
        entries_close_at: detail.entries_close_at ? detail.entries_close_at.slice(0, 16) : "",
        min_followers: detail.eligibility?.min_followers != null ? String(detail.eligibility.min_followers) : "",
        min_account_age_days: detail.eligibility?.min_account_age_days != null ? String(detail.eligibility.min_account_age_days) : "",
      });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to load giveaway", description: err.message });
      setEditingId(null);
    } finally {
      setLoadingEditDetail(false);
    }
  }, [editingId, toast]);

  const saveEdit = useCallback(async (id: string) => {
    if (!editForm) return;
    setSavingEdit(true);
    try {
      const body: Record<string, unknown> = {
        title: editForm.title,
        description: editForm.description || undefined,
      };
      if (editForm.entries_close_at) body.entries_close_at = new Date(editForm.entries_close_at).toISOString();
      if (editForm.min_followers !== "") body.min_followers = Number(editForm.min_followers);
      if (editForm.min_account_age_days !== "") body.min_account_age_days = Number(editForm.min_account_age_days);

      const res = await fetch(`${BACKEND_URL}/giveaways/admin/${id}/edit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.message || "Failed to save changes");
      }
      toast({ title: "Giveaway updated" });
      setEditingId(null);
      setEditForm(null);
      searchAll(searchInput);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to save changes", description: err.message });
    } finally {
      setSavingEdit(false);
    }
  }, [editForm, authHeaders, toast, searchAll, searchInput]);

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
          <Pencil className="w-4 h-4 text-gray-400" />
          <span className="text-base md:text-sm font-medium text-gray-300">All giveaways</span>
          <span className="text-sm text-gray-600">(support-mediated edit — title/description/close date/eligibility only, no prize or winner-count changes)</span>
          {allLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-500 ml-2" />}
        </div>
        <div className="flex items-center gap-2 mb-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") searchAll(searchInput); }}
              placeholder="Search by title…"
              className="w-full bg-gray-900 border border-gray-800 rounded-lg pl-8 pr-3 py-1.5 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-gray-600"
            />
          </div>
          <button
            type="button"
            onClick={() => searchAll(searchInput)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
          >
            Search
          </button>
        </div>
        <div className="border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-500 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Creator</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Prize/winner</th>
                <th className="px-3 py-2 font-medium">Closes</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(allGiveaways ?? []).length === 0 && !allLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-600">No giveaways found</td></tr>
              )}
              {(allGiveaways ?? []).map((g) => {
                const editable = !TERMINAL_STATUSES.has(g.status);
                return (
                  <Fragment key={g.id}>
                    <tr className="border-t border-gray-800 text-gray-300">
                      <td className="px-3 py-2">{g.title}</td>
                      <td className="px-3 py-2 text-gray-400">
                        {g.created_by_email ?? <span className="font-mono text-gray-600">{g.created_by.slice(0, 14)}…</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{g.status.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2">${g.prize_amount_usd} × {g.winner_count}</td>
                      <td className="px-3 py-2 text-gray-500">{new Date(g.entries_close_at).toLocaleString()}</td>
                      <td className="px-3 py-2">
                        {editable ? (
                          <button
                            type="button"
                            onClick={() => startEdit(g)}
                            className="p-1.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
                            aria-label="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-gray-700">—</span>
                        )}
                      </td>
                    </tr>
                    {editingId === g.id && (
                      <tr className="border-t border-gray-800 bg-gray-950/60">
                        <td colSpan={6} className="px-4 py-3">
                          {loadingEditDetail || !editForm ? (
                            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                          ) : (
                            <div className="space-y-2 max-w-xl">
                              <div>
                                <label className="text-gray-500 text-sm block mb-1">Title</label>
                                <input
                                  value={editForm.title}
                                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
                                />
                              </div>
                              <div>
                                <label className="text-gray-500 text-sm block mb-1">Description</label>
                                <textarea
                                  value={editForm.description}
                                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                  rows={3}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
                                />
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-gray-500 text-sm block mb-1">Entries close</label>
                                  <input
                                    type="datetime-local"
                                    value={editForm.entries_close_at}
                                    onChange={(e) => setEditForm({ ...editForm, entries_close_at: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
                                  />
                                </div>
                                <div>
                                  <label className="text-gray-500 text-sm block mb-1">Min followers</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={editForm.min_followers}
                                    onChange={(e) => setEditForm({ ...editForm, min_followers: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
                                  />
                                </div>
                                <div>
                                  <label className="text-gray-500 text-sm block mb-1">Min account age (days)</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={editForm.min_account_age_days}
                                    onChange={(e) => setEditForm({ ...editForm, min_account_age_days: e.target.value })}
                                    className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-gray-600"
                                  />
                                </div>
                              </div>
                              <div className="flex gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => saveEdit(g.id)}
                                  disabled={savingEdit}
                                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-900/40 text-green-400 hover:bg-green-900/70 disabled:opacity-50"
                                >
                                  {savingEdit ? "Saving…" : "Save changes"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setEditingId(null); setEditForm(null); }}
                                  className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-700 text-gray-300 hover:bg-gray-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Ban className="w-4 h-4 text-gray-400" />
          <span className="text-base md:text-sm font-medium text-gray-300">Cancelled giveaways</span>
          <span className="text-sm text-gray-600">(hidden from the creator&apos;s own list once cancelled — audit view only)</span>
        </div>
        <div className="border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 text-gray-500 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Creator</th>
                <th className="px-3 py-2 font-medium">Prize/winner</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {(cancelled ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-600">No cancelled giveaways</td></tr>
              )}
              {(cancelled ?? []).map((g) => (
                <tr key={g.id} className="border-t border-gray-800 text-gray-300">
                  <td className="px-3 py-2">{g.title}</td>
                  <td className="px-3 py-2 text-gray-400">
                    {g.created_by_email ?? <span className="font-mono text-gray-600">{g.created_by.slice(0, 14)}…</span>}
                  </td>
                  <td className="px-3 py-2">${g.prize_amount_usd} × {g.winner_count}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{g.cancel_reason ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-500">{new Date(g.updated_at).toLocaleString()}</td>
                </tr>
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
