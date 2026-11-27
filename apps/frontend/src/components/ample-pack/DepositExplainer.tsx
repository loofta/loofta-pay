"use client";

import { useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** Plain-words explanation of the deposit a prize needs. `amount` is $150 for stocks, cash, AirPods and GTA VI, and $10 for bonus tickets. */
export function DepositExplainer({ amount, cash }: { amount: number; cash?: boolean }) {
  const [open, setOpen] = useState(false);
  const steps: Array<[string, string]> = [
    ["Tap Add to Earn", "Earn is Loofta's savings pool with Ample. You put USDC in and it stays yours. You can take it out whenever you want."],
    [`Deposit at least $${amount}`, "It has to be new money. USDC that was already in Earn, or that you added before you opened the pack, does not count. If you took money out in the last 30 days, that amount is put back first."],
    [cash ? "Keep it in for a full week" : "Keep it in until the prize is ready", cash ? "Cash needs the deposit to stay for a full weekly cycle, at least 7 days. The weekly close is Sunday at 00:00 UTC." : "The prize is checked again when it is handed out, so the deposit has to still be there."],
    ["We activate your prize", cash ? "Cash is paid in USDC on Base after we verify the claim." : "We pass your details to Ample using your login email, and they take it from there."],
  ];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-4 block w-full text-center text-lg font-bold underline underline-offset-4">What does the ${amount} deposit mean?</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent wrapperZIndexClassName="z-[10001]" overlayZIndexClassName="z-[10000]" className="max-h-[90svh] w-[calc(100vw-24px)] max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#141418] text-[#F2EFE8] shadow-2xl p-6">
          <DialogTitle className="text-2xl font-extrabold">How to unlock your prize</DialogTitle>
          <DialogDescription className="text-base text-[#C9C6CF]">Your prize is saved. You unlock it by putting ${amount} into Earn.</DialogDescription>
          <ol className="flex flex-col gap-4">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-gradient-to-r from-[#FF4A26] to-[#FFB020]  text-lg font-extrabold text-[#1a0a05]">{i + 1}</span>
                <span><b className="block text-lg">{title}</b><span className="text-base text-[#C9C6CF]">{body}</span></span>
              </li>
            ))}
          </ol>
          <p className="rounded-2xl border border-white/10 bg-[#121217] p-4 text-base text-[#C9C6CF]">Your money is not spent. It is a deposit, and it is yours to withdraw. If you withdraw before the prize is handed out, the prize is cancelled.</p>
          <Link href="/app/stake" className="rounded-full bg-gradient-to-r from-[#FF4A26] to-[#FFB020] px-8 py-4 text-center text-xl font-extrabold text-[#1a0a05]">Add to Earn</Link>
        </DialogContent>
      </Dialog>
    </>
  );
}
