"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { ArrowDown, X, Trophy, RefreshCw, Ticket, ShieldCheck, ArrowUpRight, Shuffle, MoreVertical, Plus, ChevronDown, Eraser, Gift, Copy, CheckCircle2, Mail, AtSign, Loader2, LogIn, VenetianMask, Send } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { getMyGifts, updateGiftRecipient, type MyGiftItem } from "@/services/api/lotteryGift";
import { MessageInput } from "@/components/MessageInput";
import { Label } from "@/components/ui/label";
import { DescriptionWithGif } from "@/components/DescriptionWithGif";
import { InsufficientBalanceCard } from "@/components/app/InsufficientBalanceCard";
import { useEmbeddedSolanaUsdcBalance } from "@/hooks/useEmbeddedSolanaUsdcBalance";
import { isInsufficientSolOrNoPriorCreditError, privatePayErrorMessageForUser } from "@/lib/privatePayUserError";
import { getSolanaCluster } from "@/lib/solanaCluster";
import { IncognitoModeToggle } from "@/components/IncognitoModeToggle";
import { PrivacyConfettiBurst } from "@/components/PrivacyConfettiBurst";
import { PRIZE_TIERS, TicketNumberCard } from "@/components/megapot/TicketNumberCard";
import { GradientActionButton } from "@/components/ui/GradientActionButton";

const MAGICBLOCK_GASLESS_RELAY_FEE_USD = 0.20; // flat relay fee MagicBlock charges in gasless mode
const MAGICBLOCK_BPS = 10;
// Loofta no longer charges a per-purchase service fee — the buyer pays only the ticket cost plus
// MagicBlock's own transfer fee (mbFee below); the Sol→Base bridge cost is absorbed by Loofta.
// The free-ticket threshold is owned and enforced by the backend (see WITHDRAW_MIN_USDC in
// lottery.service.ts); it's reported per-request as dashboard.withdrawMinUsdc and per-ticket as
// ticket.isFreeTicket. This is only a fallback for the brief window before the dashboard loads —
// the UI should prefer the backend values.
const DEFAULT_WITHDRAW_MIN_USDC = 1.3;
// Above this, withdrawing becomes the featured CTA instead of Play again — a win this size
// shouldn't default to nudging the user straight back into another draw.
const WITHDRAW_FEATURED_THRESHOLD_USDC = 5;
// Round-up grace, mirrors the backend (lottery.service.ts ROUND_UP_GRACE_USDC): a win only 0-10c
// past a whole ticket price doesn't round up to the next ticket, so the displayed count matches
// what playAgain actually buys (e.g. a $2.00 win stays 2 tickets, not 3).
const ROUND_UP_GRACE_USDC = 0.1;
// Whether an aggregate/total win is below the withdrawal floor (→ "Free ticket", play-again only).
// For a single ticket, prefer the authoritative ticket.isFreeTicket flag from the backend.
function isFreeTicketAmount(winUsdc: number | null | undefined, thresholdUsdc: number): boolean {
  const n = winUsdc ?? 0;
  return n > 0 && n < thresholdUsdc;
}
const MAIN_MAX = 30;
const MAIN_COUNT = 5;
const BONUS_MAX = 10;

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "buy" | "redeem" | "history";
type BuyStep = "idle" | "signing" | "sent" | "confirmed" | "checking" | "bridging" | "buying" | "done" | "error";
type TicketStatus = "pending_send" | "sent" | "bridging" | "buying" | "active" | "won" | "lost" | "failed" | "withdrawn";

interface TicketNumbers { main: number[]; bonus: number }

interface TicketSummary {
  id: string; status: TicketStatus; numTickets: number; costUsdc: number;
  roundId: string | null; drawTime: string | null; winAmountUsdc: number | null;
  winTier: number | null; createdAt: string; depositAddress: string | null;
  bridgeStatus: string | null; bridgeExpiresAt: string | null;
  ticketNumbers: TicketNumbers[] | null;
  winningNumbers: TicketNumbers | null;
  deletedAt?: string | null;
  /** True when this ticket came from claiming a gift, not a self-purchase — excluded from spend. */
  isGift?: boolean;
  /** Backend-authoritative: a won ticket below the withdrawal floor, shown as "Free ticket". */
  isFreeTicket?: boolean;
  /** True when this ticket's cost was actually paid via a MagicBlock private transfer. */
  fundedPrivately?: boolean;
}
interface WithdrawalSummary {
  id: string; ticketId: string; route: "base" | "solana_private";
  destinationAddress: string; amountUsdc: number; status: string; createdAt: string;
}
interface Dashboard {
  activeTickets: TicketSummary[]; history: TicketSummary[]; withdrawals: WithdrawalSummary[];
  stats: { totalSpent: number; totalWon: number; netPnl: number; ticketCount: number };
  nextDraw: { roundId: string | null; drawTime: string | null; prizePool: string | null };
  /** Withdrawal floor (USDC) from the backend — below it a win is a "free ticket". */
  withdrawMinUsdc?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomTicket(): TicketNumbers {
  const s = new Set<number>();
  while (s.size < MAIN_COUNT) s.add(Math.ceil(Math.random() * MAIN_MAX));
  return { main: [...s].sort((a, b) => a - b), bonus: Math.ceil(Math.random() * BONUS_MAX) };
}

function statusLabel(s: TicketStatus, bridgeStatus?: string | null, drawTime?: string | null, ticketRoundId?: string | null, currentRoundId?: string | null): string {
  if (s === "failed" && bridgeStatus) {
    const bs = bridgeStatus.toUpperCase();
    if (bs === "REFUNDED") return "Refunded";
    if (bs === "EXPIRED") return "Expired";
  }
  if (s === "active") {
    const drawPassed = (drawTime && new Date(drawTime) < new Date()) ||
      (ticketRoundId && currentRoundId && ticketRoundId !== currentRoundId);
    if (drawPassed) return "Checking results…";
  }
  const m: Record<TicketStatus, string> = {
    pending_send: "Awaiting deposit", sent: "Sent privately", bridging: "Receiving",
    buying: "Buying tickets", active: "In draw", won: "Won!", lost: "No win", failed: "Failed",
    withdrawn: "Paid out",
  };
  return m[s] ?? s;
}
function statusColor(s: TicketStatus): string {
  if (s === "won" || s === "withdrawn") return "text-emerald-400";
  if (s === "lost") return "text-slate-500";
  if (s === "failed") return "text-red-400";
  if (s === "active") return "text-amber-300";
  return "text-slate-400";
}
function formatDrawTime(dt: string | null): string {
  if (!dt) return "—";
  const d = new Date(dt), diff = d.getTime() - Date.now();
  if (diff < 0) return "Drawn " + d.toLocaleDateString();
  return `Draw in ${Math.floor(diff / 3_600_000)}h ${Math.floor((diff % 3_600_000) / 60_000)}m`;
}
function fmt(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** 10 BPS of `base` (the exact amount MagicBlock grosses its fee up from) + the flat $0.20
 * gasless relay fee. */
function mbFee(base: number) {
  return (MAGICBLOCK_BPS / 10_000) * base + MAGICBLOCK_GASLESS_RELAY_FEE_USD;
}

// ─── SignInGate ───────────────────────────────────────────────────────────────
// Redeem/History have nothing meaningful to show for a logged-out visitor (no tickets, no
// winnings), so they're fully gated behind sign-in. Buy is the deliberate exception — its form
// stays visible and only the buy button itself switches to "Sign in to continue" (matching
// the main send flow's convention), since browsing ticket counts/prices shouldn't require login.

function SignInGate({ message, login }: { message: string; login: () => void }) {
  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-8 flex flex-col items-center gap-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#FF7A2A]/15 flex items-center justify-center">
        <LogIn className="w-7 h-7 text-[#FF7A2A]" />
      </div>
      <p className="text-slate-300 text-base">{message}</p>
      <button
        onClick={() => login()}
        className="h-12 px-8 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
      >
        <LogIn className="w-5 h-5" />
        Sign in to continue
      </button>
    </div>
  );
}

// ─── IconBubble ───────────────────────────────────────────────────────────────

function IconBubble({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className="relative shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full">
      <span aria-hidden="true" className={[
        "absolute inset-0 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        active
          ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_10px_24px_rgba(255,122,42,0.25)] scale-[1.02]"
          : "bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] scale-100",
      ].join(" ")} />
      <span aria-hidden="true" className={[
        "absolute -inset-1 rounded-full blur-md transition-opacity duration-300",
        active ? "opacity-60 bg-[radial-gradient(circle,rgba(255,122,42,0.55),transparent_60%)]" : "opacity-0",
      ].join(" ")} />
      <span className={[
        "relative z-10 shrink-0 flex items-center justify-center [&>svg]:h-4 [&>svg]:w-4 [&>svg]:stroke-[2.25]",
        "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        active ? "text-white translate-y-[-0.5px]" : "text-slate-300",
      ].join(" ")}>{children}</span>
    </span>
  );
}

// ─── Prize Tiers Modal ────────────────────────────────────────────────────────

function TierBalls({ normal, bonusMatch }: { normal: number; bonusMatch: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={[
          "w-5 h-5 rounded-full",
          i < normal
            ? "bg-[#FF7A2A]/30 border border-[#FF7A2A]/70"
            : "border border-white/15 bg-white/5",
        ].join(" ")} />
      ))}
      <span className="mx-0.5 w-px h-4 bg-white/10 shrink-0" />
      <span className={[
        "w-5 h-5 rounded-full",
        bonusMatch ? "bg-[#1e1e26] border border-white/40" : "border border-white/15 bg-white/5",
      ].join(" ")} />
    </div>
  );
}

