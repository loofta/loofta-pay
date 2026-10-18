"use client";

/**
 * "How it works" trust strip + explainer modal shown at the bottom of both send forms
 * (the homepage hero SendWidget and /app's SendPage). Two variants:
 *   - "cash":   paying a Venmo / Cash App / Revolut handle through Peer (peer.xyz) — P2P.
 *   - "handle": an escrow-secured claim link sent to an email or social handle.
 * Kept intentionally small: a quiet one-line link inline, full explanation in a modal.
 * The inline strip is ALWAYS just "How it works" — the Peer brand is shown once, inside the
 * modal, so nothing is said twice. Copy deliberately plain, mirroring peer.xyz's own FAQ.
 */
import { useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Icon3DArrowUser } from "@/components/ui/icons3d";

type Variant = "cash" | "handle";

type Step = { title: string; body: string };

const PEER_URL = "https://peer.xyz";

const CASH_STEPS: Step[] = [
  {
    title: "You pay a real person",
    body: "Your money goes straight to another person on Venmo, Cash App, Revolut, or Zelle — no company in the middle.",
  },
  {
    title: "Your crypto stays locked until it's confirmed",
    body: "Your USDC is held in a smart contract while you pay, so nothing can move until the payment goes through.",
  },
  {
    title: "No extra ID checks",
    body: "You don't have to prove who you are. Just pay with the account you already have.",
  },
  {
    title: "Kept private",
    body: "Your login details and history never leave your device. Only the amount, who you paid, and the time are shared.",
  },
];

const CASH_SAFETY =
  "Your credentials and account history never leave your device. Only the amount, who you paid, and the time are shared.";

const HANDLE_STEPS: Step[] = [
  {
    title: "Nothing moves until it's claimed",
    body: "Your USDC is locked in escrow the moment you set the payment up.",
  },
  {
    title: "A claim link is sent",
    body: "To their email or social handle — no bank details to exchange, and no account needed.",
  },
  {
    title: "They claim in one tap",
    body: "Into a wallet, any crypto, or cashed out to Venmo, Cash App, Revolut, Zelle, or Naira.",
  },
  {
    title: "Only the link can claim it",
    body: "If they don't get to it right away, the funds stay safe until they do.",
  },
];

const HANDLE_SAFETY =
  "Only whoever holds the link can claim it, and no bank details are ever exchanged.";

const HANDLE_SAFETY_PRIVATE =
  "Only whoever holds the link can claim it. Incognito is on, so the onchain link is hidden and the amount is split over time.";

export function SendHowItWorks({
  variant,
  cashPlatformName,
  isPrivate = false,
  className,
}: {
  variant: Variant;
  /** Shown in the modal subtitle for the cash variant, e.g. "Venmo". */
  cashPlatformName?: string;
  /** Mirrors the incognito toggle so the handle modal can mention it when on. */
  isPrivate?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const isCash = variant === "cash";
  const steps = isCash ? CASH_STEPS : HANDLE_STEPS;
  const safety = isCash ? CASH_SAFETY : isPrivate ? HANDLE_SAFETY_PRIVATE : HANDLE_SAFETY;

  return (
    <>
      <div
        className={[
          "flex flex-wrap items-center justify-center gap-x-4 gap-y-1",
          className ?? "",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 text-sm text-slate-500 transition-colors hover:text-slate-300"
        >
          <Icon3DArrowUser size={18} showArrow={isCash} />
          How it works
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-24px)] max-w-sm max-h-[90svh] overflow-y-auto rounded-3xl border border-white/10 bg-[#121217] p-5 text-white sm:p-6">
          <DialogTitle className="sr-only">
            {isCash ? "How paying to a cash app works" : "How this payment works"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isCash
              ? "Paying a real person through Peer — your crypto stays locked until the payment is confirmed."
              : "An escrow-secured claim link sent to an email or social handle."}
          </DialogDescription>

          <div className="flex flex-col items-center gap-2 text-center">
            <Icon3DArrowUser size={56} showArrow={isCash} />
            <p className="text-xl font-extrabold">
              {isCash
                ? `Paying ${cashPlatformName ?? "a cash app"} through Peer`
                : "An escrow-secured claim link"}
            </p>
            {isCash && (
              <a
                href={PEER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[#9A98A3] transition-colors hover:text-white"
              >
                Powered by
                <img src="/images/icons/peer-logo.svg" alt="Peer" className="h-3.5 w-auto" />
              </a>
            )}
          </div>

          <ul className="mt-4 flex flex-col gap-2">
            {steps.map((step) => (
              <li key={step.title} className="rounded-2xl border border-white/[0.06] px-3.5 py-3">
                <p className="text-base font-bold text-white">{step.title}</p>
                <p className="mt-0.5 text-sm leading-[1.5] text-[#8A8893]">{step.body}</p>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3.5 py-3">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-sm leading-[1.5] text-[#9A98A3]">{safety}</p>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-4 flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-base font-semibold text-white transition-all hover:opacity-90 active:scale-[0.99]"
          >
            Got it
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
