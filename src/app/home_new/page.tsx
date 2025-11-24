'use client'

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Plus, Link2, Wallet, CheckCircle2, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 relative overflow-hidden">
      {/* Background pulses (kept for visual continuity) */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-100/50 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-red-100/50 rounded-full blur-3xl animate-pulse delay-700"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-50/50 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-10 pb-16 md:pb-20 relative z-10">
        {/* Hero (simplified) */}
        <motion.div
          className="text-center space-y-5 md:space-y-6"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight">
            <span className="text-gray-900">
              Pay & request crypto privately from anyone, on any chain.
            </span>
          </h1>
          <p className="text-lg md:text-xl text-gray-700 max-w-3xl mx-auto">
            Any chain. Any token. Direct to their wallet. Private. Fast. Simple.
          </p>
          <div className="flex items-center justify-center gap-3 md:gap-4">
            <Link href="/swap">
              <Button variant="outline" className="rounded-2xl px-6 md:px-8 py-3 md:py-4 text-base md:text-lg border-orange-200">
                Learn more
              </Button>
            </Link>
            <Link href="/claim">
              <Button className="rounded-2xl px-6 md:px-8 py-3 md:py-4 text-base md:text-lg text-white font-semibold border-0 shadow-md transition-transform hover:scale-[1.02]" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}>
                Create a Payment
              </Button>

            </Link>
          </div>

        </motion.div>

        {/* Hero Illustration (clear visual with icons) */}
        <motion.div
          className="mt-8 md:mt-12"
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <div className="mx-auto max-w-3xl rounded-3xl bg-white border border-orange-200 p-5 md:p-6 shadow-sm">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              {/* Left: token icons */}
              <div className="flex items-center gap-3">
                <motion.div initial={{ y: 6, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} transition={{ delay: 0.05 }}>
                  <Image src="/images/usdt.png" alt="USDT" width={40} height={40} className="rounded-full" />
                </motion.div>
                <motion.div initial={{ y: 6, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} transition={{ delay: 0.1 }}>
                  <Image src="/images/eth.png" alt="ETH" width={40} height={40} className="rounded-full" />
                </motion.div>
                <motion.div initial={{ y: 6, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}>
                  <Image src="/images/solana.png" alt="SOL" width={40} height={40} className="rounded-full" />
                </motion.div>
              </div>

              {/* Middle: animated route */}
              <div className="relative w-full md:flex-1 h-10 hidden md:block">
                <motion.div
                  className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-px rounded-full"
                  style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                  initial={{ scaleX: 0, transformOrigin: "left" }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
                <ArrowRight
                  className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-2 h-4 w-4 text-gray-900"
                  aria-hidden="true"
                />
              </div>

              {/* Right: destination */}
              <motion.div
                className="rounded-2xl p-4 bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200 min-w-[220px]"
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, ease: "easeOut", delay: 0.15 }}
              >
                <div className="text-xs font-semibold text-gray-600">YOU RECEIVE</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">USDC on Base</div>
                <div className="mt-1 text-sm text-gray-700">Exactly what you chose</div>
              </motion.div>
            </div>
            <div className="mt-3 text-center text-xs text-gray-600">Intent-based settlement • No bridges • No wrapping • Non-custodial</div>
          </div>
        </motion.div>
      </div>

      {/* Divider */}
      <motion.div
        className="w-full my-10 md:my-16 overflow-hidden relative"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.3 }}
        variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
      >
        <div className="relative h-px w-full mx-auto max-w-3xl">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to right, transparent, #EAB308, #FF0F00, transparent)', height: '2px' }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            transition={{ duration: 1, ease: "easeInOut" }}
          />
        </div>
      </motion.div>

      {/* Section 1 — What We Do */}
      <div className="max-w-7xl mx-auto px-4 relative z-10">
        <div className="text-center">
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight">
            Payments that feel like Revolut.
          </h2>
          <p className="mt-2 text-gray-700 max-w-2xl mx-auto">
            Forget the 10-step swaps. Forget the bridges. Forget copy-pasting risky wallet addresses.
          </p>
        </div>
        <motion.div
          className="mt-6 md:mt-10 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.12 } } }}
        >
          {[
            { title: "Create a Request", desc: "Choose chain, token, and amount.", icon: <Plus className="h-5 w-5 text-orange-600" /> },
            { title: "Share a Link", desc: "Send it anywhere — DM, email, chat.", icon: <Link2 className="h-5 w-5 text-orange-600" /> },
            { title: "Get paid your way", desc: "They can pay with anything. You receive exactly what you want.", icon: <Wallet className="h-5 w-5 text-orange-600" /> },
          ].map((s, i) => (
            <motion.div
              key={s.title}
              className="rounded-2xl bg-white border border-orange-200 p-6"
              variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              whileHover={{ y: -4 }}
            >
              <div className="flex items-center gap-2 text-xs text-gray-600 font-semibold">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-orange-100">{s.icon}</div>
                STEP {i + 1}
              </div>
              <div className="mt-2 text-lg font-bold text-gray-900">{s.title}</div>
              <div className="mt-1 text-sm text-gray-700">{s.desc}</div>
            </motion.div>
          ))}
        </motion.div>
        <div className="mt-8 text-center text-gray-800">
          A universal payment link for crypto. <span className="font-semibold">Made private. Made simple.</span>
        </div>
      </div>

      {/* Section 2 — Cross-Chain Magic */}
      <div className="max-w-7xl mx-auto px-4 mt-16 md:mt-20">
        <div className="text-center">
          <h2 className="text-2xl md:text-4xl font-bold">Pay with any asset. Receive in any asset. One click.</h2>
          <p className="mt-2 text-gray-700">Loofta handles the routing behind the scenes.</p>
        </div>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {[
            "USDT on Tron → USDC on Base",
            "ETH on Arbitrum → USDT on Ethereum",
            "SOL → USDC",
            "Anything → Anything",
          ].map((row) => (
            <div key={row} className="rounded-2xl bg-white/80 border border-orange-200 p-6 text-center font-semibold">
              <span style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{row}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center text-gray-800">Crypto finally works like money.</div>
      </div>

     

      {/* Section 6 — Use Cases */}
      <div className="max-w-7xl mx-auto px-4 mt-16 md:mt-20">
        <h2 className="text-2xl md:text-4xl font-bold text-center">Use Cases</h2>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {[
            { title: "Creators & KOLs", desc: "Get paid privately without leaking your wallet." },
            { title: "Freelancers", desc: "One link. Any client. Any chain. Stable income." },
            { title: "DAOs & Teams", desc: "Pay contributors globally without the chain mess." },
            { title: "Businesses", desc: "Private payroll. Vendor payments. Cross-chain treasury ops." },
          ].map((u) => (
            <div key={u.title} className="rounded-2xl bg-white border border-orange-200 p-5">
              <div className="text-lg font-bold text-gray-900">{u.title}</div>
              <div className="mt-1 text-sm text-gray-700">{u.desc}</div>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center text-gray-800">Send crypto like sending an email.</div>
      </div>

       {/* Section 3 — Privacy That Makes Sense */}
       <div className="max-w-7xl mx-auto px-4 mt-16 md:mt-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-start">
          <div>
            <h2 className="text-2xl md:text-4xl font-bold">Private for the public. Transparent for your business.</h2>
            <p className="mt-3 text-gray-700">
              We hide the payment trail from chain analytics: no one can see who paid who or how much.
            </p>
            <p className="mt-2 text-gray-700">
              But unlike mixers, we keep:
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              "a complete internal ledger",
              "full auditability",
              "optional identity binding",
              "AML safety",
              "regulator-friendly logs",
            ].map((item) => (
              <span
                key={item}
                className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-sm text-gray-900"
              >
                <CheckCircle2 className="h-4 w-4 text-orange-600" />
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-8 text-center text-gray-800">
          You get privacy. Your company gets traceability. Everyone wins.
        </div>
      </div>

      {/* Section 7 — Why Loofta */}
      <div className="max-w-7xl mx-auto px-4 mt-16 md:mt-20">
        <h2 className="text-2xl md:text-4xl font-bold text-center">Finally, crypto payments that don’t feel like crypto.</h2>
        <ul className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 max-w-3xl mx-auto text-gray-900">
          {[
            "Clean fintech UX",
            "Multi-chain",
            "Private by default",
            "Stable payouts",
            "No swaps, no bridges, no friction",
            "Instant settlement",
            "Audit-friendly",
            "Future-proof with zk tech",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-orange-600" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Section 8 — Call to Action */}
      <div className="max-w-7xl mx-auto px-4 my-16 md:my-20">
        <div className="rounded-3xl p-8 md:p-12 text-center border border-orange-200 bg-white/80">
          <h3 className="text-2xl md:text-4xl font-bold">Ready to pay people privately?</h3>
          <p className="mt-2 text-gray-700">Create your first payment request in 10 seconds.</p>
          <div className="mt-5 flex items-center justify-center gap-3 md:gap-4">
            <Link href="/claim">
              <Button className="rounded-2xl px-6 md:px-8 py-3 md:py-4 text-base md:text-lg text-white font-semibold border-0 shadow-md transition-transform hover:scale-[1.02]" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}>
                Start Now →
              </Button>
            </Link>
            <Link href="/swap">
              <Button variant="outline" className="rounded-2xl px-6 md:px-8 py-3 md:py-4 text-base md:text-lg border-orange-200">
                Try a Demo →
              </Button>
            </Link>
          </div>
          <div className="mt-4 text-xs md:text-sm text-gray-600">
            Privacy Mode (ZK Pools) launching soon — request beta access.
          </div>
        </div>
      </div>
    </div>
  );
}

