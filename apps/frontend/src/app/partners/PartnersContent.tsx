'use client'

import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { PARTNERS_FAQ as FAQ } from "./data";

/* =====================================================
   DESIGN TOKENS — matches /home-v2's ink/paper palette so this page
   reads as the same product, not a bolted-on marketing page.
   ===================================================== */

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_14px_34px_-12px_rgba(255,19,1,0.6)]";
const INK = "text-[#F4F2EC]";
const INK_2 = "text-[#A9A7A0]";
const INK_3 = "text-[#7D7B76]";
const BORDER_LINE = "border-[rgba(255,255,255,0.12)]";
const BG_PAPER_2 = "bg-[#17171E]";

const CONTACT_EMAIL = "hello@loofta.xyz";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Integrating Loofta")}`;
const TELEGRAM_HANDLE = "t.me/looftaxyz";
const TELEGRAM_HREF = "https://t.me/looftaxyz";

const PRODUCTS = [
  {
    icon: "🐦",
    title: "Twitter bot",
    body: "Tag @looftapay on X to send USDC or gift lottery tickets — no app switch, no wallet address. Enrolled accounts can even skip the confirm step entirely.",
    cta: { label: "Get started", href: "https://pay.loofta.xyz/twitter-bot" },
  },
  {
    icon: "🎟️",
    title: "Giveaways",
    body: "Prize drops and jackpot-style giveaways for a community — built for the kind of viral, low-friction acquisition loop a rewards or referral program needs.",
    cta: { label: "View giveaways", href: "https://pay.loofta.xyz/rewards/giveaways" },
  },
  {
    icon: "🔗",
    title: "Payment links",
    body: "One-off payment links your users can share and get paid on, across chains and tokens, without an account required from the payer.",
    cta: { label: "Create a link", href: "https://pay.loofta.xyz/app?tab=receive" },
  },
  {
    icon: "🛠️",
    title: "SDK",
    body: "Drop-in TypeScript SDK to create payments, resolve identities, and go live inside your own product — for teams that want a code-level integration, not hosted checkout.",
    cta: { label: "Talk to team", href: TELEGRAM_HREF },
  },
  {
    icon: "📡",
    title: "Airdrops to social handles",
    body: "Drop tokens straight to an email, Discord, X, or Telegram handle — no wallet collection needed. Built on ZK compression, so airdropping to thousands of recipients stays cheap.",
    cta: { label: "Talk to team", href: TELEGRAM_HREF },
  },
  {
    icon: "🧾",
    title: "Team payouts",
    body: "Scheduled payroll, recurring payments, and bulk contractor payouts across countries and payout methods, with compliance gating built in.",
    cta: { label: "Try multi-send", href: "https://pay.loofta.xyz/app?tab=send" },
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
    body: "Drop-in SDK, hosted checkout, or a direct API integration — ship gifts, giveaways, token listings, or payouts inside your product, priced to your volume.",
  },
];

