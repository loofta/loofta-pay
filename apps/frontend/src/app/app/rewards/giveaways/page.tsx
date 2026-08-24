"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { FormattedText } from "@/components/FormattedText";
import { GradientActionButton } from "@/components/ui/GradientActionButton";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const GRADIENT = "linear-gradient(to right, #EAB308, #FF0F00)";

interface PublicGiveawayListItem {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  logo_url: string | null;
  project_name: string | null;
  winner_count: number;
  selection_mode: "random" | "first_come" | "manual";
  prize_amount_usd: string;
  reward_type?: "usdc" | "megapot_ticket";
  entries_close_at: string;
  status: string;
  is_official: boolean;
  admin_reviewed_at?: string | null;
  entries_count?: number;
  entries_last_hour?: number;
  entry_avatars?: string[];
}

/** Big headline figure for a list card's prize pool — dollars for a usdc giveaway, ticket count
 *  for a megapot_ticket one (tickets are $1 each, so total pool === total ticket count). */
function poolLabel(g: Pick<PublicGiveawayListItem, "reward_type">, total: number): string {
  const formatted = total.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return g.reward_type === "megapot_ticket" ? `${formatted} ticket${total === 1 ? "" : "s"}` : `$${formatted}`;
}

/** "$5 × 3 winners" vs "5 tickets × 3 winners" sub-line. */
function perWinnerLabel(g: Pick<PublicGiveawayListItem, "reward_type" | "prize_amount_usd">): string {
  return g.reward_type === "megapot_ticket"
    ? `${g.prize_amount_usd} ticket${Number(g.prize_amount_usd) === 1 ? "" : "s"}`
    : `$${g.prize_amount_usd}`;
}

interface GiveawayStats {
  winners_this_month: number;
  avg_approval_hours: number | null;
}

async function fetchOpenGiveaways(): Promise<PublicGiveawayListItem[]> {
  const res = await fetch(`${BACKEND_URL}/giveaways/public`);
  if (!res.ok) throw new Error("Failed to load giveaways");
  const data = await res.json();
  return data.giveaways ?? [];
}

async function fetchEndedGiveaways(): Promise<PublicGiveawayListItem[]> {
  const res = await fetch(`${BACKEND_URL}/giveaways/public/ended`);
  if (!res.ok) throw new Error("Failed to load past giveaways");
  const data = await res.json();
  return data.giveaways ?? [];
}

async function fetchStats(): Promise<GiveawayStats | null> {
  const res = await fetch(`${BACKEND_URL}/giveaways/public/stats`);
  if (!res.ok) return null;
  return res.json();
}

const ENDED_STATUS_LABELS: Record<string, string> = {
  ENTRIES_CLOSED: "Closing",
  DRAWING: "Drawing winners",
  WINNERS_SELECTED: "Winners selected",
  PAYOUT_IN_PROGRESS: "Paying out",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  UNDERFUNDED_EXPIRED: "Underfunded",
  REFUNDED: "Refunded",
};

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function CountdownUnit({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="tabular-nums text-white font-medium text-base">
      {String(value).padStart(2, "0")}
      <span className="text-slate-500 font-normal text-base ml-0.5">{unit}</span>
    </span>
  );
}

/** Live-ticking "closes in" readout — day-scale once >24h remain (no seconds, since a second
 *  ticking over is meaningless noise at that distance), hour-scale with seconds once inside the
 *  final day, when the extra precision actually reads as urgency. */
