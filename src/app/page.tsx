'use client'

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Tweet } from "react-tweet";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeftRight, Send, CheckCircle2 } from 'lucide-react';
import { useAuth } from "@/hooks/useAuth";
import { mergeLocalIntoRemote } from "@/lib/history";

import { searchTokens, createTestIntent, type NearToken } from "@/services/nearIntents";
import { useTokensQuery } from "@/hooks/useTokensQuery";
import type { TokenSelection } from "@/app/utils/types";
import { findTokenBySelection } from "@/lib/tokens";
import { Skeleton } from "@/components/ui/skeleton";
import { useSwapStore } from "@/store/swap";
import { useQuote } from "@/hooks/useQuote";
import { NearSwapWidget } from "@/components/swap/NearSwapWidget";
import { useDuneStats } from "@/hooks/useDuneStats";
import { cmcLogoForSymbol } from "@/lib/tokenImages";
import { useHistoryModal } from "@/contexts/HistoryModalContext";
import { FAQAccordion } from "@/components/FAQAccordion";

export default function Home() {
  // Swap state
  const { data: tokens = [], isLoading: loadingTokens } = useTokensQuery();
  const { fromSel, toSel, amount, setFromSel, setToSel, setAmount, hydrated } = useSwapStore();
  const selectedFrom = useMemo(() => findTokenBySelection(tokens, fromSel), [tokens, fromSel]);
  const selectedTo = useMemo(() => findTokenBySelection(tokens, toSel), [tokens, toSel]);

  // Landing behaviors
  const prefersReducedMotion = useReducedMotion();
  const [openTweetId, setOpenTweetId] = useState<string | null>(null);
  const handleLogoClick = useCallback((tweetId?: string, fallbackUrl?: string) => {
    if (tweetId) {
      setOpenTweetId(tweetId);
      return;
    }
    if (fallbackUrl) {
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    }
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenTweetId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Dune stats
  const { data: dune, isLoading: loadingDune, error: duneError } = useDuneStats();
  const { authenticated, login, email, logout } = useAuth();
  const { openHistory } = useHistoryModal();

  // FR gating removed for now; EN content only
  useEffect(() => {
    async function sync() {
      try {
        // @ts-ignore
        const { userId } = require("@/hooks/useAuth").useAuth();
      } catch { }
    }
  }, []);

  // Static stats (previously fetched)
  const displayedStats = { activeUsers: 1200, questsCompleted: 3400, communities: 200 };

  // Quick boost demo state (kept as before)
  const budgetStops = [20, 50, 100, 200, 300, 500, 1000];
  const [budgetIndex, setBudgetIndex] = useState<number>(0);
  const budget = budgetStops[budgetIndex];
  const [postUrl, setPostUrl] = useState<string>("");
  // Initialize defaults when tokens are loaded
  useEffect(() => {
    if (!hydrated || !tokens.length) return;
    if (!fromSel) {
      const df = tokens.find((t: NearToken) => t.symbol === "USDT") || tokens[0];
      if (df) setFromSel({ symbol: df.symbol, chain: df.chain });
    }
    if (!toSel) {
      const preferred = tokens.find((t: NearToken) => t.symbol === "ETH" && (!fromSel || t.chain !== fromSel.chain));
      const fallback = tokens.find((t: NearToken) => fromSel ? (t.symbol !== fromSel.symbol || t.chain !== fromSel.chain) : true);
      const dt = preferred || fallback;
      if (dt) setToSel({ symbol: dt.symbol, chain: dt.chain });
    }
  }, [hydrated, tokens, fromSel, toSel, setFromSel, setToSel]);

  return (
    <div className=" bg-gradient-to-b from-white to-gray-50 relative">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-100/50 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-red-100/50 rounded-full blur-3xl animate-pulse delay-700"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-50/50 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      <div className="max-w-7xl mx-auto mt-12 px-4 pb-12 relative z-10">
        {/* Hero Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 mb-8 md:mb-12 mt-4 md:mt-6 items-start">
          <div className="space-y-4 md:space-y-6 animate-slide-up text-left">
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight px-4">
              <span className="inline-flex gap-0.5">
                <motion.span
                  className="inline-block"
                  initial={{ opacity: 0, y: -20, scale: 0.5 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{
                    delay: 0.05,
                    type: "spring",
                    stiffness: 300,
                    damping: 20
                  }}
                  whileHover={{
                    scale: 1.1,
                    transition: { type: "spring", stiffness: 400 }
                  }}
                  style={{
                    background: 'linear-gradient(to right, #EAB308, #FF0F00)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  Swap
                </motion.span>
              </span>{' '}
              <span className="text-gray-900">across multiple chains.<br /></span>

            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-3xl px-4">
              Powered by Near Intents, the easiest way to swap tokens across multiple chains.
            </p>

            <div className="relative inline-block group">
              <div className="absolute -inset-3 rounded-3xl bg-gradient-to-r from-orange-400/35 via-orange-500/30 to-red-500/35 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
              {authenticated ? (
                <Button
                  style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                  className="relative z-10 mt-4 px-10   py-6 text-lg md:text-xl text-white font-semibold rounded-2xl border-0 transition-transform duration-200 ease-out hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,15,0,0.35)] hover:shadow-[0_25px_80px_-20px_rgba(255,15,0,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-400"
                  onClick={() => openHistory()}
                >
                  View History
                  <ArrowRight className="ml-3 h-6 w-6" />
                </Button>
              ) : (
                <Button
                  style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                  className="relative z-10 mt-4 px-10   py-6 text-lg md:text-xl text-white font-semibold rounded-2xl border-0 transition-transform duration-200 ease-out hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,15,0,0.35)] hover:shadow-[0_25px_80px_-20px_rgba(255,15,0,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-400"
                  onClick={() => login()}
                >
                  Log in for future updates
                  <ArrowRight className="ml-3 h-6 w-6" />
                </Button>
              )}
            </div>
          </div>
          {/* Right: Swap container with provider tabs */}
          <div className="space-y-3">
            <NearSwapWidget tokens={tokens} loadingTokens={loadingTokens} />
          </div>
        </div>

        {/* End hero */}
      </div>

      {/* Animated Section Transition */}
      <motion.div
        className="w-full mt-6 md:mt-12 mb-12 md:my-16 overflow-hidden relative"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.3 }}
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1 }
        }}
      >
        <div className="relative h-px w-full mx-auto max-w-3xl">
          <motion.div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to right, transparent, #EAB308, #FF0F00, transparent)',
              height: '2px'
            }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: false }}
            transition={{ duration: 1, ease: "easeInOut" }}
          />

          {[...Array(3)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
              style={{
                background: i % 2 === 0
                  ? 'linear-gradient(135deg, #EAB308, #FF0F00)'
                  : 'linear-gradient(135deg, #FF0F00, #EAB308)',
                left: '50%',
                transform: 'translateX(-50%) translateY(-50%)'
              }}
              animate={{
                y: [0, -15, 0],
                opacity: [0.4, 1, 0.4],
                scale: [1, 1.2, 1]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.3
              }}
            />
          ))}
        </div>
      </motion.div>

      <div className="max-w-7xl mx-auto px-4 pb-12 relative z-10">


        {/* Live Analytics (Dune) */}
        <motion.div
          id="stats-section"
          className="rounded-3xl p-6 md:p-8 mt-12 md:mt-24 mb-12 md:mb-24"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.3 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8"
            initial="hidden"
            whileInView="visible"
            exit="hidden"
            viewport={{ once: false }}
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: {
                  staggerChildren: 0.15
                }
              }
            }}
          >
            <motion.div
              className="group relative overflow-hidden rounded-2xl p-5 shadow-lg hover:shadow-2xl transition-shadow"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 }
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="absolute -inset-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ background: 'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(234,179,8,0.08), transparent 40%)' }} />
              <div className="text-lg text-black  font-semibold tracking-wider text-center">Total Volume (All time)</div>
              <div className="text-3xl md:text-4xl font-extrabold mt-1 text-center" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {loadingDune ? "…" : dune?.totalVolumeUSD != null ? `$${dune.totalVolumeUSD.toLocaleString()}` : "—"}
              </div>
            </motion.div>

            <motion.div
              className="group relative overflow-hidden rounded-2xl p-5 shadow-lg hover:shadow-2xl transition-shadow"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 }
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="absolute -inset-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ background: 'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(255,15,0,0.08), transparent 40%)' }} />
              <div className="text-lg text-black  font-semibold tracking-wider text-center">Total Swaps</div>
              <div className="text-3xl md:text-4xl font-extrabold mt-1 text-center" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {loadingDune ? "…" : dune?.totalSwaps != null ? dune.totalSwaps.toLocaleString() : "—"}
              </div>
            </motion.div>

            <motion.div
              className="group relative overflow-hidden rounded-2xl p-5 shadow-lg hover:shadow-2xl transition-shadow"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 }
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="absolute -inset-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ background: 'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(234,179,8,0.08), transparent 40%)' }} />
              <div className="text-lg text-black  font-semibold tracking-wider text-center">Unique Users (7D)</div>
              <div className="text-3xl md:text-4xl font-extrabold mt-1 text-center" style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {loadingDune ? "…" : dune?.uniqueUsers7d != null ? dune.uniqueUsers7d.toLocaleString() : "—"}
              </div>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Simple 3‑step intro */}
        <div className="text-center mt-12 md:mt-24 mb-12 md:mb-24">
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight">
            <span style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Swap across chains in 3 simple steps
            </span>
          </h2>
          <p className="mt-2 text-base md:text-lg text-gray-600 max-w-3xl mx-auto">
            Loofta lets you move tokens between chains — fast and easy. We handle the tech behind the scenes (powered by NEAR Intents).
          </p>
          {/* FR summary removed for now */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-12 text-left max-w-6xl mx-auto">
            <div className="rounded-xl p-6 bg-white shadow-md hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFE8B0, #FFD0B3)' }}>
                  <ArrowLeftRight className="h-5 w-5 text-orange-700" />
                </div>
                <div className="text-base font-semibold text-gray-900">1) Select tokens</div>
              </div>
              <div className="text-base md:text-lg text-gray-600">
                Choose the token you want to send and the token you want to receive. Enter an amount to preview your output.
              </div>
            </div>
            <div className="rounded-xl p-6 bg-white shadow-md hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FFD1C4, #FFB3B3)' }}>
                  <Send className="h-5 w-5 text-red-700" />
                </div>
                <div className="text-base font-semibold text-gray-900">2) Send</div>
              </div>
              <div className="text-base md:text-lg text-gray-600">
                We generate a one-time deposit address (and memo if required). Send your funds — no wallet connection needed.
              </div>
            </div>
            <div className="rounded-xl p-6 bg-white shadow-md hover:shadow-lg transition-shadow">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #D1FAE5, #BBF7D0)' }}>
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                </div>
                <div className="text-base font-semibold text-gray-900">3) Receive</div>
              </div>
              <div className="text-base md:text-lg  text-gray-600">
                We route your swap and deliver the output to your recipient on the target chain.
              </div>
            </div>
          </div>
        </div>

        {/* Accordion FAQ (EN only) */}
        <div className="mt-12 md:mt-24">
          <h3 className="text-xl md:text-2xl text-center font-bold mb-4">FAQ — Cross‑chain swap</h3>
          <FAQAccordion
            items={[
              {
                question: "What is a cross‑chain swap?",
                answer:
                  "A cross‑chain swap lets you send one token on a source network and receive another token on a different network, in one flow.",
              },
              {
                question: "Is a wallet connection required?",
                answer:
                  "No. We generate a one‑time deposit address. Send funds manually and we route them to your recipient.",
              },
              {
                question: "What happens if the swap fails?",
                answer:
                  "If it cannot complete in time, we automatically refund to your original address.",
              },
            ]}
          />
          {/* FAQ JSON-LD */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: [
                  {
                    "@type": "Question",
                    name: "What is a cross‑chain swap?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text:
                        "A cross‑chain swap lets you send one token on a source network and receive another token on a different network, in one flow.",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "Is a wallet connection required?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text:
                        "No. We generate a one‑time deposit address. Send funds manually and we route them to your recipient.",
                    },
                  },
                  {
                    "@type": "Question",
                    name: "What happens if the swap fails?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text:
                        "If it cannot complete in time, we automatically refund to your original address.",
                    },
                  },
                ],
              }),
            }}
          />
        </div>


        {/* Top Traded Tokens Cloud */}
        <div className="mt-12 md:mt-24 mb-12 md:mb-24">
          <h3 className="text-center mt-8text-2xl md:text-4xl font-bold tracking-tight mb-8">
            <span style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Top Traded Tokens
            </span>
          </h3>
          <div className="flex flex-wrap justify-center gap-3">
            {(dune?.topAssetsByVolume || []).slice(0, 5).map((a) => {
              const src = cmcLogoForSymbol(a.symbol) || "/images/eth.png";
              return (
                <div
                  key={a.key}
                  className="inline-flex items-center gap-2 rounded-full bg-white shadow-md px-3 py-2 hover:shadow-lg transition-shadow"
                >
                  <Image
                    src={src}
                    alt={`${a.symbol} logo`}
                    width={20}
                    height={20}
                    sizes="20px"
                    unoptimized={/^https?:\/\//.test(src)}
                    className="rounded-full"
                  />
                  <span className="text-sm font-semibold text-gray-900">{a.symbol}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>



      {/* Animated Section Transition */}
      <motion.div
        className="w-full mt-0 mb-12 md:my-16 overflow-hidden relative"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: false, amount: 0.3 }}
        variants={{
          hidden: { opacity: 0 },
          visible: { opacity: 1 }
        }}
      >
        <div className="relative h-px w-full mx-auto max-w-3xl">
          <motion.div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(to right, transparent, #EAB308, #FF0F00, transparent)',
              height: '2px'
            }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: false }}
            transition={{ duration: 1, ease: "easeInOut" }}
          />

          {[...Array(3)].map((_, i) => (
            <motion.div
              key={i}
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
              style={{
                background: i % 2 === 0
                  ? 'linear-gradient(135deg, #EAB308, #FF0F00)'
                  : 'linear-gradient(135deg, #FF0F00, #EAB308)',
                left: '50%',
                transform: 'translateX(-50%) translateY(-50%)'
              }}
              animate={{
                y: [0, -15, 0],
                opacity: [0.4, 1, 0.4],
                scale: [1, 1.2, 1]
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.3
              }}
            />
          ))}
        </div>
      </motion.div>

      {/* CTA after Case Studies */}
      <motion.div
        className="max-w-7xl mx-auto px-4 pb-12 relative z-10"
        initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: 'easeOut' }}
      >
        <div
          className="rounded-3xl p-8 md:p-12 text-center border border-orange-200"
          style={{ background: 'linear-gradient(90deg, rgba(234,179,8,0.08), rgba(255,15,0,0.08))' }}
        >
          <h3
            className="text-2xl md:text-4xl font-bold mb-3"
            style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
          >
            Swap across chains with ease.
          </h3>
          <p className="text-sm md:text-base text-gray-600 mb-5"> Questions or issues? Contact us and we’ll take care of you.</p>
          <div className="inline-block relative group">
            <div className="absolute -inset-3 rounded-2xl bg-gradient-to-r from-orange-400/35 via-orange-500/30 to-red-500/35 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
            <Button
              style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
              className="relative z-10 px-8 py-4 text-base md:text-lg text-white font-semibold rounded-2xl border-0 transition-transform duration-200 ease-out hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,15,0,0.35)] hover:shadow-[0_25px_80px_-20px_rgba(255,15,0,0.55)]"
              onClick={() => window.open('https://t.me/looftaxyz', '_blank', 'noopener,noreferrer')}
            >
              Contact us
            </Button>
          </div>
        </div>
      </motion.div>


      {/* Social Links - Footer */}
      <div className="mt-12 pb-6 text-center">
        <div className="flex items-center justify-center gap-8">
          <a
            href="https://x.com/looftaxyz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-orange-600 transition-colors text-sm font-medium"
          >
            Twitter (X)
          </a>
          <a
            href="https://t.me/looftaxyz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-orange-600 transition-colors text-sm font-medium"
          >
            Telegram
          </a>
          <a
            href="https://medium.com/@looftaxyz"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-orange-600 transition-colors text-sm font-medium"
          >
            Medium
          </a>
        </div>
      </div>

      {/* CSS Animations */}
      <style jsx global>{`
        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 1s ease-out;
        }

        .animate-slide-up {
          animation: slide-up 1s ease-out;
        }

        .delay-700 { animation-delay: 0.7s; }
        .delay-1000 { animation-delay: 1s; }

        /* Clamp tweet text inside react-tweet */
        .tweet-truncate-150 { font-size: 0.875rem; line-height: 1.35; }
        .tweet-truncate-150 .react-tweet-text,
        .tweet-truncate-150 [data-testid="tweet-text"],
        .tweet-truncate-150 p {
          display: -webkit-box;
          -webkit-line-clamp: 5;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tweet-truncate-150 p, .tweet-truncate-150 span, .tweet-truncate-150 a { font-size: 0.875rem !important; line-height: 1.35 !important; }
      `}</style>
    </div>
  );
}


