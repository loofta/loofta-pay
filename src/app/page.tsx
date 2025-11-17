'use client'

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Tweet } from "react-tweet";
import { Button } from "@/components/ui/button";
import { ArrowRight } from 'lucide-react';
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "@/components/ui/select";

type TokenSymbol = "USDT" | "USDC" | "ETH" | "SOL";
const TOKENS: TokenSymbol[] = ["USDT", "USDC", "ETH", "SOL"];

export default function Home() {
  // Swap state
  const [fromToken, setFromToken] = useState<TokenSymbol>("USDT");
  const [toToken, setToToken] = useState<TokenSymbol>("ETH");
  const [amount, setAmount] = useState<string>("");
  const rate = useMemo(() => {
    if (!amount) return "";
    const base = fromToken === "ETH" ? 3500 : fromToken === "SOL" ? 150 : 1;
    const target = toToken === "ETH" ? 1 / 3500 : toToken === "SOL" ? 1 / 150 : 1;
    const est = Number(amount || 0) * base * target;
    if (!isFinite(est)) return "";
    return est.toFixed(6);
  }, [amount, fromToken, toToken]);
  const swapDisabled = !amount || fromToken === toToken;
  function flip() {
    setFromToken(toToken);
    setToToken(fromToken);
  }
  function onSwap() {
    // placeholder: implement real swap later
  }

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

  // Static stats (previously fetched)
  const displayedStats = { activeUsers: 1200, questsCompleted: 3400, communities: 200 };

  // Quick boost demo state (kept as before)
  const budgetStops = [20, 50, 100, 200, 300, 500, 1000];
  const [budgetIndex, setBudgetIndex] = useState<number>(0);
  const budget = budgetStops[budgetIndex];
  const [postUrl, setPostUrl] = useState<string>("");

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-orange-100/50 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-red-100/50 rounded-full blur-3xl animate-pulse delay-700"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-orange-50/50 rounded-full blur-3xl animate-pulse delay-1000"></div>
      </div>

      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-8 relative z-10">
        <div className="flex justify-between items-center animate-fade-in">
          {/* Logo */}
          <div className="relative inline-block">
            <Image
              src="/loofta.svg"
              alt="Loofta"
              width={120}
              height={44}
            />
            <span
              className="absolute -top-2 -right-4 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            >
              swap
            </span>
          </div>

          {/* CTA Button (no auth) */}
          <Button
            className="bg-gray-900 hover:bg-gray-800 text-white font-semibold px-6 py-2.5 rounded-xl transition-all duration-300 hover:scale-105 shadow-lg"
            onClick={() => { }}
          >
            Get Started
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-12 relative z-10">
        {/* Hero Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12 mb-8 md:mb-12 mt-4 md:mt-6 items-start">
          <div className="space-y-4 md:space-y-6 animate-slide-up text-left">
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight px-4">
              <span className="inline-flex gap-0.5">
                {'Swap'.split('').map((letter, index) => (
                  <motion.span
                    key={`swap-${index}`}
                    className="inline-block"
                    initial={{ opacity: 0, y: -20, scale: 0.5 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                      delay: index * 0.1,
                      type: "spring",
                      stiffness: 300,
                      damping: 20
                    }}
                    whileHover={{
                      scale: 1.2,
                      transition: { type: "spring", stiffness: 400 }
                    }}
                    style={{
                      background: 'linear-gradient(to right, #EAB308, #FF0F00)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    {letter}
                  </motion.span>
                ))}
              </span>{' '}
              <span className="text-gray-900">across chains.<br /></span>
              <span className="inline-flex gap-0.5">
                {'Earn'.split('').map((letter, index) => (
                  <motion.span
                    key={`points-${index}`}
                    className="inline-block"
                    initial={{ opacity: 0, y: -20, scale: 0.5 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{
                      delay: index * 0.1 + 0.6,
                      type: "spring",
                      stiffness: 300,
                      damping: 20
                    }}
                    whileHover={{
                      scale: 1.2,
                      transition: { type: "spring", stiffness: 400 }
                    }}
                    style={{
                      background: 'linear-gradient(to right, #EAB308, #FF0F00)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      backgroundClip: 'text',
                    }}
                  >
                    {letter}
                  </motion.span>
                ))}
              </span>
              <span className="text-gray-900"> Points.</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-3xl px-4">
              Bring your friends. Simple swaps. Cute rewards.
            </p>

            <div className="relative inline-block group">
              <div className="absolute -inset-3 rounded-3xl bg-gradient-to-r from-orange-400/35 via-orange-500/30 to-red-500/35 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"></div>
              <Button
                style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                className="relative z-10 mt-4 px-10   py-6 text-lg md:text-xl text-white font-semibold rounded-2xl border-0 transition-transform duration-200 ease-out hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,15,0,0.35)] hover:shadow-[0_25px_80px_-20px_rgba(255,15,0,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-400"
                onClick={() => { }}
              >
                Get Started Now
                <ArrowRight className="ml-3 h-6 w-6" />
              </Button>
            </div>
          </div>
          {/* Right: Swap widget */}
          <motion.div
            className="group relative bg-white rounded-3xl p-6 cursor-pointer overflow-hidden shadow-md"
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, type: "spring", stiffness: 100 }}
            whileHover={{
              y: -8,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              transition: { duration: 0.2, ease: "easeOut" }
            }}
            viewport={{ once: true }}
          >
            <div className="mb-4">
              <h3 className="text-2xl font-extrabold text-gray-900 mb-2 tracking-tight">Swap</h3>
              <p className="text-gray-800 font-semibold text-base">Convert tokens instantly</p>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-xs text-gray-600 mb-1">From</div>
                <div className="flex gap-2">
                  <div className="w-28">
                    <Select value={fromToken} onValueChange={(v) => setFromToken(v as TokenSymbol)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Token" />
                      </SelectTrigger>
                      <SelectContent>
                        {TOKENS.map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    inputMode="decimal"
                    placeholder="0.0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-600">
                <button className="text-gray-700 underline decoration-orange-400 underline-offset-4" onClick={flip}>
                  Flip pair
                </button>
                <div>Est. output</div>
              </div>

              <div>
                <div className="text-xs text-gray-600 mb-1">To</div>
                <div className="flex gap-2">
                  <div className="w-28">
                    <Select value={toToken} onValueChange={(v) => setToToken(v as TokenSymbol)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Token" />
                      </SelectTrigger>
                      <SelectContent>
                        {TOKENS.map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input value={rate} readOnly placeholder="0.0" />
                </div>
              </div>

              <Button
                onClick={onSwap}
                disabled={swapDisabled}
                className="w-full mt-2 text-white font-semibold rounded-xl border-0"
                style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
              >
                Swap
              </Button>
            </div>
          </motion.div>
        </div>

        {/* End hero */}
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

      <div className="max-w-7xl mx-auto px-4 pb-12 relative z-10">
        {/* Stats Intro */}
        <div className="text-center mb-6 md:mb-8">
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight">
            <span style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              The easiest way to run authentic creator campaigns.
            </span>
          </h2>
          <p className="mt-2 text-sm md:text-base text-gray-600">
            Every creator is verified. Every campaign is genuine. Every result matters.
          </p>
        </div>

        {/* Stats Section */}
        <motion.div
          id="stats-section"
          className="border border-orange-200 rounded-3xl p-6 md:p-8 mt-12 md:mt-16 mb-16 md:mb-20"
          style={{ background: 'linear-gradient(to right, rgba(234, 179, 8, 0.05), rgba(255, 15, 0, 0.05), rgba(234, 179, 8, 0.05))' }}
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.3 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          <motion.div
            className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 text-center"
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
              className="space-y-2"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 }
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="text-4xl md:text-5xl font-bold" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {displayedStats.activeUsers.toLocaleString()}+
              </div>
              <div className="text-gray-600 text-lg font-medium">Active Creators</div>
            </motion.div>

            <motion.div
              className="space-y-2"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 }
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="text-4xl md:text-5xl font-bold" style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {displayedStats.questsCompleted.toLocaleString()}+
              </div>
              <div className="text-gray-600 text-lg font-medium">Deals Completed</div>
            </motion.div>

            <motion.div
              className="space-y-2"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: { opacity: 1, y: 0 }
              }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <div className="text-4xl md:text-5xl font-bold" style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                {displayedStats.communities.toLocaleString()}+
              </div>
              <div className="text-gray-600 text-lg font-medium">Campaigns</div>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>

      {/* Case Studies */}
      <div className="max-w-7xl mx-auto px-4 pb-12 mb-12 relative z-10">
        <div className="mb-6 md:mb-8 text-center">
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight">
            <span style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Case Studies
            </span>
          </h2>
          <p className="mt-2 text-base md:text-lg text-gray-600 mb-8">
            Real campaigns. Real metrics. See how we've helped our clients grow with verified creators.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {[
            {
              name: 'Internet Token',
              logo: '/clients/int.png',
              tweetId: '1958574225494876433',
              metrics: { budget: 500, impressions: 67398, likes: 2668, engagementRate: 6.21, followers: 145 }
            },
            {
              name: 'Conft',
              logo: '/clients/conft.svg',
              tweetId: '1956337393511907652',
              metrics: { budget: 500, impressions: 84938, likes: 1789, engagementRate: 3.03, followers: 250 }
            },
            {
              name: 'Coinomi Wallet',
              logo: '/clients/coinomi.png',
              tweetId: '1965079046384972168',
              metrics: { budget: 250, impressions: 52214, likes: 1204, engagementRate: 2.31, followers: 98 }
            },
          ].map((c, idx) => (
            <motion.div
              key={c.name}
              className="group relative bg-white rounded-3xl p-6 cursor-pointer overflow-hidden shadow-md"
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              whileHover={{ y: -8, boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)", transition: { duration: 0.2, ease: "easeOut" } }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.5, delay: idx * 0.08, ease: 'easeOut' }}
            >
              <div className="flex items-center gap-3" >
                <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-50 ring-1 ring-gray-200 flex items-center justify-center">
                  <Image src={c.logo} alt={`${c.name} logo`} width={24} height={24} />
                </div>
                <div className="text-xl font-bold text-gray-900">{c.name}</div>
              </div>

              <div className="mt-4 text-xs font-semibold tracking-wider text-gray-500">
                PERFORMANCE
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-500 font-medium">Budget</div>
                  <div className="text-xl md:text-2xl font-extrabold text-gray-900">${c.metrics.budget.toLocaleString()}</div>
                </div>

                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-500 font-medium">Total Impressions</div>
                  <div className="text-xl md:text-2xl font-extrabold" style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                    {c.metrics.impressions.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-500 font-medium">Total Likes</div>
                  <div className="text-xl md:text-2xl font-extrabold text-gray-900">{c.metrics.likes.toLocaleString()}</div>
                </div>
                <div className="rounded-xl border border-gray-200 p-4">
                  <div className="text-xs text-gray-500 font-medium">New Followers</div>
                  <div className="text-xl md:text-2xl font-extrabold text-gray-900">{c.metrics.followers.toLocaleString()}</div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl overflow-hidden tweet-truncate-150">
                <Tweet id={c.tweetId} />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Quick Boost Section */}
      <motion.div
        className="max-w-7xl mx-auto px-4 pb-12 mt-12 mb-12 relative z-10"
        initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.6, ease: 'easeOut' }}
      >
        <div className="mb-6 md:mb-8 text-center">
          <h2 className="text-2xl md:text-4xl font-bold tracking-tight">
            <span style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              Quickly Boost Engagement on a Post
            </span>
          </h2>
          <p className="mt-2 text-base md:text-lg text-gray-600">For individuals or project want to boost engagement fast</p>
        </div>

        <div className="rounded-3xl bg-white p-6 md:p-8 shadow-md">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-1 md:pr-6 md:border-r md:border-gray-200">
              <div className="space-y-3">
                <div className="text-lg font-semibold tracking-wide text-gray-700">How it works</div>
                <p className="text-base text-gray-700">
                  We run a targeted giveaway with Loofta‑verified creators. To enter, users must engage with your post — like, comment, bookmark, or retweet/quote. Our team selects the right creators and monitors results.
                </p>
                <ul className="space-y-2 text-lg text-gray-700 boost-bullets">
                  <li>Go live fast with curated creators</li>
                  <li>Authentic audiences, no bots</li>
                  <li>Transparent tracking and reporting</li>
                </ul>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Input X Post URL</label>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <input
                    type="url"
                    value={postUrl}
                    onChange={(e) => setPostUrl(e.target.value)}
                    placeholder="https://x.com/yourURLtoQuote"
                    className="w-full rounded-xl border border-gray-200 bg-black/5 text-gray-900 placeholder-gray-500 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-orange-400"
                    inputMode="url"
                  />
                </div>
              </div>

              <div className="mt-6">
                <div className="text-lg font-semibold text-gray-900">What is your budget?</div>
                <div className="mt-4">
                  <input
                    type="range"
                    min={0}
                    max={budgetStops.length - 1}
                    step={1}
                    value={budgetIndex}
                    onChange={(e) => setBudgetIndex(Number(e.target.value))}
                    aria-label="Budget"
                    className="w-full boost-range"
                    style={{ ['--fill' as any]: `${(budgetIndex / (budgetStops.length - 1)) * 100}%` }}
                  />
                  <div className="flex justify-between text-xs text-gray-700 mt-2">
                    {budgetStops.map((v, i) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setBudgetIndex(i)}
                        className={`px-1 -mx-1 transition-colors ${i === budgetIndex ? 'font-bold' : 'opacity-80'}`}
                        style={i === budgetIndex ? { background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' } : {}}
                        aria-label={`Select budget $${v}`}
                      >
                        ${v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {(() => {
                const impressionsMin = Math.round(budget * 50);
                const impressionsMax = Math.round(budget * 120);
                return (
                  <div className="mt-6">
                    <div className="rounded-2xl bg-gradient-to-r from-orange-500/10 to-red-500/10 border border-orange-200/50 p-4">
                      <div className="text-sm font-semibold text-gray-800">Estimated Impressions</div>
                      <div className="mt-1 text-xl font-extrabold" style={{ background: 'linear-gradient(to right, #FF0F00, #EAB308)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                        {impressionsMin.toLocaleString()} - {impressionsMax.toLocaleString()} views
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="mt-6 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Larger budget? <a href="mailto:hello@loofta.xyz" className="underline decoration-orange-400 underline-offset-4 hover:text-gray-900">Contact us</a>
                </div>
                <Button
                  style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
                  className="px-6 py-3 text-white font-semibold rounded-xl border-0 shadow-md transition-transform duration-200 ease-out hover:scale-[1.02] active:scale-95"
                  onClick={() => { }}
                >
                  Launch Boost
                </Button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Other Clients */}
      <div className="max-w-7xl mx-auto px-4 pb-12 relative z-20">
        <motion.h3
          className="text-2xl md:text-3xl font-bold text-black text-center mb-4"
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          We helped these projects grow with verified creators
        </motion.h3>
        <div
          className="rounded-3xl p-6 md:p-8 border border-transparent"
          style={{ background: 'linear-gradient(90deg, rgba(255,15,0,0.15), rgba(234,179,8,0.15))' }}
        >
          <div className="flex flex-wrap items-center justify-between px-24 gap-x-10 gap-y-8">
            {[
              { name: 'Taraxa', logo: '/clients/taraxa.svg', url: 'https://x.com/looftaxyz/status/1965858670404829305' },
              { name: 'TrendMoon', logo: '/clients/trendmoon.svg', url: 'https://x.com/looftaxyz/status/1920170053548286194' },
              { name: 'World of Dypians', logo: '/clients/wod.svg', url: 'https://x.com/looftaxyz/status/1980322274873078134' },
              { name: 'ChainGPT', logo: '/clients/chaingpt.svg', url: 'https://x.com/looftaxyz/status/1988898355976573313' },
            ].map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => handleLogoClick((c as any).tweetId, (c as any).url)}
                className="group relative flex basis-1/2 sm:basis-1/3 md:basis-1/4 lg:basis-1/6 items-center justify-center rounded-2xl px-4 py-3 transition-transform duration-200 hover:scale-[1.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                aria-label={`View ${c.name} tweet`}
              >
                <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  style={{ background: 'linear-gradient(90deg, rgba(255,15,0,0.9), rgba(234,179,8,0.9))' }}
                />
                <div
                  aria-label={c.name}
                  className="relative z-10 h-6 md:h-8 w-[140px] bg-black transition-colors duration-200 group-hover:bg-white"
                  style={{
                    WebkitMaskImage: `url(${c.logo})`,
                    maskImage: `url(${c.logo})`,
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskSize: 'contain',
                    maskSize: 'contain',
                    WebkitMaskPosition: 'center',
                    maskPosition: 'center'
                  }}
                />
              </button>
            ))}
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
            Ready to launch your next campaign?
          </h3>
          <p className="text-sm md:text-base text-gray-600 mb-5">Work with verified creators and track outcomes that matter.</p>
          <div className="inline-block relative group">
            <div className="absolute -inset-3 rounded-2xl bg-gradient-to-r from-orange-400/35 via-orange-500/30 to-red-500/35 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
            <Button
              style={{ background: 'linear-gradient(to right, #EAB308, #FF0F00)' }}
              className="relative z-10 px-8 py-4 text-base md:text-lg text-white font-semibold rounded-2xl border-0 transition-transform duration-200 ease-out hover:scale-[1.03] active:scale-95 shadow-[0_20px_60px_-15px_rgba(255,15,0,0.35)] hover:shadow-[0_25px_80px_-20px_rgba(255,15,0,0.55)]"
              onClick={() => { }}
            >
              Launch your campaign
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Tweet Modal */}
      <AnimatePresence>
        {openTweetId && (
          <>
            <motion.div
              className="fixed inset-0 z-[60] bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpenTweetId(null)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              className="fixed inset-0 z-[61] flex items-center justify-center p-4"
              initial={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.98, y: prefersReducedMotion ? 0 : 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: prefersReducedMotion ? 1 : 0.98, y: prefersReducedMotion ? 0 : 8 }}
              transition={{ type: 'spring', stiffness: 200, damping: 24 }}
            >
              <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl border border-gray-200 overflow-hidden">
                <div className="p-3 border-b border-gray-200 flex items-center justify-between">
                  <div className="text-sm font-semibold text-gray-800">Tweet Preview</div>
                  <button
                    onClick={() => setOpenTweetId(null)}
                    className="rounded-md px-2 py-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-3">
                  <Tweet id={openTweetId!} />
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

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


