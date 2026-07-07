"use client";

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { ArrowDown, X, Trophy, RefreshCw, Ticket, ShieldCheck, ArrowUpRight, Shuffle, MoreVertical, Plus, ChevronDown, Eraser } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const MEGAPOT_REFERRAL = "https://megapot.io/r/Q3M637";
const MAGICBLOCK_GASLESS_RELAY_FEE_USD = 0.20; // flat relay fee MagicBlock charges in gasless mode
const MAGICBLOCK_BPS = 10;
const BRIDGE_FEE_USD_EST = 0.04; // Li.Fi (cheaper than NEAR Intents)
// Loofta per-purchase fee: $0.10 flat + 30 BPS of ticket cost (mirrors backend looftaTicketFee —
// the proportional part covers the bridge cut Loofta absorbs on bigger purchases)
const LOOFTA_TICKET_FEE_FLAT_USD = 0.10;
const LOOFTA_TICKET_FEE_BPS = 30;
function looftaFee(ticketCostUsd: number) {
  return LOOFTA_TICKET_FEE_FLAT_USD + (ticketCostUsd * LOOFTA_TICKET_FEE_BPS) / 10_000;
}
const MAIN_MAX = 30;
const MAIN_COUNT = 5;
const BONUS_MAX = 12;

const PRIZE_TIERS = [
  { normal: 5, bonusMatch: true, prize: "$226,165.11" },
  { normal: 5, bonusMatch: false, prize: "$3,085.05" },
  { normal: 4, bonusMatch: true, prize: "$272.39" },
  { normal: 4, bonusMatch: false, prize: "$25.67" },
  { normal: 3, bonusMatch: true, prize: "$12.30" },
  { normal: 2, bonusMatch: true, prize: "$3.94" },
  { normal: 3, bonusMatch: false, prize: "$3.05" },
  { normal: 1, bonusMatch: true, prize: "$2.07" },
  { normal: 2, bonusMatch: false, prize: "Free ticket" },
  { normal: 0, bonusMatch: true, prize: "Free ticket" },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "buy" | "redeem" | "history";
type BuyStep = "idle" | "signing" | "sent" | "bridging" | "buying" | "done" | "error";
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
}
interface WithdrawalSummary {
  id: string; ticketId: string; route: "base" | "solana_private";
  destinationAddress: string; amountUsdc: number; status: string; createdAt: string;
}
interface Dashboard {
  activeTickets: TicketSummary[]; history: TicketSummary[]; withdrawals: WithdrawalSummary[];
  stats: { totalSpent: number; totalWon: number; netPnl: number; ticketCount: number };
  nextDraw: { roundId: string | null; drawTime: string | null; prizePool: string | null };
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
    pending_send: "Awaiting deposit", sent: "Sent privately", bridging: "Bridging to Base",
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
          <p className="text-sm text-slate-400 text-center mb-5 leading-relaxed">
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
                    <p className="text-sm text-slate-500 mt-1">{desc}</p>
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
              <p className="text-sm text-slate-400">30 normal balls</p>
            </div>
            {/* Bonus balls */}
            <div className="rounded-xl bg-white/[0.04] border border-white/10 px-4 py-4 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-[#1e1e26] border border-white/30 flex items-center justify-center text-white font-bold text-base">1</span>
                <span className="text-[#FF7A2A] font-bold text-lg">→</span>
                <span className="w-9 h-9 rounded-full bg-[#1e1e26] border border-white/30 flex items-center justify-center text-white font-bold text-base">12</span>
              </div>
              <p className="text-sm text-slate-400">12 bonus balls</p>
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
  const tabBase = "group relative z-10 whitespace-nowrap rounded-xl px-4 py-2.5 inline-flex items-center justify-center gap-2 font-semibold text-[16px] tracking-[-0.01em] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.99]";
  const tabText = (t: Tab) => ["relative z-10 transition-colors duration-300 font-sans font-medium text-lg", activeTab === t ? "text-slate-100" : "text-slate-400 group-hover:text-slate-200"].join(" ");
  const sliderPos = activeTab === "redeem" ? "translate-x-full" : "translate-x-0";
  const isHistory = activeTab === "history";
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="relative grid grid-cols-2 rounded-2xl p-1 bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] border border-white/[0.06] overflow-hidden">
        <div aria-hidden="true" className={["absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] bg-gradient-to-b from-white/[0.08] to-white/[0.03] shadow-[0_8px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)] border border-white/[0.08]", isHistory ? "opacity-0" : sliderPos].join(" ")} />
        <div aria-hidden="true" className={["pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-xl transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] opacity-40 bg-[radial-gradient(80%_140%_at_50%_0%,rgba(255,122,42,0.35),transparent_60%)]", isHistory ? "opacity-0" : sliderPos].join(" ")} />
        <Link href="/app/megapot" className={tabBase}>
          <IconBubble active={activeTab === "buy"}><Ticket /></IconBubble>
          <span className={tabText("buy")}>Buy</span>
        </Link>
        <Link href="/app/megapot?tab=redeem" className={tabBase}>
          <IconBubble active={activeTab === "redeem"}><Trophy /></IconBubble>
          <span className={tabText("redeem")}>Redeem{wonCount > 0 ? ` (${wonCount})` : ""}</span>
        </Link>
      </div>
      <Link href="/app/megapot?tab=history"
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

