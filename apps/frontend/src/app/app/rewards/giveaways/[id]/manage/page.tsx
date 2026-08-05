"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useToast } from "@/components/ui/use-toast";
import { GradientActionButton } from "@/components/ui/GradientActionButton";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

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
  payout_status: string | null; claim_payment_id: string | null;
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
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-base font-medium text-slate-400 uppercase tracking-widest mb-2">
              Entries {entries ? `(${entries.length})` : ""}
            </p>
            <div className="space-y-2">
              {(entries ?? []).map((entry) => (
                <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-medium text-white truncate">@{entry.x_handle}</p>
                    <p className="text-base text-slate-500">
                      #{entry.entry_index} · {entry.status}
                      {entry.payout_status && entry.status === "winner" ? ` · payout ${entry.payout_status}` : ""}
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
              {entries && entries.length === 0 && <p className="text-base text-slate-500">No entries yet</p>}
            </div>
            {canPickManually && (
              <div className="mt-3">
                <GradientActionButton
                  onClick={submitManualWinners}
                  disabled={selectedWinners.size === 0 || selectedWinners.size > giveaway.winner_count}
                >
                  Confirm {selectedWinners.size} / {giveaway.winner_count} winner{giveaway.winner_count === 1 ? "" : "s"}
                </GradientActionButton>
              </div>
            )}
          </div>

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
    </>
  );
}
