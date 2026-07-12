'use client'

import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { PAYMENT_LINKS_FAQ as FAQ } from "./data";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

const STEPS = [
  {
    title: "Create your link",
    body: "Generate a payment link in seconds — no wallet address to copy, no ENS to look up, no account required from the person paying you.",
  },
  {
    title: "Share it anywhere",
    body: "Drop it in a DM, an invoice, a tweet, or an email. Anyone can pay it with the token and chain they already hold.",
  },
  {
    title: "Get paid privately",
    body: "Funds land in a shielded balance. The amount and who sent it aren't broadcast on a public ledger for anyone watching your address to see.",
  },
];

export default function PaymentLinksPage() {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#0a0a0c] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          {/* Hero */}
          <div className="mb-20">
            <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              No KYC to get paid
            </span>

            <h1 className="font-display text-[clamp(2.4rem,5vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.03em] text-white mb-6">
              Private crypto<br />payment links
            </h1>

            <p className="font-grotesk text-[17px] md:text-[19px] leading-[1.65] text-slate-400 max-w-xl mb-8">
              Create a link, share it, and get paid in USDC — without putting your wallet address,
              balance, or payment history on public display. Built for creators, freelancers, and
              distributed teams who get paid across chains all the time.
            </p>

            <a
              href={APP_URL}
              className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
            >
              Create a payment link
              <span className="text-white/70">→</span>
            </a>
          </div>

          {/* How it works */}
          <div className="mb-20">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-6">
              How it works
            </p>
            <div className="flex flex-col gap-6">
              {STEPS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-4">
                  <span className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-white text-sm font-semibold ${BRAND_GRADIENT}`}>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-white font-semibold text-lg font-display mb-1">{step.title}</h3>
                    <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Why private */}
          <div className="mb-20">
            <h2 className="text-white font-semibold text-2xl font-display mb-4">
              Why a private payment link, not just any payment link
            </h2>
            <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400 mb-4">
              Most crypto payment link tools are built for speed — skip the bank, get paid instantly.
              They don&apos;t address the tradeoff that comes with any public blockchain: once a wallet
              address is linked to your identity, every payment sent to it is a permanent, public record
              of your income, your clients, and your spending.
            </p>
            <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400">
              A Loofta payment link solves the payment-link problem without inheriting that tradeoff —
              the amount and counterparty aren&apos;t exposed to whoever's watching your address.
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
                  <h3 className="text-white font-semibold text-base font-display mb-2">{item.question}</h3>
                  <p className="font-grotesk text-[15px] leading-[1.7] text-slate-400">{item.answer}</p>
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
