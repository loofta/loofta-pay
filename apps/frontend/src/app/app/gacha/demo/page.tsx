"use client";

// Gacha demo — pure UI walkthrough, zero backend calls. Simulates the whole lobby -> open ->
// ready check -> 3D rip -> bid -> settle -> claim lifecycle entirely in local state with timers,
// using the exact same components as the real /app/gacha/[roomId] page (GachaPack3D, GachaCard),
// so this is genuinely useful for reviewing the UI/UX without a Collectorcrypt key, a database,
// or any real money moving. Nothing here ever touches /api/gacha/* — see the real room page for
// the version wired to the backend.
//
// The lobby fills slowly and randomly (1.5-4s per seat) rather than instantly, so the "waiting
// for players" moment actually reads as other people trickling in rather than a flash-cut. The
// ready check simulates the other seats (bots) marking themselves ready on their own staggered
// timers, same as the real room's participants would — only the real seat (you) requires an
// actual click, matching the real page's "no click to open, only to mark ready" flow.

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import GachaPack from "@/components/GachaPack";
import GachaCard from "@/components/GachaCard";
import PokerTable from "@/components/PokerTable";
import type { GachaOpenResult, GachaRarity } from "@/components/GachaPack3D";

const GachaPack3D = dynamic(() => import("@/components/GachaPack3D"), { ssr: false });

type DemoStatus = "waiting" | "purchasing" | "opening" | "readying" | "bidding" | "settling" | "settled";

