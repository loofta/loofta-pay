"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RankBadge } from "@/components/RankBadge";
import { TIERS, getTierForVolume } from "@/lib/tiers";

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : `$${Math.floor(n)}`;

/** Tap-the-badge sheet: what ranks are, where you are, and what's next. */
export function RankProgressDialog({ open, onOpenChange, volumeUsd }: { open: boolean; onOpenChange: (o: boolean) => void; volumeUsd: number }) {
  const current = getTierForVolume(volumeUsd);
  const idx = TIERS.findIndex((t) => t.key === current.key);
  const next = TIERS[idx + 1] ?? null;
  const pct = next ? Math.min(100, Math.max(2, ((volumeUsd - current.minVolume) / (next.minVolume - current.minVolume)) * 100)) : 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-sm max-h-[90svh] overflow-y-auto rounded-3xl border border-white/10 bg-[#121217] p-4 sm:p-6 text-white">
        <DialogTitle className="sr-only">Your rank</DialogTitle>
        <DialogDescription className="sr-only">Your Loofta rank and progress to the next one.</DialogDescription>
        <div className="flex flex-col items-center gap-2 text-center">
          <RankBadge tier={current.key} size={96} />
          <p className="text-2xl font-extrabold uppercase tracking-wide">{current.label}</p>
          <p className="text-base text-[#9A98A3]">
            Your rank grows with everything you move on Loofta: sends, cash outs and claims all count.
          </p>
        </div>

        <div className="mt-4">
          <div className="h-4 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#FF4A26] via-[#FF7A2A] to-[#EAB308] shadow-[inset_0_-3px_0_rgba(0,0,0,0.25)] transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-center text-base font-semibold">
            {next ? (
              <>
                {money(Math.max(0, next.minVolume - volumeUsd))} to <span className="text-[#FF8A4A]">{next.label}</span>
              </>
            ) : (
              "Top rank reached"
            )}
          </p>
        </div>

        <ul className="mt-4 flex flex-col gap-2">
          {TIERS.map((t, i) => {
            const reached = i <= idx;
            return (
              <li key={t.key} className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${i === idx ? "border-[#FF7A2A]/60 bg-white/[0.06]" : "border-white/[0.06]"}`}>
                <span className={reached ? "" : "opacity-35 grayscale"}>
                  <RankBadge tier={t.key} size={34} />
                </span>
                <span className="flex-1 text-base font-bold">{t.label}</span>
                <span className="text-sm text-[#8A8893]">{i === idx ? "You are here" : t.minVolume === 0 ? "Start" : money(t.minVolume)}</span>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
