'use client'

import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { RateCalculator } from "@/components/rate/RateCalculator";
import { USDC_TO_NGN_FAQ as FAQ } from "./data";
import type { UsdcNgnRateSnapshot } from "@/lib/usdcNgnRate";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";

const STEPS = [
  {
    title: "Send USDC to any email or handle",
    body: "No wallet address needed on your end either, just who you're sending to, their email, X handle, or Telegram.",
  },
  {
    title: "They open a private claim link",
    body: "It's waiting for them the moment you send it, whether or not they've used crypto before.",
  },
  {
    title: "They claim straight to naira",
    body: "They choose to claim in naira and it's paid out directly to their linked Nigerian bank account, no crypto wallet required.",
  },
];

export default function UsdcToNgnContent({ initialSnapshot }: { initialSnapshot: UsdcNgnRateSnapshot }) {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#111114] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          {/* Hero */}
          <div className="mb-12">
            <span className={`inline-flex items-center rounded-full px-4 py-2 text-lg font-semibold text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}>
              Live rate, no wallet needed to receive
            </span>

            <h1 className="font-display text-[clamp(2.4rem,5vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.03em] text-slate-100 mb-6">
              USDC to Naira, at the real market rate
            </h1>

            <p className="font-grotesk text-xl md:text-2xl leading-[1.6] text-slate-200 max-w-xl">
              Send USDC to anyone in Nigeria using just their email or social handle. They claim it
              straight to their bank account in naira, at the real market rate, not the official
              bank rate.
            </p>
          </div>

          {/* Calculator */}
          <div className="mb-20">
            <RateCalculator
              initialSnapshot={initialSnapshot}
              sendUnitLabel="USDC"
              ctaLabel="Send USDC to Nigeria now"
              utmCampaign="usdc-to-ngn"
              pageKey="usdc-to-ngn"
            />
          </div>

          {/* How it works */}
          <div className="mb-20">
            <h2 className="text-slate-100 font-semibold text-3xl font-display mb-6">
              How it works
            </h2>
            <div className="flex flex-col gap-6">
              {STEPS.map((step, i) => (
                <div key={step.title} className="flex items-start gap-4">
                  <span className={`flex-shrink-0 h-9 w-9 rounded-full flex items-center justify-center text-white text-lg font-semibold ${BRAND_GRADIENT}`}>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-slate-100 font-semibold text-xl font-display mb-1.5">{step.title}</h3>
                    <p className="font-grotesk text-lg leading-[1.65] text-slate-200">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div>
            <h2 className="text-slate-100 font-semibold text-3xl font-display mb-6">
              Frequently asked questions
            </h2>
            <div className="flex flex-col gap-6">
              {FAQ.map((item) => (
                <div key={item.question}>
                  <h3 className="text-slate-100 font-semibold text-xl font-display mb-2">{item.question}</h3>
                  <p className="font-grotesk text-lg leading-[1.7] text-slate-200">{item.answer}</p>
                </div>
              ))}
            </div>
            <p className="font-grotesk text-lg text-slate-300 mt-10">
              Not sending crypto?{" "}
              <a href="/dollar-to-naira-today" className="text-slate-100 underline decoration-white/30 underline-offset-2 hover:decoration-white">
                See today's dollar to naira rate
              </a>{" "}
              instead.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
