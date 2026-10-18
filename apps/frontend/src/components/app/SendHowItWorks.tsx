"use client";

/**
 * "How it works" trust strip + explainer modal shown at the bottom of both send forms
 * (the homepage hero SendWidget and /app's SendPage). Two variants:
 *   - "cash":   paying a Venmo / Cash App / Revolut handle through Peer (peer.xyz).
 *   - "handle": an escrow-secured claim link sent to an email or social handle.
 * The inline strip is intentionally quiet; the full explanation opens in a modal whose
 * questions expand one at a time, so people understand exactly what will happen before
 * they pay.
 */
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Banknote,
  ChevronDown,
  ChevronRight,
  EyeOff,
  IdCard,
  Info,
  Link2,
  Lock,
  ShieldCheck,
  User,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { jetbrainsMono, sora } from "@/components/home-v4/fonts";

type Variant = "cash" | "handle";

const PEER_URL = "https://peer.xyz";
const easeBrand = [0.16, 1, 0.3, 1] as const;

const SORA = "var(--font-home-sora), Sora, sans-serif";
const MONO = "var(--font-home-mono), ui-monospace, monospace";

/** Restyles the shared DialogContent close button into a circular chip (top-right). */
const CLOSE_BTN =
  "[&>button.absolute]:right-5 [&>button.absolute]:top-5 [&>button.absolute]:flex [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:items-center [&>button.absolute]:justify-center [&>button.absolute]:rounded-full [&>button.absolute]:bg-white/[0.06] [&>button.absolute]:text-[#C9C6CF] [&>button.absolute]:opacity-100 [&>button.absolute]:transition-colors [&>button.absolute:hover]:bg-white/[0.12] [&>button.absolute:hover]:text-white";

type Item = { icon: typeof Lock; q: string; a: string };

function buildItems(isCash: boolean, isPrivate: boolean): Item[] {
  if (isCash) {
    return [
      {
        icon: User,
        q: "Who am I paying?",
        a: "A real person. Your money goes straight to them on Venmo, Cash App, Revolut, or Zelle, with no company in the middle.",
      },
      {
        icon: Lock,
        q: "Is my crypto safe?",
        a: "Your USDC is held in a smart contract while someone pays the recipient in cash, so nothing can move until they do.",
      },
      {
        icon: IdCard,
        q: "Do I need to verify my ID?",
        a: "No. You don't have to prove who you are. Just pay with the account you already have.",
      },
      {
        icon: EyeOff,
        q: "What gets shared?",
        a: "Your login details and history never leave your device. Only the amount, who you paid, and the time are shared.",
      },
    ];
  }
  return [
    {
      icon: Lock,
      q: "Where does my money go?",
      a: `Your USDC is locked in escrow the moment you set the payment up. Nothing moves until it's claimed.${
        isPrivate ? " Incognito is on, so the onchain link is hidden and the amount is split over time." : ""
      }`,
    },
    {
      icon: Link2,
      q: "How do they get it?",
      a: "A claim link is sent to their email, X, Telegram or Discord. No bank details to exchange, and no account needed.",
    },
    {
      icon: Banknote,
      q: "How do they cash out?",
      a: "Into a wallet, any crypto, or cashed out to Venmo, Cash App, Revolut, Zelle, or Naira.",
    },
    {
      icon: ShieldCheck,
      q: "What if they don't claim right away?",
      a: "Only the link can claim it. The funds stay safe until they do.",
    },
  ];
}

export function SendHowItWorks({
  variant,
  cashPlatformName,
  isPrivate = false,
  className,
}: {
  variant: Variant;
  /** Shown in the cash modal title, e.g. "Venmo". */
  cashPlatformName?: string;
  /** Mirrors the incognito toggle so the handle modal can mention it when on. */
  isPrivate?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const isCash = variant === "cash";
  const cashName = cashPlatformName ?? "Venmo";
  const items = buildItems(isCash, isPrivate);

  const title = isCash ? `Paying ${cashName} through Peer` : "An escrow-secured claim link";
  const description = isCash
    ? "Peer-to-peer payments verified inside a TEE with a zero-knowledge proof."
    : "An escrow-secured claim link sent to an email or social handle.";

  return (
    <>
      <div className={["flex flex-wrap items-center justify-center gap-x-4 gap-y-1", className ?? ""].join(" ")}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-300"
        >
          <Info className="h-3.5 w-3.5" />
          How it works
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={`${sora.variable} ${jetbrainsMono.variable} flex w-[calc(100vw-24px)] max-w-[560px] min-h-[min(620px,88svh)] max-h-[92svh] flex-col gap-6 overflow-y-auto rounded-[28px] border border-white/[0.08] bg-gradient-to-b from-[#15151B] to-[#101014] p-8 text-[#F2EFE8] shadow-[0_40px_120px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.05)] sm:rounded-[28px] ${CLOSE_BTN}`}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>

          <div className="flex flex-col gap-2.5 pr-11">
            <span className="text-sm uppercase tracking-[0.2em] text-[#FF6A2A]" style={{ fontFamily: MONO }}>
              How it works
            </span>
            <p
              className="text-[28px] font-bold leading-[1.15] tracking-[-0.045em] text-[#F2EFE8]"
              style={{ fontFamily: SORA, textWrap: "balance" }}
            >
              {title}
            </p>
            {isCash ? (
              <a
                href={PEER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[15px] text-[#A9A7B0] transition-colors hover:text-white"
              >
                Powered by
                <img src="/images/icons/peer-logo.svg" alt="Peer" className="h-[18px] w-auto" />
              </a>
            ) : (
              <p className="text-[15px] leading-[1.55] text-[#A9A7B0]">You send. It's locked. They claim with a link.</p>
            )}
          </div>

          <div className="flex flex-col border-t border-white/[0.08]">
            {items.map((it, i) => {
              const Icon = it.icon;
              const isOpen = openIdx === i;
              return (
                <div key={it.q} className="border-b border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setOpenIdx(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-4 py-[18px] text-left"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FF5A1F]/[0.12] text-[#FF7A2A]">
                      <Icon className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <span className="flex-1 text-[17px] font-semibold tracking-[-0.025em] text-[#F2EFE8]" style={{ fontFamily: SORA }}>
                      {it.q}
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-[#8A8893] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      strokeWidth={2.2}
                    />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: easeBrand }}
                        className="overflow-hidden"
                      >
                        <p className="pb-5 pl-14 pr-9 text-[15px] leading-[1.6] text-[#A9A7B0]" style={{ textWrap: "pretty" }}>
                          {it.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          <div className="mt-auto">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-14 w-full items-center justify-center rounded-[18px] text-[17px] font-bold tracking-[-0.02em] text-white transition-[filter] hover:brightness-[1.08]"
              style={{
                fontFamily: SORA,
                background: "linear-gradient(90deg,#FF2D0A,#F5B70C)",
                boxShadow: "0 12px 36px rgba(255,70,10,0.35)",
              }}
            >
              Got it
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
