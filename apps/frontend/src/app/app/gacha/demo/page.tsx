"use client";

// Gacha demo — pure UI walkthrough, zero backend calls. Simulates the whole lobby -> open ->
// bid -> settle -> claim lifecycle entirely in local state with timers, using the exact same
// visual states as the real /app/gacha/[roomId] page, so this is genuinely useful for reviewing
// the UI/UX without a Collectorcrypt key, a database, or any real money moving. Nothing here
// ever touches /api/gacha/* — see the real room page for the version wired to the backend.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import GachaPack from "@/components/GachaPack";

type DemoStatus = "waiting" | "purchasing" | "opening" | "bidding" | "settling" | "settled";

const SEATS = 5;
const ENTRY_USDC = 10;
const RARITIES: Array<{ rarity: "common" | "uncommon" | "rare" | "epic"; buybackUsdc: number }> = [
  { rarity: "common", buybackUsdc: 8 },
  { rarity: "uncommon", buybackUsdc: 20 },
  { rarity: "rare", buybackUsdc: 60 },
  { rarity: "epic", buybackUsdc: 150 },
];
const BID_WINDOW_S = 20;
const PAY_WINDOW_S = 15;

const RARITY_STYLE: Record<string, string> = {
  common: "border-slate-500/30 bg-slate-500/10 text-slate-300",
  uncommon: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  rare: "border-purple-400/30 bg-purple-400/10 text-purple-300",
  epic: "border-amber-400/40 bg-amber-400/10 text-amber-300",
};

