'use client'

import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { PAY_WITH_EMAIL_FAQ as FAQ } from "./data";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

const STEPS = [
  {
    title: "Type an email or handle",
    body: "No wallet address to copy, no ENS to look up, no chain to guess. Just who they already are, their email, X handle, or Telegram.",
  },
  {
    title: "They get a private claim link",
    body: "It's waiting for them the moment you send it, whether they've used crypto before or this is their first time seeing a wallet in their life.",
  },
  {
    title: "They choose how to receive it",
    body: "Claim into a Loofta account and hold USDC, or send it straight to any wallet they already have on another chain. Cashing out to a bank is one step from there.",
  },
];

const COMPARE = [
  {
    label: "What you need to send",
    old: "Their wallet address, on the right chain, copied exactly right",
    loofta: "An email address or a handle you already have for them",
  },
  {
    label: "What they need to receive",
    old: "A wallet, funded with gas, on the same chain you sent to",
    loofta: "Nothing. They claim it however works for them, later",
  },
  {
    label: "If you get it wrong",
    old: "Funds sent to the wrong address are usually gone for good",
    loofta: "Nothing goes out until they claim it. You can reclaim it back",
  },
];

export default function PayWithEmailContent() {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#0a0a0c] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          {/* Hero */}
          <div className="mb-20">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-base font-semibold text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              No wallet address needed
            </span>

            <h1 className="font-display text-[clamp(2.4rem,5vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.03em] text-white mb-6">
              Pay anyone in stablecoins.<br />All they need is an email.
            </h1>

            <p className="font-grotesk text-lg md:text-xl leading-[1.65] text-slate-300 max-w-xl mb-8">
              Send USDC to a freelancer, contributor, or client with nothing but their email address
              or social handle. No wallet address, no ENS, no crypto experience required on their
              end. Built for creators, freelancers, web3 contributors, and distributed teams who pay
              people who don't all live in a wallet.
            </p>

            <a
              href={APP_URL}
              className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
            >
              Send your first payment
              <span className="text-white/70">→</span>
            </a>
          </div>

          {/* How it works */}
          <div className="mb-20">
            <p className="font-grotesk text-base font-semibold text-slate-300 uppercase tracking-widest mb-6">
              How it works
            </p>
            <div className="flex flex-col gap-6">
              {STEPS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-4">
                  <span className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-white text-base font-semibold ${BRAND_GRADIENT}`}>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-white font-semibold text-lg font-display mb-1">{step.title}</h3>
                    <p className="font-grotesk text-base leading-[1.7] text-slate-300">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Why this matters */}
          <div className="mb-20">
            <h2 className="text-white font-semibold text-2xl font-display mb-4">
              The wallet address is the whole problem
            </h2>
            <p className="font-grotesk text-base leading-[1.7] text-slate-300 mb-4">
              Most crypto payments assume both sides are already crypto-native. You need their
              address, they need a funded wallet on the right chain, and one typo means the money
              is gone. That's fine between two people who live on-chain. It falls apart the moment
              you're paying a freelancer, a contributor, or a client who just wants to get paid
              without learning what a chain is.
            </p>
            <p className="font-grotesk text-base leading-[1.7] text-slate-300">
              Loofta pays people by who they are, not by an address. You send to an email or social
              handle, and the money sits in a private claim link until they're ready to receive it,
              on their terms, in whatever form works for them.
            </p>

            <div className="mt-10 flex flex-col gap-4">
              {COMPARE.map((row) => (
                <div key={row.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
                  <p className="font-grotesk text-base font-semibold text-white mb-4">{row.label}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="font-grotesk text-sm font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                        Wallet address
                      </p>
                      <p className="font-grotesk text-base leading-[1.6] text-slate-400">{row.old}</p>
                    </div>
                    <div>
                      <p className="font-grotesk text-sm font-semibold text-[#FF9466] uppercase tracking-wide mb-1.5">
                        Email or handle
                      </p>
                      <p className="font-grotesk text-base leading-[1.6] text-white">{row.loofta}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Private by choice */}
          <div className="mb-20">
            <h2 className="text-white font-semibold text-2xl font-display mb-4">
              Private when you want it to be
            </h2>
            <p className="font-grotesk text-base leading-[1.7] text-slate-300">
              Flip on Shielded mode and MagicBlock hides the link between sender and recipient
              on-chain, so who paid whom isn't a public record. Loofta is non-custodial the whole
              way through, only you ever hold your keys. Need a shareable link instead of a
              one-off send? Use{" "}
              <a href="/payment-links" className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-white">
                payment links
              </a>{" "}
              for the same idea, reusable.
            </p>
          </div>

          {/* FAQ */}
          <div>
            <h2 className="text-white font-semibold text-2xl font-display mb-6">
              Frequently asked questions
            </h2>
            <div className="flex flex-col gap-6">
              {FAQ.map((item) => (
                <div key={item.question}>
                  <h3 className="text-white font-semibold text-lg font-display mb-2">{item.question}</h3>
                  <p className="font-grotesk text-base leading-[1.7] text-slate-300">{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
