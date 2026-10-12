'use client'

import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { GIVEAWAYS_FAQ as FAQ } from "./data";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

const STEPS = [
  {
    title: "Fund the prize pool",
    body: "Put USDC or Megapot tickets into escrow upfront, before anyone can enter. Entrants aren't trusting your word that the prize is real.",
  },
  {
    title: "Set the entry rule",
    body: "A quote-tweet, a follower threshold, an account-age minimum, whatever fits your project. Loofta reviews it before entries open.",
  },
  {
    title: "Let the draw pick winners",
    body: "Random draws run on MagicBlock VRF, verifiable on-chain randomness, not a pick made by hand. Payout is automatic once it runs.",
  },
];

export default function GiveawaysPage() {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#0a0a0c] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          {/* Hero */}
          <div className="mb-20">


            <h1 className="font-display text-[clamp(2.4rem,5vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.03em] text-white mb-6">
              Run a giveaway<br />for your project
            </h1>

            <p className="font-grotesk text-lg md:text-xl leading-[1.65] text-slate-300 max-w-xl mb-8">
              Fund a prize pool, set an entry rule, and let Loofta pick and pay out winners.
              Built for creators, freelancers, and teams who want a fast, trustworthy way to
              get more people trying out what they're building.
            </p>

            <div className="flex flex-wrap items-center gap-4">
              <a
                href="/rewards-rail"
                className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
              >
                Launch a giveaway
                <span className="text-white/70">→</span>
              </a>
              <a
                href={`${APP_URL}/rewards/giveaways`}
                className="text-base font-medium text-slate-300 hover:text-white transition-colors"
              >
                See open giveaways
              </a>
            </div>
          </div>

          {/* How it works */}
          <div className="mb-20">
            <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest mb-6">
              How it works
            </p>
            <div className="flex flex-col gap-6">
              {STEPS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-4">
                  <span className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-white text-base font-semibold ${BRAND_GRADIENT}`}>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-white font-semibold text-xl font-display mb-1">{step.title}</h3>
                    <p className="font-grotesk text-lg leading-[1.7] text-slate-300">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Why run one */}
          <div className="mb-20">
            <h2 className="text-white font-semibold text-2xl font-display mb-4">
              Why run a giveaway on Loofta
            </h2>
            <p className="font-grotesk text-lg leading-[1.7] text-slate-300 mb-4">
              Giveaways are one of the fastest ways to get people to actually try what you're
              building instead of scrolling past it. The catch is usually trust, entrants have
              no way to check the prize pool is real or the winner was picked fairly, and
              organizers are stuck manually tracking entries and sending payouts by hand.
            </p>
            <p className="font-grotesk text-lg leading-[1.7] text-slate-300">
              Loofta removes both problems. The prize pool is funded into escrow before entries
              open, the draw runs on verifiable on-chain randomness, and payout to winners is
              automatic, nothing for you to distribute after the fact.
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
