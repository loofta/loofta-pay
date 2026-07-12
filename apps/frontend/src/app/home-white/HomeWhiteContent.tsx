'use client'

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import {
  Icon3DGlobe,
  Icon3DEye,
  Icon3DArrowUser,
  Icon3DBolt,
  Icon3DLock,
  Icon3DStar,
  Icon3DShield,
} from "@/components/ui/icons3d";
import { FloatingPaymentsLight } from "@/components/ui/hero-bg";

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.1 } } };
const GRAD = "linear-gradient(to right, #FF1301, #EAB308)";

function GradientText({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ background: GRAD, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
      {children}
    </span>
  );
}

export default function LandingPageWhite() {
  return (
    <div className="bg-[#fafaf8] text-[#0f0f12] overflow-x-hidden font-sans">

      {/* ─── HERO ──────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-28 text-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full opacity-[0.07] blur-[100px]"
            style={{ background: "radial-gradient(ellipse, #FF1301 0%, transparent 70%)" }}
          />
        </div>
        <FloatingPaymentsLight />

        <motion.div variants={stagger} initial="hidden" animate="show" className="relative z-10 max-w-5xl mx-auto">
          <motion.h1 variants={fadeUp} className="text-[3.6rem] sm:text-[5rem] md:text-[6.5rem] lg:text-[8rem] font-bold leading-[0.92] tracking-tight mb-8 text-[#0f0f12]">
            Send to anyone.{" "}
            <br className="hidden sm:block" />
            <GradientText>Receive privately.</GradientText>
          </motion.h1>

          <motion.p variants={fadeUp} className="text-xl sm:text-2xl text-slate-500 leading-relaxed max-w-2xl mx-auto mb-12">
            Pay anyone by email or username — even before they have an account.
            Zero fees on Solana USDC. Withdraw to any token or bank account.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-2xl px-10 py-5 text-white font-semibold text-lg transition-transform hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,19,1,0.35)]"
              style={{ background: GRAD }}
            >
              Start sending <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/?tab=receive"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black/[0.1] bg-white px-10 py-5 text-[#0f0f12] font-semibold text-lg hover:bg-black/[0.03] transition-colors shadow-sm"
            >
              Get your payment link
            </Link>
          </motion.div>
        </motion.div>

        {/* Mock card */}
        <motion.div
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          className="relative z-10 mt-24 w-full max-w-xs mx-auto"
        >
          <div className="rounded-2xl border border-black/[0.07] bg-white p-7 text-left shadow-xl shadow-black/[0.06]">
            <p className="text-slate-400 text-base md:text-sm font-medium mb-2">Send</p>
            <p className="text-[#0f0f12] font-bold tabular-nums mb-1" style={{ fontSize: "3.2rem", lineHeight: 1 }}>
              $150 <span className="text-slate-300 text-2xl font-semibold">USD</span>
            </p>
            <p className="text-slate-400 text-base md:text-sm font-medium mt-5 mb-2">To</p>
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-black/[0.07] px-3 py-3">
              <span className="text-slate-400 text-base">@</span>
              <span className="text-[#0f0f12] text-base font-mono">satoshi</span>
            </div>
            <div className="mt-5 w-full rounded-xl py-3.5 text-center text-white text-base font-semibold" style={{ background: GRAD }}>
              Continue →
            </div>
          </div>
          <div className="absolute -top-3 -right-3 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-sm text-slate-500 font-medium shadow-md">
            🔒 Private payment
          </div>
        </motion.div>
      </section>

      {/* ─── FEATURES ──────────────────────────────────────────── */}
      <section className="py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} className="mb-16">
            <motion.h2 variants={fadeUp} className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[0.95] tracking-tight mb-6 text-[#0f0f12]">
              Everything you need<br className="hidden md:block" /> to get paid
            </motion.h2>
            <motion.p variants={fadeUp} className="text-slate-500 text-xl md:text-2xl max-w-2xl">
              Built for anyone who wants to send or receive money — privately, across any chain.
            </motion.p>
          </motion.div>

          <motion.div variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} className="flex flex-wrap justify-center gap-5">
            {[
              { icon: <Icon3DGlobe size={56} />,     title: "Any chain, any token",    body: "Send in ETH, receive in USDC on Solana. 20+ chains via NEAR Intents." },
              { icon: <Icon3DEye size={56} />,       title: "Private by default",      body: "MagicBlock PER shields your payment details from on-chain observers." },
              { icon: <Icon3DArrowUser size={56} />, title: "Pay before sign-up",      body: "Send to a Twitter handle or email. They claim it when they join." },
              { icon: <Icon3DBolt size={56} />,      title: "Zero fees on Solana",     body: "USDC payments on Solana are free. Gas is sponsored — no surprises." },
              { icon: <Icon3DLock size={56} />,      title: "Withdraw your way",       body: "Cash out to any token, any chain — or straight to your bank account." },
              { icon: <Icon3DStar size={56} />,      title: "Earn while you sleep",    body: "Every payment earns Loofta Points. APY via Morpho Vault coming soon." },
            ].map((feat) => (
              <motion.div
                key={feat.title}
                variants={fadeUp}
                className="w-full md:w-[calc(33.333%-14px)] rounded-2xl border border-black/[0.07] bg-white p-7 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 shadow-sm"
              >
                <div className="mb-5">{feat.icon}</div>
                <h3 className="text-[#0f0f12] font-semibold text-xl md:text-2xl mb-3">{feat.title}</h3>
                <p className="text-slate-500 text-base md:text-lg leading-relaxed">{feat.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ──────────────────────────────────────── */}
      <section className="py-28 px-6 bg-white">
        <div className="max-w-6xl mx-auto">
          <motion.div variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }} className="mb-16">
            <motion.h2 variants={fadeUp} className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[0.95] tracking-tight mb-6 text-[#0f0f12]">
              Three steps<br />to get paid
            </motion.h2>
            <motion.p variants={fadeUp} className="text-slate-500 text-xl md:text-2xl">
              Set up once. Share your link. Get paid in any token.
            </motion.p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-5">
            {[
              { n: "1", title: "Sign in",          body: "Google, Twitter, or email. Wallet created automatically." },
              { n: "2", title: "Share your link",  body: "One link, tied to your username. Drop it anywhere." },
              { n: "3", title: "Get paid",         body: "Receive in USDC on Solana. Zero fees, every time." },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, scale: 1.15 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 1.1, delay: i * 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="relative rounded-2xl border border-black/[0.07] bg-[#fafaf8] p-8 overflow-hidden shadow-sm"
              >
                <div
                  aria-hidden
                  className="absolute -top-5 -left-2 text-[9rem] font-bold leading-none select-none pointer-events-none"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,80,10,0.12), rgba(234,179,8,0.05))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  {s.n}
                </div>
                <div className="relative z-10 pt-12">
                  <h3 className="text-[#0f0f12] font-bold text-2xl md:text-3xl mb-4">{s.title}</h3>
                  <p className="text-slate-500 text-lg leading-relaxed">{s.body}</p>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-14"
          >
            <Link
              href="/?tab=receive"
              className="inline-flex items-center gap-2 rounded-2xl px-10 py-5 text-white font-semibold text-lg transition-transform hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,19,1,0.3)]"
              style={{ background: GRAD }}
            >
              Create your payment link <ArrowRight className="h-5 w-5" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* ─── PRIVACY SPOTLIGHT ─────────────────────────────────── */}
      <section className="py-28 px-6 bg-[#fafaf8]">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6 }}
            className="relative rounded-3xl border border-black/[0.07] bg-white overflow-hidden p-10 md:p-16 shadow-sm"
          >
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.04]"
              style={{ background: "radial-gradient(ellipse at 20% 50%, #FF1301 0%, transparent 60%)" }}
            />
            <div className="relative z-10 grid md:grid-cols-2 gap-14 items-center">
              <div>
                <div
                  className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-base md:text-sm font-medium text-white mb-8"
                  style={{ background: GRAD }}
                >
                  <Icon3DShield size={18} />
                  MagicBlock PER
                </div>
                <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[0.95] tracking-tight mb-6 text-[#0f0f12]">
                  Payments others can't trace
                </h2>
                <p className="text-slate-500 text-lg md:text-xl leading-relaxed mb-8">
                  Private Ephemeral Rollup shields your payment details from on-chain observers.
                  Amounts, counterparts, and history stay private.
                </p>
                <ul className="space-y-3">
                  {[
                    "On-chain details shielded from observers",
                    "Activity is much harder to link together",
                    "No setup — just toggle privacy on",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-slate-600 text-base md:text-lg">
                      <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full" style={{ background: GRAD }}>
                        <Check className="h-3.5 w-3.5 text-white" />
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-center md:justify-end">
                <div className="w-full max-w-xs rounded-2xl border border-black/[0.07] bg-[#fafaf8] p-6 space-y-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 text-base font-medium">Payment link</span>
                    <span className="text-sm font-semibold px-3 py-1 rounded-full text-white" style={{ background: GRAD }}>Private</span>
                  </div>
                  <div className="h-px bg-black/[0.05]" />
                  {[
                    ["Amount", "500 USDC"],
                    ["To", "@you"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-base">
                      <span className="text-slate-400">{k}</span>
                      <span className="text-[#0f0f12] font-medium">{v}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-base">
                    <span className="text-slate-400">Visibility</span>
                    <span className="text-emerald-600 font-medium">Shielded</span>
                  </div>
                  <div className="flex justify-between text-base">
                    <span className="text-slate-400">Gas</span>
                    <span className="text-emerald-600 font-medium">Sponsored</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── EARN ──────────────────────────────────────────────── */}
      <section className="py-28 px-6 bg-white">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-20 items-center">
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.55 }}
          >
            <p className="text-base md:text-sm font-semibold uppercase tracking-widest mb-6">
              <GradientText>Earn</GradientText>
            </p>
            <h2 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[0.95] tracking-tight mb-8 text-[#0f0f12]">
              Your payments<br />work for you
            </h2>
            <p className="text-slate-500 text-xl leading-relaxed mb-10">
              Every payment you receive earns Loofta Points automatically. APY on your USDC balance via Morpho Vault coming soon.
            </p>
            <Link href="/?tab=receive" className="inline-flex items-center gap-2 text-xl font-semibold hover:opacity-70 transition-opacity">
              <GradientText>Start earning points</GradientText>
              <ArrowRight className="h-6 w-6 text-[#FF1301]" />
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="grid grid-cols-2 gap-4"
          >
            {[
              { icon: "✦", label: "Loofta Points",   sub: "Earned on every payment received" },
              { icon: "◈", label: "Morpho Vault",    sub: "APY on your USDC — coming soon" },
              { icon: "⚡", label: "Auto-compound",   sub: "Every payment auto-reinvested" },
              { icon: "🎁", label: "Partner rewards", sub: "Discounts on tools you already use" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-black/[0.07] bg-[#fafaf8] p-6 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <span className="text-3xl block mb-4">{item.icon}</span>
                <p className="text-[#0f0f12] font-semibold text-lg mb-2">{item.label}</p>
                <p className="text-slate-400 text-base leading-snug">{item.sub}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ─── FINAL CTA ─────────────────────────────────────────── */}
      <section className="py-36 px-6 bg-[#fafaf8]">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
            <motion.h2 variants={fadeUp} className="text-5xl md:text-7xl lg:text-8xl font-bold leading-[0.92] tracking-tight mb-8 text-[#0f0f12]">
              Ready to<br />get paid?
            </motion.h2>
            <motion.p variants={fadeUp} className="text-slate-500 text-xl md:text-2xl mb-12">
              Free account, no seed phrase, no wallet install.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/?tab=receive"
                className="inline-flex items-center justify-center gap-2 rounded-2xl px-10 py-5 text-white font-semibold text-lg transition-transform hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,19,1,0.3)]"
                style={{ background: GRAD }}
              >
                Get your payment link <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href="/"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-black/[0.1] bg-white px-10 py-5 text-[#0f0f12] font-semibold text-lg hover:bg-black/[0.03] transition-colors shadow-sm"
              >
                Send a payment
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
