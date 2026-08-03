"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { GradientActionButton } from "@/components/ui/GradientActionButton";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ACCENT = "#FB7185";

interface PublicGiveawayListItem {
  id: string;
  title: string;
  description: string | null;
  logo_url: string | null;
  winner_count: number;
  selection_mode: "random" | "first_come" | "manual";
  prize_amount_usd: string;
  entries_close_at: string;
  status: string;
}

async function fetchOpenGiveaways(): Promise<PublicGiveawayListItem[]> {
  const res = await fetch(`${BACKEND_URL}/giveaways/public`);
  if (!res.ok) throw new Error("Failed to load giveaways");
  const data = await res.json();
  return data.giveaways ?? [];
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3 mt-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-24" />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-24" />
    </div>
  );
}

export default function GiveawaysListPage() {
  const { authenticated } = useAuth();
  const router = useRouter();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["giveaways-open"],
    queryFn: fetchOpenGiveaways,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  return (
    <>
      <div className="bg-[#0f0f12]">
        <div className="max-w-lg mx-auto px-4 pt-4 pb-2">
          <Link href="/rewards" className="inline-flex items-center gap-1.5 text-base text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={16} />
            <span>Back to rewards</span>
          </Link>
        </div>
      </div>

      <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <div className="max-w-lg mx-auto px-4 py-6 pb-24">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-medium text-white">Giveaways</h1>
            {authenticated && (
              <Link href="/rewards/giveaways/mine" className="text-base font-medium text-slate-300 hover:text-white transition-colors">
                My Giveaways
              </Link>
            )}
          </div>
          <p className="text-base text-slate-400 mb-6">
            Enter an open giveaway to compete for prizes, or launch your own for your project.
          </p>

          {authenticated && (
            <div className="mb-6">
              <GradientActionButton onClick={() => router.push("/rewards/giveaways/create")} className="text-lg">
                Launch a Giveaway
              </GradientActionButton>
            </div>
          )}

          {isLoading ? (
            <Skeleton />
          ) : error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
              <p className="text-red-400 text-base">{(error as Error)?.message ?? "Failed to load giveaways"}</p>
              <button type="button" onClick={() => refetch()} className="mt-3 text-base text-slate-400 hover:text-white underline">
                Try again
              </button>
            </div>
          ) : !data || data.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-base text-slate-400">No giveaways are open right now — check back soon.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.map((g) => (
                <Link
                  key={g.id}
                  href={`/rewards/giveaways/${g.id}`}
                  className="block rounded-2xl border border-white/10 bg-white/5 hover:bg-white/[0.07] transition-colors p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold text-white truncate">{g.title}</p>
                      {g.description && <p className="text-base text-slate-400 mt-0.5 line-clamp-2">{g.description}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-2xl font-medium" style={{ color: ACCENT }}>${g.prize_amount_usd}</p>
                      <p className="text-sm text-slate-500">× {g.winner_count} winner{g.winner_count === 1 ? "" : "s"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border bg-white/[0.06] text-slate-300 border-white/10">
                      {g.selection_mode === "random" ? "Random draw" : g.selection_mode === "first_come" ? "First come, first serve" : "Picked by creator"}
                    </span>
                    <span className="text-sm text-slate-500">
                      Closes {new Date(g.entries_close_at).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
