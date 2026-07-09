'use client'

import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { Footer } from "@/components/layout/Footer";
import { HOW_TO_STEPS } from "./data";

const BRAND_GRADIENT = "bg-gradient-to-r from-[#FF1301] to-[#EAB308]";
const BRAND_SHADOW = "shadow-[0_8px_32px_rgba(255,74,38,0.28)]";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/app";

export default function SendCryptoPrivatelyPage() {
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
              Guide
            </span>

            <h1 className="font-display text-[clamp(2.2rem,4.5vw,3.25rem)] font-medium leading-[1.1] tracking-[-0.03em] text-white mb-6">
              How to send crypto without<br />revealing your wallet address
            </h1>

            <p className="font-grotesk text-[17px] md:text-[19px] leading-[1.65] text-slate-400 max-w-xl">
              Every payment sent to a wallet address you reuse becomes part of a permanent, public
              record. Once that address is linked to your name — a Twitter bio, an ENS name, a form —
              anyone can see your income, your clients, and your balance. Here's how to avoid that.
            </p>
          </div>

          {/* Why it matters */}
          <div className="mb-16">
            <h2 className="text-white font-semibold text-2xl font-display mb-4">
              Why your wallet address leaks more than you think
            </h2>
            <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400 mb-4">
              A public blockchain doesn't have a privacy setting. If you send the same address to every
              client, supporter, or teammate, all of those payments — amounts, timing, counterparties —
              sit on a ledger anyone can query forever. This is the exact problem stealth address
              protocols were designed to solve: generate a new, one-time address for every incoming
              payment so no single address accumulates a traceable history.
            </p>
            <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400">
              Running your own stealth address setup means managing viewing keys and scanning the chain
              for payments — real overhead for a non-technical user. A private payment link gets you the
              same outcome — no single address ties your payments together — without any of that setup.
            </p>
          </div>

          {/* Steps */}
          <div className="mb-16">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-6">
              Step by step
            </p>
            <div className="flex flex-col gap-6">
              {HOW_TO_STEPS.map((step, i) => (
                <div key={step.name} className="flex items-start gap-4">
                  <span className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-white text-sm font-semibold ${BRAND_GRADIENT}`}>
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-white font-semibold text-lg font-display mb-1">{step.name}</h3>
                    <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Comparison */}
          <div className="mb-16">
            <h2 className="text-white font-semibold text-2xl font-display mb-4">
              Stealth addresses, privacy coins, or a payment link?
            </h2>
            <p className="font-grotesk text-[16px] leading-[1.7] text-slate-400 mb-4">
              All three aim at the same problem from different angles:
            </p>
            <ul className="flex flex-col gap-3.5 mb-4">
              <li className="flex items-start gap-3.5">
                <span className="mt-[10px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FF4A26]/60" />
                <span className="font-grotesk text-[16px] leading-[1.7] text-slate-400">
                  <strong className="text-white font-semibold">Stealth address protocols</strong> (Monero,
                  Umbra, ERC-5564) build the privacy into the base protocol or wallet — powerful, but
                  requires the sender and receiver to both support the standard.
                </span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="mt-[10px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FF4A26]/60" />
                <span className="font-grotesk text-[16px] leading-[1.7] text-slate-400">
                  <strong className="text-white font-semibold">Privacy coins</strong> (Monero, Zcash) shield
                  an entire chain's activity, but mean holding and asking others to acquire a separate asset.
                </span>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="mt-[10px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#FF4A26]/60" />
                <span className="font-grotesk text-[16px] leading-[1.7] text-slate-400">
                  <strong className="text-white font-semibold">Private payment links</strong> (Loofta) apply
                  the same one-time, unlinkable idea at the payment layer — the payer sends whatever token
                  they already hold, you receive USDC, and neither side needs to change wallets or assets.
                </span>
              </li>
            </ul>
          </div>

          <a
            href={APP_URL}
            className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] ${BRAND_GRADIENT} ${BRAND_SHADOW}`}
          >
            Create your first private payment link
            <span className="text-white/70">→</span>
          </a>
        </div>
      </main>
      <Footer />
    </>
  );
}
