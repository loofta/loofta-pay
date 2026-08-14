'use client'

import { useState } from "react";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { RateCalculator } from "@/components/rate/RateCalculator";
import { SupportedBanksModal } from "@/components/rate/SupportedBanksModal";
import { DOLLAR_TO_NAIRA_COMPARE, DOLLAR_TO_NAIRA_FAQ as FAQ } from "./data";
import type { UsdcNgnRateSnapshot } from "@/lib/usdcNgnRate";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";

export default function DollarToNairaContent({ initialSnapshot }: { initialSnapshot: UsdcNgnRateSnapshot }) {
  const [banksOpen, setBanksOpen] = useState(false);

  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#111114] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          {/* Hero */}
          <div className="mb-12">
            <span className={`inline-flex items-center rounded-full px-4 py-2 text-lg font-semibold text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}>
              Live rate, straight to your bank
            </span>

            <h1 className="font-display text-[clamp(2.4rem,5vw,3.75rem)] font-medium leading-[1.05] tracking-[-0.03em] text-slate-100 mb-6">
              Dollar to Naira, Today's Real Rate
            </h1>

            <p className="font-grotesk text-xl md:text-2xl leading-[1.6] text-slate-200 max-w-xl">
              See today's dollar to naira rate, and receive it directly. Anyone can send you dollars
              using just your email or social handle, no bank details shared upfront, and you claim
              it straight to your Nigerian bank account at the real market rate.
            </p>
          </div>

          {/* Calculator */}
          <div className="mb-16">
            <RateCalculator
              initialSnapshot={initialSnapshot}
              sendUnitLabel="USD"
              ctaLabel="Receive dollars as naira"
              utmCampaign="dollar-to-naira-today"
              pageKey="dollar-to-naira-today"
            />
          </div>

          {/* Nigerian banks supported */}
          <div className="mb-20">
            <button
              type="button"
              onClick={() => setBanksOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-base font-semibold text-slate-200 transition-colors hover:border-white/30 hover:text-white"
            >
              Nigerian banks supported
              <span className="text-slate-400">→</span>
            </button>
          </div>
          <SupportedBanksModal open={banksOpen} onOpenChange={setBanksOpen} />

          {/* Comparison: at the bank vs on Loofta */}
          <div className="mb-20">
            <h2 className="text-slate-100 font-semibold text-3xl font-display mb-6">
              At the bank vs. on Loofta
            </h2>
            <div className="flex flex-col gap-4">
              {DOLLAR_TO_NAIRA_COMPARE.map((row) => (
                <div key={row.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-6">
                  <p className="font-grotesk text-lg font-semibold text-slate-100 mb-4">{row.label}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="font-grotesk text-base font-bold text-slate-300 uppercase tracking-wide mb-2">
                        At the bank
                      </p>
                      <p className="font-grotesk text-lg leading-[1.6] text-slate-300">{row.atBank}</p>
                    </div>
                    <div>
                      <p className="font-grotesk text-base font-bold text-[#FFA97D] uppercase tracking-wide mb-2">
                        On Loofta
                      </p>
                      <p className="font-grotesk text-lg leading-[1.6] text-slate-100">{row.loofta}</p>
                    </div>
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
              Already holding USDC?{" "}
              <a href="/usdc-to-ngn" className="text-slate-100 underline decoration-white/30 underline-offset-2 hover:decoration-white">
                See the live USDC to Naira calculator
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
