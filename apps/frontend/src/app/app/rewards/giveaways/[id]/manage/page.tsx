"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search, ChevronLeft, ChevronRight, ChevronDown, Copy, Download, Share2, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useToast } from "@/components/ui/use-toast";
import { GradientActionButton } from "@/components/ui/GradientActionButton";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ReviewQueueItem, ReviewQueueItemData } from "@/components/giveaways/ReviewQueueItem";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ENTRIES_PER_PAGE = 20;
const REVIEW_PAGE_SIZE = 10;
const searchInputClass = "pl-9 bg-white/[0.06] border-white/15 text-white placeholder:text-slate-500";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending review",
  REJECTED: "Rejected",
  PENDING_FUNDING: "Needs funding",
  FUNDED: "Funded",
  OPEN: "Funded",
  ENTRIES_CLOSED: "Entries closed",
  DRAWING: "Drawing winners",
  WINNERS_SELECTED: "Winners selected",
  PAYOUT_IN_PROGRESS: "Paying out",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  UNDERFUNDED_EXPIRED: "Expired — underfunded",
  REFUNDED: "Refunded",
};

function statusColor(status: string): string {
  if (status === "PENDING_APPROVAL") return "text-amber-400 bg-amber-500/10 border-amber-500/30";
  if (status === "REJECTED" || status === "UNDERFUNDED_EXPIRED" || status === "CANCELLED") return "text-red-400 bg-red-500/10 border-red-500/30";
  if (status === "PENDING_FUNDING") return "text-[#FF7A2A] bg-[#FF7A2A]/10 border-[#FF7A2A]/30";
  if (status === "OPEN" || status === "COMPLETED") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
  return "text-slate-300 bg-white/[0.06] border-white/10";
}

interface GiveawayDetail {
  id: string; title: string; status: string; selection_mode: string; winner_count: number;
  prize_amount_usd: string; entries_close_at: string;
  tasks: Array<{ id: string; task_type: string; config: { target?: string } }>;
}

interface Entry {
  id: string; user_id: string; entry_index: number; x_handle: string; status: string;
  payout_status: string | null; claim_payment_id: string | null; payment_status: string | null;
  claim_gift_id: string | null; claim_gift_short_id: string | null;
}

/** A winner's prize claim link — /c/[id] for a usdc giveaway, /gift/[shortId] (already claimed,
 *  real Megapot ticket numbers) for a megapot_ticket one. Null until the payout lands. */
function claimPath(entry: Entry): string | null {
  if (entry.claim_gift_id && entry.claim_gift_short_id) return `/gift/${entry.claim_gift_short_id}`;
  if (entry.claim_payment_id) return `/c/${entry.claim_payment_id}`;
  return null;
}

interface EntryCompletion {
  id: string;
  submission_data: Record<string, unknown> | null;
  verification_status: string;
  task: { task_type: string; config?: { target?: string } };
}

const COMPLETION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Not submitted yet",
  AUTO_VERIFIED: "Verified",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
  API_ERROR: "Needs manual review",
};

function completionStatusColor(status: string): string {
  if (status === "VERIFIED" || status === "AUTO_VERIFIED") return "text-emerald-400";
  if (status === "REJECTED") return "text-red-400";
  if (status === "API_ERROR") return "text-amber-400";
  return "text-slate-500";
}

// payout_status "succeeded" only means a claim link was created — payment_status (the underlying
// payments row's real status) is what tells us whether the winner actually claimed it.
function claimStatus(entry: Entry): { label: string; className: string } {
  if (entry.payout_status === "failed") return { label: "Payout failed", className: "text-red-400" };
  if (entry.payout_status === "in_progress") return { label: "Sending", className: "text-amber-400" };
  if (entry.payout_status !== "succeeded") return { label: "Pending", className: "text-slate-500" };
  if (entry.payment_status === "SUCCESS") return { label: "Claimed", className: "text-emerald-400" };
  return { label: "Sent, awaiting claim", className: "text-amber-400" };
}

