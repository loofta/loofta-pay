'use client'

import Link from "next/link";
import Image from "next/image";
import Lottie, { LottieRefCurrentProps } from "lottie-react";
import paymentFlowAnimation from "../../../public/jitter/paymentflow.json";
import cardsHomeAnimation from "../../../public/jitter/cards_home.json";
import howItWorksAnimation from "../../../public/jitter/howitworks.json";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { Suspense, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import Spline from "@splinetool/react-spline";

export default function Home() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const ctaRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<LottieRefCurrentProps>(null);

  const handleAnimationComplete = () => {
    setTimeout(() => {
      lottieRef.current?.goToAndPlay(0);
    }, 2000); // 2 second pause before looping
  };

  const { scrollYProgress } = useScroll({
    target: ctaRef,
    offset: ["start end", "end start"]
  });

  const bgY = useTransform(scrollYProgress, [0, 1], ["0%", "30%"]);

  const faqItems = [
    {
      question: "Do I need to connect my wallet to pay?",
      answer: "Cross-chain: No. You can pay through a deposit wallet address we generate for your payment, and NEAR Intents handles the routing automatically. Same-chain: Yes. Biconomy bundles swap + pay into one transaction you sign once.",
    },
    {
      question: "Can I receive payments privately?",
      answer: "Yes. You can settle directly in Zcash using shielded or transparent addresses. More private routes (including ETH private pools) are coming soon.",
    },
    {
      question: "What chains  do you support?",
      answer: "All chains supported by NEAR Intents: EVM Chains (Arbitrum, Aurora, Base, Bera, BNB, Ethereum, Gnosis, Polygon, XLayer, Monad), Bitcoin, Cardano, Solana, MONAD, Zcash, Doge, SUI, Stellar, Tron, XRP, TON, Litecoin. More chains coming soon."
    },
    {
      question: "What are the fees?",
      answer: "Cross-chain: near-zero (0.0001%). Same-chain via Biconomy: free during beta. A small fee will be added later for private routes and business checkout.",
    },
    {
      question: "Can businesses use Loofta Pay?",
      answer: "Yes. A checkout SDK and branded checkout are available so businesses can accept multi-chain payments with a single integration.",
    },
  ];

  return (
    <div className="bg-gradient-to-b from-white to-gray-50">
      {/* Hero Section */}
      <div className="h-auto md:h-screen relative overflow-hidden">
        {/* Background pulses (kept for visual continuity) */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-100/50 rounded-full blur-3xl animate-pulse"></div>
          {/* Hide this red blob on md+ where Spline takes over */}
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-red-100/50 rounded-full blur-3xl animate-pulse delay-700 md:hidden"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-50/50 rounded-full blur-3xl animate-pulse delay-1000"></div>
          {/* Spline 3D abstract animation on the right side */}
          <div
            className="spline-wrap pointer-events-none hidden md:block absolute top-0 right-[-2vw] w-[65vw] max-w-[1400px] md:h-full h-auto z-0"
            style={{
              WebkitMaskImage: 'linear-gradient(to left, black 78%, transparent 98%)',
              maskImage: 'linear-gradient(to left, black 78%, transparent 98%)',
            }}
          >
            <Suspense fallback={<div className="w-full h-auto md:h-full" />}>
              <Spline scene="/spline/reeded_liquid_glass_prism_hero_section_concept_copy.spline" />
            </Suspense>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 h-full flex items-start pb-10 relative z-10">
          {/* Hero (Figma-aligned) */}
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-start w-full"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <div className="order-1 pt-12 md:pt-24  md:order-1">
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
              <h1 className="mt-2 text-4xl md:text-6xl lg:text-7xl font-medium leading-[1.05] text-slate-900">
                Pay & request <br className="hidden md:block" />
                crypto <span className="font-bold">privately.</span>
              </h1>
              <p className="mt-12 md:mt-24 text-xl md:text-2xl text-slate-900/90 max-w-xl">
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
            <div className="order-2 md:order-2 relative h-automd:h-full overflow-visible z-10 flex items-end justify-end">
              <Lottie
                lottieRef={lottieRef}
                animationData={paymentFlowAnimation}
                loop={false}
                onComplete={handleAnimationComplete}
                className="w-[379px] h-[418px]"
              />
            </div>
          </motion.div>

        </div>
      </div>

      {/* Section — Dark features block (Figma) */}
      <section className="mt-0 md:mt-0 bg-[#18181F] relative overflow-hidden">
        {/* Background image with low opacity - parallax */}
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: 'url(/bg_section.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundAttachment: 'fixed',
          }}
        />
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-20 md:py-28 relative z-10">
          <div className="text-center">
            <h2 className="text-5xl md:text-6xl font-medium font-sans text-white leading-tight">
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
          {/* Desktop: Lottie animation */}
          <div className="mt-12 md:mt-16 hidden md:flex justify-center">
            <Lottie
              animationData={cardsHomeAnimation}
              loop={true}
              className="w-full max-w-4xl"
            />
          </div>

          {/* Mobile: Cards grid */}
          <div className="mt-12 md:hidden w-full grid grid-cols-1 gap-6">
            {[
              {
                icon: "/images/icons/share-icon.png",
                width: 74,
                height: 74,
                title: "Any chain. Any token. Zero hassle.",
                desc: "Accept payments from any blockchain: no bridges, no swaps, nothing to explain.",
              },
              {
                icon: "/images/icons/target-icon.png",
                width: 70,
                height: 70,
                title: "Always receive the exact asset you chose.",
                desc: "Your payer sends whatever they want. You receive exactly what you configured.",
              },
              {
                icon: "/images/icons/mouse-icon.png",
                title: "A one‑click flow anyone can complete.",
                desc: "No wallet requirements. No chain confusion. No technical steps.",
              },
              {
                icon: "/images/icons/shield-icon.png",
                title: "The payer → receiver trail stays private.",
                desc: "Accept payments from any blockchain: no bridges, no swaps, nothing to explain.",
              },
            ].map((f, index) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                className="rounded-[20px] bg-[#1D1D25] border border-white/5 p-6 text-white flex items-start gap-4"
              >
                <div className="shrink-0">
                  <Image
                    src={f.icon}
                    alt=""
                    width={f.width ?? 64}
                    height={f.height ?? 64}
                  />
                </div>
                <div className="flex flex-col">
                  <div className="text-lg md:text-xl font-semibold leading-tight">{f.title}</div>
                  <div className="mt-2 text-sm text-white/60 leading-relaxed">{f.desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Section — How it works */}
      <section className="bg-white py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <h2 className="text-5xl md:text-6xl font-medium font-sans text-slate-900 text-center mb-12 md:mb-16">
            How it works
          </h2>
          {/* Desktop: Lottie animation */}
          <div className="hidden md:flex justify-center">
            <Lottie
              animationData={howItWorksAnimation}
              loop={true}
              className="w-full max-w-5xl"
            />
          </div>

          {/* Mobile: Cards grid with scroll animation */}
          <div className="grid grid-cols-1 gap-6 md:hidden">
            {[
              {
                number: "1.",
                title: "Create a Request",
                desc: "Choose amount, network, privacy.",
              },
              {
                number: "2.",
                title: "Share a Link",
                desc: "Send it anywhere — DM, email, chat.",
              },
              {
                number: "3.",
                title: "Get Paid",
                desc: "Payer choose payout method, privacy settings, and pay.",
              },
            ].map((step, index) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                className="rounded-[20px] bg-[#F6F6F8] p-8 shadow-[0px_4px_20px_0px_rgba(15,23,42,0.08)]"
              >
                <div
                  className="text-6xl font-bold mb-4"
                  style={{
                    backgroundImage: 'linear-gradient(to bottom, #FF0F00, #EAB308)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    color: 'transparent',
                  }}
                >
                  {step.number}
                </div>
                <div className="text-xl font-semibold font-sans text-slate-900 mb-2">
                  {step.title}
                </div>
                <div className="text-md text-slate-500">
                  {step.desc}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Section — FAQ */}
      <section className="bg-white py-20 md:py-28">
        <div className="max-w-4xl mx-auto px-4 md:px-8">
          <h2 className="text-5xl md:text-6xl font-medium font-sans text-slate-900 text-center mb-12 md:mb-16">
            Frequently asked<br />questions
          </h2>
          <div className="flex flex-col gap-4">
            {faqItems.map((item, index) => (
              <div
                key={index}
                className="rounded-[20px] bg-[#F6F6F8] overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left"
                >
                  <span className="text-lg md:text-xl font-semibold font-sans text-slate-900">
                    {item.question}
                  </span>
                  <motion.span
                    className="text-2xl text-slate-900 shrink-0 ml-4"
                    animate={{ rotate: openFaq === index ? 45 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    +
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {openFaq === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <div className="px-6 pb-5">
                        <p className="text-sm md:text-base text-slate-500">
                          {item.answer}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section ref={ctaRef} className="relative z-10 px-4 md:px-8 mb-[-80px]">
        <div className="max-w-5xl rounded-[40px] mx-auto overflow-hidden">
          <motion.div
            className="rounded-[40px] bg-cover bg-opacity-5"
            style={{
              backgroundImage: 'url(/bg_footer.png)',
              backgroundPosition: 'center',
              backgroundPositionY: bgY,
            }}
          >
            <div
              className="rounded-[40px]"
              style={{
                backgroundImage: 'linear-gradient(to right, rgba(255,19,1,0.85), rgba(234,179,8,0.85))',
              }}
            >
              <div className="flex flex-col items-center py-12 md:py-18 px-8 md:px-16 text-center">
                <h2 className="text-3xl md:text-6xl font-medium font-sans text-white leading-tight">
                  Ready to get paid<br />
                  privately?
                </h2>
                <p className="mt-6 text-lg md:text-xl text-white max-w-xl">
                  Your payer uses whatever they want.<br />
                  <span className="font-semibold">You always receive exactly what you asked for.</span>
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                  <Link
                    href="/claim"
                    className="rounded-full px-8 py-4 text-base font-semibold bg-[#0F172A] text-white hover:opacity-90 transition-colors"
                  >
                    Create a payment link
                  </Link>
                  <a
                    href="https://t.me/looftaxyz"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full px-8 py-4 text-base font-semibold bg-white text-red-500 hover:bg-gray-50 transition-colors"
                  >
                    Chat on Telegram
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#18181F] pt-32 md:pt-40 pb-12">
        <div className="max-w-7xl mx-auto px-4 md:px-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 md:gap-12">
            {/* Logo */}
            <div className="col-span-2 md:col-span-1">
              <Image
                src="/loofta_white.svg"
                alt="Loofta"
                width={140}
                height={40}
                className="h-10 w-auto"
              />
            </div>

            {/* Products */}
            <div>
              <h4 className="text-white font-semibold mb-4">Products</h4>
              <ul className="space-y-2">
                <li><a href="/swap" className="text-slate-400 hover:text-white transition-colors">Cross-chain swap</a></li>
                <li><a href="/claim" className="text-slate-400 hover:text-white transition-colors">Payment request</a></li>
              </ul>
            </div>

            {/* Socials */}
            <div>
              <h4 className="text-white font-semibold mb-4">Socials</h4>
              <ul className="space-y-2">
                <li><a href="https://medium.com/@looftaxyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Medium</a></li>
                <li><a href="https://twitter.com/looftaxyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Twitter</a></li>
                <li><a href="https://t.me/looftaxyz" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Telegram</a></li>
              </ul>
            </div>

            {/* Documentation */}
            <div>
              <h4 className="text-white font-semibold mb-4">Documentation</h4>
              <ul className="space-y-2">
                <li><a href="https://github.com/loofta" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors">Github</a></li>
              </ul>
            </div>

            {/* Routes */}
            <div>
              <h4 className="text-white font-semibold mb-4">Routes</h4>
              <ul className="space-y-2">
                <li><a href="/swap" className="text-slate-400 hover:text-white transition-colors">Bridge to Solana</a></li>
                <li><a href="/swap" className="text-slate-400 hover:text-white transition-colors">Bridge to Bitcoin</a></li>
                <li><a href="/swap" className="text-slate-400 hover:text-white transition-colors">Bridge to Ethereum</a></li>
              </ul>
            </div>
          </div>
        </div>
      </footer>

      {/* Hide Spline watermark (visual only) */}
      <style jsx global>{`
        .spline-wrap a[href*="spline.design"] { display: none !important; }
      `}</style>
    </div>
  );
}

