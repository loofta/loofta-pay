"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useAuth } from "@/hooks/useAuth";
import { GradientActionButton } from "@/components/ui/GradientActionButton";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ACCENT = "#FB7185";

interface MyGiveaway {
  id: string;
  title: string;
  status: string;
  winner_count: number;
  prize_amount_usd: string;
  funding_required_usd: string | null;
  funding_confirmed_usd: string;
  rejection_reason: string | null;
}

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

async function authHeaders(getAccessToken: () => Promise<string | null>): Promise<Record<string, string>> {
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function MyGiveawaysPage() {
  const { authenticated } = useAuth();
  const { getAccessToken, login } = usePrivy();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["giveaways-mine"],
    queryFn: async (): Promise<MyGiveaway[]> => {
      const res = await fetch(`${BACKEND_URL}/giveaways/mine`, { headers: await authHeaders(getAccessToken) });
      if (!res.ok) throw new Error("Failed to load your giveaways");
      return (await res.json()).giveaways ?? [];
    },
    enabled: authenticated,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
          <Link href="/rewards/giveaways" className="inline-flex items-center gap-1.5 text-base text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            <span>Back to giveaways</span>
          </Link>
        </div>
      </div>

      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <h1 className="text-2xl font-medium text-white mb-6">My Giveaways</h1>

          {!authenticated ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-base text-slate-300 mb-4">Sign in to see the giveaways you've launched.</p>
              <GradientActionButton onClick={() => login({ loginMethods: ["email", "twitter", "discord", "github"], disableSignup: false })}>
                <span className="text-base">Sign in</span>
              </GradientActionButton>
            </div>
          ) : isLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 h-28" />
              <div className="rounded-2xl border border-white/10 bg-white/5 h-28" />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
              <p className="text-red-400 text-base">{(error as Error)?.message ?? "Failed to load your giveaways"}</p>
              <button type="button" onClick={() => refetch()} className="mt-3 text-base text-slate-400 hover:text-white underline">
                Try again
              </button>
            </div>
          ) : !data || data.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-base text-slate-400 mb-4">You haven't launched a giveaway yet.</p>
              <GradientActionButton onClick={() => (window.location.href = "/rewards/giveaways/create")}>
                <span className="text-base">Launch a Giveaway</span>
              </GradientActionButton>
            </div>
          ) : (
            <div className="space-y-3">
              {data.map((g) => (
                <div key={g.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <Link href={`/rewards/giveaways/${g.id}`} className="min-w-0 flex-1 hover:underline">
                      <p className="text-lg font-semibold text-white truncate">{g.title}</p>
                    </Link>
                    <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${statusColor(g.status)}`}>
                      {STATUS_LABELS[g.status] ?? g.status}
                    </span>
                  </div>
                  <p className="text-base text-slate-400 mb-3">
                    ${g.prize_amount_usd} × {g.winner_count} winner{g.winner_count === 1 ? "" : "s"}
                  </p>

                  {g.status === "REJECTED" && g.rejection_reason && (
                    <p className="text-sm text-red-400 mb-3">Reason: {g.rejection_reason}</p>
                  )}

                  {g.status === "PENDING_FUNDING" ? (
                    <Link href={`/rewards/giveaways/${g.id}/manage`}>
                      <GradientActionButton>
                        <span className="text-base">Fund Giveaway</span>
                      </GradientActionButton>
                    </Link>
                  ) : (
                    <Link
                      href={`/rewards/giveaways/${g.id}/manage`}
                      className="text-base font-medium text-slate-300 hover:text-white transition-colors"
                    >
                      Manage →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
