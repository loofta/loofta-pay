"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ChanceIcon } from "@/components/ChanceIcon";

export type QuestReward = { id: string; weekStart: string; volumeUsd: number; tickets: number };

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const weekLabel = (d: string) => {
  const start = new Date(`${d}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const f = (x: Date) => x.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(start)} to ${f(end)}`;
};

/** Every weekly quest reward the user has received. */
export function QuestHistoryDialog({ open, onOpenChange, rewards }: { open: boolean; onOpenChange: (o: boolean) => void; rewards: QuestReward[] }) {
  const total = rewards.reduce((n, r) => n + r.tickets, 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-sm max-h-[90svh] overflow-y-auto rounded-3xl border border-white/10 bg-[#121217] p-5 text-white sm:p-6">
        <DialogTitle className="sr-only">Your weekly rewards</DialogTitle>
        <DialogDescription className="sr-only">Free entries you earned from the weekly quest.</DialogDescription>
        <div className="flex flex-col items-center gap-2 text-center">
          <ChanceIcon size={64} />
          <p className="text-2xl font-extrabold">Your weekly rewards</p>
          <p className="text-base text-[#9A98A3]">{rewards.length ? `${total} free ${total === 1 ? "entry" : "entries"} earned so far.` : "Complete the weekly quest to earn free entries in the daily $200K draw."}</p>
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {rewards.map((r) => (
            <li key={r.id} className="flex items-center justify-between rounded-2xl bg-white/[0.05] px-4 py-3">
              <span className="flex flex-col">
                <span className="text-base font-bold">{weekLabel(r.weekStart)}</span>
                <span className="text-sm text-[#8A8893]">{money(r.volumeUsd)} moved</span>
              </span>
              <span className="text-lg font-extrabold text-[#FF8A4A]">+{r.tickets} {r.tickets === 1 ? "entry" : "entries"}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
