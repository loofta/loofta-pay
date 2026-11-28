"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** Plain-words explanation of the deposit that unlocks the bonus tickets. `amount` is the campaign minimum. */
export function DepositExplainer({ amount, className }: { amount: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const steps: Array<[string, string]> = [
    ["Tap Add to Earn", "Earn is Loofta's savings pool with Ample. You put USDC in and it stays yours. You can take it out whenever you want."],
    [`Deposit at least $${amount}`, "It has to be new money. USDC that was already in Earn, or that you added before you opened the pack, does not count. If you took money out in the last 30 days, that amount is put back first."],
    ["Keep it in until the draw", "Your bonus tickets are checked again when the draw runs, so the deposit has to still be there."],
  ];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? "mt-4 block w-full text-center text-lg font-bold underline underline-offset-4"}>What does the ${amount} deposit mean?</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wrapperZIndexClassName="z-[10001]" overlayZIndexClassName="z-[10000]" className="max-h-[90svh] w-[calc(100vw-24px)] max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#141418] text-[#F2EFE8] shadow-2xl p-6">
          <DialogTitle className="text-2xl font-extrabold">How to unlock your bonus</DialogTitle>
          <DialogDescription className="text-base text-[#C9C6CF]">Your bonus is saved. You unlock it by putting ${amount} into Earn.</DialogDescription>
          <ol className="flex flex-col gap-4">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-gradient-to-r from-[#FF4A26] to-[#FFB020]  text-lg font-extrabold text-[#1a0a05]">{i + 1}</span>
                <span><b className="block text-lg">{title}</b><span className="text-base text-[#C9C6CF]">{body}</span></span>
              </li>
            ))}
          </ol>
          <p className="rounded-2xl border border-white/10 bg-[#121217] p-4 text-base text-[#C9C6CF]">Your money is not spent. It is a deposit, and it is yours to withdraw. If you withdraw before the draw, the bonus does not count.</p>
          <Link href="/app/stake" className="rounded-full bg-gradient-to-r from-[#FF4A26] to-[#FFB020] px-8 py-4 text-center text-xl font-extrabold text-[#1a0a05]">Add to Earn</Link>
        </DialogContent>
      </Dialog>
    </>
  );
}