function PrizeTiersModal({ onClose, totalPool }: { onClose: () => void; totalPool?: string | null }) {
  const poolAmt = totalPool ? parseFloat(totalPool) : null;
  const poolDisplay = poolAmt
    ? `$${poolAmt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "$1,100,000+";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#0f0f16] rounded-t-3xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden max-h-[92svh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-end px-5 pt-4 pb-0 shrink-0">
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-2">
          <h2 className="text-3xl font-black text-white text-center tracking-tight mb-2">PRIZES</h2>
          <p className="text-base text-slate-400 text-center mb-5 leading-relaxed">
            All prize tiers are automatically paid out from the{" "}
            <span className="font-semibold text-white">{poolDisplay}</span>{" "}
            total prize pool everyday.
          </p>

          <p className="text-base font-semibold text-white mb-2">Tiers</p>
          <div className="rounded-2xl border border-white/10 overflow-hidden divide-y divide-white/[0.06]">
            {PRIZE_TIERS.map((tier, i) => {
              const desc = tier.normal === 0
                ? "1 bonus ball"
                : `${tier.normal} normal ball${tier.normal !== 1 ? "s" : ""}${tier.bonusMatch ? " + 1 bonus ball" : ""}`;
              return (
                <div key={i} className="flex items-center justify-between px-4 py-3 bg-white/[0.015]">
                  <div>
                    <TierBalls normal={tier.normal} bonusMatch={tier.bonusMatch} />
                    <p className="text-base text-slate-500 mt-1">{desc}</p>
                  </div>
                  <span className={["text-base font-semibold tabular-nums shrink-0 ml-4",
                    tier.prize === "Free ticket" ? "text-[#FF7A2A]" : "text-white"].join(" ")}>
                    {tier.prize}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="text-base font-semibold text-white mt-5 mb-2">Ball Range</p>
          <div className="grid grid-cols-2 gap-3 mb-2">
            {/* Normal balls */}
            <div className="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-4 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white font-bold text-base">1</span>
                <span className="text-[#FF7A2A] font-bold text-lg">→</span>
                <span className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white font-bold text-base">30</span>
              </div>
              <p className="text-base text-slate-400">30 normal balls</p>
            </div>
            {/* Bonus balls */}
            <div className="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-4 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-[#1e1e26] border border-white/30 flex items-center justify-center text-white font-bold text-base">1</span>
                <span className="text-[#FF7A2A] font-bold text-lg">→</span>
                <span className="w-9 h-9 rounded-full bg-[#1e1e26] border border-white/30 flex items-center justify-center text-white font-bold text-base">{BONUS_MAX}</span>
              </div>
              <p className="text-base text-slate-400">{BONUS_MAX} bonus balls</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 px-5 py-4 border-t border-white/10 shrink-0">
          <a href="https://megapot.io/results" target="_blank" rel="noopener noreferrer"
            className="h-12 rounded-xl border border-[#FF7A2A]/40 text-[#FF7A2A] font-semibold text-base flex items-center justify-center hover:bg-[#FF7A2A]/10 transition-colors">
            See results
          </a>
          <button onClick={onClose}
            className="h-12 rounded-xl font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all">
            Play
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

// ─── Megapot tabs (desktop only — mobile uses bottom nav) ─────────────────────

function MegapotTabs({ activeTab, wonCount }: { activeTab: Tab; wonCount: number }) {
  // On pay.loofta.xyz, proxy.ts redirects any literal "/app/*" URL back to the clean path —
  // hardcoding "/app/megapot" here turns every tab click into an extra redirect round trip.
  const isAppPath = usePathname()?.startsWith("/app");
  const megapotBase = isAppPath ? "/app/megapot" : "/megapot";
  const tabBase = "group relative z-10 whitespace-nowrap rounded-xl px-4 py-2.5 inline-flex items-center justify-center gap-2 font-semibold text-[16px] tracking-[-0.01em] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.99]";
  const tabText = (t: Tab) => ["relative z-10 transition-colors duration-300 font-sans font-medium text-lg", activeTab === t ? "text-slate-100" : "text-slate-400 group-hover:text-slate-200"].join(" ");
  const sliderPos = activeTab === "redeem" ? "translate-x-full" : "translate-x-0";
  const isHistory = activeTab === "history";
  return (
    <div className="hidden md:flex items-center justify-between mb-6">
      <div className="relative grid grid-cols-2 rounded-2xl p-1 bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] border border-white/[0.06] overflow-hidden">
        <div aria-hidden="true" className={["absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] bg-gradient-to-b from-white/[0.08] to-white/[0.03] shadow-[0_8px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] border border-white/[0.08]", isHistory ? "opacity-0" : sliderPos].join(" ")} />
        <div aria-hidden="true" className={["pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] opacity-40 bg-[radial-gradient(80%_140%_at_50%_0%,rgba(255,122,42,0.35),transparent_60%)]", isHistory ? "opacity-0" : sliderPos].join(" ")} />
        <Link href={megapotBase} className={tabBase}>
          <IconBubble active={activeTab === "buy"}><Ticket /></IconBubble>
          <span className={tabText("buy")}>Buy</span>
        </Link>
        <Link href={`${megapotBase}?tab=redeem`} className={tabBase}>
          <IconBubble active={activeTab === "redeem"}><Trophy /></IconBubble>
          <span className={tabText("redeem")}>Redeem{wonCount > 0 ? ` (${wonCount})` : ""}</span>
        </Link>
      </div>
      <Link href={`${megapotBase}?tab=history`}
        className={[
          "p-2.5 rounded-xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          "border border-white/[0.06]",
          isHistory
            ? "bg-white/10 text-amber-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            : "bg-white/[0.05] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]",
        ].join(" ")}
        title="History"
      >
        <span className="sr-only">History</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      </Link>
    </div>
  );
}

// ─── Number Picker Modal ──────────────────────────────────────────────────────

function NumberPickerModal({ ticket, onSave, onClose }: {
  ticket: TicketNumbers;
  onSave: (t: TicketNumbers) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TicketNumbers>({ main: [...ticket.main], bonus: ticket.bonus });

  function toggleMain(n: number) {
    setDraft(d => {
      if (d.main.includes(n)) return { ...d, main: d.main.filter(x => x !== n) };
      if (d.main.length >= MAIN_COUNT) {
        // swap last picked for the new number
        return { ...d, main: [...d.main.slice(0, -1), n].sort((a, b) => a - b) };
      }
      return { ...d, main: [...d.main, n].sort((a, b) => a - b) };
    });
  }

  function toggleBonus(n: number) {
    setDraft(d => ({ ...d, bonus: d.bonus === n ? 0 : n }));
  }

  const isComplete = draft.main.length === MAIN_COUNT && draft.bonus > 0;

  const mainRemaining = MAIN_COUNT - draft.main.length;
  const saveLabel = !isComplete
    ? [mainRemaining > 0 && `${mainRemaining} main`, draft.bonus === 0 && "bonus"].filter(Boolean).join(" + ") + " left"
    : "Save numbers";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-[#1a1a22] rounded-t-2xl sm:rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h3 className="text-white font-bold text-lg leading-tight">Pick your numbers</h3>
            <p className="text-base text-slate-500 mt-0.5">
              {draft.main.length}/{MAIN_COUNT} main · {draft.bonus > 0 ? 1 : 0}/1 bonus
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setDraft(randomTicket())}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-300 bg-white/[0.06] hover:bg-white/[0.10] transition-colors">
              <Shuffle className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setDraft({ main: [], bonus: 0 })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-300 bg-white/[0.06] hover:bg-white/[0.10] transition-colors">
              <Eraser className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-3 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Main numbers 1–30 */}
          <div>
            <p className="text-base font-medium text-slate-500 mb-2">Main numbers — pick 5</p>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: MAIN_MAX }, (_, i) => i + 1).map(n => {
                const selected = draft.main.includes(n);
                const willSwap = !selected && draft.main.length >= MAIN_COUNT;
                return (
                  <button key={n} onClick={() => toggleMain(n)}
                    className={[
                      "h-10 w-10 rounded-full text-sm font-semibold transition-all duration-150",
                      selected
                        ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] text-white shadow-[0_4px_12px_rgba(255,122,42,0.35)]"
                        : willSwap
                          ? "bg-white/[0.05] text-slate-500 hover:bg-white/[0.10] hover:text-slate-300"
                          : "bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]",
                    ].join(" ")}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bonus 1–BONUS_MAX */}
          <div>
            <p className="text-base font-medium text-slate-500 mb-2">Bonus number — pick 1</p>
            <div className="grid grid-cols-6 gap-2">
              {Array.from({ length: BONUS_MAX }, (_, i) => i + 1).map(n => (
                <button key={n} onClick={() => toggleBonus(n)}
                  className={[
                    "h-10 w-10 rounded-full text-sm font-semibold transition-all duration-150",
                    draft.bonus === n
                      ? "bg-white text-[#0f0f12] shadow-[0_4px_12px_rgba(255,255,255,0.2)]"
                      : "bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]",
                  ].join(" ")}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="px-5 pb-6 pt-3 border-t border-white/[0.06] space-y-2">
          <button onClick={() => { onSave(draft); onClose(); }} disabled={!isComplete}
            className="w-full h-13 py-3.5 rounded-xl font-semibold text-base bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
            {saveLabel}
          </button>
          <button onClick={onClose}
            className="w-full py-2.5 text-base text-slate-500 hover:text-slate-300 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Choose numbers ───────────────────────────────────────────────────────────

function ChooseNumbers({ tickets, setTickets }: {
  tickets: TicketNumbers[];
  setTickets: (t: TicketNumbers[]) => void;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [menuOpenIdx, setMenuOpenIdx] = useState<number | null>(null);

  function updateTicket(idx: number, t: TicketNumbers) {
    setTickets(tickets.map((tt, i) => i === idx ? t : tt));
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setTickets(tickets.map(() => randomTicket()))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-base font-medium bg-white/[0.05] border border-white/10 text-slate-300 hover:bg-white/[0.09] hover:text-white transition-colors">
          <Shuffle className="w-3.5 h-3.5" /> Shuffle all
        </button>
        <div className="flex-1" />
      </div>

      {/* Ticket rows */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] divide-y divide-white/[0.06]">
        {tickets.map((t, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2.5 group">
            {/* Number bubbles — click row to open picker */}
            <button type="button" onClick={() => setEditingIdx(i)}
              className="flex items-center gap-1.5 flex-1 min-w-0">
              {t.main.map((n, pos) => (
                <span key={pos}
                  className="w-8 h-8 rounded-full bg-white/[0.08] border border-white/[0.08] text-slate-200 text-sm font-semibold flex items-center justify-center shrink-0">
                  {n}
                </span>
              ))}
              {t.bonus > 0 && (
                <>
                  <span className="w-px h-4 bg-white/10 mx-0.5 shrink-0" />
                  <span className="w-8 h-8 rounded-full bg-white/80 text-[#0f0f12] text-sm font-bold flex items-center justify-center shrink-0 shadow-sm">
                    {t.bonus}
                  </span>
                </>
              )}
            </button>

            {/* Row menu */}
            <div className="relative shrink-0">
              <button type="button" onClick={() => setMenuOpenIdx(menuOpenIdx === i ? null : i)}
                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-300 transition-colors">
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpenIdx === i && (
                <div className="absolute right-0 top-8 z-30 w-36 rounded-xl bg-[#1a1a22] border border-white/10 shadow-xl py-1">
                  <button type="button" onClick={() => { setEditingIdx(i); setMenuOpenIdx(null); }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
                    Edit numbers
                  </button>
                  <button type="button" onClick={() => { updateTicket(i, randomTicket()); setMenuOpenIdx(null); }}
                    className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors">
                    Shuffle
                  </button>
                  {tickets.length > 1 && (
                    <button type="button" onClick={() => { setTickets(tickets.filter((_, ti) => ti !== i)); setMenuOpenIdx(null); }}
                      className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add ticket */}
      <button type="button" onClick={() => setTickets([...tickets, randomTicket()])}
        className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl text-base font-medium text-slate-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition-all w-full justify-center">
        <Plus className="w-4 h-4" /> Add ticket
      </button>

      <p className="text-sm text-slate-600 text-center mt-2">
        Tap any row to edit numbers
      </p>

      {/* Number picker modal */}
      {editingIdx !== null && (
        <NumberPickerModal
          ticket={tickets[editingIdx]}
          onSave={t => updateTicket(editingIdx, t)}
          onClose={() => setEditingIdx(null)}
        />
      )}
    </>
  );
}

// ─── Buy stepper ──────────────────────────────────────────────────────────────

const STEALTH_PHRASES = [
  "nobody will know about your gambling addiction 🤫",
  "shh, it's between us 🤐",
  "ninjas are moving your money to megapot 🥷",
  "printing tickets in the basement... 🎟️",
  "cutting through back alleys so nobody can trace it 🕵️",
];

// Shown for public (non-private) purchases — no stealth/secrecy framing, since this is a plain
// on-chain transfer visible to anyone like any normal transaction.
const PUBLIC_PHRASES = [
  "sending your payment on-chain 🔗",
  "printing your tickets... 🎟️",
  "broadcasting to the network 📡",
  "confirming on-chain 🔎",
];

const PURCHASE_STEP_LABEL: Partial<Record<BuyStep, string>> = {
  signing: "Confirm in your wallet",
  sent: "Payment sent",
  bridging: "Bridging to Base",
  buying: "Buying your tickets",
};

/**
 * Full-screen, uncloseable overlay shown while a purchase is in flight. No backdrop
 * dismiss, no Escape, no X — the underlying transfer/bridge/buy chain can't be
 * cancelled mid-flight, so we don't offer a close affordance that would mislead the user.
 */
function PurchaseProgressModal({ step, error, devReset, isPrivate = true }: { step: BuyStep; error?: string; devReset?: () => void; isPrivate?: boolean }) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const reduceMotion = useReducedMotion();
  const phrases = isPrivate ? STEALTH_PHRASES : PUBLIC_PHRASES;
  useEffect(() => {
    const id = setInterval(() => setPhraseIdx(i => (i + 1) % phrases.length), 3500);
    return () => clearInterval(id);
  }, [phrases.length]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-md p-4" role="dialog" aria-modal="true" aria-label="Purchasing tickets">
      <div className="w-full max-w-md bg-[#0f0f16] rounded-3xl border border-white/10 shadow-2xl px-5 sm:px-6 py-8 sm:py-10 flex flex-col items-center text-center gap-4 sm:gap-5 max-h-[92svh] overflow-y-auto">
        <motion.div
          className="text-6xl sm:text-7xl select-none"
          aria-hidden="true"
          animate={reduceMotion ? {} : { y: [0, -12, 0], rotate: [0, -8, 8, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        >
          🎟️
        </motion.div>

        <div className="space-y-2">
          <p className="text-sm font-bold tracking-[0.2em] text-amber-400 uppercase">
            {PURCHASE_STEP_LABEL[step] ?? "Processing"}
          </p>
          <h2 className="font-display text-2xl sm:text-4xl font-bold text-white tracking-tight">
            Hang tight
          </h2>
        </div>

        {/* Fixed-height wrapper so rotating phrases of different lengths never resize the card */}
        <div className="w-full min-h-[4.5rem] sm:min-h-[5.5rem] flex items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={phraseIdx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
              className="text-lg sm:text-2xl font-semibold text-slate-100 leading-snug"
            >
              {phrases[phraseIdx]}
            </motion.p>
          </AnimatePresence>
        </div>

        {error && <p className="text-base font-semibold text-red-400">{error}</p>}

        <p className="text-sm font-medium text-slate-400">🔒 Don&apos;t close this window — usually takes a minute.</p>

        {devReset && (
          <button onClick={devReset} className="text-sm text-slate-500 hover:text-slate-300 border border-white/10 rounded-lg px-2 py-1 transition-colors">
            New payment (dev)
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Shown the moment the MagicBlock transfer is confirmed — the buyer's payment is in, so there's
 * nothing left for them to wait on. Bridging + the actual Megapot purchase finish in the
 * background (same as if they'd closed the tab, which the app already tolerates); unlike
 * PurchaseProgressModal this is dismissible, so we don't hold anyone hostage on-screen for a step
 * that no longer needs their attention.
 *
 * `uncertain` covers the case where the wallet's own confirmation watch timed out or our
 * buy-confirm call failed to reach the backend — the signed transfer was still actually broadcast
 * (see handlePrivateBuy), so this is not a real failure, just an unresolved one. We show a more
 * honest "checking" message instead of "Good luck" until the background poll resolves it either
 * way (the backend independently verifies the burner's on-chain balance, so it will catch a real
 * success even if the buyer never sees a follow-up here).
 */
function PurchaseConfirmedModal({ numTickets, uncertain, onClose }: { numTickets: number; uncertain?: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#0f0f16] rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl px-6 pt-3 pb-6 flex flex-col items-center text-center gap-3"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={uncertain ? "Checking payment status" : "Payment confirmed"}
      >
        <div className="flex items-center justify-end w-full">
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        {uncertain ? (
          <>
            <div className="text-6xl select-none" aria-hidden="true">🔍</div>
            <p className="text-sm font-bold text-amber-400 uppercase tracking-[0.2em]">Checking your payment</p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Didn't hear back in time
            </h2>
            <p className="text-slate-300 text-lg">
              Your wallet didn't confirm quickly enough, but the transfer may already be on its way —
              we're checking the real status now.
            </p>
            <p className="text-slate-400 text-sm">
              If it landed, your {numTickets ? `${numTickets} ` : ""}ticket{numTickets === 1 ? "" : "s"} will show up under My Tickets in a few minutes. Safe to close this — we won't lose track of it.
            </p>
          </>
        ) : (
          <>
            <div className="text-6xl select-none" aria-hidden="true">🎟️✨</div>
            <p className="text-sm font-bold text-emerald-400 uppercase tracking-[0.2em]">Payment confirmed</p>
            <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-tight bg-gradient-to-b from-white via-slate-100 to-amber-200 bg-clip-text text-transparent">
              Good luck! 🍀
            </h2>
            <p className="text-slate-300 text-lg">
              You're in — {numTickets} ticket{numTickets === 1 ? "" : "s"} locked in for the next draw.
            </p>
            <p className="text-slate-400 text-sm">Numbers will show up under My Tickets in a few minutes. Feel free to close this.</p>
          </>
        )}
        <button
          onClick={onClose}
          className={`mt-2 w-full h-12 rounded-xl text-white border-0 text-lg font-medium bg-gradient-to-r from-[#E5140A] to-[#C2790A]`}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

// ─── Draw success modal ────────────────────────────────────────────────────────

function DrawSuccessModal({ tickets, drawTime, prizePool, onBuyMore, onClose }: {
  tickets: TicketNumbers[];
  numTickets: number;
  drawTime: string | null;
  prizePool: string | null;
  onBuyMore: () => void;
  onClose: () => void;
}) {
  const [msLeft, setMsLeft] = useState(() => drawTime ? new Date(drawTime).getTime() - Date.now() : 0);
  const [showAllTickets, setShowAllTickets] = useState(false);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!drawTime) return;
    const tick = () => setMsLeft(new Date(drawTime).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [drawTime]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalSecs = Math.max(0, Math.floor(msLeft / 1000));
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  const drawLocal = drawTime
    ? new Date(drawTime).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const showPicks = tickets.length > 0 && (tickets[0]?.main?.length ?? 0) > 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#0f0f16] rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl overflow-hidden max-h-[92svh] flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Tickets purchased"
      >
        <div className="flex items-center justify-end px-5 pt-4 pb-0 shrink-0">
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 pb-6 space-y-6">
          {/* Headline */}
          <motion.div
            className="flex flex-col items-center text-center gap-2 pt-1"
            initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <motion.div
              className="text-5xl sm:text-6xl select-none"
              aria-hidden="true"
              animate={reduceMotion ? {} : { rotate: [0, -8, 8, -4, 0] }}
              transition={{ duration: 1.2, delay: 0.15 }}
            >
              🎟️✨
            </motion.div>
            <p className="text-sm font-bold text-emerald-400 uppercase tracking-[0.2em] mt-1">Tickets confirmed</p>
            <h2 className="font-display text-4xl sm:text-6xl font-bold tracking-tight bg-gradient-to-b from-white via-slate-100 to-amber-200 bg-clip-text text-transparent">
              Good luck! 🍀
            </h2>
            {prizePool && (
              <p className="text-lg text-amber-300 font-semibold">
                ${Math.round(parseFloat(prizePool)).toLocaleString()} prize pool
              </p>
            )}
          </motion.div>

          {/* Countdown */}
          {drawTime && totalSecs > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-slate-400 uppercase tracking-wider text-center font-semibold">Draw in</p>
              <div className="flex justify-center items-start gap-2">
                {[{ v: hours, label: "HRS" }, { v: minutes, label: "MIN" }, { v: seconds, label: "SEC" }].map(({ v, label }, i) => (
                  <div key={label} className="flex items-start gap-2">
                    <div className="flex flex-col items-center">
                      <div className="w-[66px] h-[66px] rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center">
                        <span className="text-3xl font-bold tabular-nums text-white">{String(v).padStart(2, "0")}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1.5 font-semibold tracking-widest">{label}</span>
                    </div>
                    {i < 2 && <span className="text-2xl font-bold text-slate-400 mt-3 select-none">:</span>}
                  </div>
                ))}
              </div>
              {drawLocal && <p className="text-center text-sm text-slate-400 mt-1">Draw {drawLocal}</p>}
            </div>
          )}

          {/* Ticket picks */}
          {showPicks && (
            <div className="space-y-2">
              <p className="text-sm text-slate-400 uppercase tracking-wider font-semibold mb-2">Your tickets</p>
              {(showAllTickets ? tickets : tickets.slice(0, 5)).map((t, i) => (
                <motion.div
                  key={i}
                  initial={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
                  animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3, delay: 0.1 + i * 0.06 }}
                >
                  <TicketNumberCard tn={t} />
                </motion.div>
              ))}
              {!showAllTickets && tickets.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllTickets(true)}
                  className="w-full h-9 rounded-xl text-sm font-medium text-slate-300 hover:text-white border border-white/10 hover:bg-white/[0.06] transition-all"
                >
                  +{tickets.length - 5} more tickets
                </button>
              )}
            </div>
          )}

          <p className="text-center text-base font-medium text-slate-300">Check back soon to see if you&apos;ve won 🤞</p>

          <button onClick={onBuyMore}
            className="w-full h-11 rounded-xl text-sm font-semibold border border-white/10 text-slate-200 hover:bg-white/[0.06] hover:text-white transition-all">
            Buy more tickets
          </button>
        </div>
      </div>
    </div>
  );
}

