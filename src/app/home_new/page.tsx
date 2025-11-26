'use client'

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import Spline from "@splinetool/react-spline/next";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 relative overflow-hidden">
      {/* Background pulses (kept for visual continuity) */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-100/50 rounded-full blur-3xl animate-pulse"></div>
        {/* Hide this red blob on md+ where Spline takes over */}
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-red-100/50 rounded-full blur-3xl animate-pulse delay-700 md:hidden"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-50/50 rounded-full blur-3xl animate-pulse delay-1000"></div>
        {/* Spline 3D abstract animation on the right side */}
        <div
          className="spline-wrap pointer-events-none hidden md:block absolute top-[-6vh] right-[-2vw] w-[65vw] max-w-[1400px] h-[110vh] z-0"
          style={{
            WebkitMaskImage: 'linear-gradient(to left, black 78%, transparent 98%)',
            maskImage: 'linear-gradient(to left, black 78%, transparent 98%)',
          }}
        >
          <Spline scene="/spline/reeded_liquid_glass_prism_hero_section_concept_copy.spline" />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 min-h-screen flex items-start pt-12 md:pt-24 pb-10 relative z-10">
        {/* Hero (Figma-aligned) */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-start w-full"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <div className="order-2 md:order-1">
            <div
              className="uppercase tracking-[0.14em] text-[12px] md:text-xs font-semibold"
              style={{
                backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }}
            >
              multi‑chain • private • non‑custodial • no swaps required
            </div>
            <h1 className="mt-2 text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.05] text-slate-900">
              Crypto payments,<br className="hidden md:block" /> finally <span className="font-extrabold">simple.</span>
            </h1>
            <p className="mt-4 text-lg md:text-xl text-slate-900/90 max-w-xl">
              Your payer uses whatever they want.<br className="hidden md:block" />
              <span className="font-semibold">You always receive exactly what you asked for.</span>
            </p>
            <div className="mt-6">
              <Link href="/claim">
                <Button className="rounded-[21px] px-6 py-3 text-base font-semibold text-white border-0 shadow-md hover:scale-[1.02] transition-transform" style={{ background: 'linear-gradient(to right, #FF1301, #EAB308)' }}>
                  Create a payment
                </Button>
              </Link>
            </div>
          </div>
          <div className="order-1 md:order-2 relative z-10">
            <div className="mx-auto md:ml-auto md:mr-0 max-w-sm rounded-2xl bg-white border border-orange-200 p-4 shadow-xl relative">
              <div className="text-sm font-semibold text-slate-900">Create a payment request.</div>
              <div className="mt-2 text-xs text-slate-900">Choose the asset you want to receive</div>
              <div className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 flex items-center justify-between">
                <div className="inline-flex items-center gap-2">
                  <Image src="/images/usdt.png" alt="USDC" width={20} height={20} className="rounded-full" />
                  <span>USDC</span>
                </div>
                <span className="text-slate-500 text-xs">Base</span>
              </div>
              <div className="mt-3 text-xs text-slate-900">Amount</div>
              <div className="mt-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">300</div>
              {/* Floating minis (from Figma nodes 75:26 and 75:53) */}
              <div className="hidden md:block absolute -top-10 -right-28 w-72 h-52 rounded-2xl bg-white border border-white/20 shadow-lg" />
              <div className="hidden md:block absolute top-40 -right-36 w-32 h-32 rounded-2xl bg-white border border-white/20 shadow-lg" />
              {/* Pill + QR cluster (overlapping outside card bottom-right to match Figma node 75:57 & 75:51) */}
              <div className="absolute -bottom-12 -right-12 flex items-center gap-3">
                <div className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs text-white shadow-md" style={{ background: 'linear-gradient(to right, #FF1301, #EAB308)' }}>
                  <CheckCircle2 className="h-4 w-4 text-white" />
                  <span>Your payment link is ready</span>
                </div>
                <div className="rounded-2xl bg-white shadow-lg p-2 border border-slate-200">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=${encodeURIComponent('loofta://payment?id=demo')}`}
                    alt="Payment QR"
                    width={96}
                    height={96}
                    className="block"
                  />
                </div>
              </div>
              {/* Curved arrow to pill (Figma node 75:47 approximation) */}
              <svg
                className="hidden md:block absolute -bottom-14 right-32"
                width="80"
                height="60"
                viewBox="0 0 80 60"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5 10C35 10 50 25 60 40"
                  stroke="url(#g1)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <path
                  d="M60 40c2 4 6 8 10 9"
                  stroke="url(#g1)"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#FF1301" />
                    <stop offset="1" stopColor="#EAB308" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
        </motion.div>

      </div>

      {/* Section — Dark features block (Figma) */}
      <section className="mt-0 md:mt-0 bg-[#0d0d0f]">
        <div className="max-w-7xl mx-auto px-4 py-14 md:py-20">
          <div className="text-center">
            <h2 className="text-3xl md:text-5xl font-bold text-white leading-tight">
              The modern way <br className="hidden md:block" />
              <span
                style={{
                  backgroundImage: 'linear-gradient(to right, #FF0F00, #EAB308)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }}
              >
                to get paid in crypto.
              </span>
            </h2>
            <p className="mt-3 text-sm md:text-base text-white/70">
              Loofta removes all the friction of multi‑chain payments, for you and your users.
            </p>
          </div>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {[
              {
                title: "Any chain. Any token. Zero hassle.",
                desc: "Accept payments from any blockchain: no bridges, no swaps, nothing to explain.",
              },
              {
                title: "Always receive the exact asset you chose.",
                desc: "Your payer sends whatever they want. You receive exactly what you configured.",
              },
              {
                title: "A one‑click flow anyone can complete.",
                desc: "No wallet requirements. No chain confusion. No technical steps.",
              },
              {
                title: "The payer → receiver trail stays private.",
                desc: "Accept payments from any blockchain, no bridges, no swaps, nothing to explain.",
              },
            ].map((f) => (
              <div key={f.title} className="rounded-[20px] bg-[#151518] border border-white/5 p-6 text-white">
                <div className="text-lg font-bold">{f.title}</div>
                <div className="mt-2 text-sm text-white/70">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* End of Figma content */}
      {/* Hide Spline watermark (visual only) */}
      <style jsx global>{`
        .spline-wrap a[href*="spline.design"] { display: none !important; }
      `}</style>
    </div>
  );
}

