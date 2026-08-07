"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X, Search, ChevronLeft, ChevronRight, Copy, Download } from "lucide-react";
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

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ENTRIES_PER_PAGE = 20;
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

interface ReviewItem {
  id: string; submission_data: Record<string, unknown> | null; verification_status: string;
  entry: { x_handle: string }; task: { task_type: string };
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

  const { data: reviewQueue, refetch: refetchReviewQueue } = useQuery({
    queryKey: ["giveaway-manage-review-queue", id],
    queryFn: async (): Promise<ReviewItem[]> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/review-queue`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load review queue");
      return (await res.json()).items ?? [];
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
  const pendingReviewCount = reviewQueue?.length ?? 0;
  const winners = (entries ?? []).filter((e) => e.status === "winner");
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "https://pay.loofta.xyz";

  const winnersAsRows = winners.map((w) => ({
    handle: w.x_handle,
    status: claimStatus(w).label,
    claim_link: w.claim_payment_id ? `${siteUrl}/c/${w.claim_payment_id}` : "",
  }));

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
            <h1 className="text-2xl font-medium text-white mb-2">{giveaway.title}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${statusColor(giveaway.status)}`}>
              {STATUS_LABELS[giveaway.status] ?? giveaway.status.replace(/_/g, " ")}
            </span>
            {giveaway.status === "OPEN" && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowRunDrawConfirm(true)}
                  disabled={runningDraw || pendingReviewCount > 0}
                  className="inline-flex items-center rounded-lg px-3 py-1.5 text-base font-medium border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {runningDraw ? "Running draw…" : "Run draw now"}
                </button>
                {pendingReviewCount > 0 && (
                  <p className="text-base text-slate-500 mt-1.5">
                    Review the {pendingReviewCount} pending submission{pendingReviewCount === 1 ? "" : "s"} below first — the draw can&apos;t run until the queue is clear.
                  </p>
                )}
              </div>
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
                    {entry.claim_payment_id && (
                      <Link
                        href={`/c/${entry.claim_payment_id}`}
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

          <Dialog open={entriesDialogOpen} onOpenChange={setEntriesDialogOpen}>
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
                {pageEntries.map((entry) => (
                  <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-medium text-white truncate">@{entry.x_handle}</p>
                      <p className="text-base text-slate-500">
                        #{entry.entry_index} · {entry.status}
                        {entry.status === "winner" ? ` · ${claimStatus(entry).label}` : ""}
                      </p>
                      {entry.status === "winner" && entry.claim_payment_id && (
                        <Link
                          href={`/c/${entry.claim_payment_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-base text-[#FF7A2A] hover:underline underline-offset-2"
                        >
                          View claim link
                        </Link>
                      )}
                    </div>
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
                ))}
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
            <p className="text-base font-medium text-slate-400 uppercase tracking-widest mb-2">
              Task review queue {reviewQueue ? `(${reviewQueue.length})` : ""}
            </p>
            <div className="space-y-2">
              {(reviewQueue ?? []).map((item) => (
                <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base font-medium text-white">@{item.entry.x_handle} — {item.task.task_type.replace(/_/g, " ")}</p>
                      {item.submission_data && (
                        <p className="text-base text-slate-500 truncate">{JSON.stringify(item.submission_data)}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => review(item.id, "verified")} className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors" aria-label="Approve">
                        <Check className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => review(item.id, "rejected")} className="p-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors" aria-label="Reject">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {reviewQueue && reviewQueue.length === 0 && <p className="text-base text-slate-500">Nothing to review right now</p>}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={showRunDrawConfirm} onOpenChange={setShowRunDrawConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run the draw now?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes entries immediately, even if the scheduled close time hasn&apos;t passed yet, and runs the draw right away. This can&apos;t be undone.
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
