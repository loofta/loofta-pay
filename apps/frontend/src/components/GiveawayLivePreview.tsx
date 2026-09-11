"use client";

/**
 * Read-only preview of the giveaway wizard's current draft, styled to match the real
 * entrant-facing giveaway page (header badge, prize-pool card, task list) so what a creator sees
 * while filling out the form is what actually goes live — not a separate mocked-up look.
 */
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { FormattedText } from "@/components/FormattedText";

function CountUp({ value, prefix = "", className }: { value: number; prefix?: string; className?: string }) {
  const [disp, setDisp] = useState(value);
  const prevRef = useRef(value);
  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;
    if (from === to) return;
    const dur = 450;
    const t0 = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisp(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span className={`tabular-nums ${className ?? ""}`}>
      {prefix}
      {disp.toLocaleString()}
    </span>
  );
}

/** Same "Closes in 11d 9h" formatting as the real giveaway detail page's formatCloseCountdown,
 *  just fed a datetime-local input value here instead of an ISO string from the API. */
function closesInLabel(closeLocalValue: string): string {
  if (!closeLocalValue) return "";
  const diffMs = new Date(closeLocalValue).getTime() - Date.now();
  if (diffMs <= 0) return "closed";
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

const CHIP_CLS = "inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border bg-white/[0.06] text-slate-300 border-white/10";

export interface PreviewTask {
  icon: string;
  label: string;
}

export interface GiveawayLivePreviewProps {
  title: string;
  projectName: string;
  logoUrl: string;
  description: string;
  totalPool: number;
  winnerCount: number;
  selectionMode: "random" | "first_come" | "manual";
  rewardType?: "usdc" | "megapot_ticket";
  entriesCloseAt: string;
  minFollowers: string;
  verifiedOnly: boolean;
  requiredCountries?: string[];
  requiredContinents?: string[];
  isOfficial: boolean;
  tasks: PreviewTask[];
  pulse?: boolean;
}

export function GiveawayLivePreview({
  title,
  projectName,
  logoUrl,
  description,
  totalPool,
  winnerCount,
  selectionMode,
  rewardType = "usdc",
  entriesCloseAt,
  minFollowers,
  verifiedOnly,
  requiredCountries = [],
  requiredContinents = [],
  isOfficial,
  tasks,
  pulse,
}: GiveawayLivePreviewProps) {
  const prizeAmount = winnerCount > 0 ? Math.floor(totalPool / winnerCount) : 0;
  const closeLabel = closesInLabel(entriesCloseAt);

  return (
    <div className="lg:sticky lg:top-8">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-slate-500">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_#34D399]" />
        Live preview — what entrants see
      </div>

      <div
        className="rounded-3xl border border-white/10 bg-[#0f0f12] p-5 transition-shadow duration-500"
        style={{
          boxShadow: pulse
            ? "0 30px 80px -20px rgba(0,0,0,.7), 0 0 50px rgba(255,19,1,.25)"
            : "0 30px 80px -20px rgba(0,0,0,.7)",
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {isOfficial ? (
              <>
                <Image src="/loofta_icon_magic.png" alt="" width={36} height={36} className="rounded-full shrink-0" />
                <span className="text-base font-semibold text-white truncate">Loofta</span>
              </>
            ) : logoUrl || projectName ? (
              <>
                {logoUrl && <Image src={logoUrl} alt="" width={36} height={36} className="rounded-full object-cover shrink-0" />}
                {projectName && <span className="text-sm font-medium text-slate-400 truncate">{projectName}</span>}
              </>
            ) : (
              <span className="text-sm text-slate-600">Your project</span>
            )}
          </div>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold border text-slate-300 bg-white/[0.06] border-white/10 shrink-0">
            Draft
          </span>
        </div>

        <h2 className={`text-xl font-medium mb-2 ${title ? "text-white" : "text-slate-600"}`}>{title || "Your giveaway title…"}</h2>
        {description ? (
          <FormattedText text={description} className="text-sm text-slate-400 mb-4 leading-relaxed" />
        ) : (
          <p className="text-sm text-slate-600 mb-4">Add a description so entrants know what this is about.</p>
        )}

        <div
          className="rounded-2xl p-4 mb-4 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)]"
          style={{ background: "linear-gradient(160deg, rgba(52,211,153,0.10), rgba(255,255,255,0.02) 55%)", border: "1px solid rgba(52,211,153,0.28)" }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Prize pool · in escrow</p>
            <Image src="/images/icons/shield-icon.png" alt="" width={20} height={20} className="shrink-0 opacity-90" />
          </div>
          <p className="flex items-baseline gap-2 mb-2.5">
            <span className="text-4xl font-bold tracking-tight text-white">
              <CountUp value={totalPool} prefix={rewardType === "megapot_ticket" ? "" : "$"} />
            </span>
            <span className="text-sm text-slate-400">{rewardType === "megapot_ticket" ? `ticket${totalPool === 1 ? "" : "s"}` : "USDC"}</span>
          </p>
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {/* Each chip's CountUp + suffix text must share one wrapping <span> — as two direct
                children of this inline-flex chip they'd each become their own anonymous flex
                item, and a flex item's leading whitespace gets trimmed, gluing the number to the
                following word (e.g. "10tickets"). */}
            <span className={CHIP_CLS}>
              <span>
                {rewardType === "megapot_ticket" ? (
                  <>
                    <CountUp value={prizeAmount} />
                    {` ticket${prizeAmount === 1 ? "" : "s"} each`}
                  </>
                ) : (
                  <>
                    <CountUp value={prizeAmount} prefix="$" />
                    {" each"}
                  </>
                )}
              </span>
            </span>
            <span className={CHIP_CLS}>
              <span>
                <CountUp value={winnerCount} />
                {` winner${winnerCount === 1 ? "" : "s"}`}
              </span>
            </span>
            <span className={CHIP_CLS}>
              {selectionMode === "random" ? "Random draw" : selectionMode === "first_come" ? "First come, first serve" : "Picked by creator"}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.08] pt-2.5 text-sm text-slate-400">
            <span>{closeLabel ? <>Closes in <span className="font-semibold text-white">{closeLabel}</span></> : "Closes —"}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Tasks to enter</span>
            <span className="text-sm text-slate-500">{tasks.length} total</span>
          </div>
          {tasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-3.5 py-3 text-center text-sm text-slate-600">
              Tasks appear here as you add them
            </div>
          ) : (
            tasks.map((t, i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-sm">{t.icon}</div>
                <div className="min-w-0 flex-1 text-sm font-medium text-white truncate">{t.label}</div>
                <span className="shrink-0 text-xs font-semibold text-slate-500">To do</span>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mt-4">
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-sm text-slate-500">Linked X account</span>
          {minFollowers && <span className="rounded-full border border-white/10 px-2.5 py-1 text-sm text-slate-500">{minFollowers}+ followers</span>}
          {verifiedOnly && <span className="rounded-full border border-white/10 px-2.5 py-1 text-sm text-slate-500">Verified X account</span>}
          {[...requiredContinents, ...requiredCountries].length > 0 && (
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-sm text-slate-500">
              {[...requiredContinents, ...requiredCountries].slice(0, 2).join(", ")}
              {[...requiredContinents, ...requiredCountries].length > 2 ? ` +${[...requiredContinents, ...requiredCountries].length - 2} more` : ""}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
