'use client'

import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

const ROWS = [
  {
    label: "Who sees your payment history",
    paypal: "Visible in one place to PayPal, and to anyone you've transacted with via shared activity",
    loofta: "Shielded — counterparties and amounts aren't broadcast on a public, permanent record",
  },
  {
    label: "Fees",
    paypal: "Typically ~2.9% + a fixed fee for international/business payments, plus currency conversion spread",
    loofta: "A simple, transparent fee shown before you send — no card-network markups",
  },
  {
    label: "Settlement speed",
    paypal: "Instant to your PayPal balance; bank withdrawal can take days and may be held for review",
    loofta: "Settles on-chain in seconds, available immediately",
  },
  {
    label: "Availability",
    paypal: "Blocked or limited in a number of countries freelancers and remote teams work from",
    loofta: "Works anywhere you can reach the internet and hold a supported token",
  },
  {
    label: "Getting started",
    paypal: "Business account, identity verification, and approval before you can accept payments",
    loofta: "Generate a payment link in seconds — no account required from whoever's paying you",
  },
];

export default function PaypalComparisonPage() {
  return (
    <>
      <MinimalHeader />
      <main className="min-h-screen bg-[#0a0a0c] pb-40 relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-32 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#FF4A26]/[0.06] blur-[120px]" />

        <div className="relative max-w-3xl mx-auto px-4 md:px-8 pt-24 md:pt-32">
          {/* Hero */}
          <div className="mb-16">
            <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white mb-8 ${BRAND_GRADIENT} ${BRAND_SHADOW}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              Loofta vs PayPal
            </span>

            <h1 className="font-display text-[clamp(2.2rem,4.5vw,3.25rem)] font-medium leading-[1.1] tracking-[-0.03em] text-white mb-6">
              A private way for freelancers<br />to get paid, without PayPal
            </h1>

            <p className="font-grotesk text-[17px] md:text-[19px] leading-[1.65] text-slate-400 max-w-xl">
              Freelancers, creators, and distributed teams increasingly get paid in crypto — but most
              crypto payment tools copy PayPal's model without fixing the parts that actually bother
              freelancers: the fees, the holds, and every payment sitting in one place for the platform
              to see.
            </p>
          </div>

          {/* Comparison table */}
          <div className="mb-16 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left font-grotesk text-[13px] font-semibold text-slate-500 uppercase tracking-widest py-3 pr-4">
                    &nbsp;
                  </th>
                  <th className="text-left font-display text-white text-base font-semibold py-3 pr-4">
                    PayPal
                  </th>
                  <th className="text-left font-display text-white text-base font-semibold py-3">
                    Loofta
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-white/[0.06]">
                    <td className="align-top font-grotesk text-[14px] font-semibold text-slate-300 py-4 pr-4 whitespace-nowrap">
                      {row.label}
                    </td>
                    <td className="align-top font-grotesk text-[15px] leading-[1.6] text-slate-400 py-4 pr-4">
                      {row.paypal}
                    </td>
                    <td className="align-top font-grotesk text-[15px] leading-[1.6] text-slate-400 py-4">
                      {row.loofta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Why privacy matters here */}
          <div className="mb-16">
            <h2 className="text-white font-semibold text-2xl font-display mb-4">
              Why privacy matters for how you get paid
            </h2>
            <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400 mb-4">
              With PayPal, every client, gig, and tip lands in one account — your whole earnings history
              in a single place a platform can freeze, flag, or review at any time. Moving to a typical
              crypto payment link doesn't fix this; it just moves the same permanent record onto a public
              blockchain instead of a private company's database.
            </p>
            <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400">
              A private payment link keeps the parts that make crypto worth switching to — instant
              settlement, no country restrictions, no account required from your client — without
              turning your income into a public record either.
            </p>
          </div>

          <a
            href={APP_URL}
            className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
          >
            Get paid privately
            <span className="text-white/70">→</span>
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}
