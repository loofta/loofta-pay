"use client";

import { use, useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ACCENT = "#FB7185";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending review",
  REJECTED: "Rejected",
  PENDING_FUNDING: "Approved — needs funding",
  FUNDED: "Funded",
  OPEN: "Open",
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

const TASK_TYPE_LABELS: Record<string, string> = {
  x_follow: "Follow on X",
  x_retweet: "Retweet the post",
  x_like: "Like the post",
  x_comment: "Comment on the post",
  x_bookmark: "Bookmark the post",
  telegram_join: "Join Telegram",
  discord_join: "Join Discord",
  visit_link: "Visit the link",
  custom: "Custom task",
};

interface PublicGiveaway {
  id: string; title: string; description: string | null; logo_url: string | null;
  winner_count: number; selection_mode: string; prize_amount_usd: string; entries_close_at: string;
  eligibility: { min_followers?: number; min_account_age_days?: number };
  status: string; burner_address: string | null; mint: string | null; is_devnet: boolean;
  funding_required_usd: string | null; funding_confirmed_usd: string; entry_count: number;
  entry_snapshot_hash: string | null; vrf_randomness: string | null; vrf_fulfilled_at: string | null;
  tasks: Array<{ id: string; task_type: string; config: { target?: string; comment_requirement?: string }; order_index: number }>;
}

interface TaskCompletion {
  id: string; giveaway_task_id: string; verification_status: string; submission_data: Record<string, unknown> | null;
}

interface MyEntry {
  id: string; status: string; payout_choice: string | null; payout_destination: string | null;
  payout_status: string | null; completions: TaskCompletion[];
}

async function authHeaders(getAccessToken: () => Promise<string | null>): Promise<Record<string, string>> {
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function GiveawayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { authenticated, userId } = useAuth();
  const { getAccessToken, login } = usePrivy();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [entering, setEntering] = useState(false);
  const [payoutChoice, setPayoutChoice] = useState<"public" | "private">("private");
  const [payoutDestination, setPayoutDestination] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);

  const { data: giveaway, isLoading, error, refetch } = useQuery({
    queryKey: ["giveaway-public", id],
    queryFn: async (): Promise<PublicGiveaway> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/public/${id}`);
      if (!res.ok) throw new Error("Giveaway not found");
      return res.json();
    },
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const { data: myEntry, refetch: refetchEntry } = useQuery({
    queryKey: ["giveaway-my-entry", id, userId],
    queryFn: async (): Promise<MyEntry | null> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/my-entry`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) return null;
      const data = await res.json();
      return data.entry ?? null;
    },
    enabled: Boolean(authenticated && userId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const { data: isOwner } = useQuery({
    queryKey: ["giveaway-is-owner", id, userId],
    queryFn: async (): Promise<boolean> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}`, { headers: await authHeaders(getAccessToken) });
      return res.ok;
    },
    enabled: Boolean(authenticated && userId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const enter = useCallback(async () => {
    setEntering(true);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/entries`, {
        method: "POST",
        headers: await authHeaders(getAccessToken),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "You're entered!", description: "Complete the tasks below before entries close." });
      refetchEntry();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not enter", description: err.message });
    } finally {
      setEntering(false);
    }
  }, [id, getAccessToken, toast, refetchEntry]);

  const markTaskDone = useCallback(async (taskId: string, submissionText: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/tasks/${taskId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
        body: JSON.stringify({ submission_data: submissionText ? { proof: submissionText } : undefined }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Task marked done" });
      refetchEntry();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not submit task", description: err.message });
    }
  }, [id, getAccessToken, toast, refetchEntry]);

  const savePayoutChoice = useCallback(async () => {
    if (!payoutDestination.trim()) {
      toast({ variant: "destructive", title: "Enter a destination wallet" });
      return;
    }
    setSavingPayout(true);
    try {
      const res = await fetch(`${BACKEND_URL}/giveaways/${id}/payout-choice`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
        body: JSON.stringify({ choice: payoutChoice, destination: payoutDestination.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "Payout choice saved", description: "You'll be paid out automatically once processed." });
      refetchEntry();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not save payout choice", description: err.message });
    } finally {
      setSavingPayout(false);
    }
  }, [id, payoutChoice, payoutDestination, getAccessToken, toast, refetchEntry]);

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24 animate-pulse space-y-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-32" />
        </div>
      </div>
    );
  }
  if (error || !giveaway) {
    return (
      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
            <p className="text-red-400 text-base">Giveaway not found</p>
          </div>
        </div>
      </div>
    );
  }

  const fundingPct = giveaway.funding_required_usd
    ? Math.min(100, Math.round((Number(giveaway.funding_confirmed_usd) / Number(giveaway.funding_required_usd)) * 100))
    : 0;
  const canEnter = giveaway.status === "OPEN" && !myEntry;

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2 flex items-center justify-between">
          <Link href="/rewards/giveaways" className="inline-flex items-center gap-1.5 text-base text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            <span>Back to giveaways</span>
          </Link>
          {isOwner && (
            <Link href={`/rewards/giveaways/${id}/manage`} className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
              Manage →
            </Link>
          )}
        </div>
      </div>

      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-3 flex items-center gap-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${statusColor(giveaway.status)}`}>
              {STATUS_LABELS[giveaway.status] ?? giveaway.status.replace(/_/g, " ")}
            </span>
            {giveaway.is_devnet && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border bg-white/[0.06] text-slate-300 border-white/10">Devnet</span>
            )}
          </div>

          <h1 className="text-2xl font-medium text-white mb-2">{giveaway.title}</h1>
          {giveaway.description && <p className="text-base text-slate-300 mb-5 leading-relaxed">{giveaway.description}</p>}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 mb-5">
            <div className="flex items-end justify-between mb-1">
              <p className="text-sm font-semibold uppercase tracking-wider" style={{ color: `${ACCENT}99` }}>Prize per winner</p>
              <p className="text-sm text-slate-500">{giveaway.entry_count} entered</p>
            </div>
            <p className="text-3xl font-medium" style={{ color: ACCENT }}>${giveaway.prize_amount_usd} × {giveaway.winner_count}</p>
            <p className="text-sm text-slate-500 mt-2">
              Closes {new Date(giveaway.entries_close_at).toLocaleString()} ·{" "}
              {giveaway.selection_mode === "random" ? "Random draw" : giveaway.selection_mode === "first_come" ? "First come, first serve" : "Picked by creator"}
            </p>
            {(giveaway.status === "PENDING_FUNDING" || giveaway.status === "FUNDED") && giveaway.funding_required_usd && (
              <div className="mt-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm text-slate-400">Funding: ${giveaway.funding_confirmed_usd} / ${giveaway.funding_required_usd}</span>
                  <span className="text-sm text-slate-400">{fundingPct}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${fundingPct}%`, backgroundColor: ACCENT }} />
                </div>
              </div>
            )}
            {giveaway.vrf_fulfilled_at && giveaway.vrf_randomness && (
              <p className="text-sm text-slate-500 mt-3 break-all">
                Draw proof: randomness <span className="font-mono">{giveaway.vrf_randomness.slice(0, 16)}…</span>, snapshot <span className="font-mono">{giveaway.entry_snapshot_hash?.slice(0, 16)}…</span>
              </p>
            )}
          </div>

          <div className="mb-5">
            <p className="text-sm font-medium text-slate-400 uppercase tracking-widest mb-2">Tasks</p>
            <div className="space-y-2">
              {giveaway.tasks.map((task) => {
                const completion = myEntry?.completions.find((c) => c.giveaway_task_id === task.id);
                const verified = completion?.verification_status === "verified" || completion?.verification_status === "auto_verified";
                const rejected = completion?.verification_status === "rejected";
                return (
                  <div key={task.order_index} className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-base font-medium text-white">{TASK_TYPE_LABELS[task.task_type] ?? task.task_type}</p>
                        {task.config?.target && <p className="text-sm text-slate-500 truncate">{task.config.target}</p>}
                      </div>
                      {myEntry && (
                        verified ? (
                          <span className="shrink-0 inline-flex items-center gap-1 text-sm font-medium text-emerald-400"><Check className="w-3.5 h-3.5" /> Verified</span>
                        ) : rejected ? (
                          <span className="shrink-0 text-sm font-medium text-red-400">Rejected</span>
                        ) : completion?.submission_data ? (
                          <span className="shrink-0 text-sm font-medium text-amber-400">Pending review</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => markTaskDone(task.id, "")}
                            className="shrink-0 text-sm font-medium border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all rounded-lg px-2.5 py-1"
                          >
                            Mark done
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {!authenticated ? (
            <button
              type="button"
              onClick={() => login({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}
              className="w-full rounded-xl px-5 py-3 font-semibold text-black hover:opacity-90 transition-opacity"
              style={{ backgroundColor: ACCENT }}
            >
              Sign in to enter
            </button>
          ) : canEnter ? (
            <button
              type="button"
              onClick={enter}
              disabled={entering}
              className="w-full rounded-xl px-5 py-3 font-semibold text-black hover:opacity-90 transition-opacity disabled:opacity-50 inline-flex items-center justify-center gap-2"
              style={{ backgroundColor: ACCENT }}
            >
              {entering && <Loader2 className="w-4 h-4 animate-spin" />}
              Enter giveaway
            </button>
          ) : myEntry?.status === "winner" && myEntry.payout_status === "pending" && !myEntry.payout_choice ? (
            <div className="rounded-2xl border p-4" style={{ backgroundColor: `${ACCENT}14`, borderColor: `${ACCENT}4d` }}>
              <p className="font-semibold text-lg mb-1" style={{ color: ACCENT }}>You won!</p>
              <p className="text-base text-slate-300 mb-3">Choose how you want to be paid out.</p>
              <div className="flex gap-2 mb-3">
                {(["private", "public"] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    onClick={() => setPayoutChoice(choice)}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium border transition-colors ${
                      payoutChoice === choice ? "border-transparent text-black" : "border-white/10 text-slate-300 hover:bg-white/[0.06]"
                    }`}
                    style={payoutChoice === choice ? { backgroundColor: ACCENT } : undefined}
                  >
                    {choice === "private" ? "Private (default)" : "Public"}
                  </button>
                ))}
              </div>
              <Input
                value={payoutDestination}
                onChange={(e) => setPayoutDestination(e.target.value)}
                placeholder="Destination Solana wallet address"
                className="bg-white/5 border-white/10 text-white placeholder:text-slate-500 mb-3"
              />
              <button
                type="button"
                onClick={savePayoutChoice}
                disabled={savingPayout}
                className="w-full rounded-xl px-5 py-2.5 font-semibold text-black hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {savingPayout ? "Saving…" : "Confirm payout"}
              </button>
            </div>
          ) : myEntry?.status === "winner" ? (
            <div className="rounded-2xl border p-4 text-center" style={{ backgroundColor: `${ACCENT}14`, borderColor: `${ACCENT}4d` }}>
              <p className="font-semibold text-lg" style={{ color: ACCENT }}>You won! Payout: {myEntry.payout_status}</p>
            </div>
          ) : myEntry ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center">
              <p className="text-base text-slate-400">You&apos;re entered — complete your tasks above before entries close.</p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
