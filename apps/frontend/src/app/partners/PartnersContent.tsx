'use client'

import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { PARTNERS_FAQ as FAQ } from "./data";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const CONTACT_EMAIL = "hello@loofta.xyz";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Integrating Loofta")}`;
const TELEGRAM_HANDLE = "t.me/looftaxyz";
const TELEGRAM_HREF = "https://t.me/looftaxyz";

const PRODUCTS = [
  {
    icon: "🎁",
    title: "Gifts",
    body: "Send a crypto gift with a claim link — no wallet address needed on either end. Drop it into any flow: a signup reward, a referral bonus, a thank-you.",
  },
  {
    icon: "🔗",
    title: "Payment links",
    body: "One-off or recurring payment links your users can share and get paid on, across chains and tokens, without an account required from the payer.",
  },
  {
    icon: "🎟️",
    title: "Giveaways",
    body: "Prize drops and jackpot-style giveaways for a community — built for the kind of viral, low-friction acquisition loop a rewards or referral program needs.",
  },
  {
    icon: "🧾",
    title: "Team payouts",
    body: "Scheduled payroll, recurring payments, and bulk contractor payouts across countries and payout methods, with compliance gating built in.",
  },
];

const STEPS = [
  {
    title: "Tell us what you're building",
    body: "Share your use case, expected volume, and whether public, private, or both matters to you.",
  },
  {
    title: "We scope it together",
    body: "There's no generic self-serve docs yet — we build the first integrations hand-in-hand with partners, based on what you actually need.",
  },
  {
    title: "Go live",
    body: "Ship gifts, giveaways, or payouts inside your product, priced to your volume.",
  },
];

function ContactButtons({ align = "start" }: { align?: "start" | "center" }) {
  return (
    <div className={`flex flex-wrap gap-3 ${align === "center" ? "justify-center" : ""}`}>
      <a
        href={TELEGRAM_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
      >
        Message us on Telegram
        <span className="text-white/70">→</span>
      </a>
      <a
        href={CONTACT_HREF}
        className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all"
      >
        {CONTACT_EMAIL}
      </a>
    </div>
  );
}

export default function PartnersContent() {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#0a0a0c] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.08] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          {/* Hero */}
          <div className="mb-24">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
              For business · Early access
            </span>

            <h1 className="font-display text-[clamp(2.6rem,5.5vw,4.1rem)] font-medium leading-[1.05] tracking-[-0.03em] text-white mb-7">
              Bring social payments<br />into your product
            </h1>

            <p className="font-grotesk text-xl md:text-2xl leading-[1.6] text-slate-200 max-w-xl mb-10">
              Gift, split, reward, and pay out in USDC — public or private — without building crypto
              payment infrastructure yourself. Built for creator platforms, freelance marketplaces,
              and distributed teams who want to move money for their community.
            </p>

            <ContactButtons />
          </div>

          {/* What you can bring in */}
          <div className="mb-24">
            <p className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-6">
              What you can bring into your product
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PRODUCTS.map((p) => (
                <div
                  key={p.title}
                  className="rounded-2xl border border-white/15 bg-gradient-to-b from-[#1e1e24]/95 to-[#111114]/95 p-6"
                >
                  <div className="mb-3 text-[28px] leading-none">{p.icon}</div>
                  <h3 className="text-white font-bold text-xl font-display mb-2">{p.title}</h3>
                  <p className="font-grotesk text-lg leading-[1.6] text-slate-200">{p.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Public or private */}
          <div className="mb-24">
            <h2 className="text-white font-bold text-3xl md:text-4xl font-display mb-5 tracking-[-0.02em]">
              Public or private, your users&apos; call
            </h2>
            <p className="font-grotesk text-lg leading-[1.75] text-slate-200">
              Public and private aren&apos;t separate products on Loofta — they&apos;re a setting on the
              same payment rail. A private payment is shielded so the amount and counterparty aren&apos;t
              exposed on-chain; a public one behaves like a normal transaction. Whichever of the above you
              integrate, that same choice carries through to your users.
            </p>
          </div>

          {/* How it works */}
          <div className="mb-24">
            <p className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-6">
              How we work with early partners
            </p>
            <div className="flex flex-col gap-7">
              {STEPS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-4">
                  <span className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-white text-base font-bold ${BRAND_GRADIENT}`}>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-white font-bold text-xl font-display mb-1.5">{step.title}</h3>
                    <p className="font-grotesk text-lg leading-[1.75] text-slate-200">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div className="mb-24">
            <h2 className="text-white font-bold text-3xl md:text-4xl font-display mb-7 tracking-[-0.02em]">
              Frequently asked questions
            </h2>
            <div className="flex flex-col gap-7">
              {FAQ.map((item) => (
                <div key={item.question}>
                  <h3 className="text-white font-bold text-lg font-display mb-2">{item.question}</h3>
                  <p className="font-grotesk text-lg leading-[1.75] text-slate-200">{item.answer}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Contact CTA */}
          <div className={`relative overflow-hidden rounded-2xl p-[1px] ${BRAND_GRADIENT}`}>
            <div className="rounded-[15px] bg-[#0f0f12]/95 backdrop-blur-xl px-6 py-9 sm:px-10 sm:py-12">
              <p className="text-white font-bold text-2xl font-display mb-2.5">Let&apos;s build it together</p>
              <p className="text-slate-200 text-lg leading-relaxed mb-7 max-w-lg">
                Tell us what you&apos;re building and what you need from us — we&apos;ll figure out the
                right integration from there. Telegram is fastest.
              </p>
              <ContactButtons />
              <p className="text-slate-400 text-sm mt-4">{TELEGRAM_HANDLE}</p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