function ContactButtons({ align = "start" }: { align?: "start" | "center" }) {
  return (
    <div className={`flex flex-wrap gap-3.5 ${align === "center" ? "justify-center" : ""}`}>
      <a
        href={TELEGRAM_HREF}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-2.5 rounded-full px-7 py-4 font-display text-lg font-medium text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
      >
        Message us on Telegram
        <span className="text-white/70">→</span>
      </a>
      <a
        href={CONTACT_HREF}
        className={`inline-flex items-center gap-2.5 rounded-full border-[1.5px] ${BORDER_LINE} px-7 py-4 font-display text-lg font-medium ${INK} transition-colors hover:border-white/40`}
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
      <main className={`relative min-h-screen overflow-hidden bg-[#0B0B0F] pb-40 font-grotesk ${INK}`}>
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[-60px] h-[560px] w-[1000px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(255,106,0,0.14), rgba(234,179,8,0.06) 44%, transparent 66%)",
          }}
        />

        <div className="relative mx-auto max-w-[760px] px-6 pt-24 md:px-10 md:pt-32">
          {/* Hero */}
          <div className="mb-24">
            <span className="font-grotesk text-base font-semibold uppercase tracking-[0.22em] text-[#FF1301]">
              For business · Early access
            </span>

            <h1 className={`mt-[18px] font-display text-[clamp(40px,5.4vw,64px)] font-medium leading-[1.05] tracking-[-0.035em] ${INK}`}>
              Bring social payments
              <br />
              into your product.
            </h1>

            <p className={`mt-[22px] max-w-xl font-grotesk text-[clamp(18px,2vw,22px)] leading-[1.6] ${INK_2}`}>
              Gift, split, reward, list a token, or pay out in USDC — public or private — without
              building crypto payment infrastructure yourself. Drop-in SDK or hosted checkout, live
              in a day. Built for creator platforms, freelance marketplaces, and distributed teams
              who want to move money for their community.
            </p>

            <div className="mt-9">
              <ContactButtons />
            </div>
          </div>

          {/* What you can bring in */}
          <div className="mb-24">
            <p className={`mb-6 font-grotesk text-sm font-semibold uppercase tracking-[0.16em] ${INK_3}`}>
              What you can bring into your product
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {PRODUCTS.map((p) => (
                <div key={p.title} className={`flex flex-col rounded-[26px] border ${BORDER_LINE} ${BG_PAPER_2} p-7`}>
                  <div className="mb-3 text-[28px] leading-none">{p.icon}</div>
                  <h3 className={`font-display text-xl font-medium ${INK}`}>{p.title}</h3>
                  <p className={`mt-2 flex-1 font-grotesk text-lg leading-[1.6] ${INK_2}`}>{p.body}</p>
                  {p.cta && (
                    <a
                      href={p.cta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`mt-6 inline-flex w-fit items-center gap-2 rounded-full px-6 py-3 font-display text-base font-medium text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
                    >
                      {p.cta.label}
                      <span className="text-white/70">→</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Public or private */}
          <div className="mb-24">
            <h2 className={`mb-5 font-display text-3xl font-medium tracking-[-0.02em] md:text-4xl ${INK}`}>
              Public or private, your users&apos; call
            </h2>
            <p className={`font-grotesk text-lg leading-[1.75] ${INK_2}`}>
              Public and private aren&apos;t separate products on Loofta — they&apos;re a setting on the
              same payment rail. A private payment is shielded so the amount and counterparty aren&apos;t
              exposed on-chain; a public one behaves like a normal transaction. Whichever of the above you
              integrate, that same choice carries through to your users.
            </p>
          </div>

          {/* How it works */}
          <div className="mb-24">
            <p className={`mb-6 font-grotesk text-sm font-semibold uppercase tracking-[0.16em] ${INK_3}`}>
              How we work with early partners
            </p>
            <div className="flex flex-col gap-7">
              {STEPS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-4">
                  <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full font-display text-base font-medium text-white ${BRAND_GRADIENT}`}>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className={`font-display text-xl font-medium ${INK}`}>{step.title}</h3>
                    <p className={`mt-1.5 font-grotesk text-lg leading-[1.75] ${INK_2}`}>{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div className="mb-24">
            <h2 className={`mb-7 font-display text-3xl font-medium tracking-[-0.02em] md:text-4xl ${INK}`}>
              Frequently asked questions
            </h2>
            <div className="flex flex-col gap-7">
              {FAQ.map((item) => (
                <div key={item.question}>
                  <h3 className={`font-display text-lg font-medium ${INK}`}>{item.question}</h3>
                  <p className={`mt-2 font-grotesk text-lg leading-[1.75] ${INK_2}`}>{item.answer}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Contact CTA */}
          <div className={`relative overflow-hidden rounded-[28px] p-[1px] ${BRAND_GRADIENT}`}>
            <div className="rounded-[27px] bg-[#0B0B0F]/95 px-6 py-9 backdrop-blur-xl sm:px-10 sm:py-12">
              <p className={`font-display text-2xl font-medium ${INK}`}>Let&apos;s build it together</p>
              <p className={`mb-7 mt-2.5 max-w-lg font-grotesk text-lg leading-relaxed ${INK_2}`}>
                Tell us what you&apos;re building and what you need from us — we&apos;ll figure out the
                right integration from there. Telegram is fastest.
              </p>
              <ContactButtons />
              <p className={`mt-4 font-grotesk text-sm ${INK_3}`}>{TELEGRAM_HANDLE}</p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