async function authHeaders(getAccessToken: () => Promise<string | null>): Promise<Record<string, string>> {
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function ManageGiveawayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { getAccessToken } = usePrivy();
  const { toast } = useToast();
  const [selectedWinners, setSelectedWinners] = useState<Set<string>>(new Set());
  const [runningDraw, setRunningDraw] = useState(false);
  const [showRunDrawConfirm, setShowRunDrawConfirm] = useState(false);
  const [entriesDialogOpen, setEntriesDialogOpen] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryPage, setEntryPage] = useState(1);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewLink, setReviewLink] = useState<{ url: string; password: string } | null>(null);
  const [reviewLinkDialogOpen, setReviewLinkDialogOpen] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const { data: giveaway, refetch: refetchGiveaway } = useQuery({
    queryKey: ["giveaway-manage", id],
    queryFn: async (): Promise<GiveawayDetail> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Not found or not your giveaway");
      return res.json();
    },
  });

  const { data: entries, refetch: refetchEntries } = useQuery({
    queryKey: ["giveaway-manage-entries", id],
    queryFn: async (): Promise<Entry[]> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/entries`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load entries");
      return (await res.json()).entries ?? [];
    },
  });

  const { data: expandedEntryCompletions, isLoading: loadingEntryCompletions } = useQuery({
    queryKey: ["giveaway-entry-completions", id, expandedEntryId],
    queryFn: async (): Promise<EntryCompletion[]> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/entries/${expandedEntryId}/completions`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load task details");
      return (await res.json()).completions ?? [];
    },
    enabled: !!expandedEntryId,
  });

  const { data: reviewQueue, refetch: refetchReviewQueue } = useQuery({
    queryKey: ["giveaway-manage-review-queue", id, reviewPage],
    queryFn: async (): Promise<{ items: ReviewQueueItemData[]; total: number }> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/review-queue?page=${reviewPage}&pageSize=${REVIEW_PAGE_SIZE}`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load review queue");
      const body = await res.json();
      return { items: body.items ?? [], total: body.total ?? 0 };
    },
  });

  const review = useCallback(async (completionId: string, decision: "verified" | "rejected") => {
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/completions/${completionId}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: `Marked ${decision}` });
      refetchReviewQueue();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to review", description: err.message });
    }
  }, [id, getAccessToken, toast, refetchReviewQueue]);

  const generateReviewLink = useCallback(async () => {
    setGeneratingLink(true);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/review-link`, {
        method: "POST",
        headers: await authHeaders(getAccessToken),
      });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      setReviewLink({ url: body.url, password: body.password });
      setReviewLinkDialogOpen(true);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to generate review link", description: err.message });
    } finally {
      setGeneratingLink(false);
    }
  }, [id, getAccessToken, toast]);

  const toggleWinner = useCallback((entryId: string) => {
    setSelectedWinners((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }, []);

  const submitManualWinners = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/select-winners`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
        body: JSON.stringify({ entry_ids: Array.from(selectedWinners) }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Winners selected" });
      refetchEntries();
      refetchGiveaway();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to select winners", description: err.message });
    }
  }, [id, selectedWinners, getAccessToken, toast, refetchEntries, refetchGiveaway]);

  const runDrawNow = useCallback(async () => {
    setShowRunDrawConfirm(false);
    setRunningDraw(true);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/force-run-draw`, {
        method: "PUT",
        headers: await authHeaders(getAccessToken),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Draw complete" });
      refetchGiveaway();
      refetchEntries();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Failed to run draw", description: err.message });
    } finally {
      setRunningDraw(false);
    }
  }, [id, getAccessToken, toast, refetchGiveaway, refetchEntries]);

  if (!giveaway) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24 animate-pulse">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-24" />
        </div>
      </div>
    );
  }

  const canPickManually = giveaway.status === "DRAWING" && giveaway.selection_mode === "manual";
  // Mirrors the backend's forceable-status set in giveaway-draw.service.ts — OPEN (early close),
  // ENTRIES_CLOSED (waiting on the next cron tick or review), or DRAWING for an auto-selection
  // giveaway stuck on VRF. Manual-selection DRAWING uses the "pick winner" flow instead.
  const canForceDraw =
    giveaway.status === "OPEN" ||
    giveaway.status === "ENTRIES_CLOSED" ||
    (giveaway.status === "DRAWING" && giveaway.selection_mode !== "manual");
  const pendingReviewCount = reviewQueue?.total ?? 0;
  const totalReviewPages = Math.max(1, Math.ceil((reviewQueue?.total ?? 0) / REVIEW_PAGE_SIZE));
  const winners = (entries ?? []).filter((e) => e.status === "winner");
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "https://pay.loofta.xyz";

  const winnersAsRows = winners.map((w) => {
    const path = claimPath(w);
    return {
      handle: w.x_handle,
      status: claimStatus(w).label,
      claim_link: path ? `${siteUrl}${path}` : "",
    };
  });

  const copyWinners = () => {
    const text = winnersAsRows.map((w) => `@${w.handle}\t${w.status}\t${w.claim_link}`).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "Winners copied to clipboard" });
  };

  const exportWinnersCsv = () => {
    const header = "handle,status,claim_link";
    const rows = winnersAsRows.map((w) => `"${w.handle}","${w.status}","${w.claim_link}"`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${giveaway.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-winners.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Client-side filter/paginate — entry counts can run into the hundreds, and pulling that whole
  // list into view by default (as this used to) made the manage page unusably long to scroll.
  const searchQuery = entrySearch.trim().toLowerCase();
  const filteredEntries = searchQuery
    ? (entries ?? []).filter((e) => e.x_handle.toLowerCase().includes(searchQuery) || String(e.entry_index) === searchQuery)
    : (entries ?? []);
  const totalEntryPages = Math.max(1, Math.ceil(filteredEntries.length / ENTRIES_PER_PAGE));
  const clampedEntryPage = Math.min(entryPage, totalEntryPages);
  const pageEntries = filteredEntries.slice((clampedEntryPage - 1) * ENTRIES_PER_PAGE, clampedEntryPage * ENTRIES_PER_PAGE);

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
          <Link href={`/rewards/giveaways/${id}`} className="inline-flex items-center gap-1.5 text-base text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            <span>Back to giveaway</span>
          </Link>
        </div>
      </div>

      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24 space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-medium text-white mb-2">{giveaway.title}</h1>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${statusColor(giveaway.status)}`}>
                  {STATUS_LABELS[giveaway.status] ?? giveaway.status.replace(/_/g, " ")}
                </span>
              </div>
              {canForceDraw && (
                <button
                  type="button"
                  onClick={() => setShowRunDrawConfirm(true)}
                  disabled={runningDraw || pendingReviewCount > 0}
                  className="shrink-0 inline-flex items-center rounded-lg px-3 py-1.5 text-base font-medium border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {runningDraw ? "Running draw…" : "Run draw now"}
                </button>
              )}
            </div>
            {canForceDraw && pendingReviewCount > 0 && (
              <p className="text-base text-slate-500 mt-3">
                Review the {pendingReviewCount} pending submission{pendingReviewCount === 1 ? "" : "s"} below first — the draw can&apos;t run until the queue is clear.
              </p>
            )}
          </div>

          {winners.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-base font-medium text-slate-400 uppercase tracking-widest">
                  Winners ({winners.length})
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={copyWinners}
                    title="Copy winners to clipboard"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={exportWinnersCsv}
                    title="Export winners as CSV"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {winners.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-medium text-white truncate">@{entry.x_handle}</p>
                      <p className={`text-base ${claimStatus(entry).className}`}>
                        {claimStatus(entry).label}
                      </p>
                    </div>
                    {claimPath(entry) && (
                      <Link
                        href={claimPath(entry)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-base text-[#FF7A2A] hover:underline underline-offset-2"
                      >
                        View claim link
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-medium text-slate-400 uppercase tracking-widest">
                Entries {entries ? `(${entries.length})` : ""}
              </p>
              <button
                type="button"
                onClick={() => setEntriesDialogOpen(true)}
                disabled={!entries || entries.length === 0}
                className="shrink-0 text-base font-medium border border-white/15 text-slate-300 hover:bg-white/[0.06] transition-all rounded-lg px-3 py-1.5 disabled:opacity-40 disabled:pointer-events-none"
              >
                View entries
              </button>
            </div>
            {canPickManually && (
              <p className="text-base text-slate-400 mt-2">
                {selectedWinners.size} / {giveaway.winner_count} winner{giveaway.winner_count === 1 ? "" : "s"} selected — open the list to pick.
              </p>
            )}
          </div>

          <Dialog
            open={entriesDialogOpen}
            onOpenChange={(open) => {
              setEntriesDialogOpen(open);
              if (!open) setExpandedEntryId(null);
            }}
          >
            <DialogContent className="max-w-md max-h-[85vh] flex flex-col overflow-hidden bg-[#0f0f12] border-white/10">
              <DialogHeader>
                <DialogTitle className="text-white">Entries ({entries?.length ?? 0})</DialogTitle>
              </DialogHeader>

              <div className="relative shrink-0">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  value={entrySearch}
                  onChange={(e) => {
                    setEntrySearch(e.target.value);
                    setEntryPage(1);
                  }}
                  placeholder="Search by @handle or entry #"
                  className={searchInputClass}
                />
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                {pageEntries.map((entry) => {
                  const isExpanded = expandedEntryId === entry.id;
                  return (
                    <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                      <div className="p-3 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                          className="min-w-0 flex-1 text-left flex items-center gap-1.5"
                        >
                          <div className="min-w-0">
                            <p className="text-base font-medium text-white truncate">@{entry.x_handle}</p>
                            <p className="text-base text-slate-500">
                              #{entry.entry_index} · {entry.status}
                              {entry.status === "winner" ? ` · ${claimStatus(entry).label}` : ""}
                            </p>
                            {entry.status === "winner" && claimPath(entry) && (
                              <Link
                                href={claimPath(entry)!}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-base text-[#FF7A2A] hover:underline underline-offset-2"
                              >
                                View claim link
                              </Link>
                            )}
                          </div>
                          <ChevronDown className={`w-4 h-4 shrink-0 text-slate-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>
                        {canPickManually && (
                          <button
                            type="button"
                            onClick={() => toggleWinner(entry.id)}
                            className={`shrink-0 rounded-lg px-2.5 py-1 text-base font-medium border transition-colors ${
                              selectedWinners.has(entry.id) ? "border-[#FF7A2A] text-white bg-[#FF7A2A]/10" : "border-white/10 text-slate-300 hover:bg-white/[0.06]"
                            }`}
                          >
                            {selectedWinners.has(entry.id) ? "Selected" : "Pick as winner"}
                          </button>
                        )}
                      </div>
                      {isExpanded && (
                        <div className="border-t border-white/10 bg-black/20 p-3 space-y-2">
                          {loadingEntryCompletions && <p className="text-base text-slate-500">Loading tasks…</p>}
                          {!loadingEntryCompletions && (expandedEntryCompletions ?? []).length === 0 && (
                            <p className="text-base text-slate-500">No tasks found</p>
                          )}
                          {(expandedEntryCompletions ?? []).map((c) => {
                            const proofImageUrl = typeof c.submission_data?.proof_image_url === "string" ? c.submission_data.proof_image_url : null;
                            const proofText = typeof c.submission_data?.proof === "string" ? c.submission_data.proof : null;
                            const statusLabel = c.verification_status === "PENDING" && !proofImageUrl && !proofText
                              ? COMPLETION_STATUS_LABELS.PENDING
                              : c.verification_status === "PENDING"
                                ? "Awaiting review"
                                : (COMPLETION_STATUS_LABELS[c.verification_status] ?? c.verification_status);
                            return (
                              <div key={c.id} className="flex items-start gap-2.5">
                                {proofImageUrl && (
                                  /* eslint-disable-next-line @next/next/no-img-element -- review-only thumbnail */
                                  <img src={proofImageUrl} alt="Submitted proof" className="w-10 h-10 rounded-lg object-cover border border-white/10 shrink-0" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-base text-white">{c.task.task_type.replace(/_/g, " ")}</p>
                                  <p className={`text-base ${completionStatusColor(c.verification_status)}`}>{statusLabel}</p>
                                  {proofText && (
                                    /^https?:\/\//i.test(proofText) ? (
                                      <a href={proofText} target="_blank" rel="noopener noreferrer" className="text-base text-[#FF7A2A] hover:underline underline-offset-2 inline-flex items-center gap-1 break-all">
                                        {proofText} <ExternalLink className="w-3 h-3 shrink-0" />
                                      </a>
                                    ) : (
                                      <p className="text-base text-slate-500 break-all">{proofText}</p>
                                    )
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {pageEntries.length === 0 && (
                  <p className="text-base text-slate-500 text-center py-6">
                    {searchQuery ? "No matching entries" : "No entries yet"}
                  </p>
                )}
              </div>

              {totalEntryPages > 1 && (
                <div className="shrink-0 flex items-center justify-between pt-2 border-t border-white/10">
                  <button
                    type="button"
                    disabled={clampedEntryPage <= 1}
                    onClick={() => setEntryPage((p) => Math.max(1, p - 1))}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-base text-slate-400">Page {clampedEntryPage} of {totalEntryPages}</span>
                  <button
                    type="button"
                    disabled={clampedEntryPage >= totalEntryPages}
                    onClick={() => setEntryPage((p) => Math.min(totalEntryPages, p + 1))}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    aria-label="Next page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {canPickManually && (
                <div className="shrink-0">
                  <GradientActionButton
                    onClick={submitManualWinners}
                    disabled={selectedWinners.size === 0 || selectedWinners.size > giveaway.winner_count}
                  >
                    Confirm {selectedWinners.size} / {giveaway.winner_count} winner{giveaway.winner_count === 1 ? "" : "s"}
                  </GradientActionButton>
                </div>
              )}

              <button
                type="button"
                onClick={() => setEntriesDialogOpen(false)}
                className="shrink-0 w-full text-base font-medium border border-white/10 text-slate-300 hover:bg-white/[0.06] transition-all rounded-lg px-3 py-2.5"
              >
                Close
              </button>
            </DialogContent>
          </Dialog>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-base font-medium text-slate-400 uppercase tracking-widest">
                Task review queue {reviewQueue ? `(${reviewQueue.total})` : ""}
              </p>
              <button
                type="button"
                onClick={generateReviewLink}
                disabled={generatingLink}
                title="Generate a password-protected link to share task review with someone else"
                className="shrink-0 inline-flex items-center gap-1.5 text-base font-medium border border-white/15 text-slate-300 hover:bg-white/[0.06] transition-all rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                <Share2 className="w-3.5 h-3.5" />
                {generatingLink ? "Generating…" : "Share for review"}
              </button>
            </div>
            <div className="space-y-2">
              {(reviewQueue?.items ?? []).map((item) => (
                <ReviewQueueItem
                  key={item.id}
                  item={item}
                  onApprove={(itemId) => review(itemId, "verified")}
                  onReject={(itemId) => review(itemId, "rejected")}
                />
              ))}
              {reviewQueue && reviewQueue.items.length === 0 && <p className="text-base text-slate-500">Nothing to review right now</p>}
            </div>
            {totalReviewPages > 1 && (
              <div className="flex items-center justify-between pt-3 mt-1 border-t border-white/10">
                <button
                  type="button"
                  disabled={reviewPage <= 1}
                  onClick={() => setReviewPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-base text-slate-400">Page {reviewPage} of {totalReviewPages}</span>
                <button
                  type="button"
                  disabled={reviewPage >= totalReviewPages}
                  onClick={() => setReviewPage((p) => Math.min(totalReviewPages, p + 1))}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={reviewLinkDialogOpen} onOpenChange={setReviewLinkDialogOpen}>
        <DialogContent className="max-w-md bg-[#0f0f12] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Share for review</DialogTitle>
          </DialogHeader>
          <p className="text-base text-slate-400">
            Anyone with this link and password can approve or decline this giveaway&apos;s self-report tasks — no Loofta account needed. Generating a new link replaces this one; the old link and password stop working immediately.
          </p>
          {reviewLink && (
            <div className="space-y-3">
              <div>
                <p className="text-base text-slate-500 mb-1">Link</p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={reviewLink.url} className={searchInputClass} />
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(reviewLink.url); toast({ title: "Link copied" }); }}
                    className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                    aria-label="Copy link"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div>
                <p className="text-base text-slate-500 mb-1">Password — shown only once, save it now</p>
                <div className="flex items-center gap-2">
                  <Input readOnly value={reviewLink.password} className={`${searchInputClass} font-mono`} />
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(reviewLink.password); toast({ title: "Password copied" }); }}
                    className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                    aria-label="Copy password"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setReviewLinkDialogOpen(false)}
            className="w-full text-base font-medium border border-white/10 text-slate-300 hover:bg-white/[0.06] transition-all rounded-lg px-3 py-2.5"
          >
            Done
          </button>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showRunDrawConfirm} onOpenChange={setShowRunDrawConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run the draw now?</AlertDialogTitle>
            <AlertDialogDescription>
              {giveaway.status === "OPEN" && (entries?.length ?? 0) === 0
                ? "No one has entered yet. Running the draw now closes entries immediately and, with nobody eligible, cancels this giveaway instead of picking winners. This can't be undone."
                : giveaway.status === "OPEN"
                ? `This closes entries immediately, even if the scheduled close time (${new Date(giveaway.entries_close_at).toLocaleString()}) hasn't passed yet, and picks winners only from entrants who've already verified every task — anyone still mid-task is excluded. This can't be undone.`
                : "This runs the draw right away instead of waiting for the next automatic check. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDrawNow}>Run draw now</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