const SEATS = 5;
const ENTRY_USDC = 10;
const RARITIES: Array<{ rarity: GachaRarity; buybackUsdc: number; name: string }> = [
  { rarity: "common", buybackUsdc: 8, name: "Common Card" },
  { rarity: "uncommon", buybackUsdc: 20, name: "Uncommon Card" },
  { rarity: "rare", buybackUsdc: 60, name: "Rare Card" },
  { rarity: "epic", buybackUsdc: 150, name: "Epic Card" },
];
const BID_WINDOW_S = 60;
const PAY_WINDOW_S = 20;
const MIN_SEAT_DELAY_MS = 1500;
const MAX_SEAT_DELAY_MS = 4000;
const BOT_NAMES = ["Nova", "Ziggy", "Marlowe", "Kip", "Sable", "Orion", "Finch", "Remy"];

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

  // Ready check — real seat needs a real click; bot seats ready up on their own staggered timers.
  const [iAmReady, setIAmReady] = useState(false);
  const [botsReady, setBotsReady] = useState(0);
  const [autoOpen, setAutoOpen] = useState(false);
  const [revealedCard, setRevealedCard] = useState<GachaOpenResult | null>(null);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const after = (ms: number, fn: () => void) => { const t = setTimeout(fn, ms); timers.current.push(t); };
  useEffect(() => clearTimers, []);

  const reset = () => {
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
    setIAmReady(false);
    setBotsReady(0);
    setAutoOpen(false);
    setRevealedCard(null);
  };

  // Lobby: other demo players trickle in slowly, at random intervals — not instantly.
  useEffect(() => {
    if (status !== "waiting") return;
    if (seatsFilled >= SEATS) {
      setStatus("purchasing");
      after(1200, () => setStatus("opening"));
      after(2600, () => {
        const picked = RARITIES[Math.floor(Math.random() * RARITIES.length)];
        setRarity(picked);
        setBestBid(picked.buybackUsdc);
        setStatus("readying");
      });
      return;
    }
    after(MIN_SEAT_DELAY_MS + Math.random() * (MAX_SEAT_DELAY_MS - MIN_SEAT_DELAY_MS), () => setSeatsFilled((n) => Math.min(SEATS, n + 1)));
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, seatsFilled]);

  // Ready check: the other (SEATS - 1) bot seats ready up on their own staggered timers.
  useEffect(() => {
    if (status !== "readying") return;
    const otherSeats = SEATS - 1;
    const botTimers = Array.from({ length: otherSeats }, (_, i) =>
      setTimeout(() => setBotsReady((n) => n + 1), 800 + i * (600 + Math.random() * 900)),
    );
    return () => botTimers.forEach(clearTimeout);
  }, [status]);

  useEffect(() => {
    if (status === "readying" && iAmReady && botsReady >= SEATS - 1) setAutoOpen(true);
  }, [status, iAmReady, botsReady]);

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

  const handleBid = () => {
    const amount = parseFloat(bidInput);
    const floor = bestBid ?? rarity?.buybackUsdc ?? 0;
    if (!Number.isFinite(amount) || amount <= floor) return;
    setBestBid(amount);
    setIWon(true);
    setBidInput("");
  };

  const handlePay = () => setStatus("settled");
  const handleClaim = () => after(500, () => setClaimed(true));

  const payoutUsdc = useMemo(() => (bestBid ? bestBid / SEATS : 0), [bestBid]);

  const [myEmoji, setMyEmoji] = useState<string | null>(null);
  const participants = useMemo(
    () => Array.from({ length: seatsFilled }, (_, i) => ({
      seatNumber: i + 1,
      username: i === 0 ? "You" : BOT_NAMES[(i - 1) % BOT_NAMES.length],
      isMe: i === 0,
      emoji: i === 0 ? myEmoji ?? undefined : undefined,
    })),
    [seatsFilled, myEmoji],
  );

  const statusCaption = useMemo(() => {
    switch (status) {
      case "waiting": return `Waiting for ${SEATS - seatsFilled} more player${SEATS - seatsFilled === 1 ? "" : "s"}…`;
      case "purchasing": return "Buying the pack…";
      case "opening": return "Opening the pack…";
      case "readying": return autoOpen ? "Everyone's ready…" : "Waiting for everyone to be ready…";
      case "bidding": return "Bidding is open";
      case "settling": return "Settling…";
      case "settled": return "Settled";
      default: return status;
    }
  }, [status, seatsFilled, autoOpen]);

  const show3D = status === "opening" || status === "readying";

  return (
    <div className="relative w-full min-h-[calc(100vh-var(--header-h,0px))] bg-[#111114] text-slate-100">
      <div className="max-w-2xl mx-auto px-5 pt-6 pb-16">
        <div className="flex items-center justify-between mb-6">
          <Link href="/app/gacha" className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-base">
            <ChevronLeft className="w-4 h-4" /> Rooms
          </Link>
          <span className="text-slate-400 text-base">{seatsFilled}/{SEATS} players · ${ENTRY_USDC.toFixed(2)} each</span>
        </div>

        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-full -mb-4 relative z-10">
            <PokerTable seats={SEATS} participants={participants} onPickEmoji={setMyEmoji} />
          </div>

          {status === "waiting" ? (
            <GachaPack width={180} />
          ) : show3D ? (
            <div className="w-full h-[380px] rounded-2xl overflow-hidden border border-white/10">
              <GachaPack3D
                autoOpen={autoOpen}
                resolveOpen={() => new Promise<GachaOpenResult>((resolve) => {
                  // Demo has no server round trip — the rarity is already known locally the
                  // instant the pack "opens," same shape as the real page's waitForReveal.
                  const check = () => (rarity ? resolve({ nftMetadata: { name: rarity.name }, rarity: rarity.rarity }) : setTimeout(check, 200));
                  check();
                })}
                onOpened={(result) => { setRevealedCard(result); setStatus("bidding"); }}
                idleSubtitle={autoOpen ? statusCaption : "Waiting for everyone to be ready…"}
                openingLabel={statusCaption}
              />
            </div>
          ) : revealedCard ? (
            <GachaCard width={220} card={{ name: revealedCard.nftMetadata?.name ?? "Mystery Card", rarity: revealedCard.rarity }} />
          ) : (
            <GachaPack width={180} face="back" />
          )}
          {rarity && !show3D && (
            <span className={`text-sm font-semibold uppercase tracking-wide px-3 py-1 rounded-full border ${RARITY_STYLE[rarity.rarity]}`}>
              {rarity.rarity}
            </span>
          )}
          {!show3D && <p className="text-slate-300 text-base font-medium">{statusCaption}</p>}
        </div>

        {status === "readying" && !autoOpen && (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center space-y-3">
            {iAmReady ? (
              <p className="text-slate-300 text-base">Waiting for everyone to be ready — {1 + botsReady}/{SEATS} ready.</p>
            ) : (
              <>
                <p className="text-slate-300 text-base">Everyone marks ready, then the pack opens for the whole room at once.</p>
                <button
                  type="button"
                  onClick={() => setIAmReady(true)}
                  className="w-full h-11 rounded-full bg-amber-500/25 border border-amber-400/40 text-amber-100 font-semibold hover:bg-amber-500/40 transition-colors"
                >
                  I&apos;m ready
                </button>
              </>
            )}
          </div>
        )}

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