function formatCountdown(s: number): string {
  const clamped = Math.max(0, s);
  const m = Math.floor(clamped / 60);
  const sec = clamped % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function GachaDemoPage() {
  const [status, setStatus] = useState<DemoStatus>("waiting");
  const [seatsFilled, setSeatsFilled] = useState(1);
  const [rarity, setRarity] = useState<(typeof RARITIES)[number] | null>(null);
  const [bestBid, setBestBid] = useState<number | null>(null);
  const [iWon, setIWon] = useState(false);
  const [bidInput, setBidInput] = useState("");
  const [bidWindowLeft, setBidWindowLeft] = useState(BID_WINDOW_S);
  const [payWindowLeft, setPayWindowLeft] = useState(PAY_WINDOW_S);
  const [claimed, setClaimed] = useState(false);
  const [isPrivate, setIsPrivate] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const after = (ms: number, fn: () => void) => { const t = setTimeout(fn, ms); timers.current.push(t); };

  const reset = useCallback(() => {
    clearTimers();
    setStatus("waiting");
    setSeatsFilled(1);
    setRarity(null);
    setBestBid(null);
    setIWon(false);
    setBidInput("");
    setBidWindowLeft(BID_WINDOW_S);
    setPayWindowLeft(PAY_WINDOW_S);
    setClaimed(false);
  }, []);

  // Lobby: simulate other demo players trickling in.
  useEffect(() => {
    if (status !== "waiting") return;
    if (seatsFilled >= SEATS) {
      setStatus("purchasing");
      after(1200, () => setStatus("opening"));
      after(2600, () => {
        const picked = RARITIES[Math.floor(Math.random() * RARITIES.length)];
        setRarity(picked);
        setBestBid(picked.buybackUsdc);
        setStatus("bidding");
      });
      return;
    }
    after(700 + Math.random() * 600, () => setSeatsFilled((n) => Math.min(SEATS, n + 1)));
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, seatsFilled]);

  // Bidding countdown.
  useEffect(() => {
    if (status !== "bidding") return;
    if (bidWindowLeft <= 0) {
      if (iWon) {
        setStatus("settling");
        setPayWindowLeft(PAY_WINDOW_S);
      } else {
        setStatus("settled");
      }
      return;
    }
    const t = setTimeout(() => setBidWindowLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [status, bidWindowLeft, iWon]);

  // Pay-for-the-win countdown (only reached if the demo user placed the winning bid).
  useEffect(() => {
    if (status !== "settling") return;
    if (payWindowLeft <= 0) { setStatus("settled"); return; }
    const t = setTimeout(() => setPayWindowLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [status, payWindowLeft]);

  const handleBid = useCallback(() => {
    const amount = parseFloat(bidInput);
    const floor = bestBid ?? rarity?.buybackUsdc ?? 0;
    if (!Number.isFinite(amount) || amount <= floor) return;
    setBestBid(amount);
    setIWon(true);
    setBidInput("");
  }, [bidInput, bestBid, rarity]);

  const handlePay = useCallback(() => {
    setStatus("settled");
  }, []);

  const handleClaim = useCallback(() => {
    after(500, () => setClaimed(true));
  }, []);

  const payoutUsdc = useMemo(() => {
    if (!bestBid) return 0;
    return bestBid / SEATS;
  }, [bestBid]);

  const statusCaption = useMemo(() => {
    switch (status) {
      case "waiting": return `Waiting for ${SEATS - seatsFilled} more player${SEATS - seatsFilled === 1 ? "" : "s"}…`;
      case "purchasing": return "Buying the pack…";
      case "opening": return "Opening the pack…";
      case "bidding": return "Bidding is open";
      case "settling": return "Settling…";
      case "settled": return "Settled";
      default: return status;
    }
  }, [status, seatsFilled]);

  const revealed = status === "bidding" || status === "settling" || status === "settled";

  return (
    <div className="relative w-full min-h-[calc(100vh-var(--header-h,0px))] bg-[#111114] text-slate-100">
      <div className="max-w-2xl mx-auto px-5 pt-6 pb-16">
        <div className="flex items-center justify-between mb-6">
          <Link href="/app/gacha" className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-base">
            <ChevronLeft className="w-4 h-4" /> Rooms
          </Link>
          <span className="text-slate-400 text-base">{seatsFilled}/{SEATS} players · ${ENTRY_USDC.toFixed(2)} each</span>
        </div>

        <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-base text-amber-200">
          Demo mode — nothing here is real. No backend calls, no money, no other players.
        </div>

        <div className="flex flex-col items-center gap-4 mb-8">
          {revealed ? <GachaPack width={180} face="back" /> : <GachaPack width={180} />}
          {rarity && (
            <span className={`text-sm font-semibold uppercase tracking-wide px-3 py-1 rounded-full border ${RARITY_STYLE[rarity.rarity]}`}>
              {rarity.rarity}
            </span>
          )}
          <p className="text-slate-300 text-base font-medium">{statusCaption}</p>
        </div>

        {status === "bidding" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-base">Current best</p>
                <p className="text-2xl font-bold text-slate-100">${(bestBid ?? 0).toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-400 text-base">Time left</p>
                <p className="text-2xl font-bold text-slate-100 tabular-nums">{formatCountdown(bidWindowLeft)}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={bidInput}
                onChange={(e) => setBidInput(e.target.value)}
                placeholder={`> $${(bestBid ?? 0).toFixed(2)}`}
                className="flex-1 h-11 rounded-full bg-white/10 border border-white/10 px-4 text-base text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400/50"
              />
              <button
                type="button"
                onClick={handleBid}
                className="h-11 px-6 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors"
              >
                Bid
              </button>
            </div>
            <p className="text-slate-500 text-base">No bid? The card auto-sells back and everyone splits the buyback evenly.</p>
          </div>
        )}

        {status === "settling" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-3 text-center">
            <p className="text-slate-100 text-lg font-bold">You won the bid — ${(bestBid ?? 0).toFixed(2)}</p>
            <p className="text-slate-400 text-base">Pay within {formatCountdown(payWindowLeft)} to claim the card.</p>
            <button
              type="button"
              onClick={handlePay}
              className="w-full h-11 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors"
            >
              Pay ${(bestBid ?? 0).toFixed(2)}
            </button>
          </div>
        )}

        {status === "settled" && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
            {claimed ? (
              <p className="text-center text-slate-100 text-lg font-bold">Claimed{isPrivate ? " privately" : ""} — ${payoutUsdc.toFixed(2)}</p>
            ) : (
              <>
                <p className="text-center text-slate-100 text-lg font-bold">Your payout: ${payoutUsdc.toFixed(2)}</p>
                <div>
                  <p className="text-slate-400 text-base mb-2">Claim</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsPrivate(true)}
                      className={`flex-1 h-10 rounded-xl border text-base font-medium transition-colors ${isPrivate ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-400 hover:text-white"}`}
                    >
                      Private
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsPrivate(false)}
                      className={`flex-1 h-10 rounded-xl border text-base font-medium transition-colors ${!isPrivate ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-400 hover:text-white"}`}
                    >
                      Not private
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClaim}
                  className="w-full h-11 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors"
                >
                  Claim ${payoutUsdc.toFixed(2)}
                </button>
              </>
            )}
            <button type="button" onClick={reset} className="w-full h-10 rounded-full border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-base">
              Restart demo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