          {/* Bonus 1–12 */}
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
  "taking the scenic route so no one follows 🕵️",
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
function PurchaseProgressModal({ step, error, devReset }: { step: BuyStep; error?: string; devReset?: () => void }) {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const id = setInterval(() => setPhraseIdx(i => (i + 1) % STEALTH_PHRASES.length), 3500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-md p-4" role="dialog" aria-modal="true" aria-label="Purchasing tickets">
      <div className="w-full max-w-md bg-[#0f0f16] rounded-3xl border border-white/10 shadow-2xl px-5 sm:px-6 py-8 sm:py-10 flex flex-col items-center text-center gap-5 sm:gap-6">
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
              {STEALTH_PHRASES[phraseIdx]}
            </motion.p>
          </AnimatePresence>
        </div>

        {error && <p className="text-base font-semibold text-red-400">{error}</p>}

        <p className="text-sm font-medium text-slate-400">🔒 Don&apos;t close this window — this only takes a moment.</p>

        {devReset && (
          <button onClick={devReset} className="text-xs text-slate-500 hover:text-slate-300 border border-white/10 rounded-lg px-2 py-1 transition-colors">
            New payment (dev)
          </button>
        )}
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
              <p className="text-xs text-slate-400 uppercase tracking-wider text-center font-semibold">Draw in</p>
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
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">Your tickets</p>
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

// ─── Fee breakdown ────────────────────────────────────────────────────────────

function FeeBreakdown({ ticketCostUsd, mode, solPriceUsd, bridgeFeeUsd, bridgeReceiveUsdc }: {
  ticketCostUsd: number;
  mode: "buy" | "buy-public" | "base" | "solana_private";
  solPriceUsd: number;
  bridgeFeeUsd?: number | null;      // actual Li.Fi fee; null = loading
  bridgeReceiveUsdc?: number | null; // Li.Fi toAmountMin; null = loading
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
    const wMb = (MAGICBLOCK_BPS / 10_000) * ticketCostUsd + MAGICBLOCK_GASLESS_RELAY_FEE_USD;
    const totalFees = (bridgeFeeUsd ?? BRIDGE_FEE_USD_EST) + wMb;
    // Use actual Li.Fi toAmountMin if available, then subtract MagicBlock fee
    const youReceive = bridgeReceiveUsdc != null ? Math.max(0, bridgeReceiveUsdc - wMb) : null;
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
        <div className="flex justify-between items-start px-4 py-3.5 gap-4">
          <div className="min-w-0">
            <p className="text-base text-slate-400">Privacy &amp; processing</p>
            <p className="text-sm text-slate-500 mt-0.5">Private transfer &amp; bridging — all included</p>
          </div>
          <span className="text-base text-slate-400 tabular-nums shrink-0">
            {bridgeFeeUsd === null ? <span className="opacity-40">estimating…</span> : `~${fmt(totalFees)}`}
          </span>
        </div>
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base font-semibold text-white">You receive</span>
          <span className="text-base font-semibold text-white tabular-nums">
            {youReceive === null
              ? <span className="opacity-40 font-normal text-slate-400">estimating…</span>
              : fmt(youReceive)}
          </span>
        </div>
      </div>
    );
  }

  if (mode === "buy-public") {
    const BRIDGE_BUFFER = 0.15;
    const total = ticketCostUsd + BRIDGE_BUFFER;
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base text-slate-400">Tickets ({ticketCostUsd} × $1.00)</span>
          <span className="text-base text-slate-200 tabular-nums">{fmt(ticketCostUsd)}</span>
        </div>
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base text-slate-400">NEAR Intents bridge fee (SOL USDC → Base)</span>
          <span className="text-base text-slate-400 tabular-nums">~{fmt(BRIDGE_BUFFER)}</span>
        </div>
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base font-semibold text-white">Total to send</span>
          <span className="text-base font-semibold text-white tabular-nums">~{fmt(total)}</span>
        </div>
      </div>
    );
  }

  // MagicBlock exactOut sends exactly ticketCostUsd (no rounding — it's already a whole-dollar
  // amount for any ticket count) and grosses its own fee up from that same amount. Li.Fi's
  // bridging cost is funded from the pooled fee reserve, not charged to the user directly — see
  // backend computePurchaseAmounts / tryStartBridge.
  const buyFees = mbFee(ticketCostUsd) + looftaFee(ticketCostUsd);
  const total = ticketCostUsd + buyFees;
  // Fees are mostly flat, so per-ticket cost falls fast with count — nudge small buys up
  const feesPerTicket = buyFees / ticketCostUsd;
  const feesPerTicketAt5 = (mbFee(5) + looftaFee(5)) / 5;
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
      <div className="flex justify-between px-4 py-3.5">
        <span className="text-base text-slate-400">Tickets ({ticketCostUsd} × $1.00)</span>
        <span className="text-base text-slate-200 tabular-nums">{fmt(ticketCostUsd)}</span>
      </div>
      <div className="flex justify-between items-start px-4 py-3.5 gap-4">
        <div className="min-w-0">
          <p className="text-base text-slate-400">Privacy &amp; processing</p>
          <p className="text-sm text-slate-500 mt-0.5">Private transfer, bridging &amp; service — all included</p>
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
  const [step, setStep] = useState<BuyStep>("idle");
  const [stepError, setStepError] = useState("");
  const [lastTickets, setLastTickets] = useState<TicketNumbers[]>([]);
  const [lastNumTickets, setLastNumTickets] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingStartedRef = useRef(false);
  const suppressedTicketIdRef = useRef<string | null>(null);

  // Dev-only: jump directly to any purchase-flow screen via ?preview=... (see DevPreviewPanel)
  const previewParam = useSearchParams().get("preview");
  useEffect(() => {
    if (!IS_LOCALHOST || !previewParam) return;
    if (previewParam === "reset") { setStep("idle"); return; }
    const validSteps: string[] = ["signing", "sent", "bridging", "buying", "done"];
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

  const { user, getAccessToken } = usePrivy();

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

  const pollStatus = useCallback((ticketId: string) => {
    localStorage.setItem("megapot_ticket", ticketId);
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`/api/lottery/status/${ticketId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const t: TicketSummary = await res.json();
        if (["active", "won"].includes(t.status)) {
          localStorage.removeItem("megapot_ticket");
          pollingStartedRef.current = false;
          stopPoll(); setStep("done"); onPurchased();
        } else if (t.status === "failed") {
          localStorage.removeItem("megapot_ticket");
          pollingStartedRef.current = false;
          stopPoll(); setStep("error"); setStepError("Purchase failed — contact support.");
        } else if (t.status === "buying") setStep("buying");
        else if (t.status === "bridging") setStep("bridging");
        else if (t.status === "sent") setStep("sent");
      } catch { /* ignore */ }
    }, 8_000);
  }, [getAccessToken, onPurchased, stopPoll]);

  // Resume polling on mount if a ticket was in-flight on this device (localStorage persists across refreshes)
  useEffect(() => {
    const saved = localStorage.getItem("megapot_ticket");
    if (saved && !pollingStartedRef.current) {
      pollingStartedRef.current = true;
      setStep("sent");
      pollStatus(saved);
    }
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
    const nextStep: BuyStep =
      inFlight.status === "buying" ? "buying" :
        inFlight.status === "bridging" ? "bridging" : "sent";
    setStep(nextStep);
    pollStatus(inFlight.id);
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
    try {
      const token = await getAccessToken();
      const authHeader: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const initRes = await fetch("/api/lottery/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ numTickets, userSolanaAddress: embeddedWallet?.address }),
      });
      if (!initRes.ok) throw new Error((await initRes.json()).message ?? "Failed to initiate");
      const { ticketId, feeTxBase64, txBase64 } = await initRes.json();

      // 1. Sign + send the upfront fee payment first — a plain transfer, separate from the
      // MagicBlock private transfer (can't be combined into the same transaction).
      const feeTxBytes = Buffer.from(feeTxBase64, "base64");
      const { signature: feeSigBytes } = await signAndSendTransaction({
        transaction: feeTxBytes as unknown as Uint8Array,
        wallet: embeddedWallet as any,
      });
      const feeSignature = bs58.encode(feeSigBytes as Uint8Array);
      await fetch("/api/lottery/buy-fee-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ ticketId, feeTxHash: feeSignature }),
      });

      // 2. Sign + send the MagicBlock private transfer.
      const txBytes = Buffer.from(txBase64, "base64");
      const { signature: sigBytes } = await signAndSendTransaction({
        transaction: txBytes as unknown as Uint8Array,
        wallet: embeddedWallet as any,
      });
      const signature = bs58.encode(sigBytes as Uint8Array);
      setStep("sent");
      await fetch("/api/lottery/buy-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ ticketId, senderTxHash: signature }),
      });
      suppressedTicketIdRef.current = null;
      setStep("bridging");
      pollingStartedRef.current = true;
      pollStatus(ticketId);
    } catch (err: any) {
      setStep("error");
      setStepError(err.message ?? "Unknown error");
    }
  }

  const isRunning = !["idle", "done", "error"].includes(step);

  function resetBuy() { setStep("idle"); setStepError(""); pollingStartedRef.current = false; }

  function startNewPayment() {
    stopPoll();
    const current = localStorage.getItem("megapot_ticket");
    if (current) suppressedTicketIdRef.current = current;
    localStorage.removeItem("megapot_ticket");
    pollingStartedRef.current = false;
    setStep("idle");
    setStepError("");
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
        />
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
      {!isRunning && step !== "done" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-slate-300 text-xl font-medium font-sans">Buy tickets privately</p>
            <a href={MEGAPOT_REFERRAL} target="_blank" rel="noopener noreferrer"
              className="text-sm text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2">
              megapot.io ↗
            </a>
          </div>

          <p className="text-sm text-slate-400">🔒 Shielded via MagicBlock. Min {PRIVATE_MIN} tickets. Uses your Loofta balance.</p>

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

          {/* Choose numbers — collapsible for ≤10 tickets, random notice for 11+ */}
          {numTickets <= 10 ? (
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

          <FeeBreakdown ticketCostUsd={numTickets} mode="buy" solPriceUsd={solPriceUsd} />

          {step === "error" && stepError && (
            <p className="text-base text-red-400">{stepError}</p>
          )}

          <button onClick={() => handlePrivateBuy()}
            className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all">
            {`Buy privately · ${fmt(numTickets + mbFee(numTickets) + looftaFee(numTickets))}`}
          </button>
        </>
      )}
    </div>
  );
}



// ─── Withdraw tab ─────────────────────────────────────────────────────────────

function WithdrawTab({ wonTickets, accessToken, userSolanaAddress, solPriceUsd, onWithdrawn, dashboardLoading, previewDone }: {
  wonTickets: TicketSummary[]; accessToken: string | null;
  userSolanaAddress: string; solPriceUsd: number; onWithdrawn: () => void;
  dashboardLoading?: boolean;
  previewDone?: boolean; // dev-only: render the post-redeem state directly
}) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!!previewDone);
  const [doneAmount, setDoneAmount] = useState(previewDone ? 272.39 : 0);
  const [error, setError] = useState("");
  const [bridgeFeeUsd, setBridgeFeeUsd] = useState<number | null>(null);
  const [bridgeReceiveUsdc, setBridgeReceiveUsdc] = useState<number | null>(null);
  const [withdrawalIds, setWithdrawalIds] = useState<string[]>([]);
  const [arrived, setArrived] = useState(false);
  const [transferFailed, setTransferFailed] = useState(false);
  const reduceMotion = useReducedMotion();

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
        if (mine.some((w: WithdrawalSummary) => w.status === "failed")) setTransferFailed(true);
        else if (mine.every((w: WithdrawalSummary) => w.status === "complete")) setArrived(true);
      } catch { /* keep polling */ }
    }, 5000);
    return () => clearInterval(id);
  }, [done, arrived, transferFailed, withdrawalIds, accessToken]);

  const totalAmount = wonTickets.reduce((sum, t) => sum + (t.winAmountUsdc ?? 0), 0);
  const isBatch = wonTickets.length > 1;

  useEffect(() => {
    if (!totalAmount) return;
    setBridgeFeeUsd(null);
    setBridgeReceiveUsdc(null);
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
    fetch(`/api/lottery/bridge-fee?amountUsdc=${totalAmount}`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.feeUsd != null) setBridgeFeeUsd(data.feeUsd);
        if (data?.receiveUsdc != null) setBridgeReceiveUsdc(data.receiveUsdc);
      })
      .catch(() => {
        setBridgeFeeUsd(BRIDGE_FEE_USD_EST);
        setBridgeReceiveUsdc(totalAmount - BRIDGE_FEE_USD_EST);
      });
  }, [totalAmount, accessToken]);

  async function handleWithdraw() {
    if (!userSolanaAddress || !wonTickets.length) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/lottery/withdraw-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ ticketIds: wonTickets.map(t => t.id), destinationAddress: userSolanaAddress }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      const data = await res.json().catch(() => null);
      setWithdrawalIds(data?.withdrawalIds ?? []);
      setArrived(false);
      setTransferFailed(false);
      setDoneAmount(totalAmount);
      setDone(true); onWithdrawn();
    } catch (err: any) { setError(err.message ?? "Unknown error"); }
    finally { setLoading(false); }
  }

  if (dashboardLoading) return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-4 animate-pulse">
      <div className="h-5 w-36 rounded-lg bg-white/10" />
      <div className="h-16 rounded-xl bg-white/5" />
      <div className="h-16 rounded-xl bg-white/5" />
      <div className="h-12 rounded-xl bg-white/10" />
    </div>
  );

  if (!wonTickets.length) return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
      <Trophy className="w-10 h-10 text-slate-700 mx-auto mb-3" />
      <p className="text-slate-300 text-lg font-medium">No winnings yet</p>
      <p className="text-slate-500 text-base mt-1">Win the daily draw and your prize lands here, ready to redeem privately.</p>
    </div>
  );

  if (done) {
    type StepState = "done" | "active" | "pending";
    const steps: { label: string; state: StepState }[] = [
      { label: "Redeemed", state: "done" },
      { label: "Traveling privately", state: arrived ? "done" : "active" },
      { label: "In your wallet", state: arrived ? "done" : "pending" },
    ];
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.08] to-white/[0.02] p-8 text-center space-y-6">
        <motion.div
          className="text-5xl select-none"
          aria-hidden="true"
          initial={reduceMotion ? undefined : { scale: 0.5, opacity: 0 }}
          animate={reduceMotion ? undefined : { scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
        >
          {arrived ? "🎉" : "🛡️✨"}
        </motion.div>
        <div>
          <p className="text-sm font-bold text-emerald-400 uppercase tracking-[0.2em] mb-2">
            {arrived ? "Withdrawal complete" : "Withdrawal on its way"}
          </p>
          <h2 className="font-display text-4xl sm:text-5xl font-bold tracking-tight bg-gradient-to-b from-white via-slate-100 to-emerald-200 bg-clip-text text-transparent tabular-nums">
            {fmt(doneAmount)}
          </h2>
          <p className="text-lg text-slate-300 mt-3 font-medium">
            {arrived ? "is in your wallet" : "is heading to your wallet"}
          </p>
          <p className="text-base text-slate-400 mt-1">
            {arrived
              ? "Delivered privately to your Loofta balance — no on-chain link back to you."
              : "Arrives in your Loofta balance in a few minutes. No on-chain link back to you."}
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
                <div className={[
                  "w-8 h-8 rounded-full flex items-center justify-center border",
                  s.state === "done" ? "bg-emerald-500 border-emerald-400" :
                  s.state === "active" ? "bg-emerald-500/15 border-emerald-400/60" :
                  "bg-white/[0.04] border-white/15",
                ].join(" ")}>
                  {s.state === "done" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : s.state === "active" ? (
                    <span className={`w-2.5 h-2.5 rounded-full bg-emerald-400 ${reduceMotion ? "" : "animate-pulse"}`} />
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                  )}
                </div>
                <span className={["text-sm font-medium leading-tight", s.state === "pending" ? "text-slate-500" : "text-emerald-300"].join(" ")}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={["h-px w-6 -mt-6 shrink-0", s.state === "done" ? "bg-emerald-400/60" : "bg-white/15"].join(" ")} />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {!arrived && !transferFailed && (
            <p className="text-sm text-slate-500">You can safely leave this page — it continues in the background.</p>
          )}
          <button onClick={() => { setDone(false); setDoneAmount(0); setArrived(false); setTransferFailed(false); }}
            className="text-base text-slate-400 hover:text-white underline underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 rounded">
            Back to redeem
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.07] via-white/[0.04] to-white/[0.02] p-6 space-y-6">
      {/* Celebration header */}
      <motion.div
        className="flex flex-col items-center text-center gap-1 pt-1"
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
          🏆
        </motion.div>
        <p className="text-sm font-bold text-emerald-400 uppercase tracking-[0.2em] mt-2">
          {isBatch ? `${wonTickets.length} winning draws` : "You won"}
        </p>
        <h2 className="font-display text-5xl sm:text-6xl font-bold tracking-tight bg-gradient-to-b from-white via-emerald-50 to-emerald-300 bg-clip-text text-transparent tabular-nums">
          {fmt(totalAmount)}
        </h2>
        <p className="text-base text-slate-400 mt-1">ready to redeem privately</p>
      </motion.div>

      {/* Winning ticket(s) */}
      <div className="space-y-2">
        <p className="text-sm text-slate-400 uppercase tracking-wider font-semibold">Your wins</p>
        {wonTickets.map((t, i) => (
          <motion.div
            key={t.id}
            className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] shadow-[0_0_20px_rgba(16,185,129,0.08)]"
            initial={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.07 }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Trophy className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-white text-base font-medium truncate">Winning ticket{t.winTier ? ` · Tier ${t.winTier}` : ""}</p>
                <p className="text-slate-400 text-sm mt-0.5 truncate">
                  {t.drawTime ? new Date(t.drawTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  {t.numTickets > 1 ? ` · from batch of ${t.numTickets}` : ""}
                </p>
              </div>
            </div>
            <span className="text-emerald-400 font-bold text-lg tabular-nums shrink-0 ml-3">+{fmt(t.winAmountUsdc ?? 0)}</span>
          </motion.div>
        ))}
      </div>

      <div className="rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3.5 flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-base text-slate-300 font-medium">
            {isBatch ? "All your wins arrive as one private transfer" : "Arrives privately in your Loofta balance"}
          </p>
          <p className="text-sm text-slate-500 mt-0.5">No on-chain link between your winnings and your wallet</p>
        </div>
      </div>

      <FeeBreakdown ticketCostUsd={totalAmount} mode="solana_private" solPriceUsd={solPriceUsd} bridgeFeeUsd={bridgeFeeUsd} bridgeReceiveUsdc={bridgeReceiveUsdc} />
      {error && <p className="text-base text-red-400">{error}</p>}

      <button onClick={handleWithdraw} disabled={loading || !wonTickets.length || bridgeFeeUsd === null}
        className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-emerald-500 to-teal-400 text-white shadow-[0_8px_24px_rgba(16,185,129,0.25)] hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f12]">
        {loading ? "Processing..." : bridgeFeeUsd === null ? "Estimating fees…" : `Redeem ${fmt(totalAmount)} privately`}
      </button>
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
    winningNumbers: PREVIEW_WINNING_NUMBERS_WON,
  },
  {
    id: "preview-won-2", status: "won", numTickets: 1, costUsdc: 1, roundId: "411",
    drawTime: new Date(Date.now() - 36 * 3600_000).toISOString(), winAmountUsdc: 12.5, winTier: 4,
    createdAt: new Date(Date.now() - 60 * 3600_000).toISOString(), depositAddress: null,
    bridgeStatus: "DONE", bridgeExpiresAt: null, ticketNumbers: PREVIEW_TICKETS.slice(0, 1),
    winningNumbers: PREVIEW_WINNING_NUMBERS_WON,
  },
  {
    id: "preview-won-3", status: "won", numTickets: 10, costUsdc: 10, roundId: "410",
    drawTime: new Date(Date.now() - 60 * 3600_000).toISOString(), winAmountUsdc: 3.75, winTier: 5,
    createdAt: new Date(Date.now() - 84 * 3600_000).toISOString(), depositAddress: null,
    bridgeStatus: "DONE", bridgeExpiresAt: null, ticketNumbers: PREVIEW_TICKETS,
    winningNumbers: PREVIEW_WINNING_NUMBERS_WON,
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
    <div className="text-center pt-2 pb-7">
      <p className="text-xs font-bold tracking-[0.22em] text-slate-500 uppercase mb-4">Prize Pool</p>
      <p
        className="text-[72px] sm:text-[84px] font-black leading-none tracking-tight bg-gradient-to-b from-white via-slate-100 to-amber-200 bg-clip-text text-transparent select-none"
        style={{ filter: "drop-shadow(0 3px 28px rgba(251,146,60,0.22))" }}
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

function ticketTierLabel(matchedNormals: number, bonusMatch: boolean): string | null {
  const tier = PRIZE_TIERS.find(t => t.normal === matchedNormals && t.bonusMatch === bonusMatch);
  return tier?.prize ?? null;
}

function TicketNumberCard({ tn, winningNumbers }: {
  tn: { main: number[]; bonus: number };
  winningNumbers?: { main: number[]; bonus: number } | null;
}) {
  const winSet = winningNumbers ? new Set(winningNumbers.main) : null;
  const bonusHit = winningNumbers ? tn.bonus === winningNumbers.bonus : false;
  const matchedCount = winSet ? tn.main.filter(n => winSet.has(n)).length : 0;
  const prize = winningNumbers ? ticketTierLabel(matchedCount, bonusHit) : null;
  const isWin = prize !== null && prize !== "Free ticket";
  const isFreeTicket = prize === "Free ticket";

  return (
    <div className={`flex items-center rounded-xl border bg-white/[0.04] px-3 gap-3 relative overflow-hidden ${isWin ? "border-emerald-500/30" : isFreeTicket ? "border-emerald-500/20" : "border-white/[0.08]"
      }`} style={{ minHeight: 58 }}>
      {/* Numbers */}
      <div className="flex flex-col gap-1 flex-1 min-w-0 py-3">
        <span className="text-[10px] font-bold tracking-[0.16em] text-slate-600 uppercase">Numbers</span>
        <div className="flex gap-2.5">
          {tn.main.map(n => {
            const hit = winSet?.has(n);
            return (
              <span key={n} className={`text-sm font-bold tabular-nums ${hit ? "text-emerald-400" : "text-slate-400"}`}>
                {n}
              </span>
            );
          })}
        </div>
      </div>
      {/* Dashed separator */}
      <div className="self-stretch border-l border-dashed border-white/[0.12] mx-1" />
      {/* Bonus */}
      <div className="flex flex-col items-center gap-1 shrink-0 py-3">
        <span className="text-[10px] font-bold tracking-[0.16em] text-slate-600 uppercase">Bonus</span>
        <span className={`w-7 h-7 rounded-full border text-xs font-bold flex items-center justify-center tabular-nums ${bonusHit
          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400"
          : "border-amber-500/50 bg-amber-500/10 text-amber-400"
          }`}>
          {tn.bonus}
        </span>
      </div>
      {/* WIN / NO WIN label — only shown when we have winning numbers */}
      {winningNumbers && (
        <>
          <div className="self-stretch border-l border-dashed border-white/[0.12] mx-1" />
          <div className="shrink-0 py-3">
            {isWin ? (
              <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold whitespace-nowrap">
                WIN {prize}
              </span>
            ) : isFreeTicket ? (
              <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/20 text-emerald-300 text-xs font-bold whitespace-nowrap">
                FREE
              </span>
            ) : (
              <span className="text-slate-600 text-xs font-bold uppercase tracking-wide">No win</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function HistoryTab({ history, withdrawals, activeTickets, getAccessToken, onRefresh, refetch, userSolanaAddress, loading, nextDrawRoundId }: {
  history: TicketSummary[]; withdrawals: WithdrawalSummary[]; activeTickets: TicketSummary[];
  getAccessToken: () => Promise<string | null>; onRefresh: () => void; refetch?: () => void;
  userSolanaAddress: string; loading?: boolean; nextDrawRoundId?: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const syncedIds = useRef<Set<string>>(new Set());

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
  const [checkingResult, setCheckingResult] = useState<string | null>(null);
  const [checkResultMsg, setCheckResultMsg] = useState<Record<string, string>>({});
  const [ticketShowAll, setTicketShowAll] = useState<Record<string, boolean>>({});

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
  const visibleCompleted = completed.slice(0, visibleCount);
  const hasMore = completed.length > visibleCount || serverHasMore;

  async function handleLoadMore() {
    if (completed.length > visibleCount) {
      setVisibleCount(c => c + HISTORY_PAGE);
      return;
    }
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
      setVisibleCount(c => c + HISTORY_PAGE);
    } catch (e) {
      console.error("Load more history failed", e);
    } finally {
      setLoadingMore(false);
    }
  }

  const allForStats = [...activeTickets, ...history];
  const totalSpent = allForStats.filter(t => t.status !== "failed").reduce((s, t) => s + t.costUsdc, 0);
  const totalWon = allForStats.filter(t => t.status === "won" || t.status === "withdrawn").reduce((s, t) => s + (t.winAmountUsdc ?? 0), 0);

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
        setTimeout(onRefresh, 5000);
      } else {
        setRetryResult(r => ({ ...r, [ticketId]: `Error: ${data.message ?? "Unknown error"}` }));
      }
    } catch (e: any) {
      setRetryResult(r => ({ ...r, [ticketId]: `Error: ${e.message}` }));
    } finally {
      setRetrying(null);
    }
  }

  async function handleCheckResults(ticketId: string) {
    setCheckingResult(ticketId);
    setCheckResultMsg(r => ({ ...r, [ticketId]: "Checking results on-chain…" }));
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/lottery/tickets/${ticketId}/check-results`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok) {
        const msg = data.status === "won"
          ? `Won $${data.winAmountUsdc?.toFixed(2)} (Tier ${data.winTier ?? "?"})! Go to Redeem tab.`
          : data.status === "lost"
            ? "No win this draw — better luck next time!"
            : `Status: ${data.status}`;
        setCheckResultMsg(r => ({ ...r, [ticketId]: msg }));
        setTimeout(onRefresh, 1500);
      } else {
        setCheckResultMsg(r => ({ ...r, [ticketId]: `Error: ${data.message ?? "Unknown error"}` }));
      }
    } catch (e: any) {
      setCheckResultMsg(r => ({ ...r, [ticketId]: `Error: ${e.message}` }));
    } finally {
      setCheckingResult(null);
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
      if (res.ok) {
        setRescueResult(r => ({ ...r, [ticketId]: "Rescue submitted — USDC being sent to safe wallet. Check logs." }));
        setTimeout(onRefresh, 3000);
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
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ destinationSolAddress: userSolanaAddress }),
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

  return (
    <div className="space-y-4 pb-24">
      {/* Stats cards */}
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
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Awaiting deposit</p>
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
                      <p className={`text-sm font-medium ${new Date(t.bridgeExpiresAt) > new Date() ? "text-amber-400/80" : "text-red-400"}`}>
                        {new Date(t.bridgeExpiresAt) > new Date()
                          ? `Expires ${new Date(t.bridgeExpiresAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
                          : "Expired"}
                      </p>
                    )}
                  </div>
                  {t.depositAddress ? (
                    <>
                      <div className="space-y-2">
                        <p className="text-sm text-slate-400">Send <span className="text-white font-semibold">{fmt(t.costUsdc)}</span> USDC on Solana to:</p>
                        <div className="flex items-center gap-2 bg-black/30 rounded-xl px-3 py-2.5 border border-white/10">
                          <span className="font-mono text-sm text-slate-200 truncate flex-1">{t.depositAddress}</span>
                          <button type="button" onClick={() => copyAddress(t.id, t.depositAddress!)}
                            className="shrink-0 text-slate-400 hover:text-white transition-colors px-1">
                            {copied === t.id
                              ? <span className="text-emerald-400 text-sm font-medium">Copied!</span>
                              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                            }
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">Deposit address unavailable.</p>
                  )}
                  <button type="button"
                    onClick={() => handleCancel(t.id)}
                    disabled={cancelling === t.id}
                    className="w-full h-10 rounded-xl text-sm font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 active:bg-red-500/20 transition-all disabled:opacity-40">
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
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">In progress</p>
          <div className="space-y-2">
            {inFlight.map(t => (
              <details key={t.id} className="rounded-xl border border-white/10 bg-white/5 group">
                <summary className="flex items-center justify-between p-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                    <span className="text-base font-semibold text-white">{t.numTickets} ticket{t.numTickets !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ticketStatusBadgeClass(t.status, t.bridgeStatus, t.drawTime, t.roundId, nextDrawRoundId)}`}>
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
                  <p className="text-sm text-slate-400">
                    {t.status === "sent" && "Waiting for MagicBlock private transfer to arrive in burner wallet (up to 2 min)."}
                    {t.status === "bridging" && "Bridging from Solana to Base. This takes 5–15 minutes."}
                    {t.status === "buying" && "Funds arrived on Base — buying your tickets now."}
                  </p>
                  <a
                    href="/app/megapot"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#FF7A2A] hover:text-[#FF9A5A] transition-colors"
                  >
                    View progress <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                  {t.depositAddress && t.status !== "buying" && (
                    <>
                      <p className="text-sm text-slate-400">Deposit address:</p>
                      <div className="flex items-center gap-2 bg-black/30 rounded-xl px-3 py-2.5 border border-white/10">
                        <span className="font-mono text-sm text-slate-200 truncate flex-1">{t.depositAddress}</span>
                        <button type="button" onClick={() => copyAddress(t.id, t.depositAddress!)}
                          className="shrink-0 text-slate-400 hover:text-white transition-colors px-1">
                          {copied === t.id
                            ? <span className="text-emerald-400 text-sm font-medium">Copied!</span>
                            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                          }
                        </button>
                      </div>
                    </>
                  )}
                  {t.status === "sent" && (
                    <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
                      <p className="text-sm font-semibold text-slate-400">Funds stuck in burner wallet?</p>
                      <p className="text-xs text-slate-500">If it has been more than 2 min since you sent, rescue will return the USDC to your Loofta balance.</p>
                      {rescueBurnerResult[t.id] && (
                        <p className={`text-sm font-medium ${rescueBurnerResult[t.id].startsWith("Error") || rescueBurnerResult[t.id].startsWith("Burner") ? "text-red-400" : "text-emerald-400"}`}>
                          {rescueBurnerResult[t.id]}
                        </p>
                      )}
                      <button type="button"
                        onClick={() => handleRescueBurner(t.id)}
                        disabled={rescuingBurner === t.id}
                        className="w-full h-10 rounded-xl text-sm font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40">
                        {rescuingBurner === t.id ? "Rescuing..." : "Rescue from Solana"}
                      </button>
                    </div>
                  )}
                  {/* Bridging is fully automatic and can't be safely cancelled — funds are in
                      transit and will arrive on Base. No action needed. */}
                  {t.status === "buying" && (
                    <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
                      <p className="text-sm font-semibold text-slate-400">Stuck? Try one of these:</p>
                      {(retryResult[t.id] || rescueResult[t.id]) && (
                        <p className="text-sm text-amber-400">{retryResult[t.id] || rescueResult[t.id]}</p>
                      )}
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => handleRetry(t.id)}
                          disabled={retrying === t.id || rescuing === t.id}
                          className="flex-1 h-10 rounded-xl text-sm font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-40">
                          {retrying === t.id ? "Retrying..." : "Retry purchase"}
                        </button>
                        <button type="button"
                          onClick={() => handleRescue(t.id)}
                          disabled={rescuing === t.id || retrying === t.id}
                          className="flex-1 h-10 rounded-xl text-sm font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40">
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

      {/* Completed draws */}
      {loading && completed.length === 0 && awaitingDeposit.length === 0 && inFlight.length === 0 ? (
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
      ) : completed.length === 0 && awaitingDeposit.length === 0 && inFlight.length === 0 ? null
        : completed.length > 0 && (
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Tickets</p>
            <div className="space-y-2">
              {visibleCompleted.map(t => {
                const dateStr = (t.drawTime ? new Date(t.drawTime) : new Date(t.createdAt))
                  .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
                const hasNumbers = t.ticketNumbers && t.ticketNumbers.length > 0 && t.ticketNumbers[0].main.length > 0;
                const hasAllNumbers = hasNumbers && t.ticketNumbers!.length >= t.numTickets;
                const isFailed = t.status === "failed";
                return (
                  <div key={t.id} className={`rounded-xl border bg-white/5 overflow-hidden ${isFailed ? "border-red-500/20" : "border-white/10"}`}>
                    {/* Main row — clickable to expand */}
                    <button
                      onClick={() => toggleExpand(t.id, !!hasAllNumbers)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <img src="/images/icons/ticket-icon.svg" alt="" className="w-9 h-9 shrink-0 opacity-90" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-semibold text-white">{t.numTickets} ticket{t.numTickets !== 1 ? "s" : ""}</span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ticketStatusBadgeClass(t.status, t.bridgeStatus, t.drawTime, t.roundId, nextDrawRoundId)}`}>
                            {statusLabel(t.status, t.bridgeStatus, t.drawTime, t.roundId, nextDrawRoundId)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {t.roundId ? `Round ${t.roundId} · ` : ""}{dateStr}
                          {t.winTier ? ` · Tier ${t.winTier}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-base font-semibold font-sans">
                          {(t.status === "won" || t.status === "withdrawn")
                            ? <span className="text-emerald-400">+{fmt(t.winAmountUsdc ?? 0)}</span>
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
                            <p className="text-sm text-slate-500">
                              Draw: {new Date(t.drawTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                            </p>
                          </div>
                        )}
                        {/* Check results button for active tickets past draw time */}
                        {t.status === "active" && (
                          (t.drawTime && new Date(t.drawTime) < new Date()) ||
                          (t.roundId && nextDrawRoundId && t.roundId !== nextDrawRoundId)
                        ) && (
                            <div className="space-y-2">
                              {checkResultMsg[t.id] && (
                                <p className={`text-sm ${checkResultMsg[t.id].startsWith("Error") ? "text-red-400" : checkResultMsg[t.id].includes("Won") ? "text-emerald-400" : "text-slate-400"}`}>
                                  {checkResultMsg[t.id]}
                                </p>
                              )}
                              <button
                                onClick={() => handleCheckResults(t.id)}
                                disabled={checkingResult === t.id}
                                className="w-full h-9 rounded-xl text-sm font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-40"
                              >
                                {checkingResult === t.id ? "Checking…" : "Check Results"}
                              </button>
                            </div>
                          )}
                        {/* Number balls */}
                        {hasNumbers ? (
                          <div className="space-y-2">
                            {!hasAllNumbers && (
                              <p className="text-sm text-slate-500 italic">Loading {t.numTickets - t.ticketNumbers!.length} more ticket numbers…</p>
                            )}
                            {t.winningNumbers && (
                              <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                                <p className="text-[10px] font-bold tracking-[0.16em] text-slate-600 uppercase mb-1.5">Winning numbers</p>
                                <div className="flex items-center gap-2">
                                  {t.winningNumbers.main.map(n => (
                                    <span key={n} className="w-7 h-7 rounded-full bg-white/10 border border-white/20 text-white text-xs font-bold flex items-center justify-center tabular-nums">{n}</span>
                                  ))}
                                  <span className="w-7 h-7 rounded-full bg-slate-800 border border-slate-600 text-slate-300 text-xs font-bold flex items-center justify-center tabular-nums">{t.winningNumbers.bonus}</span>
                                </div>
                              </div>
                            )}
                            <p className="text-sm text-slate-600">Your tickets</p>
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
                                      className="w-full h-9 rounded-xl text-sm font-medium text-slate-400 hover:text-white border border-white/10 hover:bg-white/[0.06] transition-all"
                                    >
                                      +{sorted.length - 5} more tickets
                                    </button>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        ) : (
                          <p className="text-sm text-slate-600 italic">Loading ticket numbers…</p>
                        )}
                      </div>
                    )}

                    {/* Failed ticket actions — funds must be retried or rescued before the
                      ticket can be removed (RESCUED/CANCELLED = nothing left to recover) */}
                    {isFailed && (
                      <div className="px-3 pb-3 space-y-2 border-t border-white/[0.06] pt-3">
                        {(retryResult[t.id] || rescueResult[t.id]) && (
                          <p className="text-sm text-amber-400">{retryResult[t.id] || rescueResult[t.id]}</p>
                        )}
                        {t.bridgeStatus === "RESCUED" || t.bridgeStatus === "CANCELLED" ? (
                          <button
                            onClick={() => handleDelete(t.id)}
                            disabled={deleting === t.id}
                            className="w-full h-9 rounded-xl text-sm font-semibold border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-all disabled:opacity-40"
                          >
                            {deleting === t.id ? "Removing…" : "Remove from history"}
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleRetry(t.id)}
                              disabled={retrying === t.id || rescuing === t.id}
                              className="flex-1 h-9 rounded-xl text-sm font-semibold border border-[#FF7A2A]/40 text-[#FF7A2A] hover:bg-[#FF7A2A]/10 transition-all disabled:opacity-40"
                            >
                              {retrying === t.id ? "Retrying…" : "Retry purchase"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRescue(t.id)}
                              disabled={rescuing === t.id || retrying === t.id}
                              className="flex-1 h-9 rounded-xl text-sm font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40"
                            >
                              {rescuing === t.id ? "Rescuing…" : "Rescue funds"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full h-10 mt-3 rounded-xl text-sm font-semibold border border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-40"
              >
                {loadingMore ? "Loading…" : "Show more tickets"}
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

function DrawResultModal({ results, winningNumbers, ticketNumbers, onClose, onRedeem }: {
  results: DrawResult[];
  winningNumbers?: { main: number[]; bonus: number } | null;
  ticketNumbers?: { main: number[]; bonus: number }[] | null;
  onClose: () => void;
  onRedeem: () => void;
}) {
  const anyWon = results.some(r => r.status === "won");
  const totalWon = results.reduce((sum, r) => sum + (r.winAmountUsdc ?? 0), 0);
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
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-0.5">Draw Result</p>
            {anyWon ? (
              <>
                <h2 className="text-2xl font-bold text-white">You Won!</h2>
                <p className="text-xl font-semibold text-emerald-400">+{fmt(totalWon)}</p>
              </>
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
          <Link href="/app/megapot?tab=redeem" onClick={onRedeem}
            className="flex items-center justify-center w-full h-11 rounded-xl font-semibold bg-emerald-500 hover:bg-emerald-400 text-white transition-all">
            Redeem Winnings
          </Link>
        ) : (
          <Link href="/app/megapot" onClick={onClose}
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
  { label: "Good luck", href: "/app/megapot?tab=buy&preview=done" },
  { label: "Draw — Won", href: "/app/megapot?tab=buy&preview=won" },
  { label: "Draw — Lost", href: "/app/megapot?tab=buy&preview=lost" },
  { label: "Redeem — 1 win", href: "/app/megapot?tab=redeem&preview=redeem" },
  { label: "Redeem — batch", href: "/app/megapot?tab=redeem&preview=redeem-batch" },
  { label: "Redeem — done", href: "/app/megapot?tab=redeem&preview=redeem-done" },
] as const;

function DevPreviewPanel() {
  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-1 p-2 rounded-2xl bg-black/85 backdrop-blur border border-white/10 shadow-2xl">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1.5 pt-0.5">Preview flow (dev)</p>
      {DEV_PREVIEW_LINKS.map(l => (
        <Link key={l.label} href={l.href}
          className="text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 rounded-lg px-2 py-1.5 transition-colors">
          {l.label}
        </Link>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MegapotPage() {
  const { getAccessToken } = usePrivy();
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

  // Dev-only: mock winning tickets for redeem UI preview (see DevPreviewPanel)
  const redeemPreview = IS_LOCALHOST ? searchParams?.get("preview") : null;
  const wonTickets = redeemPreview === "redeem" || redeemPreview === "redeem-done"
    ? PREVIEW_WON_TICKETS.slice(0, 1)
    : redeemPreview === "redeem-batch"
      ? PREVIEW_WON_TICKETS
      : [...(dashboard?.activeTickets ?? []), ...(dashboard?.history ?? [])].filter(t => t.status === "won");
  const isRedeemPreview = redeemPreview === "redeem" || redeemPreview === "redeem-batch" || redeemPreview === "redeem-done";

  return (
    <div className="bg-[#0f0f12] text-white mobile-first">
      <div className="w-full max-w-lg mx-auto px-4 py-6 min-h-[calc(100svh-var(--header-h,0px)-4rem)]">

        <MegapotTabs activeTab={tab} wonCount={wonTickets.length} />

        {tab === "buy" && (
          <>
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
          <WithdrawTab wonTickets={wonTickets} accessToken={accessToken.current} userSolanaAddress={userSolanaAddress} solPriceUsd={solPriceUsd} onWithdrawn={fetchDashboard} dashboardLoading={isRedeemPreview ? false : dashboardLoading} previewDone={redeemPreview === "redeem-done"} />
        )}
        {tab === "history" && (
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
          />
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