function GiftSentCard({ claimUrl, numTickets, recipientType, onDone }: {
  claimUrl: string;
  numTickets: number;
  recipientType: "email" | "handle";
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const ticketWord = numTickets === 1 ? "ticket" : "tickets";

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" onClick={onDone}>
      <div
        className="w-full max-w-md bg-[#0f0f16] rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Gift sent"
      >
        <div className="flex items-center justify-end px-5 pt-4 pb-0">
          <button onClick={onDone} aria-label="Close" className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 pb-6 space-y-5">
          <div className="flex flex-col items-center text-center gap-2 pt-1">
            <div className="w-14 h-14 rounded-2xl bg-[#FF7A2A]/15 flex items-center justify-center">
              <Gift className="w-7 h-7 text-[#FF7A2A]" />
            </div>
            <p className="text-2xl font-semibold text-white">Gifted!</p>
            <p className="text-base text-slate-400">
              {numTickets} Megapot {ticketWord} paid for — {recipientType === "email" ? "they'll get an email with" : "share"} the claim link{recipientType === "email" ? "." : " below."}
            </p>
          </div>

          <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
            <a href={claimUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 min-w-0 truncate text-base text-slate-300 hover:text-white hover:underline underline-offset-2 transition-colors">
              {claimUrl}
            </a>
            <button
              onClick={() => { navigator.clipboard.writeText(claimUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
              aria-label="Copy claim link"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <button onClick={onDone}
            className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Fee breakdown ────────────────────────────────────────────────────────────

function FeeBreakdown({ ticketCostUsd, mode, solPriceUsd, bridgeFeeUsd, bridgeReceiveUsdc, bridgeFeeUnavailable, onRetryFee }: {
  ticketCostUsd: number;
  mode: "buy" | "buy-public" | "base" | "solana_private";
  solPriceUsd: number;
  bridgeFeeUsd?: number | null;      // actual Li.Fi fee; null = loading
  bridgeReceiveUsdc?: number | null; // Li.Fi toAmountMin; null = loading
  bridgeFeeUnavailable?: boolean;    // couldn't get a real quote after retries — no guessed number is shown
  onRetryFee?: () => void;
}) {
  if (mode === "base") return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
      <div className="flex justify-between px-4 py-3.5">
        <span className="text-base text-slate-400">Withdrawal fee</span>
        <span className="text-base text-emerald-400">Free</span>
      </div>
      <div className="flex justify-between px-4 py-3.5">
        <span className="text-base font-semibold text-white">You receive</span>
        <span className="text-base font-semibold text-white tabular-nums">{fmt(ticketCostUsd)}</span>
      </div>
    </div>
  );

  if (mode === "solana_private") {
    // Backend /bridge-fee now returns the TRUE net (one consolidated bridge + MagicBlock relay +
    // volume fee), so use it directly — don't re-subtract MagicBlock here or it double-counts.
    // No estimated/guessed fallback: if a real quote can't be obtained, say so plainly rather
    // than showing a number that might not match what the bridge actually charges.
    const youReceive = bridgeReceiveUsdc != null ? Math.max(0, bridgeReceiveUsdc) : null;
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
        <div className="flex justify-between items-start px-4 py-3.5 gap-4">
          <div className="min-w-0">
            <p className="text-base text-slate-400">Privacy &amp; processing</p>
            <p className="text-sm text-slate-500 mt-0.5">Private transfer &amp; bridging — all included</p>
          </div>
          <span className="text-base text-slate-400 tabular-nums shrink-0">
            {bridgeFeeUnavailable
              ? <span className="text-amber-400">unavailable</span>
              : bridgeFeeUsd == null ? <span className="opacity-40">estimating…</span> : `~${fmt(bridgeFeeUsd)}`}
          </span>
        </div>
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base font-semibold text-white">You receive</span>
          <span className="text-base font-semibold text-white tabular-nums">
            {bridgeFeeUnavailable
              ? <span className="text-sm font-normal text-amber-400">couldn&apos;t get a real quote</span>
              : youReceive === null
                ? <span className="opacity-40 font-normal text-slate-400">estimating…</span>
                : `~${fmt(youReceive)}`}
          </span>
        </div>
        {!bridgeFeeUnavailable && youReceive !== null && (
          <div className="px-4 py-2.5">
            <p className="text-sm text-slate-500">
              Estimate based on your recorded win — the exact amount is confirmed once your winnings are claimed on-chain, and may come in slightly lower.
            </p>
          </div>
        )}
        {bridgeFeeUnavailable && onRetryFee && (
          <div className="px-4 py-3">
            <button type="button" onClick={onRetryFee} className="text-sm text-amber-400 underline underline-offset-2 hover:text-amber-300">
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }

  if (mode === "buy-public") {
    // Matches initiatePublicPurchase/buildPublicPurchaseTransferTx on the backend: the buyer's
    // wallet only ever sends ticketCostUsd — the NEAR Intents bridge-fee buffer is topped up
    // separately from Loofta's own fee wallet in the same transaction, not charged to the buyer.
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base text-slate-400">Tickets ({ticketCostUsd} × $1.00)</span>
          <span className="text-base text-slate-200 tabular-nums">{fmt(ticketCostUsd)}</span>
        </div>
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base text-slate-400">NEAR Intents bridge fee (SOL USDC → Base)</span>
          <span className="text-base text-emerald-400 tabular-nums">Covered by Loofta</span>
        </div>
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base font-semibold text-white">Total to send</span>
          <span className="text-base font-semibold text-white tabular-nums">{fmt(ticketCostUsd)}</span>
        </div>
      </div>
    );
  }

  // MagicBlock exactOut sends exactly ticketCostUsd (no rounding — it's already a whole-dollar
  // amount for any ticket count) and grosses its own fee up from that same amount. Loofta no
  // longer adds a service fee, and the Li.Fi bridging cost is absorbed from Loofta's fee reserve
  // (not charged to the user) — so the only fee shown is MagicBlock's own transfer fee.
  const buyFees = mbFee(ticketCostUsd);
  const total = ticketCostUsd + buyFees;
  // The MagicBlock fee is mostly flat ($0.20 relay), so per-ticket cost falls fast with count.
  const feesPerTicket = buyFees / ticketCostUsd;
  const feesPerTicketAt5 = mbFee(5) / 5;
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
      <div className="flex justify-between px-4 py-3.5">
        <span className="text-base text-slate-400">Tickets ({ticketCostUsd} × $1.00)</span>
        <span className="text-base text-slate-200 tabular-nums">{fmt(ticketCostUsd)}</span>
      </div>
      <div className="flex justify-between items-start px-4 py-3.5 gap-4">
        <div className="min-w-0">
          <p className="text-base text-slate-400">Private transfer</p>
          <p className="text-sm text-slate-500 mt-0.5">MagicBlock transfer fee — bridging &amp; service on us</p>
        </div>
        <span className="text-base text-slate-400 tabular-nums shrink-0">~{fmt(buyFees)}</span>
      </div>
      <div className="flex justify-between px-4 py-3.5">
        <span className="text-base font-semibold text-white">Total from your balance</span>
        <span className="text-base font-semibold text-white tabular-nums">~{fmt(total)}</span>
      </div>
      {ticketCostUsd < 5 && (
        <div className="flex items-start gap-2.5 px-4 py-3.5 bg-[#EAB308]/[0.07]">
          <span aria-hidden className="text-base leading-snug">💡</span>
          <p className="text-sm leading-snug text-amber-200/90">
            Fees barely change with size — right now that&apos;s {fmt(feesPerTicket)} per ticket.
            Buy 5 and it drops to {fmt(feesPerTicketAt5)} per ticket.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Buy tab ──────────────────────────────────────────────────────────────────

const PRESETS = [5, 10, 50, 100] as const;
const PRIVATE_MIN = 1;
// Default the picker to 5: the privacy + Loofta fees are flat, so per-ticket cost drops
// sharply with count ($0.30/ticket at 1 → $0.06/ticket at 5). Min stays 1.
const DEFAULT_TICKETS = 5;

function BuyTab({ accessToken, solPriceUsd, onPurchased, activeTickets, dashboardLoading, nextDraw }: {
  accessToken: string | null;
  solPriceUsd: number;
  onPurchased: () => void;
  activeTickets: TicketSummary[];
  dashboardLoading?: boolean;
  nextDraw?: { drawTime: string | null; prizePool: string | null };
}) {
  const [numTickets, setNumTickets] = useState(DEFAULT_TICKETS);
  const [tickets, setTickets] = useState<TicketNumbers[]>(() => Array.from({ length: DEFAULT_TICKETS }, randomTicket));
  const [chooseOpen, setChooseOpen] = useState(false);
  // Default ON — matches today's only (private) behavior; public buying is the new opt-in.
  const [sendPrivately, setSendPrivately] = useState(true);
  const [privacyBurstKey, setPrivacyBurstKey] = useState<number | null>(null);
  const handleToggleSendPrivately = (checked: boolean) => {
    setSendPrivately(checked);
    if (checked) setPrivacyBurstKey(Date.now());
  };
  const [step, setStep] = useState<BuyStep>("idle");
  const [stepError, setStepError] = useState("");
  const [stepErrorIsBalance, setStepErrorIsBalance] = useState(false);
  const [lastTickets, setLastTickets] = useState<TicketNumbers[]>([]);
  const [lastNumTickets, setLastNumTickets] = useState(0);

  // Gift mode: buy tickets for someone else instead of yourself. Same signed private transfer,
  // just addressed to a recipient's email, X handle, or Loofta username — see handleGiftBuy.
  const [giftMode, setGiftMode] = useState(false);
  const [giftIdentifier, setGiftIdentifier] = useState("");
  const giftLooksLikeEmail = giftIdentifier.includes("@") && giftIdentifier.includes(".");
  const [giftNote, setGiftNote] = useState("");
  const [giftGifUrl, setGiftGifUrl] = useState<string | null>(null);
  const [giftStep, setGiftStep] = useState<"idle" | "signing" | "done" | "error">("idle");
  const [giftError, setGiftError] = useState("");
  const [giftErrorIsBalance, setGiftErrorIsBalance] = useState(false);
  const [giftClaimUrl, setGiftClaimUrl] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingStartedRef = useRef(false);
  const suppressedTicketIdRef = useRef<string | null>(null);

  // Sales pause DRAW_PURCHASE_CUTOFF_MS before the draw — backend enforces this for real
  // (assertNotInDrawCutoff), this just keeps the UI from letting someone start a purchase
  // the backend is about to reject.
  const [drawCutoff, setDrawCutoff] = useState(false);
  const [drawTimeLabel, setDrawTimeLabel] = useState<string | null>(null);
  useEffect(() => {
    const compute = () => {
      const drawTime = nextDraw?.drawTime ? new Date(nextDraw.drawTime) : nextParisDrawDate();
      const msUntil = drawTime.getTime() - Date.now();
      setDrawCutoff(msUntil > 0 && msUntil <= DRAW_PURCHASE_CUTOFF_MS);
      setDrawTimeLabel(drawTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Europe/Paris" }));
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [nextDraw?.drawTime]);

  // Dev-only: jump directly to any purchase-flow screen via ?preview=... (see DevPreviewPanel)
  const previewParam = useSearchParams().get("preview");
  useEffect(() => {
    if (!IS_LOCALHOST || !previewParam) return;
    if (previewParam === "reset") { setStep("idle"); return; }
    const validSteps: string[] = ["signing", "sent", "confirmed", "checking", "bridging", "buying", "done"];
    if (validSteps.includes(previewParam)) {
      setLastTickets(PREVIEW_TICKETS);
      setLastNumTickets(PREVIEW_TICKETS.length);
      setStep(previewParam as BuyStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewParam]);

  useEffect(() => {
    if (step === "signing") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const { user, getAccessToken, authenticated, login } = usePrivy();

  // Purchases draw from the buyer's Loofta balance — check it up front so a short buyer sees a
  // top-up prompt instead of a raw MagicBlock/Solana simulation error at signing time.
  const { balanceUSD, isLoading: isBalanceLoading } = useEmbeddedSolanaUsdcBalance({ enabled: authenticated === true });
  // Public buying has no MagicBlock fee — the buyer only ever sends ticketCostUsd (see
  // buildPublicPurchaseTransferTx; the NEAR Intents bridge buffer comes from Loofta's fee wallet).
  const totalCostUsd = sendPrivately ? numTickets + mbFee(numTickets) : numTickets;
  const insufficientBalance = authenticated === true && !isBalanceLoading && balanceUSD < totalCostUsd;

  const embeddedSolAddress = ((user?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const embeddedWallet = wallets.find(w => w.address === embeddedSolAddress) ?? wallets[0];

  function setCount(n: number) {
    const c = Math.max(PRIVATE_MIN, Math.min(100, n));
    setNumTickets(c);
    setTickets(prev => {
      if (prev.length === c) return prev;
      if (c > prev.length) return [...prev, ...Array.from({ length: c - prev.length }, randomTicket)];
      return prev.slice(0, c);
    });
  }

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);
  useEffect(() => () => stopPoll(), [stopPoll]);

  // Tracks whichever ticket the most recent pollStatus() call is following — an older interval
  // that's still ticking down (e.g. the user dismissed "confirmed" and started a second purchase
  // before the first one's poll happened to fire) checks this before touching `step`, so a
  // late-arriving update for an abandoned ticket can't clobber the screen for a newer purchase.
  const activeTicketIdRef = useRef<string | null>(null);

  const checkTicketStatus = useCallback(async (ticketId: string): Promise<TicketSummary | null> => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/lottery/status/${ticketId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      // A missing/malformed row (e.g. a stale ticketId that no longer resolves for this user)
      // must not crash the caller — this used to throw and get silently swallowed, wedging the
      // "Hang tight" screen forever.
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  }, [getAccessToken]);

  // Applies a fetched status if it's terminal (active/won/failed) — clears the localStorage flag
  // and updates the visible step. Returns true if it was terminal (caller should stop polling).
  const applyTerminalTicketStatus = useCallback((ticketId: string, t: TicketSummary | null): boolean => {
    if (!t || !t.status) return false;
    const isCurrent = activeTicketIdRef.current === ticketId;
    // The buyer already saw "payment confirmed" the moment MagicBlock landed (see
    // handlePrivateBuy) — bridging/buying finish in the background from here, so this only
    // needs to catch the two terminal outcomes, not drive step-by-step UI anymore.
    if (["active", "won"].includes(t.status)) {
      localStorage.removeItem("megapot_ticket");
      pollingStartedRef.current = false;
      stopPoll(); onPurchased();
      if (isCurrent) {
        // Always take numbers/count from the server response here, not whatever `lastTickets`
        // already held — this branch can be reached after a fresh page load (mount-resume or
        // cross-device restore) where the buyer never went through handlePrivateBuy in this
        // browser session at all, so there'd be nothing else to show them.
        setLastTickets(t.ticketNumbers ?? []);
        setLastNumTickets(t.numTickets);
        setStep("done");
      }
      return true;
    }
    if (t.status === "failed") {
      localStorage.removeItem("megapot_ticket");
      pollingStartedRef.current = false;
      stopPoll();
      if (isCurrent) { setStep("error"); setStepError("Purchase failed — contact support."); }
      return true;
    }
    return false;
  }, [onPurchased, stopPoll]);

  const pollStatus = useCallback((ticketId: string, numTicketsForStorage?: number) => {
    // Preserve whatever count is already on record if this particular call didn't pass one — every
    // call to pollStatus rewrites this same key (e.g. resuming an in-flight ticket on mount), so an
    // omitted count here must not clobber a real one a previous call already stored.
    let numTicketsToStore = numTicketsForStorage;
    if (numTicketsToStore === undefined) {
      try {
        const existing = JSON.parse(localStorage.getItem("megapot_ticket") ?? "null") as { ticketId?: string; numTickets?: number } | null;
        if (existing?.ticketId === ticketId) numTicketsToStore = existing.numTickets;
      } catch { /* ignore malformed existing entry */ }
    }
    localStorage.setItem("megapot_ticket", JSON.stringify({ ticketId, savedAt: Date.now(), numTickets: numTicketsToStore }));
    activeTicketIdRef.current = ticketId;
    stopPoll();
    pollRef.current = setInterval(async () => {
      const t = await checkTicketStatus(ticketId);
      applyTerminalTicketStatus(ticketId, t);
    }, 8_000);
  }, [checkTicketStatus, applyTerminalTicketStatus, stopPoll]);

  // Resume polling on mount if a ticket was in-flight on this device (localStorage persists across
  // refreshes). Purchases confirm in "usually takes a minute" per the copy below — an hour is
  // generous slack for backend hiccups while still guaranteeing a stale flag (e.g. left over from a
  // crashed/dead poll) can't wedge this screen open indefinitely, mirroring the withdrawal fix.
  const TICKET_STORAGE_TTL_MS = 60 * 60 * 1000;
  useEffect(() => {
    const raw = localStorage.getItem("megapot_ticket");
    if (!raw || pollingStartedRef.current) return;
    let ticketId: string | null = null;
    let numTicketsForModal = 0;
    try {
      const parsed = JSON.parse(raw) as { ticketId?: string; savedAt?: number; numTickets?: number };
      if (parsed?.ticketId && parsed.savedAt && Date.now() - parsed.savedAt <= TICKET_STORAGE_TTL_MS) {
        ticketId = parsed.ticketId;
        numTicketsForModal = parsed.numTickets ?? 0;
      }
    } catch {
      // Legacy format from before this key stored JSON — treat the raw string as the ticket id but
      // don't trust it indefinitely; it has no savedAt so we can't tell how old it is.
      ticketId = raw;
    }
    if (!ticketId) { localStorage.removeItem("megapot_ticket"); return; }
    pollingStartedRef.current = true;
    activeTicketIdRef.current = ticketId;
    setLastNumTickets(numTicketsForModal);

    const resumeTicketId = ticketId;
    (async () => {
      // Check the real current status right away instead of blindly flashing "Good luck" for a
      // ticket that may have already resolved (won/lost/failed) minutes or hours ago on a
      // previous visit — the old code only found out on the next 8s poll tick, so revisiting the
      // page after the ticket was already done kept re-showing "confirmed" for a beat every time.
      const t = await checkTicketStatus(resumeTicketId);
      if (applyTerminalTicketStatus(resumeTicketId, t)) return;
      // Still genuinely in flight — payment already landed on-chain by the time this key exists
      // (it's written right after MagicBlock confirms), so resume quietly rather than showing a
      // blocking "Hang tight" screen.
      setStep("confirmed");
      // Must pass the count along — pollStatus rewrites this same localStorage entry on every
      // call, so omitting it here would overwrite the real count with nothing on every resume,
      // which is exactly what produced "0 tickets locked in" after leaving and coming back.
      pollStatus(resumeTicketId, numTicketsForModal);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-device restore: when the dashboard data arrives, check for any in-flight ticket
  // This handles the case where localStorage is empty (different device or cleared storage)
  useEffect(() => {
    if (pollingStartedRef.current) return;
    const inFlight = activeTickets.find(t =>
      ["sent", "bridging", "buying"].includes(t.status) &&
      t.id !== suppressedTicketIdRef.current
    );
    if (!inFlight) return;
    pollingStartedRef.current = true;
    // Any of these statuses means the payment already landed — same as the localStorage-resume
    // path above, show the dismissible confirmation rather than a blocking step-tracker.
    setLastNumTickets(inFlight.numTickets);
    setLastTickets(inFlight.ticketNumbers ?? []);
    setStep("confirmed");
    pollStatus(inFlight.id, inFlight.numTickets);
  }, [activeTickets, pollStatus]);

  async function handlePrivateBuy() {
    if (!embeddedWallet?.address) {
      setStepError("Wallet not ready — please wait a moment and try again.");
      return;
    }
    setLastTickets([...tickets]);
    setLastNumTickets(numTickets);
    setStep("signing");
    setStepError("");
    setStepErrorIsBalance(false);
    // Hoisted so the catch block can still reach the ticket + know whether the transfer was
    // actually broadcast, even though both are normally set deep inside the try block.
    let ticketId: string | undefined;
    let paymentBroadcast = false;
    try {
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const initRes = await fetch("/api/lottery/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          numTickets,
          userSolanaAddress: embeddedWallet?.address,
          tickets: numTickets <= 10 ? tickets.map(t => ({ main: t.main, bonus: t.bonus })) : undefined,
          route: "solana_private",
        }),
      });
      if (!initRes.ok) throw new Error((await initRes.json()).message ?? "Failed to initiate");
      const initData = await initRes.json();
      const currentTicketId: string = initData.ticketId;
      ticketId = currentTicketId;
      const txBase64 = initData.txBase64;

      // Sign + send the MagicBlock private transfer — the only tx the buyer signs now. Loofta no
      // longer collects a separate upfront fee.
      const txBytes = Buffer.from(txBase64, "base64");
      let signature: string;
      try {
        const { signature: sigBytes } = await signAndSendTransaction({
          transaction: txBytes as unknown as Uint8Array,
          wallet: embeddedWallet as any,
        });
        signature = bs58.encode(sigBytes as Uint8Array);
        paymentBroadcast = true;
      } catch (signErr: any) {
        // Privy's own confirmation watch is a 10s race against a websocket subscription that
        // starts AFTER it has already broadcast the transaction — "confirmation timed out/failed"
        // can only be thrown once that broadcast succeeded, so the transfer may well be in flight
        // even though we never got a signature back. Flag it so the outer catch checks the real
        // status instead of declaring a payment failure that may not have happened.
        if (/confirmation (timed out|failed)/i.test(signErr?.message ?? "")) paymentBroadcast = true;
        throw signErr;
      }
      setStep("sent");
      await fetch("/api/lottery/buy-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ ticketId: currentTicketId, senderTxHash: signature }),
      });
      suppressedTicketIdRef.current = null;
      // The buyer's payment is confirmed on-chain right here — bridging + the actual Megapot
      // purchase happen in the background from this point, same as if they closed the tab (the
      // backend already tolerates that). Backend work (buy-confirm above, pollStatus, onPurchased)
      // starts immediately so it's not artificially delayed — only the UI transition off "Hang
      // tight" is held a few seconds so it doesn't feel like an instant jump straight from signing
      // to "Good luck" the moment the wallet popup closes.
      pollingStartedRef.current = true;
      pollStatus(currentTicketId, numTickets);
      // Dashboard data is otherwise only refetched once the ticket reaches active/won (inside
      // pollStatus below) — without this, a buyer who checks History right after paying sees
      // whatever was on the page before this purchase, with no sign their ticket even exists yet.
      onPurchased();
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      // The numbers themselves were already picked client-side before we ever charged them (see
      // setLastTickets above), so there's nothing left to wait on before showing "Good luck" —
      // straight to the real success screen instead of an intermediate "confirmed" placeholder.
      setStep("done");
    } catch (err: any) {
      const message = err?.message ?? "Unknown error";
      if (ticketId && paymentBroadcast) {
        // The signed transfer really was sent (either signAndSendTransaction's own broadcast call
        // succeeded before it lost the confirmation race, or buy-confirm just failed to reach us
        // over a flaky connection after signing succeeded) — telling the buyer it failed here would
        // be wrong. The backend independently checks the burner wallet's real on-chain balance
        // every few seconds and will recover the ticket on its own if the funds landed, so just
        // watch the real status instead of guessing.
        suppressedTicketIdRef.current = null;
        setStep("checking");
        setStepError("");
        pollingStartedRef.current = true;
        pollStatus(ticketId, numTickets);
        onPurchased();
        return;
      }
      setStep("error");
      if (isInsufficientSolOrNoPriorCreditError(message)) {
        setStepErrorIsBalance(true);
        setStepError("");
      } else {
        setStepError(privatePayErrorMessageForUser(message, getSolanaCluster()));
      }
    }
  }

  /**
   * Public path — same /buy endpoint as private, with route: "solana_public". Only the sender→
   * burner leg differs (plain sponsor-cosigned transfer instead of a MagicBlock private transfer,
   * see initiatePurchase/buildPublicBurnerTransferTx on the backend) — the burner→Base bridge
   * (already Relay-first/Li.Fi-fallback for every ticket regardless of privacy) and the actual
   * ticket purchase are unchanged, so custom number picks work exactly the same as private buying.
   */
  async function handlePublicBuy() {
    if (!embeddedWallet?.address) {
      setStepError("Wallet not ready — please wait a moment and try again.");
      return;
    }
    setLastTickets([...tickets]);
    setLastNumTickets(numTickets);
    setStep("signing");
    setStepError("");
    setStepErrorIsBalance(false);
    let ticketId: string | undefined;
    let paymentBroadcast = false;
    try {
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const initRes = await fetch("/api/lottery/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          numTickets,
          userSolanaAddress: embeddedWallet?.address,
          tickets: numTickets <= 10 ? tickets.map(t => ({ main: t.main, bonus: t.bonus })) : undefined,
          route: "solana_public",
        }),
      });
      if (!initRes.ok) throw new Error((await initRes.json()).message ?? "Failed to initiate");
      const initData = await initRes.json();
      const currentTicketId: string = initData.ticketId;
      ticketId = currentTicketId;
      const txBase64 = initData.txBase64;

      const txBytes = Buffer.from(txBase64, "base64");
      let signature: string;
      try {
        const { signature: sigBytes } = await signAndSendTransaction({
          transaction: txBytes as unknown as Uint8Array,
          wallet: embeddedWallet as any,
        });
        signature = bs58.encode(sigBytes as Uint8Array);
        paymentBroadcast = true;
      } catch (signErr: any) {
        if (/confirmation (timed out|failed)/i.test(signErr?.message ?? "")) paymentBroadcast = true;
        throw signErr;
      }
      setStep("sent");
      await fetch("/api/lottery/buy-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ ticketId: currentTicketId, senderTxHash: signature }),
      });
      suppressedTicketIdRef.current = null;
      pollingStartedRef.current = true;
      pollStatus(currentTicketId, numTickets);
      onPurchased();
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      setStep("done");
    } catch (err: any) {
      const message = err?.message ?? "Unknown error";
      if (ticketId && paymentBroadcast) {
        suppressedTicketIdRef.current = null;
        setStep("checking");
        setStepError("");
        pollingStartedRef.current = true;
        pollStatus(ticketId, numTickets);
        onPurchased();
        return;
      }
      setStep("error");
      if (isInsufficientSolOrNoPriorCreditError(message)) {
        setStepErrorIsBalance(true);
        setStepError("");
      } else {
        setStepError(message);
      }
    }
  }

  async function handleGiftBuy() {
    if (!embeddedWallet?.address) {
      setGiftError("Wallet not ready — please wait a moment and try again.");
      setGiftStep("error");
      return;
    }
    const recipientIdentifier = giftIdentifier.trim().replace(/^@+/, "");
    if (!recipientIdentifier) {
      setGiftError("Enter a recipient email, X handle, or Loofta username.");
      setGiftStep("error");
      return;
    }
    const recipientType = giftLooksLikeEmail ? "email" : "handle";
    setGiftStep("signing");
    setGiftError("");
    setGiftErrorIsBalance(false);
    try {
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const initRes = await fetch("/api/lottery/buy-gift", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({
          numTickets,
          userSolanaAddress: embeddedWallet?.address,
          recipientType,
          recipientIdentifier,
          note: [giftNote.trim(), giftGifUrl].filter(Boolean).join(" ").trim() || undefined,
          route: sendPrivately ? "solana_private" : "solana_public",
        }),
      });
      if (!initRes.ok) throw new Error((await initRes.json()).message ?? "Failed to initiate");
      const { giftId, txBase64 } = await initRes.json();

      // One signature: the MagicBlock private transfer that funds the holding burner (Loofta no
      // longer collects a separate fee). Nothing is bought yet — the actual Megapot purchase
      // happens when the recipient claims (see /app/gift/[token]), not here.
      const txBytes = Buffer.from(txBase64, "base64");
      const { signature: sigBytes } = await signAndSendTransaction({
        transaction: txBytes as unknown as Uint8Array,
        wallet: embeddedWallet as any,
      });
      const signature = bs58.encode(sigBytes as Uint8Array);
      const confirmRes = await fetch("/api/lottery/buy-gift-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ giftId, senderTxHash: signature }),
      });
      if (!confirmRes.ok) throw new Error((await confirmRes.json()).message ?? "Failed to confirm");
      const { claimUrl } = await confirmRes.json();
      setGiftClaimUrl(claimUrl);
      setGiftStep("done");
      // Pre-warm the OG image now, the moment the link becomes shareable — cold next/og
      // rendering measured 1.7-3s in production, which risks X's crawler timeout specifically
      // (same fix already applied to ShareLinkMenu's own pre-warm for payment links).
      try {
        const parsed = new URL(claimUrl);
        const shareId = parsed.pathname.split("/").filter(Boolean).pop();
        if (shareId) fetch(`${parsed.origin}/api/gift/${shareId}/og`).catch(() => { });
      } catch { /* claimUrl wasn't a valid absolute URL — nothing to pre-warm */ }
    } catch (err: any) {
      setGiftStep("error");
      const message = err?.message ?? "Unknown error";
      if (isInsufficientSolOrNoPriorCreditError(message)) {
        setGiftErrorIsBalance(true);
        setGiftError("");
      } else {
        setGiftError(privatePayErrorMessageForUser(message, getSolanaCluster()));
      }
    }
  }

  // Only "signing" (waiting on the wallet) and "sent" (the brief buy-confirm POST right after)
  // block the screen — everything past that point is background work the buyer already got a
  // dismissible confirmation for (see PurchaseConfirmedModal / steps "confirmed" and "checking").
  const isRunning = !["idle", "confirmed", "checking", "done", "error"].includes(step);

  function resetBuy() { setStep("idle"); setStepError(""); setStepErrorIsBalance(false); pollingStartedRef.current = false; }

  function startNewPayment() {
    stopPoll();
    const current = localStorage.getItem("megapot_ticket");
    if (current) {
      try { suppressedTicketIdRef.current = (JSON.parse(current) as { ticketId?: string })?.ticketId ?? current; }
      catch { suppressedTicketIdRef.current = current; }
    }
    localStorage.removeItem("megapot_ticket");
    pollingStartedRef.current = false;
    setStep("idle");
    setStepError("");
    setStepErrorIsBalance(false);
  }

  if (dashboardLoading && step === "idle") {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5 animate-pulse">
        <div className="h-6 w-32 rounded-lg bg-white/[0.08]" />
        <div className="h-4 w-48 rounded-lg bg-white/[0.05]" />
        <div className="h-12 rounded-xl bg-white/[0.05]" />
        <div className="h-28 rounded-xl bg-white/[0.05]" />
        <div className="h-12 rounded-xl bg-white/[0.08]" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
      {isRunning && (
        <PurchaseProgressModal
          step={step}
          error={stepError}
          devReset={IS_LOCALHOST ? startNewPayment : undefined}
          isPrivate={sendPrivately}
        />
      )}
      {step === "confirmed" && (
        <PurchaseConfirmedModal numTickets={lastNumTickets} onClose={resetBuy} />
      )}
      {step === "checking" && (
        <PurchaseConfirmedModal numTickets={lastNumTickets} uncertain onClose={resetBuy} />
      )}
      {step === "done" && (
        <DrawSuccessModal
          tickets={lastTickets}
          numTickets={lastNumTickets}
          drawTime={nextDraw?.drawTime ?? null}
          prizePool={nextDraw?.prizePool ?? null}
          onBuyMore={resetBuy}
          onClose={resetBuy}
        />
      )}
      {giftStep === "done" && giftClaimUrl && (
        <GiftSentCard
          claimUrl={giftClaimUrl}
          numTickets={numTickets}
          recipientType={giftLooksLikeEmail ? "email" : "handle"}
          onDone={() => {
            setGiftStep("idle");
            setGiftClaimUrl(null);
            setGiftIdentifier("");
            setGiftNote("");
            setGiftGifUrl(null);
          }}
        />
      )}
      {!isRunning && step !== "confirmed" && step !== "checking" && step !== "done" && giftStep !== "done" && (
        <>
          <p className="text-slate-300 text-xl font-medium font-sans">Buy tickets{sendPrivately ? " privately" : ""}</p>

          {sendPrivately && (
            <p className="text-sm text-slate-400">🔒 Shielded via MagicBlock. Min {PRIVATE_MIN} tickets. Uses your Loofta balance.</p>
          )}

          {/* Gift toggle */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
            <button type="button" onClick={() => setGiftMode(g => !g)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors">
              <span className="flex items-center gap-2 text-base font-medium text-slate-200">
                <Gift className="w-4 h-4 text-slate-400" /> Gift to someone
              </span>
              <div className={["w-10 h-6 rounded-full transition-colors relative shrink-0",
                giftMode ? "bg-[#FF7A2A]" : "bg-white/10"].join(" ")}>
                <div className={["absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform",
                  giftMode ? "translate-x-4" : "translate-x-0.5"].join(" ")} />
              </div>
            </button>
            {giftMode && (
              <div className="px-4 pb-4 border-t border-white/[0.06] space-y-3 pt-4">
                <div>
                  <Label className="text-slate-400 text-base">Recipient</Label>
                  <div className="relative mt-1.5">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                      {giftLooksLikeEmail ? <Mail className="h-4 w-4" /> : <AtSign className="h-4 w-4" />}
                    </span>
                    <input value={giftIdentifier} onChange={e => setGiftIdentifier(e.target.value.replace(/^@+/, ""))}
                      placeholder="Email, X handle, or Loofta username"
                      className="w-full bg-white/[0.03] border border-white/10 text-slate-100 placeholder:text-slate-600 rounded-lg pl-10 pr-3 py-2 text-base" />
                  </div>
                </div>
                <div>
                  <Label className="text-slate-400 text-base">Message (optional)</Label>
                  <MessageInput
                    value={giftNote}
                    onChange={setGiftNote}
                    gifUrl={giftGifUrl}
                    onGifChange={setGiftGifUrl}
                    placeholder="Add a message…"
                    maxLength={300}
                    defaultGifQuery="lottery"
                    className="mt-1.5 [&_input]:h-11 [&_input]:bg-white/[0.03] [&_input]:border-white/10 [&_input]:text-slate-100 [&_input]:placeholder:text-slate-600"
                  />
                </div>
                <p className="text-sm text-slate-500">They'll get a claim link — the ticket enters the draw as soon as they claim it.</p>
              </div>
            )}
          </div>

          {/* Ticket count selector */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-slate-300 text-xl font-sans font-medium">Tickets</p>
              <div className="flex gap-1.5">
                {PRESETS.map(n => (
                  <button key={n} onClick={() => setCount(n)}
                    className={["px-3 py-1.5 rounded-lg text-base font-medium transition-all border",
                      numTickets === n
                        ? "bg-[#FF7A2A]/20 border-[#FF7A2A]/40 text-[#FF7A2A]"
                        : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"].join(" ")}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
              <button onClick={() => setCount(numTickets - 1)}
                className="w-14 h-12 flex items-center justify-center text-2xl text-slate-300 hover:text-white hover:bg-white/[0.06] transition-all shrink-0">
                −
              </button>
              <span className="flex-1 text-center text-2xl font-bold text-white tabular-nums">{numTickets}</span>
              <button onClick={() => setCount(numTickets + 1)}
                className="w-14 h-12 flex items-center justify-center text-2xl text-slate-300 hover:text-white hover:bg-white/[0.06] transition-all shrink-0">
                +
              </button>
            </div>
          </div>

          {/* Choose numbers — collapsible for ≤10 tickets, random notice for 11+ (skipped when gifting, since the recipient's numbers are always assigned randomly at claim time) */}
          {giftMode ? (
            <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <Shuffle className="w-4 h-4 text-slate-400 shrink-0" />
              <p className="text-base text-slate-300">Numbers are picked randomly when they claim their ticket</p>
            </div>
          ) : numTickets <= 10 ? (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
              <button type="button" onClick={() => setChooseOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors">
                <span className="text-base font-medium text-slate-200">Choose numbers</span>
                <ChevronDown className={["w-4 h-4 text-slate-400 transition-transform duration-200", chooseOpen ? "rotate-180" : ""].join(" ")} />
              </button>
              {chooseOpen && (
                <div className="px-4 pb-4 border-t border-white/[0.06]">
                  <div className="mt-4">
                    <ChooseNumbers tickets={tickets} setTickets={(t) => {
                      setTickets(t);
                      setNumTickets(t.length);
                    }} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <Shuffle className="w-4 h-4 text-slate-400 shrink-0" />
              <p className="text-base text-slate-300">Numbers picked randomly for 11+ tickets</p>
            </div>
          )}

          {privacyBurstKey != null && <PrivacyConfettiBurst key={privacyBurstKey} onDone={() => setPrivacyBurstKey(null)} />}
          <IncognitoModeToggle checked={sendPrivately} onCheckedChange={handleToggleSendPrivately} />

          {sendPrivately ? (
            <FeeBreakdown ticketCostUsd={numTickets} mode="buy" solPriceUsd={solPriceUsd} />
          ) : (
            <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
              <div className="flex justify-between px-4 py-3.5">
                <span className="text-base text-slate-400">Tickets ({numTickets} × $1.00)</span>
                <span className="text-base text-slate-200 tabular-nums">{fmt(numTickets)}</span>
              </div>
              <div className="flex justify-between px-4 py-3.5">
                <span className="text-base font-semibold text-white">Total to send</span>
                <span className="text-base font-semibold text-white tabular-nums">{fmt(numTickets)}</span>
              </div>
            </div>
          )}

          {step === "error" && stepError && (
            <p className="text-base text-red-400">{stepError}</p>
          )}
          {giftMode && giftStep === "error" && giftError && (
            <p className="text-base text-red-400">{giftError}</p>
          )}

          {drawCutoff && (
            <p className="text-sm text-amber-400 text-center">
              Sales pause a few minutes before each draw{drawTimeLabel ? ` (${drawTimeLabel} CET)` : ""} — back right after.
            </p>
          )}

          {authenticated && ((giftMode ? giftErrorIsBalance : stepErrorIsBalance) || (!isBalanceLoading && insufficientBalance)) ? (
            <InsufficientBalanceCard balanceUSD={balanceUSD} neededUSD={totalCostUsd} />
          ) : giftMode ? (
            <button onClick={!authenticated ? () => login() : () => handleGiftBuy()}
              disabled={authenticated && (drawCutoff || giftStep === "signing" || !giftIdentifier.trim())}
              className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-2">
              {!authenticated ? (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign in to continue
                </>
              ) : giftStep === "signing" ? "Signing…" : (
                <>
                  <Gift className="w-5 h-5" />
                  {drawCutoff ? "Sales paused" : `Gift${sendPrivately ? " privately" : ""} · ${fmt(totalCostUsd)}`}
                </>
              )}
            </button>
          ) : (
            <button onClick={!authenticated ? () => login() : () => (sendPrivately ? handlePrivateBuy() : handlePublicBuy())}
              disabled={authenticated && drawCutoff}
              className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 flex items-center justify-center gap-2">
              {!authenticated ? (
                <>
                  <LogIn className="w-5 h-5" />
                  Sign in to continue
                </>
              ) : (drawCutoff ? "Sales paused" : `Buy${sendPrivately ? " privately" : ""} · ${fmt(totalCostUsd)}`)}
            </button>
          )}
        </>
      )}
    </div>
  );
}



/**
 * The featured "Play again" CTA — a moving lightning-glow border to sell it as the better deal vs.
 * withdrawing. Reduced-motion falls back to a static glow.
 */
function GlowPlayAgainButton({ onClick, disabled, children }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="relative">
      <style>{`
        @keyframes looftaGlowShift { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes looftaGlowPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
      `}</style>
      <div
        aria-hidden
        className="absolute -inset-[2.5px] rounded-2xl blur-[7px]"
        style={{
          background: "linear-gradient(110deg,#FF0F00,#FF7A2A,#EAB308,#FF7A2A,#FF0F00)",
          backgroundSize: "220% 100%",
          animation: reduceMotion ? undefined : "looftaGlowShift 2.4s linear infinite, looftaGlowPulse 2.4s ease-in-out infinite",
          opacity: reduceMotion ? 0.7 : undefined,
        }}
      />
      <button
        onClick={onClick}
        disabled={disabled}
        className="relative w-full h-14 rounded-2xl font-bold text-lg bg-[#0d0d11] border border-white/10 text-white active:scale-[0.99] transition-transform disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A2A]/60"
      >
        <span className="bg-gradient-to-r from-[#FF7A2A] to-[#EAB308] bg-clip-text text-transparent">
          {children}
        </span>
      </button>
    </div>
  );
}

// Promo banner for the Mystery Pack feature, shown at the top of the Buy tab — this is meant to
// be a high-conversion traffic driver, so it gets its own subtle animated brand-gradient glow
// (same technique as GlowPlayAgainButton above, but the pack's own red/orange/yellow palette
// instead of that button's green/teal, to visually match the pack foil + payment confirm button
// the user lands on next) rather than the flat bordered card it started as.
function MysteryPackBanner() {
  const reduceMotion = useReducedMotion();
  return (
    <Link
      href="/app/megapot/packs"
      className="relative mb-4 block rounded-2xl active:scale-[0.99] transition-transform"
    >
      <style>{`@keyframes packBannerGlow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }`}</style>
      <div
        aria-hidden
        className="absolute -inset-px rounded-2xl blur-[6px]"
        style={{
          background: "linear-gradient(110deg,#FF1301,#FF6A00,#EAB308,#FF4A26,#FF1301)",
          backgroundSize: "220% 100%",
          animation: reduceMotion ? undefined : "packBannerGlow 6s linear infinite",
          opacity: reduceMotion ? 0.5 : 0.7,
        }}
      />
      <div className="relative flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#15110d] px-4 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          {/* Hand-built glossy 3D-style badge (public/images/icons/mystery-pack-icon.svg) matching
              the look of the app's other 3D icon assets (target-icon.png etc.) — gradient depth,
              gloss highlight, drop shadow — with a "?" medallion mirroring the actual pack's own
              mystery-circle treatment in MegapotPack.tsx's packArt(). */}
          <img src="/images/icons/mystery-pack-icon.svg" alt="" className="w-10 h-10 shrink-0" />
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-100">Mystery Pack</p>
            <p className="text-sm text-slate-400 truncate">Open a pack, win up to 100 tickets</p>
          </div>
        </div>
        <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-3.5 py-2 text-sm font-semibold text-white shrink-0">
          Open
          <ArrowUpRight className="w-4 h-4" />
        </span>
      </div>
    </Link>
  );
}

// ─── Withdraw tab ─────────────────────────────────────────────────────────────

function WithdrawTab({ wonTickets, accessToken, userSolanaAddress, solPriceUsd, onWithdrawn, dashboardLoading, previewDone, previewArrived, withdrawMinUsdc }: {
  wonTickets: TicketSummary[]; accessToken: string | null;
  userSolanaAddress: string; solPriceUsd: number; onWithdrawn: () => void;
  dashboardLoading?: boolean;
  previewDone?: boolean; // dev-only: render the "on its way" post-redeem state directly
  previewArrived?: boolean; // dev-only: render the fully-arrived post-redeem state directly
  withdrawMinUsdc?: number; // backend-reported withdrawal floor (fallback until dashboard loads)
}) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!!previewDone || !!previewArrived);
  const [doneAmount, setDoneAmount] = useState(previewDone || previewArrived ? 272.39 : 0);
  const [error, setError] = useState("");
  const [bridgeFeeUsd, setBridgeFeeUsd] = useState<number | null>(null);
  const [bridgeReceiveUsdc, setBridgeReceiveUsdc] = useState<number | null>(null);
  const [bridgeFeeUnavailable, setBridgeFeeUnavailable] = useState(false);
  const [feeRetryToken, setFeeRetryToken] = useState(0);
  const [withdrawalIds, setWithdrawalIds] = useState<string[]>([]);
  const [arrived, setArrived] = useState(!!previewArrived);
  const [transferFailed, setTransferFailed] = useState(false);
  const [playingAgain, setPlayingAgain] = useState(false);
  const [playAgainDone, setPlayAgainDone] = useState<{ numTickets: number } | null>(null);
  const [playAgainError, setPlayAgainError] = useState("");
  const [confirmingRedeem, setConfirmingRedeem] = useState(false);
  const reduceMotion = useReducedMotion();
  // Not a manual choice — winnings leave the same way the ticket was bought. A ticket funded
  // through a MagicBlock private transfer withdraws privately; a normally-funded ticket withdraws
  // as a standard on-chain transfer. Mixed batch (some private, some not) defaults to private —
  // sending everything as one plain transfer would leak the association with the private buy.
  const sendPrivately = wonTickets.some(t => t.fundedPrivately);

  // Dev preview links navigate client-side (no remount), so the useState initializers above only
  // fire once — clicking from one ?preview= link to another left this stuck on whichever state
  // was current on first mount. Re-sync whenever the preview flags actually change.
  useEffect(() => {
    if (previewArrived) { setDone(true); setArrived(true); setDoneAmount(272.39); }
    else if (previewDone) { setDone(true); setArrived(false); setDoneAmount(272.39); }
  }, [previewDone, previewArrived]);

  // Resume an in-flight redeem across a page refresh — without this, a refresh mid-redeem drops
  // back to "ready to redeem" (the ticket's status stays 'won' until the very end of the
  // pipeline), and clicking Redeem again used to spin up a duplicate withdrawal that raced the
  // first one and got permanently stuck. The backend is now idempotent against that too, but
  // resuming here avoids the confusing "stuck" UI in the first place.
  const WITHDRAWAL_STORAGE_KEY = "megapot_withdrawal";
  // Transfers land in "a few minutes" per the copy below — an hour is generous slack for backend
  // hiccups while still guaranteeing this can't resurrect a multi-day-old withdrawal and block the
  // redeem screen for a ticket won after it.
  const WITHDRAWAL_STORAGE_TTL_MS = 60 * 60 * 1000;
  useEffect(() => {
    if (previewDone || previewArrived) return;
    try {
      const saved = localStorage.getItem(WITHDRAWAL_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { withdrawalIds: string[]; doneAmount: number; savedAt?: number };
      if (!parsed?.withdrawalIds?.length) return;
      if (!parsed.savedAt || Date.now() - parsed.savedAt > WITHDRAWAL_STORAGE_TTL_MS) {
        localStorage.removeItem(WITHDRAWAL_STORAGE_KEY);
        return;
      }
      setWithdrawalIds(parsed.withdrawalIds);
      setDoneAmount(parsed.doneAmount ?? 0);
      setDone(true);
    } catch { /* ignore malformed/missing storage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live progress: poll our withdrawal rows until they all complete (or one fails).
  useEffect(() => {
    if (!done || arrived || transferFailed || !withdrawalIds.length) return;
    const id = setInterval(async () => {
      try {
        const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
        const res = await fetch("/api/lottery/dashboard", { headers });
        if (!res.ok) return;
        const data = await res.json();
        const mine = (data?.withdrawals ?? []).filter((w: WithdrawalSummary) => withdrawalIds.includes(w.id));
        if (!mine.length) return;
        if (mine.some((w: WithdrawalSummary) => w.status === "failed")) {
          setTransferFailed(true);
          localStorage.removeItem(WITHDRAWAL_STORAGE_KEY);
        } else if (mine.every((w: WithdrawalSummary) => w.status === "complete")) {
          // On completion the backend has stamped each row with the actually-delivered amount —
          // show that real figure, not the gross win we optimistically displayed at redeem.
          const delivered = mine.reduce((s: number, w: WithdrawalSummary) => s + (w.amountUsdc ?? 0), 0);
          if (delivered > 0) setDoneAmount(delivered);
          setArrived(true);
          localStorage.removeItem(WITHDRAWAL_STORAGE_KEY);
        }
      } catch { /* keep polling */ }
    }, 5000);
    return () => clearInterval(id);
  }, [done, arrived, transferFailed, withdrawalIds, accessToken]);

  const totalAmount = wonTickets.reduce((sum, t) => sum + (t.winAmountUsdc ?? 0), 0);
  const isBatch = wonTickets.length > 1;
  // Threshold is backend-owned (dashboard.withdrawMinUsdc); fall back only until it loads. Sub-
  // threshold wins are worth less than a ticket after fees — shown as a "Free ticket", the only
  // action is Play Again. At/above it the user may also cash out.
  const minWithdraw = withdrawMinUsdc ?? DEFAULT_WITHDRAW_MIN_USDC;
  // Play-again ticket count, matching the backend playAgainBatch rule: multiple won tickets get
  // consolidated into ONE companion first, so the round-up/floor applies ONCE to the combined
  // total — not once per ticket (that used to double-count round-ups: a $23.02 win + a $2.95 win
  // became 24 + 3 = 27 tickets instead of ceil(25.97) = 26).
  const playAgainTicketCount = totalAmount >= minWithdraw ? Math.max(1, Math.ceil(totalAmount - ROUND_UP_GRACE_USDC)) : Math.floor(totalAmount);
  const canPlayAgain = wonTickets.some(t => (t.winAmountUsdc ?? 0) > 0);
  const isFreeTicket = isFreeTicketAmount(totalAmount, minWithdraw) && canPlayAgain;
  // A win large enough to matter shouldn't default to steering the user back into another draw —
  // feature Withdraw instead and demote Play again to the secondary link.
  const preferWithdraw = !isFreeTicket && canPlayAgain && totalAmount >= WITHDRAW_FEATURED_THRESHOLD_USDC;

  useEffect(() => {
    if (!totalAmount) return;
    let cancelled = false;
    setBridgeFeeUsd(null);
    setBridgeReceiveUsdc(null);
    setBridgeFeeUnavailable(false);
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

    // No fabricated fallback here — a fee estimate that doesn't match the real bridge is worse
    // than showing nothing (see the incident this was hardened for). Retry transient failures a
    // few times; if it still can't get a real number, block redeeming and let the user retry.
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 700 * attempt));
        try {
          const route = sendPrivately ? "solana_private" : "solana_public";
          const res = await fetch(`/api/lottery/bridge-fee?amountUsdc=${totalAmount}&route=${route}`, { headers });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (data?.feeUsd == null || data?.receiveUsdc == null) throw new Error("Malformed response");
          if (cancelled) return;
          setBridgeFeeUsd(data.feeUsd);
          setBridgeReceiveUsdc(data.receiveUsdc);
          return;
        } catch { /* try again */ }
      }
      if (!cancelled) setBridgeFeeUnavailable(true);
    })();

    return () => { cancelled = true; };
  }, [totalAmount, accessToken, feeRetryToken, sendPrivately]);

  async function handleWithdraw() {
    if (!userSolanaAddress || !wonTickets.length) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/lottery/withdraw-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({
          ticketIds: wonTickets.map(t => t.id),
          destinationAddress: userSolanaAddress,
          route: sendPrivately ? "solana_private" : "solana_public",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      const data = await res.json().catch(() => null);
      const ids: string[] = data?.withdrawalIds ?? [];
      setWithdrawalIds(ids);
      setArrived(false);
      setTransferFailed(false);
      // Show the NET the user will actually receive (after fees), not the gross win — the polling
      // above replaces this with the exact delivered amount once the transfer completes.
      const optimisticAmount = bridgeReceiveUsdc ?? totalAmount;
      setDoneAmount(optimisticAmount);
      setDone(true); onWithdrawn();
      if (ids.length) {
        localStorage.setItem(WITHDRAWAL_STORAGE_KEY, JSON.stringify({ withdrawalIds: ids, doneAmount: optimisticAmount, savedAt: Date.now() }));
      }
    } catch (err: any) { setError(err.message ?? "Unknown error"); }
    finally { setLoading(false); }
  }

  /** Claims + reinvests every currently-won ticket — one call, backend consolidates all of them
   *  into a single companion first so multiple wins get exactly one round-up, not one each. */
  async function handlePlayAgain() {
    if (!wonTickets.length) return;
    setPlayingAgain(true); setPlayAgainError("");
    try {
      const res = await fetch(`/api/lottery/tickets/play-again-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ ticketIds: wonTickets.map(t => t.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message ?? "Failed");
      setPlayAgainDone({ numTickets: data?.numTickets ?? 0 });
      onWithdrawn();
    } catch (err: any) {
      setPlayAgainError(err.message ?? "Unknown error");
    } finally {
      setPlayingAgain(false);
    }
  }

  if (dashboardLoading) return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4 animate-pulse">
      <div className="h-5 w-36 rounded-lg bg-white/10" />
      <div className="h-16 rounded-xl bg-white/5" />
      <div className="h-16 rounded-xl bg-white/5" />
      <div className="h-12 rounded-xl bg-white/10" />
    </div>
  );

  if (playAgainDone) return (
    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.08] to-white/[0.02] p-8 text-center space-y-4">
      <div className="text-5xl select-none" aria-hidden="true">🎟️</div>
      <div>
        <p className="text-sm font-bold text-emerald-400 uppercase tracking-[0.2em] mb-2">Played again</p>
        <h2 className="font-display text-4xl font-bold tracking-tight bg-gradient-to-b from-white via-slate-100 to-emerald-200 bg-clip-text text-transparent">
          {playAgainDone.numTickets} new ticket{playAgainDone.numTickets === 1 ? "" : "s"}
        </h2>
        <p className="text-base text-slate-400 mt-2">Your winnings went straight back into the next draw — no fees.</p>
      </div>
      <button onClick={() => setPlayAgainDone(null)}
        className="text-base text-slate-400 hover:text-white underline underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 rounded">
        Back
      </button>
    </div>
  );

  // Checked BEFORE !wonTickets.length below — handleWithdraw() sets done=true and then
  // refetches the dashboard (onWithdrawn), which now excludes the just-redeemed ticket from
  // wonTickets (it's in-flight, no longer "won and unclaimed"). With the guards in the other
  // order, that refetch made wonTickets empty right as the progress tracker should appear,
  // so the "No winnings yet" card flashed in instead — the redeem progress steps looked like
  // they vanished the instant you clicked. `done` is local state driven by the withdrawal
  // itself, so it must win over the derived `wonTickets` prop once a withdrawal is underway.
  if (done) {
    type StepState = "done" | "active" | "pending";
    const steps: { label: string; state: StepState }[] = [
      { label: "Redeemed", state: "done" },
      { label: sendPrivately ? "Traveling privately" : "On the way", state: arrived ? "done" : "active" },
      { label: "In your wallet", state: arrived ? "done" : "pending" },
    ];
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center space-y-6">
        <motion.div
          className={arrived ? "text-6xl select-none" : "mx-auto w-16 h-16 rounded-full flex items-center justify-center border-2 border-[#FF7A2A]/40 text-[#FF7A2A]"}
          aria-hidden="true"
          initial={reduceMotion ? undefined : { scale: 0.5, opacity: 0 }}
          animate={reduceMotion ? undefined : { scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
        >
          {arrived ? "✅" : <Send className="w-6 h-6" />}
        </motion.div>
        <div>
          <p className="text-sm font-bold text-[#FF7A2A] uppercase tracking-[0.2em] mb-2">
            {arrived ? "Withdrawal complete" : "Withdrawal on its way"}
          </p>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white tabular-nums">
            {fmt(doneAmount)}
          </h2>
          <p className="text-lg text-slate-300 mt-3 font-medium">
            {arrived
              ? (sendPrivately ? "is in your Loofta balance" : "is in your wallet")
              : (sendPrivately ? "is heading to your Loofta balance" : "is heading to your wallet")}
          </p>
          <p className="text-base text-slate-400 mt-1">
            {sendPrivately
              ? (arrived
                  ? "Delivered privately to your Loofta balance — no on-chain link back to you."
                  : "Arrives in your Loofta balance in a few minutes. No on-chain link back to you.")
              : (arrived
                  ? "Delivered directly to your wallet."
                  : "Arrives directly in your wallet in a few minutes.")}
          </p>
          {transferFailed && (
            <p className="text-base text-red-400 mt-3">
              Something went wrong in transit — your funds are safe. Check the History tab or contact support.
            </p>
          )}
        </div>

        {/* Progress tracker */}
        <div className="flex items-center justify-center px-2" aria-label="Withdrawal progress: redeemed, now traveling privately to your wallet">
          {steps.map((s, i) => (
            <div key={s.label} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5 w-24">
                <div
                  className={[
                    "w-8 h-8 rounded-full overflow-hidden flex items-center justify-center",
                    s.state === "done" ? "bg-gradient-to-r from-[#EAB308] to-[#FF0F00] border-0" :
                      s.state === "active" ? "bg-transparent border border-[#FF7A2A]/70" :
                        "bg-transparent border border-white/20",
                  ].join(" ")}
                >
                  {s.state === "done" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : s.state === "active" ? (
                    <span className={`w-2.5 h-2.5 rounded-full bg-[#FF7A2A] ${reduceMotion ? "" : "animate-pulse"}`} />
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                  )}
                </div>
                <span className={[
                  "text-sm font-medium leading-tight",
                  s.state === "pending" ? "text-slate-500" : s.state === "active" ? "text-[#FF7A2A] font-semibold" : "text-white",
                ].join(" ")}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={["h-px w-6 -mt-6 shrink-0", s.state === "done" ? "bg-[#FF7A2A]/60" : "bg-white/15"].join(" ")} />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {!arrived && !transferFailed && (
            <p className="text-sm text-slate-500">You can safely leave this page — it continues in the background.</p>
          )}
          {/* Ticket status stays 'won' for the whole claim→bridge→deliver pipeline (see
              initiateWithdrawalBatch) — showing this while still in flight let a user bail back
              into what looked like the exact same unredeemed win, even though it was already being
              delivered. Only offer it once there's actually nothing left in flight to lose track of. */}
          {(arrived || transferFailed) && (
            <button onClick={() => { localStorage.removeItem(WITHDRAWAL_STORAGE_KEY); setDone(false); setDoneAmount(0); setArrived(false); setTransferFailed(false); onWithdrawn(); }}
              className="text-base text-slate-400 hover:text-white underline underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A2A]/50 rounded">
              Back to redeem
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!wonTickets.length) return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
      <Trophy className="w-10 h-10 text-slate-700 mx-auto mb-3" />
      <p className="text-slate-300 text-lg font-medium">No winnings yet</p>
      <p className="text-slate-500 text-base mt-1">Win the daily draw and your prize lands here, ready to redeem privately.</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-6">
      {/* Celebration header */}
      <motion.div
        className="flex flex-col items-center text-center gap-1 pt-1"
        initial={reduceMotion ? undefined : { opacity: 0, y: 10 }}
        animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <motion.div
          className="w-16 h-16 rounded-full border-2 border-[#FF7A2A]/40 flex items-center justify-center text-[#FF7A2A]"
          animate={reduceMotion ? {} : { rotate: [0, -8, 8, -4, 0] }}
          transition={{ duration: 1.2, delay: 0.15 }}
        >
          <Trophy className="w-7 h-7" />
        </motion.div>
        <p className="text-sm font-bold text-[#FF7A2A] uppercase tracking-[0.2em] mt-2">
          {isBatch ? `${wonTickets.length} winning draws` : "You won"}
        </p>
        <h2 className="font-display text-5xl sm:text-6xl font-bold tracking-tight text-white tabular-nums">
          {isFreeTicket ? "Free ticket" : fmt(totalAmount)}
        </h2>
        <p className="text-base text-slate-400 mt-1">
          {isFreeTicket ? "play it again in the next draw" : sendPrivately ? "ready to redeem privately" : "ready to redeem"}
        </p>
      </motion.div>

      {/* Winning ticket(s) */}
      <div className="space-y-2">
        <p className="text-sm text-slate-400 uppercase tracking-wider font-semibold">Your wins</p>
        {wonTickets.map((t, i) => (
          <motion.div
            key={t.id}
            className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-white/10 bg-white/[0.03]"
            initial={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.07 }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0 text-amber-400 text-sm font-bold">
                {t.winTier ? `T${t.winTier}` : <Trophy className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-white text-base font-medium truncate">Winning ticket{t.winTier ? ` · Tier ${t.winTier}` : ""}</p>
                <p className="text-slate-400 text-sm mt-0.5 truncate">
                  {t.drawTime ? new Date(t.drawTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  {t.numTickets > 1 ? ` · from batch of ${t.numTickets}` : ""}
                </p>
              </div>
            </div>
            <span className="text-[#FF7A2A] font-bold text-lg tabular-nums shrink-0 ml-3">
              {t.isFreeTicket ? "Free ticket" : `+${fmt(t.winAmountUsdc ?? 0)}`}
            </span>
          </motion.div>
        ))}
      </div>

      {!isFreeTicket && (
        <div className="rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3.5 flex items-start gap-3">
          {sendPrivately ? (
            <ShieldCheck className="w-4 h-4 text-[#EAB308] mt-0.5 shrink-0" />
          ) : (
            <Send className="w-4 h-4 text-[#EAB308] mt-0.5 shrink-0" />
          )}
          <div>
            <p className="text-base text-white font-semibold">
              {sendPrivately ? "Private withdrawal, automatic" : "Standard withdrawal"}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              {sendPrivately
                ? `You bought ${isBatch ? "these tickets" : "this ticket"} privately, so your winnings leave privately too. One shielded transfer, no on-chain link between your win${isBatch ? "s" : ""} and your wallet.`
                : `You bought ${isBatch ? "these tickets" : "this ticket"} the normal way, so your winnings leave the same way — a standard transfer, straight to your wallet.`}
            </p>
          </div>
        </div>
      )}

      {playAgainError && <p className="text-base text-red-400">{playAgainError}</p>}

      {isFreeTicket ? (
        /* Free ticket — worth less than a ticket's cash value after fees, so the only action is
           to replay it into the next draw (free), rounded up to a whole ticket. No withdraw. */
        <>
          <GlowPlayAgainButton onClick={handlePlayAgain} disabled={playingAgain}>
            {playingAgain ? "Playing again…" : `⚡ Play again — ${playAgainTicketCount} ticket${playAgainTicketCount === 1 ? "" : "s"}, free`}
          </GlowPlayAgainButton>
          <p className="text-center text-sm text-slate-500">Your win goes straight into the next draw — no fees.</p>
        </>
      ) : preferWithdraw ? (
        /* Win ≥ $5: withdrawing is the featured CTA — a win this size shouldn't default to
           nudging the user straight back into another draw. Play again stays one tap away. */
        <>
          {error && <p className="text-base text-red-400">{error}</p>}
          <GradientActionButton
            onClick={handleWithdraw}
            disabled={loading || bridgeFeeUsd === null}
            loading={loading}
            loadingText="Processing..."
            className="!h-12 !text-lg"
          >
            {bridgeFeeUnavailable ? "Fee unavailable — try again above" : bridgeFeeUsd === null ? "Getting real fee quote…" : `Withdraw ~${fmt(bridgeReceiveUsdc ?? totalAmount)}${sendPrivately ? " privately" : ""}`}
          </GradientActionButton>
          <button onClick={handlePlayAgain} disabled={playingAgain}
            className="w-full text-center text-base font-medium text-slate-300 hover:text-white underline underline-offset-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {playingAgain ? "Playing again…" : `or play again — ${playAgainTicketCount} ticket${playAgainTicketCount === 1 ? "" : "s"} instead, free`}
          </button>
        </>
      ) : canPlayAgain ? (
        /* Cash win (≥ $1.30, < $5): play again is the featured, rounded-up, fee-free deal;
           withdrawing is one tap away, de-emphasised, behind a confirmation showing the real net. */
        <>
          <GlowPlayAgainButton onClick={handlePlayAgain} disabled={playingAgain}>
            {playingAgain ? "Playing again…" : `⚡ Play again — ${playAgainTicketCount} ticket${playAgainTicketCount === 1 ? "" : "s"}`}
          </GlowPlayAgainButton>
          <p className="text-center text-sm text-[#FF7A2A]/80 font-medium -mt-1">
            Best value — we round you up to {playAgainTicketCount} whole ticket{playAgainTicketCount === 1 ? "" : "s"}, no fees
          </p>
          {!confirmingRedeem ? (
            <button onClick={() => setConfirmingRedeem(true)} disabled={playingAgain || bridgeFeeUsd === null}
              className="w-full text-center text-base font-medium text-slate-300 hover:text-white underline underline-offset-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {bridgeFeeUnavailable ? "Fee unavailable, retry" : bridgeFeeUsd === null ? "Getting fee quote…" : `or withdraw ~${fmt(bridgeReceiveUsdc ?? totalAmount)} instead`}
            </button>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <p className="text-sm text-slate-400">
                You&apos;ll receive an estimated <span className="text-white font-semibold">{fmt(bridgeReceiveUsdc ?? totalAmount)}</span> after fees (confirmed once claimed on-chain, may come in slightly lower) — playing again gets you {playAgainTicketCount} full new ticket{playAgainTicketCount === 1 ? "" : "s"} instead, free.
              </p>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex items-center gap-3">
                <button onClick={() => setConfirmingRedeem(false)} disabled={loading}
                  className="flex-1 h-10 rounded-lg border border-white/15 text-slate-300 font-medium text-sm hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  Cancel
                </button>
                <button onClick={handleWithdraw} disabled={loading}
                  className="flex-1 h-10 rounded-lg font-semibold text-sm bg-white/10 border border-white/20 text-white hover:bg-white/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  {loading ? "Processing…" : "Confirm redeem"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Edge: a win too small to buy even one replay ticket (< $1) — withdrawal is the only path. */
        <>
          {error && <p className="text-base text-red-400">{error}</p>}
          <GradientActionButton
            onClick={handleWithdraw}
            disabled={loading || !wonTickets.length || bridgeFeeUsd === null}
            loading={loading}
            loadingText="Processing..."
            className="!h-12 !text-lg"
          >
            {bridgeFeeUnavailable ? "Fee unavailable — try again above" : bridgeFeeUsd === null ? "Getting real fee quote…" : `Redeem ~${fmt(bridgeReceiveUsdc ?? totalAmount)}${sendPrivately ? " privately" : ""}`}
          </GradientActionButton>
        </>
      )}
    </div>
  );
}

// ─── History drawer ───────────────────────────────────────────────────────────

function ticketStatusBadgeClass(s: TicketStatus, bridgeStatus?: string | null, drawTime?: string | null, ticketRoundId?: string | null, currentRoundId?: string | null): string {
  if (s === "failed" && bridgeStatus) {
    const bs = bridgeStatus.toUpperCase();
    if (bs === "REFUNDED") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (bs === "EXPIRED") return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  }
  if (s === "active") {
    const drawPassed = (drawTime && new Date(drawTime) < new Date()) ||
      (ticketRoundId && currentRoundId && ticketRoundId !== currentRoundId);
    if (drawPassed) return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  }
  switch (s) {
    case "won": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "withdrawn": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "lost": return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    case "failed": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "active": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default: return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  }
}

const IS_LOCALHOST = typeof window !== "undefined" && window.location.hostname === "localhost";

// Dev-only mock data for previewing the purchase/draw flow without a real purchase (see DevPreviewPanel)
const PREVIEW_TICKETS: TicketNumbers[] = [
  { main: [3, 11, 19, 24, 30], bonus: 7 },
  { main: [1, 8, 15, 22, 29], bonus: 3 },
  { main: [5, 12, 17, 21, 26], bonus: 11 },
];
const PREVIEW_WINNING_NUMBERS_WON = { main: [3, 11, 19, 24, 6], bonus: 7 }; // 4 normals + bonus vs. ticket 1
const PREVIEW_WINNING_NUMBERS_LOST = { main: [2, 6, 9, 14, 20], bonus: 4 };

// Dev-only mock winning tickets for previewing the redeem tab (?preview=redeem / redeem-batch)
const PREVIEW_WON_TICKETS: TicketSummary[] = [
  {
    id: "preview-won-1", status: "won", numTickets: 5, costUsdc: 5, roundId: "412",
    drawTime: new Date(Date.now() - 12 * 3600_000).toISOString(), winAmountUsdc: 272.39, winTier: 2,
    createdAt: new Date(Date.now() - 36 * 3600_000).toISOString(), depositAddress: null,
    bridgeStatus: "DONE", bridgeExpiresAt: null, ticketNumbers: PREVIEW_TICKETS,
    winningNumbers: PREVIEW_WINNING_NUMBERS_WON, fundedPrivately: true,
  },
  {
    id: "preview-won-2", status: "won", numTickets: 1, costUsdc: 1, roundId: "411",
    drawTime: new Date(Date.now() - 36 * 3600_000).toISOString(), winAmountUsdc: 12.5, winTier: 4,
    createdAt: new Date(Date.now() - 60 * 3600_000).toISOString(), depositAddress: null,
    bridgeStatus: "DONE", bridgeExpiresAt: null, ticketNumbers: PREVIEW_TICKETS.slice(0, 1),
    winningNumbers: PREVIEW_WINNING_NUMBERS_WON, fundedPrivately: true,
  },
  {
    id: "preview-won-3", status: "won", numTickets: 10, costUsdc: 10, roundId: "410",
    drawTime: new Date(Date.now() - 60 * 3600_000).toISOString(), winAmountUsdc: 3.75, winTier: 5,
    createdAt: new Date(Date.now() - 84 * 3600_000).toISOString(), depositAddress: null,
    bridgeStatus: "DONE", bridgeExpiresAt: null, ticketNumbers: PREVIEW_TICKETS,
    winningNumbers: PREVIEW_WINNING_NUMBERS_WON,
  },
  // Small cash win ($1.30–$4.99) — routes to the featured "Play again" glow button instead of
  // Withdraw (see preferWithdraw/canPlayAgain below). $4.95 is the practical max for this branch:
  // playAgainTicketCount = ceil(amount - 0.1), and >= $5 flips to the Withdraw-featured branch —
  // so 5 tickets is the highest this glow-button state can show, not 6.
  {
    id: "preview-won-4", status: "won", numTickets: 5, costUsdc: 5, roundId: "409",
    drawTime: new Date(Date.now() - 20 * 3600_000).toISOString(), winAmountUsdc: 4.95, winTier: 5,
    createdAt: new Date(Date.now() - 44 * 3600_000).toISOString(), depositAddress: null,
    bridgeStatus: "DONE", bridgeExpiresAt: null, ticketNumbers: PREVIEW_TICKETS,
    winningNumbers: PREVIEW_WINNING_NUMBERS_WON, fundedPrivately: false,
  },
];

/** Returns the next UTC timestamp for 19:00:00 Europe/Paris, handling CET/CEST automatically. */
function nextParisDrawDate(after = new Date()): Date {
  for (let ahead = 0; ahead <= 2; ahead++) {
    const ref = new Date(after.getTime() + ahead * 86_400_000);
    const parisDate = new Intl.DateTimeFormat("sv", {
      timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(ref); // "YYYY-MM-DD"
    // Try UTC+2 (CEST) then UTC+1 (CET)
    for (const offset of [2, 1]) {
      const utcH = String(19 - offset).padStart(2, "0");
      const candidate = new Date(`${parisDate}T${utcH}:00:00Z`);
      const parisH = parseInt(
        new Intl.DateTimeFormat("en", { timeZone: "Europe/Paris", hour: "numeric", hour12: false }).format(candidate),
      ) % 24;
      if (parisH === 19 && candidate.getTime() > after.getTime()) return candidate;
    }
  }
  return new Date(after.getTime() + 86_400_000);
}

// Purchases pause this long before the draw — mirrors DRAW_PURCHASE_CUTOFF_MS in
// lottery.service.ts (backend is the real enforcement; this is just so the UI doesn't let
// someone start a purchase the backend is about to reject).
const DRAW_PURCHASE_CUTOFF_MS = 5 * 60_000;

function PrizePoolHero({ prizePool, drawTime, onHowToPlay, onPrizeTiers }: {
  prizePool: string | null;
  drawTime: string | null;
  onHowToPlay: () => void;
  onPrizeTiers: () => void;
}) {
  // Prefer API draw time; fall back to computing next 19:00 Paris ourselves
  const target = useMemo(() => {
    if (drawTime) {
      const d = new Date(drawTime);
      if (d.getTime() > Date.now()) return d;
    }
    return nextParisDrawDate();
  }, [drawTime]);

  const [cd, setCd] = useState({ h: 0, m: 0, s: 0, done: false });
  useEffect(() => {
    const tick = () => {
      const diff = target.getTime() - Date.now();
      if (diff <= 0) { setCd({ h: 0, m: 0, s: 0, done: true }); return; }
      setCd({ h: Math.floor(diff / 3_600_000), m: Math.floor((diff % 3_600_000) / 60_000), s: Math.floor((diff % 60_000) / 1000), done: false });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target]);

  const amount = prizePool ? Math.round(parseFloat(prizePool) / 100_000) * 100_000 : 1_100_000;
  const pad = (n: number) => String(n).padStart(2, "0");
  const segs = [
    { v: cd.done ? "00" : pad(cd.h), l: "HRS" },
    { v: cd.done ? "00" : pad(cd.m), l: "MIN" },
    { v: cd.done ? "00" : pad(cd.s), l: "SEC" },
  ];

  return (
    <div className="text-center pt-2 pb-7 px-2">
      <p className="text-sm font-bold tracking-[0.22em] text-slate-500 uppercase mb-4">Prize Pool</p>
      <p
        className="font-black leading-none tracking-tight bg-gradient-to-b from-white via-slate-100 to-amber-200 bg-clip-text text-transparent select-none"
        style={{
          filter: "drop-shadow(0 3px 28px rgba(251,146,60,0.22))",
          // Fluid instead of a fixed 72px→84px breakpoint jump — the fixed size overflowed and
          // clipped at the viewport edge on narrower phones once the pool hit 7 digits.
          fontSize: "clamp(40px, 13vw, 84px)",
        }}
      >
        ${amount.toLocaleString("en-US")}
      </p>

      <div className="flex items-end justify-center gap-1.5 mt-6">
        {segs.map((seg, i) => (
          <div key={seg.l} className="flex items-end gap-1.5">
            {i > 0 && <span className="text-slate-600 font-bold text-lg pb-4">:</span>}
            <div className="flex flex-col items-center">
              <div className="w-[52px] h-[52px] rounded-xl bg-white/[0.06] border border-white/[0.09] flex items-center justify-center">
                <span className="text-[26px] font-bold text-white tabular-nums leading-none">{seg.v}</span>
              </div>
              <span className="text-[10px] text-slate-600 font-bold tracking-[0.18em] mt-1.5 uppercase">{seg.l}</span>
            </div>
          </div>
        ))}
      </div>
      {cd.done && <p className="text-sm text-amber-400 mt-2 font-medium">Draw in progress 🎯</p>}

      <div className="flex items-center justify-center gap-3 mt-6">
        <button onClick={onHowToPlay} className="px-5 py-2 rounded-full border border-white/[0.15] text-slate-300 font-medium text-sm hover:bg-white/[0.06] transition-colors">
          How to Play
        </button>
        <button onClick={onPrizeTiers} className="px-5 py-2 rounded-full border border-white/[0.15] text-slate-300 font-medium text-sm hover:bg-white/[0.06] transition-colors">
          Prize Tiers
        </button>
      </div>
    </div>
  );
}

function HistoryTab({ history, withdrawals, activeTickets, getAccessToken, onRefresh, refetch, userSolanaAddress, loading, nextDrawRoundId, withdrawMinUsdc }: {
  history: TicketSummary[]; withdrawals: WithdrawalSummary[]; activeTickets: TicketSummary[];
  getAccessToken: () => Promise<string | null>; onRefresh: () => void; refetch?: () => void;
  userSolanaAddress: string; loading?: boolean; nextDrawRoundId?: string | null;
  withdrawMinUsdc?: number;
}) {
  const isAppPath = usePathname()?.startsWith("/app");
  const megapotBase = isAppPath ? "/app/megapot" : "/megapot";
  // Backend-owned threshold; below it a win is a "free ticket" and shown as "Free" in history
  // (works for won AND already-played-again/withdrawn rows, unlike the won-only isFreeTicket flag).
  const minWithdraw = withdrawMinUsdc ?? DEFAULT_WITHDRAW_MIN_USDC;
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [historyFilter, setHistoryFilter] = useState<"all" | "mine" | "gifted">("all");
  const syncedIds = useRef<Set<string>>(new Set());

  // Gifts you sent — separate from your own tickets, since ownership of a claimed gift's ticket
  // belongs to the recipient, not you (see LotteryService.purchaseGiftTickets).
  const GIFTS_PAGE = 20;
  const { user: giftsUser } = usePrivy();
  const [myGifts, setMyGifts] = useState<MyGiftItem[]>([]);
  const [myGiftsTotal, setMyGiftsTotal] = useState(0);
  const [loadingMoreGifts, setLoadingMoreGifts] = useState(false);
  const [copiedGiftId, setCopiedGiftId] = useState<string | null>(null);
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);
  const [editRecipientValue, setEditRecipientValue] = useState("");
  const [savingRecipientId, setSavingRecipientId] = useState<string | null>(null);
  const [editRecipientError, setEditRecipientError] = useState<string | null>(null);
  useEffect(() => {
    if (!giftsUser?.id) return;
    (async () => {
      try {
        const accessToken = await getAccessToken();
        const { gifts, total } = await getMyGifts(giftsUser.id, 0, GIFTS_PAGE, accessToken);
        setMyGifts(gifts);
        setMyGiftsTotal(total);
      } catch { /* non-fatal */ }
    })();
  }, [giftsUser?.id, getAccessToken]);
  async function fetchMoreGifts() {
    if (!giftsUser?.id || myGifts.length >= myGiftsTotal || loadingMoreGifts) return;
    setLoadingMoreGifts(true);
    try {
      const accessToken = await getAccessToken();
      const { gifts, total } = await getMyGifts(giftsUser.id, myGifts.length, GIFTS_PAGE, accessToken);
      setMyGifts(prev => [...prev, ...gifts]);
      setMyGiftsTotal(total);
    } catch { /* non-fatal */ }
    finally { setLoadingMoreGifts(false); }
  }
  function copyGiftLink(giftId: string, url: string) {
    navigator.clipboard.writeText(url);
    setCopiedGiftId(giftId);
    setTimeout(() => setCopiedGiftId(null), 1500);
  }

  function startEditRecipient(g: MyGiftItem) {
    setEditingGiftId(g.giftId);
    setEditRecipientValue(g.recipientIdentifier);
    setEditRecipientError(null);
  }

  async function saveEditRecipient(giftId: string) {
    if (!giftsUser?.id) return;
    const trimmed = editRecipientValue.trim();
    if (!trimmed) { setEditRecipientError("Required"); return; }
    const recipientType = trimmed.includes("@") && trimmed.includes(".") ? "email" : "handle";
    setSavingRecipientId(giftId);
    setEditRecipientError(null);
    try {
      const accessToken = await getAccessToken();
      await updateGiftRecipient(giftId, recipientType, trimmed.replace(/^@+/, ""), giftsUser.id, accessToken);
      setMyGifts(prev => prev.map(g => g.giftId === giftId
        ? { ...g, recipientType, recipientIdentifier: trimmed.replace(/^@+/, "") }
        : g));
      setEditingGiftId(null);
    } catch (e: any) {
      setEditRecipientError(e?.message || "Couldn't save — try again.");
    } finally {
      setSavingRecipientId(null);
    }
  }

  // Call sync-numbers API when expanding a card that has no numbers, then poll until they arrive
  const toggleExpand = useCallback(async (ticketId: string, ticketHasNumbers: boolean) => {
    const isOpening = !expandedIds.has(ticketId);
    setExpandedIds(prev => { const next = new Set(prev); isOpening ? next.add(ticketId) : next.delete(ticketId); return next; });

    if (isOpening && !ticketHasNumbers && !syncedIds.current.has(ticketId)) {
      syncedIds.current.add(ticketId);
      const token = await getAccessToken();
      if (!token) return;
      try {
        await fetch(`/api/lottery/tickets/${ticketId}/sync-numbers`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* non-fatal */ }
      // Poll for updated numbers
      refetch?.();
      const iv = setInterval(() => refetch?.(), 4_000);
      setTimeout(() => clearInterval(iv), 30_000); // stop after 30s
    }
  }, [expandedIds, getAccessToken, refetch]);

  const allTickets = [...activeTickets, ...history];

  const [cancelling, setCancelling] = useState<string | null>(null);
  const [rescuing, setRescuing] = useState<string | null>(null);
  const [rescueResult, setRescueResult] = useState<Record<string, string>>({});
  const [rescuingBurner, setRescuingBurner] = useState<string | null>(null);
  const [rescueBurnerResult, setRescueBurnerResult] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [ticketShowAll, setTicketShowAll] = useState<Record<string, boolean>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);

  // Pagination: the dashboard ships the newest history; older pages come from
  // /api/lottery/history on demand. Rendering is windowed by visibleCount.
  const HISTORY_PAGE = 20;
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE);
  const [extraHistory, setExtraHistory] = useState<TicketSummary[]>([]);
  const [serverHasMore, setServerHasMore] = useState(history.length >= HISTORY_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);

  const awaitingDeposit = activeTickets.filter(t => t.status === "pending_send");
  const inFlight = activeTickets.filter(t => ["sent", "bridging", "buying"].includes(t.status));
  const completed = (() => {
    const seen = new Set<string>();
    return [...activeTickets.filter(t => t.status === "active"), ...history, ...extraHistory]
      .filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return t.bridgeStatus !== "CANCELLED";
      })
      .sort((a, b) => {
        // Failed tickets float to top
        if (a.status === "failed" && b.status !== "failed") return -1;
        if (b.status === "failed" && a.status !== "failed") return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  })();
  // Unified, chronologically-interleaved history — a gift you sent isn't a ticket you own (once
  // claimed, ownership moves to the recipient), but it's still "your" history, so it belongs in
  // the same follow-each-other list as your own tickets rather than a separately pinned section.
  type HistoryRow =
    | { kind: "ticket"; date: string; failed: boolean; ticket: TicketSummary }
    | { kind: "gift"; date: string; failed: boolean; gift: MyGiftItem };
  const mergedHistory: HistoryRow[] = [
    ...completed.map(t => ({ kind: "ticket" as const, date: t.createdAt, failed: t.status === "failed", ticket: t })),
    ...myGifts.map(g => ({ kind: "gift" as const, date: g.createdAt, failed: g.status === "failed", gift: g })),
  ].sort((a, b) => {
    if (a.failed && !b.failed) return -1;
    if (b.failed && !a.failed) return 1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });
  const visibleMerged = mergedHistory.slice(0, visibleCount);
  const hasMore = mergedHistory.length > visibleCount || serverHasMore || myGifts.length < myGiftsTotal;

  async function fetchMoreTicketHistory() {
    if (!serverHasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await getAccessToken();
      const offset = history.length + extraHistory.length;
      const res = await fetch(`/api/lottery/history?offset=${offset}&limit=${HISTORY_PAGE}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      const fetched: TicketSummary[] = data?.tickets ?? [];
      setExtraHistory(prev => [...prev, ...fetched]);
      setServerHasMore(offset + fetched.length < (data?.total ?? 0));
    } catch (e) {
      console.error("Load more history failed", e);
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleLoadMore() {
    if (mergedHistory.length > visibleCount) {
      setVisibleCount(c => c + HISTORY_PAGE);
      return;
    }
    await Promise.all([fetchMoreTicketHistory(), fetchMoreGifts()]);
    setVisibleCount(c => c + HISTORY_PAGE);
  }

  const allForStats = [...activeTickets, ...history];
  // Gift-received tickets cost the claimant nothing — don't count them as spend (they still show
  // up in the list below, just labeled "Gifted" instead of a debit).
  const ticketSpent = allForStats.filter(t => t.status !== "failed" && !t.isGift).reduce((s, t) => s + t.costUsdc, 0);
  const ticketWon = allForStats.filter(t => t.status === "won" || t.status === "withdrawn").reduce((s, t) => s + (t.winAmountUsdc ?? 0), 0);
  const giftSpent = myGifts.filter(g => g.status !== "failed").reduce((s, g) => s + g.costUsdc, 0);
  // "Spent"/"Won" fold gift spend into one number rather than a separate card — dynamically
  // recomputed per the All/My tickets/Gifted filter below.
  const totalSpent = historyFilter === "mine" ? ticketSpent : historyFilter === "gifted" ? giftSpent : ticketSpent + giftSpent;
  const totalWon = historyFilter === "gifted" ? 0 : ticketWon;

  async function handleCancel(ticketId: string) {
    setCancelling(ticketId);
    try {
      const token = await getAccessToken();
      await fetch(`/api/lottery/tickets/${ticketId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      onRefresh();
    } finally {
      setCancelling(null);
    }
  }

  async function handleDelete(ticketId: string) {
    setDeleting(ticketId);
    try {
      const token = await getAccessToken();
      await fetch(`/api/lottery/tickets/${ticketId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      refetch?.();
    } catch (e: any) {
      console.error("Delete failed", e);
    } finally {
      setDeleting(null);
    }
  }

  async function handleRetry(ticketId: string) {
    setRetrying(ticketId);
    setRetryResult(r => ({ ...r, [ticketId]: "Queuing retry..." }));
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/lottery/tickets/${ticketId}/retry`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok) {
        setRetryResult(r => ({ ...r, [ticketId]: "Retry queued — ticket will be processed in the next cron run (~1 min)." }));
        // A single refresh at a fixed delay used to land before the cron had actually processed
        // the retry (it can take up to ~1 min), so the list still showed the stale status and the
        // buyer had to manually reload once it was actually done. Poll a few times across that
        // window instead so the UI catches up on its own.
        let pollCount = 0;
        const pollInterval = setInterval(() => {
          pollCount++;
          onRefresh();
          if (pollCount >= 12) clearInterval(pollInterval); // ~90s total (12 × ~7.5s)
        }, 7_500);
      } else {
        setRetryResult(r => ({ ...r, [ticketId]: `Error: ${data.message ?? "Unknown error"}` }));
      }
    } catch (e: any) {
      setRetryResult(r => ({ ...r, [ticketId]: `Error: ${e.message}` }));
    } finally {
      setRetrying(null);
    }
  }

  // Page-level "refresh everything" — re-derives every stale ticket server-side (drawn-but-
  // unresolved, or won/lost-but-unclaimed, see refreshDashboard in lottery.service.ts) instead of
  // a per-ticket "Check Results" button the user has to click one at a time.
  async function handleRefreshAll() {
    setRefreshingAll(true);
    try {
      const token = await getAccessToken();
      await fetch("/api/lottery/dashboard/refresh", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch { /* non-fatal — refetch below still shows whatever's already there */ }
    finally {
      setRefreshingAll(false);
      refetch?.() ?? onRefresh();
    }
  }

  async function handleRescue(ticketId: string) {
    setRescuing(ticketId);
    setRescueResult(r => ({ ...r, [ticketId]: "Sending rescue request..." }));
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/lottery/tickets/${ticketId}/rescue`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok && data.rescued) {
        setRescueResult(r => ({ ...r, [ticketId]: data.message ?? "Rescue submitted — USDC being sent to safe wallet." }));
        setTimeout(onRefresh, 3000);
      } else if (res.ok) {
        // Nothing found on Base — funds are likely still on Solana, point at that option.
        setRescueResult(r => ({ ...r, [ticketId]: data.message ?? "No funds found on Base." }));
      } else {
        setRescueResult(r => ({ ...r, [ticketId]: `Error: ${data.message ?? "Unknown error"}` }));
      }
    } catch (e: any) {
      setRescueResult(r => ({ ...r, [ticketId]: `Error: ${e.message}` }));
    } finally {
      setRescuing(null);
    }
  }

  async function handleRescueBurner(ticketId: string) {
    if (!userSolanaAddress) {
      setRescueBurnerResult(r => ({ ...r, [ticketId]: "Error: Loofta wallet address not found." }));
      return;
    }
    setRescuingBurner(ticketId);
    setRescueBurnerResult(r => ({ ...r, [ticketId]: "Checking burner wallet..." }));
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/lottery/tickets/${ticketId}/rescue-burner`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRescueBurnerResult(r => ({ ...r, [ticketId]: data.message }));
        setTimeout(onRefresh, 3000);
      } else {
        setRescueBurnerResult(r => ({ ...r, [ticketId]: data.message ?? "Error: " + (data.message ?? "Unknown error") }));
      }
    } catch (e: any) {
      setRescueBurnerResult(r => ({ ...r, [ticketId]: `Error: ${e.message}` }));
    } finally {
      setRescuingBurner(null);
    }
  }

  function copyAddress(id: string, addr: string) {
    navigator.clipboard.writeText(addr);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  function renderGiftRow(g: MyGiftItem) {
    const giftStatusStyle: Record<string, string> = {
      unclaimed: "border-amber-500/30 text-amber-400 bg-amber-500/10",
      claimed: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
      cancelled: "border-white/15 text-slate-400 bg-white/5",
      failed: "border-red-500/30 text-red-400 bg-red-500/10",
    };
    const giftStatusLabel: Record<string, string> = {
      unclaimed: "Not yet claimed",
      claimed: "Claimed",
      cancelled: "Cancelled",
      failed: "Failed",
    };
    const recipientLabel = g.recipientType === "handle" ? `@${g.recipientIdentifier}` : g.recipientIdentifier;
    const key = `gift-${g.giftId}`;
    const isExpanded = expandedIds.has(key);
    const dateStr = new Date(g.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    return (
      // Same card shell/height/icon/font weight as a ticket row — a sent gift belongs in the
      // same visual family as your own tickets, just tagged via the "→ @recipient" title and badge.
      <div key={key} className="rounded-xl border bg-white/5 overflow-hidden border-white/10">
        <button
          onClick={() => setExpandedIds(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; })}
          className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
        >
          <img src="/images/icons/ticket-icon.svg" alt="" className="w-9 h-9 shrink-0 opacity-90" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-white">
                {g.numTickets} ticket{g.numTickets !== 1 ? "s" : ""} → {recipientLabel}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${giftStatusStyle[g.status] ?? "border-white/15 text-slate-400 bg-white/5"}`}>
                {giftStatusLabel[g.status] ?? g.status}
              </span>
            </div>
            <p className="text-base text-slate-500 mt-0.5">
              {dateStr}
              {g.claimedAt && ` · claimed ${new Date(g.claimedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-base font-semibold font-sans text-slate-500">−{fmt(g.costUsdc)}</span>
            <ChevronDown className={`w-4 h-4 text-slate-600 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
          </div>
        </button>

        {isExpanded && (
          <div className="border-t border-white/[0.06] px-3 pb-3 pt-3 space-y-3">
            <DescriptionWithGif text={g.note} />
            {g.status === "unclaimed" && (
              editingGiftId === g.giftId ? (
                <div className="space-y-2">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                      {editRecipientValue.includes("@") && editRecipientValue.includes(".") ? <Mail className="h-4 w-4" /> : <AtSign className="h-4 w-4" />}
                    </span>
                    <input
                      value={editRecipientValue}
                      onChange={e => setEditRecipientValue(e.target.value.replace(/^@+/, ""))}
                      placeholder="Email, X handle, or Loofta username"
                      className="w-full bg-white/[0.03] border border-white/10 text-slate-100 placeholder:text-slate-600 rounded-lg pl-10 pr-3 py-2 text-base"
                    />
                  </div>
                  {editRecipientError && <p className="text-sm text-red-400">{editRecipientError}</p>}
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={() => saveEditRecipient(g.giftId)}
                      disabled={savingRecipientId === g.giftId}
                      className="flex-1 h-9 rounded-xl text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-40">
                      {savingRecipientId === g.giftId ? "Saving…" : "Save"}
                    </button>
                    <button type="button"
                      onClick={() => setEditingGiftId(null)}
                      disabled={savingRecipientId === g.giftId}
                      className="flex-1 h-9 rounded-xl text-base font-semibold border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-all disabled:opacity-40">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button"
                  onClick={() => startEditRecipient(g)}
                  className="w-full h-9 rounded-xl text-base font-medium text-slate-400 hover:text-white border border-white/10 hover:bg-white/[0.06] transition-all">
                  Edit recipient
                </button>
              )
            )}
            {(g.status === "unclaimed" || g.status === "claimed") && (
              <div className="flex items-center gap-2 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
                <a href={g.claimUrl} target="_blank" rel="noopener noreferrer"
                  className="flex-1 min-w-0 truncate text-base text-slate-300 hover:text-white hover:underline underline-offset-2 transition-colors">
                  {g.claimUrl}
                </a>
                <button
                  onClick={() => copyGiftLink(g.giftId, g.claimUrl)}
                  className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors"
                  aria-label={g.status === "unclaimed" ? "Copy claim link" : "Copy share link"}
                >
                  {copiedGiftId === g.giftId ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderTicketRow(t: TicketSummary) {
    const dateStr = (t.drawTime ? new Date(t.drawTime) : new Date(t.createdAt))
      .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const hasNumbers = t.ticketNumbers && t.ticketNumbers.length > 0 && t.ticketNumbers[0].main.length > 0;
    const hasAllNumbers = hasNumbers && t.ticketNumbers!.length >= t.numTickets;
    const isFailed = t.status === "failed";
    return (
      <div key={`ticket-${t.id}`} className={`rounded-xl border bg-white/5 overflow-hidden ${isFailed ? "border-red-500/20" : "border-white/10"}`}>
        {/* Main row — clickable to expand */}
        <button
          onClick={() => toggleExpand(t.id, !!hasAllNumbers)}
          className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
        >
          <img src="/images/icons/ticket-icon.svg" alt="" className="w-9 h-9 shrink-0 opacity-90" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-semibold text-white">{t.numTickets} ticket{t.numTickets !== 1 ? "s" : ""}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${ticketStatusBadgeClass(t.status, t.bridgeStatus, t.drawTime, t.roundId, nextDrawRoundId)}`}>
                {statusLabel(t.status, t.bridgeStatus, t.drawTime, t.roundId, nextDrawRoundId)}
              </span>
              {t.isGift && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                  Gifted
                </span>
              )}
              {t.fundedPrivately && (
                <span title="Purchased privately" className="inline-flex items-center shrink-0">
                  <VenetianMask className="w-4 h-4 text-[#FF7A2A]/80" aria-label="Purchased privately" />
                </span>
              )}
            </div>
            <p className="text-base text-slate-500 mt-0.5">
              {t.roundId ? `Round ${t.roundId} · ` : ""}{dateStr}
              {t.winTier ? ` · Tier ${t.winTier}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-base font-semibold font-sans">
              {(t.status === "won" || t.status === "withdrawn")
                ? <span className="text-emerald-400">{isFreeTicketAmount(t.winAmountUsdc, minWithdraw) ? "Free" : `+${fmt(t.winAmountUsdc ?? 0)}`}</span>
                : t.isGift
                  ? null
                  : <span className="text-slate-500">−{fmt(t.costUsdc)}</span>}
            </span>
            <ChevronDown className={`w-4 h-4 text-slate-600 transition-transform ${expandedIds.has(t.id) ? "rotate-180" : ""}`} />
          </div>
        </button>

        {/* Expanded details */}
        {expandedIds.has(t.id) && (
          <div className="border-t border-white/[0.06] px-3 pb-3 pt-3 space-y-3">
            {/* Draw info */}
            {t.drawTime && (
              <div>
                <p className="text-base text-slate-500">
                  Draw: {new Date(t.drawTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
            )}
            {/* Number balls */}
            {hasNumbers ? (
              <div className="space-y-2">
                {!hasAllNumbers && (
                  <p className="text-base text-slate-500 italic">Loading {t.numTickets - t.ticketNumbers!.length} more ticket numbers…</p>
                )}
                {t.winningNumbers && (
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                    <p className="text-[10px] font-bold tracking-[0.16em] text-slate-600 uppercase mb-1.5">Winning numbers</p>
                    <div className="flex items-center gap-2">
                      {t.winningNumbers.main.map(n => (
                        <span key={n} className="w-7 h-7 rounded-full bg-white/10 border border-white/20 text-white text-sm font-bold flex items-center justify-center tabular-nums">{n}</span>
                      ))}
                      <span className="w-7 h-7 rounded-full bg-slate-800 border border-slate-600 text-slate-300 text-sm font-bold flex items-center justify-center tabular-nums">{t.winningNumbers.bonus}</span>
                    </div>
                  </div>
                )}
                <p className="text-base text-slate-600">Your tickets</p>
                {(() => {
                  const matchCount = (tn: TicketNumbers) => {
                    if (!t.winningNumbers) return 0;
                    const m = tn.main.filter(n => t.winningNumbers!.main.includes(n)).length;
                    const b = tn.bonus === t.winningNumbers.bonus ? 1 : 0;
                    return m * 2 + b;
                  };
                  const sorted = [...t.ticketNumbers!].sort((a, b) => matchCount(b) - matchCount(a));
                  const showAll = ticketShowAll[t.id];
                  const visible = showAll ? sorted : sorted.slice(0, 5);
                  return (
                    <>
                      {visible.map((tn, i) => (
                        <TicketNumberCard key={i} tn={tn} winningNumbers={t.winningNumbers} />
                      ))}
                      {!showAll && sorted.length > 5 && (
                        <button
                          type="button"
                          onClick={() => setTicketShowAll(prev => ({ ...prev, [t.id]: true }))}
                          className="w-full h-9 rounded-xl text-base font-medium text-slate-400 hover:text-white border border-white/10 hover:bg-white/[0.06] transition-all"
                        >
                          +{sorted.length - 5} more tickets
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            ) : (
              <p className="text-base text-slate-600 italic">Loading ticket numbers…</p>
            )}
          </div>
        )}

        {/* Failed ticket actions — funds must be retried or rescued before the
          ticket can be removed (RESCUED/CANCELLED = nothing left to recover) */}
        {isFailed && (
          <div className="px-3 pb-3 space-y-2 border-t border-white/[0.06] pt-3">
            {(retryResult[t.id] || rescueResult[t.id]) && (
              <p className="text-base text-amber-400">{retryResult[t.id] || rescueResult[t.id]}</p>
            )}
            {rescueBurnerResult[t.id] && (
              <p className="text-base text-amber-400">{rescueBurnerResult[t.id]}</p>
            )}
            {t.bridgeStatus === "RESCUED" || t.bridgeStatus === "CANCELLED" ? (
              <button
                onClick={() => handleDelete(t.id)}
                disabled={deleting === t.id}
                className="w-full h-9 rounded-xl text-base font-semibold border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-all disabled:opacity-40"
              >
                {deleting === t.id ? "Removing…" : "Remove from history"}
              </button>
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleRetry(t.id)}
                    disabled={retrying === t.id || rescuing === t.id}
                    className="flex-1 h-9 rounded-xl text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-40"
                  >
                    {retrying === t.id ? "Retrying…" : "Retry purchase"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRescue(t.id)}
                    disabled={rescuing === t.id || retrying === t.id}
                    className="flex-1 h-9 rounded-xl text-base font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40"
                  >
                    {rescuing === t.id ? "Rescuing…" : "Rescue funds (Base)"}
                  </button>
                </div>
                {/* Funds from a private purchase can still be sitting on the Solana
                    burner (never bridged, or mid-bridge) — the Base-only rescue above
                    finds nothing in that case, so offer this as a fallback. Dev-only for
                    now — not yet trusted enough to expose as self-service in production. */}
                {IS_LOCALHOST && (
                  <button
                    type="button"
                    onClick={() => handleRescueBurner(t.id)}
                    disabled={rescuingBurner === t.id}
                    className="w-full h-9 rounded-xl text-base font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40"
                  >
                    {rescuingBurner === t.id ? "Rescuing…" : "Rescue from Solana"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Stats cards — Spent folds in gift spend (dynamically re-scoped by the All/My
          tickets/Gifted filter below, not a separate card) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-amber-500/5 border-amber-500/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/20">
              <Ticket className="w-3.5 h-3.5 text-amber-300" />
            </span>
            <p className="text-slate-300 text-base font-medium uppercase tracking-wide">Spent</p>
          </div>
          <p className="text-3xl font-sans font-semibold text-white tabular-nums">{fmt(totalSpent)}</p>
        </div>
        <div className="rounded-2xl border bg-emerald-500/5 border-emerald-500/20 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <Trophy className="w-3.5 h-3.5 text-emerald-300" />
            </span>
            <p className="text-slate-300 text-base font-medium uppercase tracking-wide">Won</p>
          </div>
          <p className="text-3xl font-sans font-semibold text-white tabular-nums">{fmt(totalWon)}</p>
        </div>
      </div>

      {/* Awaiting deposit */}
      {awaitingDeposit.length > 0 && (
        <div>
          <p className="text-base font-medium text-slate-500 uppercase tracking-wider mb-2">Awaiting deposit</p>
          <div className="space-y-2">
            {awaitingDeposit.map(t => (
              <details key={t.id} className="rounded-xl border border-white/10 bg-white/5 group">
                <summary className="flex items-center justify-between p-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                    <span className="text-base font-semibold text-white">{t.numTickets} ticket{t.numTickets !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-base text-amber-400 font-medium">{fmt(t.costUsdc)}</span>
                    <ChevronDown className="w-4 h-4 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
                  </div>
                </summary>
                <div className="px-3 pb-3 pt-0 space-y-3 border-t border-white/10">
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-base text-slate-500">
                      {new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                    {t.bridgeExpiresAt && (
                      <p className={`text-base font-medium ${new Date(t.bridgeExpiresAt) > new Date() ? "text-amber-400/80" : "text-red-400"}`}>
                        {new Date(t.bridgeExpiresAt) > new Date()
                          ? `Expires ${new Date(t.bridgeExpiresAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
                          : "Expired"}
                      </p>
                    )}
                  </div>
                  {t.depositAddress ? (
                    <>
                      <div className="space-y-2">
                        <p className="text-base text-slate-400">Send <span className="text-white font-semibold">{fmt(t.costUsdc)}</span> USDC on Solana to:</p>
                        <div className="flex items-center gap-2 bg-black/30 rounded-xl px-3 py-2.5 border border-white/10">
                          <span className="font-mono text-base text-slate-200 truncate flex-1">{t.depositAddress}</span>
                          <button type="button" onClick={() => copyAddress(t.id, t.depositAddress!)}
                            className="shrink-0 text-slate-400 hover:text-white transition-colors px-1">
                            {copied === t.id
                              ? <span className="text-emerald-400 text-base font-medium">Copied!</span>
                              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                            }
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-base text-slate-500">Deposit address unavailable.</p>
                  )}
                  <button type="button"
                    onClick={() => handleCancel(t.id)}
                    disabled={cancelling === t.id}
                    className="w-full h-10 rounded-xl text-base font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 active:bg-red-500/20 transition-all disabled:opacity-40">
                    {cancelling === t.id ? "Cancelling..." : "Cancel purchase"}
                  </button>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* In progress */}
      {inFlight.length > 0 && (
        <div>
          <p className="text-base font-medium text-slate-500 uppercase tracking-wider mb-2">In progress</p>
          <div className="space-y-2">
            {inFlight.map(t => (
              <details key={t.id} className="rounded-xl border border-white/10 bg-white/5 group">
                <summary className="flex items-center justify-between p-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                    <span className="text-base font-semibold text-white">{t.numTickets} ticket{t.numTickets !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-sm font-medium border ${ticketStatusBadgeClass(t.status, t.bridgeStatus, t.drawTime, t.roundId, nextDrawRoundId)}`}>
                      {statusLabel(t.status, t.bridgeStatus, t.drawTime, t.roundId, nextDrawRoundId)}
                    </span>
                    <ChevronDown className="w-4 h-4 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
                  </div>
                </summary>
                <div className="px-3 pb-3 pt-0 space-y-3 border-t border-white/10">
                  <p className="text-base text-slate-500 pt-2">
                    {new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    {" · "}{fmt(t.costUsdc)}
                  </p>
                  {/* Real users don't need to know which of sent/bridging/buying a ticket is in —
                      it's all the same "still working on it" from their side, and the History tab
                      now auto-refreshes (see the syncing poll effect) until real numbers show up. */}
                  <p className="text-base text-slate-400">Syncing…</p>
                  {IS_LOCALHOST && (
                    <p className="text-sm text-slate-500">
                      Dev detail — status: {t.status}
                      {t.status === "sent" && " (waiting for MagicBlock transfer to arrive in burner wallet)"}
                      {t.status === "bridging" && " (funds in transit to Base)"}
                      {t.status === "buying" && " (funds arrived on Base — buying tickets now)"}
                    </p>
                  )}
                  <Link
                    href={megapotBase}
                    className="w-full h-10 rounded-xl text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all flex items-center justify-center gap-1.5"
                  >
                    View progress <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                  {/* Rescue-from-burner is a dev/debug escape hatch, not something to surface to
                      real users — on prod the backend's own closed-tab-resilience + fee-wallet
                      recovery already handles this automatically, so showing "funds stuck?" with
                      no way to act on it would just alarm people over a normal in-progress ticket. */}
                  {t.status === "sent" && IS_LOCALHOST && (
                    <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
                      <p className="text-base font-semibold text-slate-400">Funds stuck in burner wallet?</p>
                      <p className="text-sm text-slate-500">If it has been more than 2 min since you sent, rescue will return the USDC to your Loofta balance.</p>
                      {rescueBurnerResult[t.id] && (
                        <p className={`text-base font-medium ${rescueBurnerResult[t.id].startsWith("Error") || rescueBurnerResult[t.id].startsWith("Burner") ? "text-red-400" : "text-emerald-400"}`}>
                          {rescueBurnerResult[t.id]}
                        </p>
                      )}
                      {IS_LOCALHOST && (
                        <button type="button"
                          onClick={() => handleRescueBurner(t.id)}
                          disabled={rescuingBurner === t.id}
                          className="w-full h-10 rounded-xl text-base font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40">
                          {rescuingBurner === t.id ? "Rescuing..." : "Rescue from Solana"}
                        </button>
                      )}
                    </div>
                  )}
                  {/* Bridging is fully automatic and can't be safely cancelled — funds are in
                      transit and will arrive on Base. No action needed. Same dev-only reasoning as
                      the "sent" rescue box above — real users get "Syncing…" and nothing to act on. */}
                  {t.status === "buying" && IS_LOCALHOST && (
                    <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
                      <p className="text-base font-semibold text-slate-400">Stuck? Try one of these:</p>
                      {(retryResult[t.id] || rescueResult[t.id]) && (
                        <p className="text-base text-amber-400">{retryResult[t.id] || rescueResult[t.id]}</p>
                      )}
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => handleRetry(t.id)}
                          disabled={retrying === t.id || rescuing === t.id}
                          className="flex-1 h-10 rounded-xl text-base font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-40">
                          {retrying === t.id ? "Retrying..." : "Retry purchase"}
                        </button>
                        <button type="button"
                          onClick={() => handleRescue(t.id)}
                          disabled={rescuing === t.id || retrying === t.id}
                          className="flex-1 h-10 rounded-xl text-base font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40">
                          {rescuing === t.id ? "Rescuing..." : "Rescue funds"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Tickets + gifts you sent — one chronological list, not separated (a sent gift isn't a
          ticket you own, but it's still your history, so it follows the same feed). */}
      {loading && mergedHistory.length === 0 && awaitingDeposit.length === 0 && inFlight.length === 0 ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-4 w-20 rounded-lg bg-white/[0.08]" />
                <div className="h-5 w-12 rounded-full bg-white/[0.06]" />
              </div>
              <div className="h-4 w-14 rounded-lg bg-white/[0.06]" />
            </div>
          ))}
        </div>
      ) : mergedHistory.length === 0 && awaitingDeposit.length === 0 && inFlight.length === 0 ? null
        : mergedHistory.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <p className="text-base font-medium text-slate-500 uppercase tracking-wider">Tickets</p>
                <button
                  type="button"
                  onClick={handleRefreshAll}
                  disabled={refreshingAll}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                  aria-label="Refresh"
                  title="Refresh results"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingAll ? "animate-spin" : ""}`} />
                </button>
              </div>
              {myGifts.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {([["all", "All"], ["mine", "My tickets"], ["gifted", "Gifted"]] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setHistoryFilter(key)}
                      className={`px-2.5 py-1.5 rounded-full text-sm font-semibold border transition-colors ${historyFilter === key
                        ? "bg-white/10 border-white/20 text-white"
                        : "border-white/10 text-slate-500 hover:text-slate-300"
                        }`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {visibleMerged
                .filter(item => historyFilter === "all" || (historyFilter === "mine" ? item.kind === "ticket" : item.kind === "gift"))
                .map(item => item.kind === "gift" ? renderGiftRow(item.gift) : renderTicketRow(item.ticket))}
            </div>
            {hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore || loadingMoreGifts}
                className="w-full h-10 mt-3 rounded-xl text-base font-semibold border border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-40"
              >
                {(loadingMore || loadingMoreGifts) ? "Loading…" : "Show more"}
              </button>
            )}
          </div>
        )}

    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

const FAQ_ITEMS: { question: string; answer: ReactNode }[] = [
  {
    question: "How does a private purchase work?",
    answer: (
      <>
        <p className="mb-3">You pick your tickets and confirm — that&apos;s it. Behind the scenes, four things happen automatically:</p>
        <p className="mb-2"><span className="font-medium text-slate-300">1.</span> Your USDC leaves your Loofta balance through a <span className="font-medium text-slate-300">privacy pool</span> that breaks the link to your wallet.</p>
        <p className="mb-2"><span className="font-medium text-slate-300">2.</span> It lands in a <span className="font-medium text-slate-300">one-time wallet</span> created just for this purchase, then bridges to Base.</p>
        <p className="mb-2"><span className="font-medium text-slate-300">3.</span> A <span className="font-medium text-slate-300">fresh companion wallet on Base</span> buys your Megapot tickets — it has no connection to you or your other purchases.</p>
        <p className="mb-3"><span className="font-medium text-slate-300">4.</span> Your tickets appear in the app with their numbers, usually within <span className="font-medium text-slate-300">1–2 minutes</span>.</p>
        <p>If anything fails along the way, your money is automatically refunded or recoverable from the ticket&apos;s history entry.</p>
      </>
    ),
  },
  {
    question: "What are the fees to buy tickets?",
    answer: (
      <>
        <p className="mb-3">Each ticket costs <span className="font-medium text-slate-300">$1 USDC</span>, plus one combined <span className="font-medium text-slate-300">privacy &amp; processing fee</span> that covers everything: the private MagicBlock transfer (0.1% + $0.20 relay), bridging to Base, and Loofta&apos;s service fee ($0.10 + 0.3%).</p>
        <p>The fee barely changes with purchase size, so bigger purchases cost much less per ticket — about $0.31 total on 1 ticket, but only ~$0.34 total on 10 tickets (3.4¢ per ticket).</p>
      </>
    ),
  },
  {
    question: "How does privacy work?",
    answer: (
      <>
        <p className="mb-3">Your Solana identity is shielded by <span className="font-medium text-slate-300">MagicBlock</span> — a privacy pool that splits your transfer into several smaller parts and delivers each with a randomized delay, making on-chain timing and amount analysis useless.</p>
        <p className="mb-3">The funds land in a <span className="font-medium text-slate-300">fresh one-time Solana wallet</span>, which bridges them to Base — so the bridge only ever sees a brand-new wallet, never yours.</p>
        <p>A <span className="font-medium text-slate-300">brand-new companion wallet is created for every ticket purchase</span>, so even if someone watches Base they can&apos;t link your tickets to each other or to you.</p>
      </>
    ),
  },
  {
    question: "What is MagicBlock?",
    answer: (
      <>
        <p className="mb-3">MagicBlock is a <span className="font-medium text-slate-300">Solana privacy protocol</span> that routes USDC through a shielded pool, split into multiple parts with randomized delays.</p>
        <p>Its fee is <span className="font-medium text-slate-300">0.1% + a flat $0.20 relay</span> — the relay is what submits the transaction privately, so it can never be zero.</p>
      </>
    ),
  },
  {
    question: "What are the withdrawal fees for winnings?",
    answer: (
      <>
        <p className="mb-3"><span className="font-medium text-slate-300">Base wallet — free.</span> The companion wallet sends USDC directly. No fee, but creates a visible on-chain link between the companion wallet and your Base address.</p>
        <p><span className="font-medium text-slate-300">Loofta balance (private) — small fee.</span> A live-quoted bridge fee (Base→Solana) + the MagicBlock relay (0.1% + $0.20). Fully unlinkable — worth it for meaningful winnings.</p>
      </>
    ),
  },
  {
    question: "What happens after I win?",
    answer: (
      <>
        <p className="mb-3">Results are checked at 00:30 UTC daily. If your companion wallet won, the ticket status changes to <span className="font-medium text-slate-300">Won!</span> and the Withdraw tab shows a badge.</p>
        <p>You can withdraw to a Base wallet (free) or privately to your Loofta balance. You can also leave funds on the companion wallet and re-enter the next draw directly from Base — skipping the bridge fee for the next purchase.</p>
      </>
    ),
  },
];

// ─── Live SOL price ───────────────────────────────────────────────────────────

function useSolPrice(): number {
  const { data } = useQuery({
    queryKey: ["sol-price"],
    queryFn: async (): Promise<number> => {
      const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "";
      const apiKey = rpcUrl.split("/").pop() ?? "";
      const r = await fetch(`https://api.g.alchemy.com/prices/v1/${apiKey}/tokens/by-symbol?symbols=SOL`);
      const json = await r.json();
      return parseFloat(json?.data?.[0]?.prices?.find((p: { currency: string }) => p.currency === "usd")?.value ?? "0");
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return data ?? 150;
}

// ─── Draw result modal ────────────────────────────────────────────────────────

type DrawResult = {
  ticketId: string; status: string; winAmountUsdc: number | null; winTier: number | null;
  winningNumbers?: { main: number[]; bonus: number } | null;
  ticketNumbers?: { main: number[]; bonus: number }[] | null;
};

const WON_MODAL_KEY = "loofta_won_modal_v1";

function DrawResultModal({ results, winningNumbers, ticketNumbers, onClose, onRedeem, withdrawMinUsdc }: {
  results: DrawResult[];
  winningNumbers?: { main: number[]; bonus: number } | null;
  ticketNumbers?: { main: number[]; bonus: number }[] | null;
  onClose: () => void;
  onRedeem: () => void;
  withdrawMinUsdc?: number;
}) {
  const isAppPath = usePathname()?.startsWith("/app");
  const megapotBase = isAppPath ? "/app/megapot" : "/megapot";
  const anyWon = results.some(r => r.status === "won");
  const totalWon = results.reduce((sum, r) => sum + (r.winAmountUsdc ?? 0), 0);
  const wonFreeTicket = anyWon && isFreeTicketAmount(totalWon, withdrawMinUsdc ?? DEFAULT_WITHDRAW_MIN_USDC);
  const [showAllTickets, setShowAllTickets] = useState(false);

  const sortedTickets = ticketNumbers ? [...ticketNumbers].sort((a, b) => {
    if (!winningNumbers) return 0;
    const score = (tn: TicketNumbers) =>
      tn.main.filter(n => winningNumbers.main.includes(n)).length * 2 +
      (tn.bonus === winningNumbers.bonus ? 1 : 0);
    return score(b) - score(a);
  }) : [];
  const visibleTickets = showAllTickets ? sortedTickets : sortedTickets.slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl bg-[#1a1a24] border border-white/10 p-5 space-y-4 max-h-[90svh] overflow-y-auto">
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2 pt-1">
          {anyWon ? (
            <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center">
              <Trophy className="w-8 h-8 text-amber-400" />
            </div>
          ) : (
            <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center">
              <Ticket className="w-7 h-7 text-slate-500" />
            </div>
          )}
          <div>
            <p className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-0.5">Draw Result</p>
            {anyWon ? (
              wonFreeTicket ? (
                <>
                  <h2 className="text-2xl font-bold text-white">You won a free ticket!</h2>
                  <p className="text-base font-semibold text-emerald-400">Play it again in the next draw</p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold text-white">You Won!</h2>
                  <p className="text-xl font-semibold text-emerald-400">+{fmt(totalWon)}</p>
                </>
              )
            ) : (
              <>
                <h2 className="text-xl font-bold text-white">No win this time</h2>
                <p className="text-sm text-slate-400">Better luck next draw!</p>
              </>
            )}
          </div>
        </div>

        {/* Winning numbers row */}
        {winningNumbers && (
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 py-2.5">
            <p className="text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase mb-2">Winning numbers</p>
            <div className="flex items-center gap-2.5">
              {winningNumbers.main.map(n => (
                <span key={n} className="w-8 h-8 rounded-full bg-white/10 border border-white/20 text-white text-sm font-bold flex items-center justify-center tabular-nums">
                  {n}
                </span>
              ))}
              <span className="w-8 h-8 rounded-full bg-slate-800 border border-slate-600 text-slate-200 text-sm font-bold flex items-center justify-center tabular-nums">
                {winningNumbers.bonus}
              </span>
            </div>
          </div>
        )}

        {/* Per-ticket breakdown */}
        {sortedTickets.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold tracking-[0.16em] text-slate-500 uppercase">Your tickets</p>
            {visibleTickets.map((tn, i) => (
              <TicketNumberCard key={i} tn={tn} winningNumbers={winningNumbers} />
            ))}
            {!showAllTickets && sortedTickets.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllTickets(true)}
                className="w-full h-9 rounded-xl text-sm font-medium text-slate-400 hover:text-white border border-white/10 hover:bg-white/[0.06] transition-all"
              >
                +{sortedTickets.length - 5} more tickets
              </button>
            )}
          </div>
        )}

        {/* CTAs */}
        {anyWon ? (
          <Link href={`${megapotBase}?tab=redeem`} onClick={onRedeem}
            className="flex items-center justify-center w-full h-11 rounded-xl font-semibold bg-emerald-500 hover:bg-emerald-400 text-white transition-all">
            Redeem Winnings
          </Link>
        ) : (
          <Link href={megapotBase} onClick={onClose}
            className="flex items-center justify-center w-full h-11 rounded-xl font-semibold border border-white/10 text-slate-300 hover:bg-white/[0.06] transition-all">
            Buy tickets for tomorrow
          </Link>
        )}
        <button onClick={onClose} className="w-full h-9 rounded-xl text-sm font-medium text-slate-500 hover:text-slate-300 transition-colors">
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Dev preview panel ─────────────────────────────────────────────────────────
// Localhost-only: jump directly to any screen in the purchase/draw flow with mock
// data, via ?preview=... query params. Never rendered outside IS_LOCALHOST.

const DEV_PREVIEW_LINKS = [
  { label: "Buy form", href: "/app/megapot?tab=buy&preview=reset" },
  { label: "Purchasing…", href: "/app/megapot?tab=buy&preview=buying" },
  { label: "Payment confirmed", href: "/app/megapot?tab=buy&preview=confirmed" },
  { label: "Checking payment (timeout)", href: "/app/megapot?tab=buy&preview=checking" },
  { label: "Good luck", href: "/app/megapot?tab=buy&preview=done" },
  { label: "Draw — Won", href: "/app/megapot?tab=buy&preview=won" },
  { label: "Draw — Lost", href: "/app/megapot?tab=buy&preview=lost" },
  { label: "Redeem — 1 win", href: "/app/megapot?tab=redeem&preview=redeem" },
  { label: "Redeem — batch", href: "/app/megapot?tab=redeem&preview=redeem-batch" },
  { label: "Redeem — play again (glow)", href: "/app/megapot?tab=redeem&preview=redeem-playagain" },
  { label: "Redeem — on its way", href: "/app/megapot?tab=redeem&preview=redeem-done" },
  { label: "Redeem — arrived", href: "/app/megapot?tab=redeem&preview=redeem-arrived" },
] as const;

function DevPreviewPanel() {
  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-1 p-2 rounded-2xl bg-black/85 backdrop-blur border border-white/10 shadow-2xl">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1.5 pt-0.5">Preview flow (dev)</p>
      {DEV_PREVIEW_LINKS.map(l => (
        <Link key={l.label} href={l.href}
          className="text-sm font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg px-2 py-1.5 transition-colors">
          {l.label}
        </Link>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MegapotPage() {
  const { getAccessToken, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: Tab = rawTab === "redeem" ? "redeem" : rawTab === "history" ? "history" : "buy";
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [prizeTiersOpen, setPrizeTiersOpen] = useState(false);
  const accessToken = useRef<string | null>(null);
  const solPriceUsd = useSolPrice();

  const { user: megapotUser } = usePrivy();
  const megapotEmbeddedAddress = ((megapotUser?.linkedAccounts ?? [])
    .find((a: any) => a.type === "wallet" && a.chainType === "solana" &&
      (a.walletClientType === "privy" || a.walletClientType === "privy-v2")) as any)?.address ?? "";
  const userSolanaAddress = megapotEmbeddedAddress || wallets[0]?.address || "";

  const [drawResults, setDrawResults] = useState<DrawResult[]>([]);
  const [showResultModal, setShowResultModal] = useState(false);
  const autoCheckedIds = useRef<Set<string>>(new Set());

  // Dev-only: open the win/loss draw result modal with mock data via ?preview=won|lost (see DevPreviewPanel)
  useEffect(() => {
    if (!IS_LOCALHOST) return;
    const p = searchParams.get("preview");
    if (p === "won") {
      setDrawResults([{
        ticketId: "preview-won", status: "won", winAmountUsdc: 272.39, winTier: null,
        winningNumbers: PREVIEW_WINNING_NUMBERS_WON,
        ticketNumbers: PREVIEW_TICKETS,
      }]);
      setShowResultModal(true);
    } else if (p === "lost") {
      setDrawResults([{
        ticketId: "preview-lost", status: "lost", winAmountUsdc: null, winTier: null,
        winningNumbers: PREVIEW_WINNING_NUMBERS_LOST,
        ticketNumbers: PREVIEW_TICKETS,
      }]);
      setShowResultModal(true);
    } else if (p === "reset") {
      setShowResultModal(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Restore won modal from localStorage on mount (persists until "Redeem" is clicked)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WON_MODAL_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.results?.some((r: DrawResult) => r.status === "won")) {
          setDrawResults(parsed.results);
          setShowResultModal(true);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const fetchDashboard = useCallback(async () => {
    const token = await getAccessToken();
    accessToken.current = token;
    try {
      const res = await fetch("/api/lottery/dashboard", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setDashboard(await res.json());
    } catch { /* ignore */ }
    finally { setDashboardLoading(false); }
  }, [getAccessToken]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Auto-check results for active tickets whose draw time has passed
  useEffect(() => {
    if (!dashboard || !accessToken.current) return;
    const expired = (dashboard.activeTickets ?? []).filter(t =>
      t.status === "active" && (
        (t.drawTime && new Date(t.drawTime) < new Date()) ||
        (t.roundId && dashboard.nextDraw.roundId && t.roundId !== dashboard.nextDraw.roundId)
      )
    );
    const unchecked = expired.filter(t => !autoCheckedIds.current.has(t.id));
    if (!unchecked.length) return;

    unchecked.forEach(t => autoCheckedIds.current.add(t.id));
    const token = accessToken.current;

    Promise.all(
      unchecked.map(async t => {
        try {
          const res = await fetch(`/api/lottery/tickets/${t.id}/check-results`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            return {
              ticketId: t.id,
              status: data.status,
              winAmountUsdc: data.winAmountUsdc ?? null,
              winTier: data.winTier ?? null,
              winningNumbers: data.winningNumbers ?? null,
              ticketNumbers: data.ticketNumbers ?? t.ticketNumbers ?? null,
            } as DrawResult;
          }
        } catch { /* non-fatal */ }
        return null;
      }),
    ).then(results => {
      const valid = results.filter((r): r is DrawResult => r !== null);
      if (valid.length) {
        setDrawResults(valid);
        setShowResultModal(true);
        fetchDashboard();
        // Persist won results so the modal re-appears on page reload until "Redeem" is clicked
        if (valid.some(r => r.status === "won")) {
          try { localStorage.setItem(WON_MODAL_KEY, JSON.stringify({ results: valid })); } catch { /* ignore */ }
        }
      }
    });
  }, [dashboard, fetchDashboard]);

  // Retry every 45s for active tickets whose draw has passed but results aren't resolved yet
  useEffect(() => {
    if (!dashboard) return;
    const stuckIds = (dashboard.activeTickets ?? [])
      .filter(t => t.status === "active" && (
        (t.drawTime && new Date(t.drawTime) < new Date()) ||
        (t.roundId && dashboard.nextDraw.roundId && t.roundId !== dashboard.nextDraw.roundId)
      ))
      .map(t => t.id);
    if (!stuckIds.length) return;
    const id = setInterval(() => {
      stuckIds.forEach(sid => autoCheckedIds.current.delete(sid));
      fetchDashboard();
    }, 45_000);
    return () => clearInterval(id);
  }, [dashboard, fetchDashboard]);

  // Keep refreshing while any ticket is still syncing (pending_send/sent/bridging/buying) — History
  // shows a plain "Syncing…" for these, so this is what actually replaces it with real numbers once
  // they're ready, instead of requiring the user to manually reload the page.
  useEffect(() => {
    if (!dashboard) return;
    const syncing = (dashboard.activeTickets ?? []).some(t =>
      ["pending_send", "sent", "bridging", "buying"].includes(t.status)
    );
    if (!syncing) return;
    const id = setInterval(fetchDashboard, 8_000);
    return () => clearInterval(id);
  }, [dashboard, fetchDashboard]);

  // Dev-only: mock winning tickets for redeem UI preview (see DevPreviewPanel)
  const redeemPreview = IS_LOCALHOST ? searchParams?.get("preview") : null;
  // A ticket's status stays 'won' for its entire claim→bridge→deliver pipeline (only flips to
  // 'withdrawn' at the very end — see initiateWithdrawalBatch) — so a withdrawal that's pending,
  // processing, or already complete must still be excluded here by cross-referencing
  // dashboard.withdrawals, or the redeem screen re-offers the same already-claimed win. A 'failed'
  // withdrawal is the one exception: funds are safe but undelivered, so the ticket should stay
  // redeemable to retry.
  const inFlightOrDoneWithdrawalTicketIds = new Set(
    (dashboard?.withdrawals ?? []).filter(w => w.status !== "failed").map(w => w.ticketId)
  );
  const wonTickets = redeemPreview === "redeem" || redeemPreview === "redeem-done" || redeemPreview === "redeem-arrived"
    ? PREVIEW_WON_TICKETS.slice(0, 1)
    : redeemPreview === "redeem-batch"
      ? PREVIEW_WON_TICKETS
      : redeemPreview === "redeem-playagain"
        ? PREVIEW_WON_TICKETS.slice(3, 4)
        : [...(dashboard?.activeTickets ?? []), ...(dashboard?.history ?? [])]
          .filter(t => t.status === "won" && !inFlightOrDoneWithdrawalTicketIds.has(t.id));
  const isRedeemPreview = redeemPreview === "redeem" || redeemPreview === "redeem-batch" || redeemPreview === "redeem-playagain" || redeemPreview === "redeem-done" || redeemPreview === "redeem-arrived";

  return (
    <div className="bg-[#0f0f12] text-white mobile-first">
      <div className="w-full max-w-lg mx-auto px-4 py-6 min-h-[calc(100svh-var(--header-h,0px)-4rem)]">

        <MegapotTabs activeTab={tab} wonCount={wonTickets.length} />

        {tab === "buy" && (
          <>
            <MysteryPackBanner />

            <PrizePoolHero
              prizePool={dashboard?.nextDraw?.prizePool ?? null}
              drawTime={dashboard?.nextDraw?.drawTime ?? null}
              onHowToPlay={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
              onPrizeTiers={() => setPrizeTiersOpen(true)}
            />

            <BuyTab accessToken={accessToken.current} solPriceUsd={solPriceUsd} onPurchased={fetchDashboard} activeTickets={dashboard?.activeTickets ?? []} dashboardLoading={dashboardLoading} nextDraw={dashboard?.nextDraw} />
          </>
        )}
        {tab === "redeem" && (
          authenticated ? (
            <WithdrawTab wonTickets={wonTickets} accessToken={accessToken.current} userSolanaAddress={userSolanaAddress} solPriceUsd={solPriceUsd} onWithdrawn={fetchDashboard} dashboardLoading={isRedeemPreview ? false : dashboardLoading} previewDone={redeemPreview === "redeem-done"} previewArrived={redeemPreview === "redeem-arrived"} withdrawMinUsdc={dashboard?.withdrawMinUsdc} />
          ) : (
            <SignInGate message="Sign in to see and redeem your winnings." login={login} />
          )
        )}
        {tab === "history" && (
          authenticated ? (
            <HistoryTab
              history={dashboard?.history ?? []}
              withdrawals={dashboard?.withdrawals ?? []}
              activeTickets={dashboard?.activeTickets ?? []}
              getAccessToken={getAccessToken}
              onRefresh={fetchDashboard}
              refetch={fetchDashboard}
              userSolanaAddress={userSolanaAddress}
              loading={dashboardLoading}
              nextDrawRoundId={dashboard?.nextDraw?.roundId ?? null}
              withdrawMinUsdc={dashboard?.withdrawMinUsdc}
            />
          ) : (
            <SignInGate message="Sign in to see your ticket history." login={login} />
          )
        )}
      </div>

      {prizeTiersOpen && (
        <PrizeTiersModal onClose={() => setPrizeTiersOpen(false)} totalPool={dashboard?.nextDraw?.prizePool} />
      )}
      {showResultModal && drawResults.length > 0 && (
        <DrawResultModal
          results={drawResults}
          winningNumbers={drawResults.find(r => r.winningNumbers)?.winningNumbers}
          ticketNumbers={drawResults.flatMap(r => r.ticketNumbers ?? [])}
          onClose={() => setShowResultModal(false)}
          onRedeem={() => {
            try { localStorage.removeItem(WON_MODAL_KEY); } catch { /* ignore */ }
            setShowResultModal(false);
          }}
          withdrawMinUsdc={dashboard?.withdrawMinUsdc}
        />
      )}

      {IS_LOCALHOST && <DevPreviewPanel />}

      {/* FAQ — same style as send/receive */}
      <section id="how-it-works" className="md:pb-16 px-4 mt-2 pb-24">
        <div className="max-w-xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-medium font-sans text-white text-center mb-8 md:mb-10">
            How it works
          </h2>
          <div className="flex flex-col gap-4">
            {FAQ_ITEMS.map((item, index) => (
              <div key={index} className="rounded-[20px] border border-white/10 bg-white/5 overflow-hidden">
                <button type="button" onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full px-6 py-5 flex items-center justify-between text-left">
                  <span className="text-lg md:text-xl font-semibold font-sans text-slate-200">{item.question}</span>
                  <motion.span className="text-4xl text-orange-500 shrink-0 ml-4"
                    animate={{ rotate: openFaq === index ? 45 : 0 }} transition={{ duration: 0.2 }}>
                    +
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {openFaq === index && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden">
                      <div className="px-6 pb-5 text-lg text-slate-400 leading-relaxed">{item.answer}</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