function CloseCountdown({ closeAt }: { closeAt: string }) {
  const now = useNow(1000);
  const diffMs = new Date(closeAt).getTime() - now;
  if (diffMs <= 0) return <span className="text-slate-500 text-base font-medium">Closed</span>;
  const totalSeconds = Math.floor(diffMs / 1000);
  const d = Math.floor(totalSeconds / 86_400);
  const h = Math.floor((totalSeconds % 86_400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return (
    <div className="flex items-baseline gap-1">
      {d > 0 ? (
        <>
          <CountdownUnit value={d} unit="d" />
          <CountdownUnit value={h} unit="h" />
          <CountdownUnit value={m} unit="m" />
        </>
      ) : (
        <>
          <CountdownUnit value={h} unit="h" />
          <CountdownUnit value={m} unit="m" />
          <CountdownUnit value={s} unit="s" />
        </>
      )}
    </div>
  );
}

/** Full-bleed bar along the bottom edge of a card, filling as the entry window runs out — real
 *  elapsed time since approval through to close, not a decorative fake fill. Approval time is the
 *  earliest timestamp the public API exposes for an OPEN giveaway (there's no separate "went
 *  live" column), so it's an approximation of the entry window, not exact to the minute a giveaway
 *  actually opened. */
function EntryProgressBar({ startAt, closeAt }: { startAt: string | null | undefined; closeAt: string }) {
  const now = useNow(30_000);
  if (!startAt) return null;
  const start = new Date(startAt).getTime();
  const end = new Date(closeAt).getTime();
  if (!(end > start)) return null;
  const pct = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  return (
    <div className="h-1 w-full bg-white/10">
      <div className="h-full transition-[width] duration-1000" style={{ width: `${pct}%`, background: GRADIENT }} />
    </div>
  );
}

function AvatarStack({ avatars }: { avatars: string[] }) {
  if (avatars.length === 0) return null;
  return (
    <div className="flex -space-x-2 shrink-0">
      {avatars.slice(0, 4).map((url, i) => (
        <Image
          key={i}
          src={url}
          alt=""
          width={24}
          height={24}
          className="rounded-full border-2 border-[#0f0f12] object-cover"
        />
      ))}
    </div>
  );
}

function formatApprovalTime(hours: number | null | undefined): string {
  if (hours == null) return "—";
  if (hours < 1) return "<1h";
  if (hours < 48) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5">
      <p className="font-display text-3xl font-semibold text-white">{value}</p>
      <p className="text-base text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function ProjectBadge({ g }: { g: PublicGiveawayListItem }) {
  if (g.is_official) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <Image src="/loofta_icon_magic.png" alt="" width={18} height={18} className="rounded-full shrink-0" />
        <span className="text-base font-medium text-slate-300 truncate">Loofta</span>
      </div>
    );
  }
  if (g.logo_url || g.project_name) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        {g.logo_url && <Image src={g.logo_url} alt="" width={18} height={18} className="rounded-full object-cover shrink-0" />}
        {g.project_name && <span className="text-base font-medium text-slate-300 truncate">{g.project_name}</span>}
      </div>
    );
  }
  return <span />;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3 mt-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-36" />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 h-36" />
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

  const { data: endedData } = useQuery({
    queryKey: ["giveaways-ended"],
    queryFn: fetchEndedGiveaways,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const { data: stats } = useQuery({
    queryKey: ["giveaways-stats"],
    queryFn: fetchStats,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Real total across currently-open pools — free from data already on the page, no extra call.
  const openPoolUsd = (data ?? []).reduce((sum, g) => sum + parseFloat(g.prize_amount_usd || "0") * g.winner_count, 0);

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
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-5xl font-semibold text-white tracking-tight">Giveaways</h1>
            {authenticated && (
              <Link
                href="/rewards/giveaways/mine"
                className="inline-flex items-center gap-1 text-base font-medium text-slate-400 hover:text-white transition-colors shrink-0"
              >
                My giveaways <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
          <p className="text-lg text-slate-400 mb-5">
            Enter an open giveaway to compete for prizes, or launch your own for your project.
          </p>

          <div className="grid grid-cols-3 gap-2 mb-6">
            <StatTile value={`$${Math.round(openPoolUsd).toLocaleString()}`} label="up for grabs right now" />
            <StatTile value={String(stats?.winners_this_month ?? 0)} label="winners this month" />
            <StatTile value={formatApprovalTime(stats?.avg_approval_hours)} label="avg. approval time" />
          </div>

          {authenticated && (
            <div className="mb-8">
              <GradientActionButton onClick={() => router.push("/rewards/giveaways/create")}>
                <span className="text-base">Launch a giveaway</span>
              </GradientActionButton>
            </div>
          )}

          {isLoading ? (
            <Skeleton />
          ) : error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
              <p className="text-red-400 text-lg">{(error as Error)?.message ?? "Failed to load giveaways"}</p>
              <button type="button" onClick={() => refetch()} className="mt-3 text-lg text-slate-400 hover:text-white underline">
                Try again
              </button>
            </div>
          ) : !data || data.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
              <p className="text-lg text-slate-400">No giveaways are open right now — check back soon.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-semibold uppercase tracking-widest text-emerald-400 shrink-0">
                  Open now · {data.length}
                </span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              <div className="space-y-3">
                {data.map((g) => {
                  // prize_amount_usd is PER WINNER (see giveaways table comment) — the headline
                  // number on the card is the total pool, i.e. per-winner × winner count.
                  const total = parseFloat(String(g.prize_amount_usd)) * g.winner_count;
                  const entriesCount = g.entries_count ?? 0;
                  const lastHour = g.entries_last_hour ?? 0;
                  return (
                    <Link
                      key={g.id}
                      href={`/rewards/giveaways/${g.short_id ?? g.id}`}
                      className="relative block overflow-hidden rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      <div className="p-4">
                        <div className="mb-2.5">
                          <ProjectBadge g={g} />
                        </div>

                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-xl font-semibold text-white truncate">{g.title}</p>
                            {g.description && (
                              <FormattedText text={g.description} className="text-base text-slate-400 mt-0.5 line-clamp-2" />
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p
                              className="text-3xl font-medium bg-clip-text text-transparent"
                              style={{ backgroundImage: GRADIENT }}
                            >
                              {poolLabel(g, total)}
                            </p>
                            <p className="text-base text-slate-500">
                              {perWinnerLabel(g)} × {g.winner_count} winner{g.winner_count === 1 ? "" : "s"}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-end justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <AvatarStack avatars={g.entry_avatars ?? []} />
                            <p className="text-base text-slate-400 truncate">
                              <span className="font-semibold text-white">{entriesCount.toLocaleString()}</span> entered
                              {lastHour > 0 && <span className="text-emerald-400"> · +{lastHour} past hour</span>}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold uppercase tracking-widest text-slate-500 mb-0.5">Closes in</p>
                            <CloseCountdown closeAt={g.entries_close_at} />
                          </div>
                        </div>
                      </div>
                      <EntryProgressBar startAt={g.admin_reviewed_at} closeAt={g.entries_close_at} />
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          {endedData && endedData.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-sm font-semibold uppercase tracking-widest text-slate-500 shrink-0">Ended</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              <div className="space-y-3">
                {endedData.map((g) => {
                  const total = parseFloat(String(g.prize_amount_usd)) * g.winner_count;
                  return (
                  <Link
                    key={g.id}
                    href={`/rewards/giveaways/${g.short_id ?? g.id}`}
                    className="block rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors p-4"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <ProjectBadge g={g} />
                      <span className="text-base font-medium text-slate-500 shrink-0">{ENDED_STATUS_LABELS[g.status] ?? g.status}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xl font-semibold text-slate-300 truncate">{g.title}</p>
                        {g.description && <FormattedText text={g.description} className="text-base text-slate-500 mt-0.5 line-clamp-2" />}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-base font-semibold uppercase tracking-widest text-slate-600">Was</p>
                        <p className="text-3xl font-medium text-slate-400">{poolLabel(g, total)}</p>
                        <p className="text-base text-slate-600">
                          {perWinnerLabel(g)} × {g.winner_count} winner{g.winner_count === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3 text-base text-slate-500 min-w-0">
                        <span className="inline-flex items-center gap-1 shrink-0">
                          <Trophy className="w-4 h-4 text-slate-600" />
                          {g.winner_count} winner{g.winner_count === 1 ? "" : "s"} drawn
                        </span>
                        {typeof g.entries_count === "number" && <span className="shrink-0">{g.entries_count.toLocaleString()} entries</span>}
                        <span className="truncate">Ended {new Date(g.entries_close_at).toLocaleDateString()}</span>
                      </div>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-base font-medium border border-white/10 text-slate-400 shrink-0">
                        {ENDED_STATUS_LABELS[g.status] ?? g.status}
                      </span>
                    </div>
                  </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
