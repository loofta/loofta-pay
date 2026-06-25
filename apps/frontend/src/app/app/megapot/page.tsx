"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useWallets, useSignAndSendTransaction } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { ArrowDown, X, Trophy, RefreshCw, Ticket, ShieldCheck, ArrowUpRight, Shuffle, MoreVertical, Plus, ChevronDown, Eraser } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MEGAPOT_REFERRAL = "https://megapot.io/r/Q3M637";
const MAGICBLOCK_SOL_GAS = 0.002;
const MAGICBLOCK_BPS = 10;
const BRIDGE_FEE_USD_EST = 0.10;
const MAIN_MAX = 30;
const MAIN_COUNT = 5;
const BONUS_MAX = 12;

const PRIZE_TIERS = [
  { normal: 5, bonusMatch: true,  prize: "$226,165.11" },
  { normal: 5, bonusMatch: false, prize: "$3,085.05" },
  { normal: 4, bonusMatch: true,  prize: "$272.39" },
  { normal: 4, bonusMatch: false, prize: "$25.67" },
  { normal: 3, bonusMatch: true,  prize: "$12.30" },
  { normal: 2, bonusMatch: true,  prize: "$3.94" },
  { normal: 3, bonusMatch: false, prize: "$3.05" },
  { normal: 1, bonusMatch: true,  prize: "$2.07" },
  { normal: 2, bonusMatch: false, prize: "Free ticket" },
  { normal: 0, bonusMatch: true,  prize: "Free ticket" },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "buy" | "redeem" | "history";
type BuyStep = "idle" | "signing" | "sent" | "bridging" | "buying" | "done" | "error";
type TicketStatus = "pending_send" | "sent" | "bridging" | "buying" | "active" | "won" | "lost" | "failed";

interface TicketNumbers { main: number[]; bonus: number }

interface TicketSummary {
  id: string; status: TicketStatus; numTickets: number; costUsdc: number;
  roundId: string | null; drawTime: string | null; winAmountUsdc: number | null;
  winTier: number | null; createdAt: string; depositAddress: string | null;
  bridgeStatus: string | null; bridgeExpiresAt: string | null;
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

function statusLabel(s: TicketStatus, bridgeStatus?: string | null): string {
  if (s === "failed" && bridgeStatus) {
    const bs = bridgeStatus.toUpperCase();
    if (bs === "REFUNDED") return "Refunded";
    if (bs === "EXPIRED") return "Expired";
  }
  const m: Record<TicketStatus, string> = {
    pending_send: "Awaiting deposit", sent: "Sent privately", bridging: "Bridging to Base",
    buying: "Buying tickets", active: "In draw", won: "Won!", lost: "No win", failed: "Failed",
  };
  return m[s] ?? s;
}
function statusColor(s: TicketStatus): string {
  if (s === "won") return "text-emerald-400";
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
function fmtFee(n: number): string {
  if (n > 0 && n < 0.005) return `$${n.toFixed(3)}`;
  return fmt(n);
}
function mbFee(cost: number, solPriceUsd: number) {
  return (MAGICBLOCK_BPS / 10_000) * cost + MAGICBLOCK_SOL_GAS * solPriceUsd;
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
        <a href="/app/megapot" className={tabBase}>
          <IconBubble active={activeTab === "buy"}><Ticket /></IconBubble>
          <span className={tabText("buy")}>Buy</span>
        </a>
        <a href="/app/megapot?tab=redeem" className={tabBase}>
          <IconBubble active={activeTab === "redeem"}><Trophy /></IconBubble>
          <span className={tabText("redeem")}>Redeem{wonCount > 0 ? ` (${wonCount})` : ""}</span>
        </a>
      </div>
      <a href="/app/megapot?tab=history"
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
      </a>
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
              <Shuffle className="w-3.5 h-3.5" /><span className="hidden sm:inline">Shuffle</span>
            </button>
            <button onClick={() => setDraft({ main: [], bonus: 0 })}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-slate-300 bg-white/[0.06] hover:bg-white/[0.10] transition-colors">
              <Eraser className="w-3.5 h-3.5" /><span className="hidden sm:inline">Clear</span>
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

function BuyStepper({ step, error }: { step: BuyStep; error?: string }) {
  const steps = [
    { key: "signing", label: "Send USDC via MagicBlock · up to 2 min privacy delay" },
    { key: "bridging", label: "Bridge USDC to Base via NEAR Intents" },
    { key: "buying", label: "Buy tickets on Megapot" },
    { key: "done", label: "Tickets active — good luck!" },
  ];
  const order: BuyStep[] = ["signing", "sent", "bridging", "buying", "done"];
  const ci = order.indexOf(step);
  return (
    <div className="mt-5 space-y-3">
      {steps.map((s, i) => {
        const idx = order.indexOf(s.key as BuyStep);
        const done = ci > idx || step === "done";
        const active = ci === idx && step !== "done";
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className={["w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all duration-300",
              done ? "bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] text-white"
                : active ? "bg-[#FF7A2A]/20 text-[#FF7A2A] ring-2 ring-[#FF7A2A]/50"
                : "bg-white/[0.05] text-slate-600"].join(" ")}>
              {done ? "✓" : i + 1}
            </div>
            <span className={["text-base transition-colors duration-300",
              done ? "text-slate-300" : active ? "text-white font-medium" : "text-slate-600"].join(" ")}>
              {s.label}
            </span>
          </div>
        );
      })}
      {(step === "signing" || step === "sent") && (
        <p className="text-sm text-slate-500 pt-1">
          Your USDC is being routed privately through MagicBlock. This can take up to 2 minutes — the page will update automatically.
        </p>
      )}
      {error && <p className="text-base text-red-400 pt-1">{error}</p>}
    </div>
  );
}

// ─── Fee breakdown ────────────────────────────────────────────────────────────

function FeeBreakdown({ ticketCostUsd, mode, solPriceUsd }: {
  ticketCostUsd: number;
  mode: "buy" | "buy-public" | "base" | "solana_private";
  solPriceUsd: number;
}) {
  const bpsFee = (MAGICBLOCK_BPS / 10_000) * ticketCostUsd;
  const solFee = MAGICBLOCK_SOL_GAS * solPriceUsd;
  const mbTotal = bpsFee + solFee;

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
    const wMb = (MAGICBLOCK_BPS / 10_000) * ticketCostUsd + solFee;
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base text-slate-400">Bridge (Base → SOL)</span>
          <span className="text-base text-slate-400 tabular-nums">~{fmt(BRIDGE_FEE_USD_EST)}</span>
        </div>
        <div className="px-4 py-3.5 space-y-1.5">
          <div className="flex justify-between">
            <span className="text-base text-slate-400">MagicBlock privacy relay</span>
            <span className="text-base text-slate-400 tabular-nums">~{fmt(wMb)}</span>
          </div>
          <div className="flex justify-between pl-3">
            <span className="text-sm text-slate-600">{MAGICBLOCK_BPS} BPS + 0.002 SOL gas</span>
            <span className="text-sm text-slate-600 tabular-nums">{fmtFee(bpsFee)} + {fmt(solFee)}</span>
          </div>
        </div>
        <div className="flex justify-between px-4 py-3.5">
          <span className="text-base font-semibold text-white">You receive (~)</span>
          <span className="text-base font-semibold text-white tabular-nums">{fmt(Math.max(0, ticketCostUsd - BRIDGE_FEE_USD_EST - wMb))}</span>
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

  const total = ticketCostUsd + mbTotal + BRIDGE_FEE_USD_EST;
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
      <div className="flex justify-between px-4 py-3.5">
        <span className="text-base text-slate-400">Tickets ({ticketCostUsd} × $1.00)</span>
        <span className="text-base text-slate-200 tabular-nums">{fmt(ticketCostUsd)}</span>
      </div>
      <div className="px-4 py-3.5 space-y-1.5">
        <div className="flex justify-between">
          <span className="text-base text-slate-400">MagicBlock privacy fee</span>
          <span className="text-base text-slate-400 tabular-nums">~{fmt(mbTotal)}</span>
        </div>
        <div className="flex justify-between pl-3">
          <span className="text-sm text-slate-600">{MAGICBLOCK_BPS} BPS of {fmt(ticketCostUsd)}</span>
          <span className="text-sm text-slate-600 tabular-nums">{fmtFee(bpsFee)}</span>
        </div>
        <div className="flex justify-between pl-3">
          <span className="text-sm text-slate-600">0.002 SOL gas relay (~${solPriceUsd.toFixed(0)}/SOL)</span>
          <span className="text-sm text-slate-600 tabular-nums">{fmt(solFee)}</span>
        </div>
      </div>
      <div className="flex justify-between px-4 py-3.5">
        <span className="text-base text-slate-400">Bridge (SOL → Base)</span>
        <span className="text-base text-slate-400 tabular-nums">~{fmt(BRIDGE_FEE_USD_EST)}</span>
      </div>
      <div className="flex justify-between px-4 py-3.5">
        <span className="text-base font-semibold text-white">Total from your balance</span>
        <span className="text-base font-semibold text-white tabular-nums">~{fmt(total)}</span>
      </div>
    </div>
  );
}

// ─── Buy tab ──────────────────────────────────────────────────────────────────

const PRESETS = [5, 10, 50, 100] as const;
const PRIVATE_MIN = 5;

function BuyTab({ accessToken, solPriceUsd, onPurchased, activeTickets, dashboardLoading }: {
  accessToken: string | null;
  solPriceUsd: number;
  onPurchased: () => void;
  activeTickets: TicketSummary[];
  dashboardLoading?: boolean;
}) {
  const [numTickets, setNumTickets] = useState(PRIVATE_MIN);
  const [tickets, setTickets] = useState<TicketNumbers[]>(() => Array.from({ length: PRIVATE_MIN }, randomTicket));
  const [chooseOpen, setChooseOpen] = useState(false);
  const [step, setStep] = useState<BuyStep>("idle");
  const [stepError, setStepError] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingStartedRef = useRef(false);
  const suppressedTicketIdRef = useRef<string | null>(null);

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
      const { ticketId, txBase64 } = await initRes.json();
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
      {isRunning || step === "done" ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-slate-300 text-xl font-medium font-sans">
              {step === "done" ? "You're in the draw! 🎰" : "Processing..."}
            </p>
            {IS_LOCALHOST && isRunning && (
              <button
                onClick={startNewPayment}
                className="text-xs text-slate-500 hover:text-slate-300 border border-white/10 rounded-lg px-2 py-1 transition-colors"
              >
                New payment
              </button>
            )}
          </div>
          <BuyStepper step={step} error={stepError} />
          {step === "done" && (
            <button onClick={resetBuy} className="text-sm text-slate-400 hover:text-white underline underline-offset-2 transition-colors">
              Buy more tickets
            </button>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-slate-300 text-xl font-medium font-sans">Buy tickets</p>
            <a href={MEGAPOT_REFERRAL} target="_blank" rel="noopener noreferrer"
              className="text-sm text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2">
              megapot.io ↗
            </a>
          </div>

          <p className="text-sm text-slate-500">🔒 Shielded via MagicBlock. Min {PRIVATE_MIN} tickets. Uses your Loofta balance.</p>

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
                        : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10"].join(" ")}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
              <button onClick={() => setCount(numTickets - 1)}
                className="w-14 h-12 flex items-center justify-center text-2xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all shrink-0">
                −
              </button>
              <span className="flex-1 text-center text-2xl font-bold text-white tabular-nums">{numTickets}</span>
              <button onClick={() => setCount(numTickets + 1)}
                className="w-14 h-12 flex items-center justify-center text-2xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all shrink-0">
                +
              </button>
            </div>
          </div>

          {/* Choose numbers — collapsible for ≤10 tickets, random notice for 11+ */}
          {numTickets <= 10 ? (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
              <button type="button" onClick={() => setChooseOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-white/[0.03] transition-colors">
                <span className="text-base font-medium text-slate-300">Choose numbers</span>
                <ChevronDown className={["w-4 h-4 text-slate-500 transition-transform duration-200", chooseOpen ? "rotate-180" : ""].join(" ")} />
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
              <Shuffle className="w-4 h-4 text-slate-500 shrink-0" />
              <p className="text-base text-slate-500">Numbers picked randomly for 11+ tickets</p>
            </div>
          )}

          <FeeBreakdown ticketCostUsd={numTickets} mode="buy" solPriceUsd={solPriceUsd} />

          {step === "error" && stepError && (
            <p className="text-base text-red-400">{stepError}</p>
          )}

          <button onClick={() => handlePrivateBuy()}
            className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all">
            {`Buy ${numTickets === 1 ? "Ticket" : "Tickets"} · ${fmt(numTickets + mbFee(numTickets, solPriceUsd) + BRIDGE_FEE_USD_EST)}`}
          </button>
        </>
      )}
    </div>
  );
}



// ─── Withdraw tab ─────────────────────────────────────────────────────────────

function WithdrawTab({ wonTickets, accessToken, userSolanaAddress, solPriceUsd, onWithdrawn }: {
  wonTickets: TicketSummary[]; accessToken: string | null;
  userSolanaAddress: string; solPriceUsd: number; onWithdrawn: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [route, setRoute] = useState<"base" | "solana_private">("solana_private");
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const ticket = wonTickets.find(t => t.id === selected);

  async function handleWithdraw() {
    if (!selected || !destination) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/lottery/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ ticketId: selected, route, destinationAddress: destination }),
      });
      if (!res.ok) throw new Error((await res.json()).message ?? "Failed");
      setDone(true); onWithdrawn();
    } catch (err: any) { setError(err.message ?? "Unknown error"); }
    finally { setLoading(false); }
  }

  if (!wonTickets.length) return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
      <Trophy className="w-8 h-8 text-slate-700 mx-auto mb-3" />
      <p className="text-slate-400 text-base">No winnings to withdraw yet.</p>
      <p className="text-slate-500 text-base mt-1">Buy tickets and come back after the daily draw.</p>
    </div>
  );

  if (done) return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center space-y-3">
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF4A26] via-[#FF7A2A] to-[#E1A041] shadow-[0_8px_24px_rgba(255,122,42,0.25)] flex items-center justify-center mx-auto">
        <ArrowDown className="w-5 h-5 text-white" />
      </div>
      <p className="text-white font-semibold">Withdrawal initiated</p>
      <p className="text-base text-slate-400">
        {route === "base" ? "USDC is being sent to your Base wallet." : "Routing privately to your Loofta balance — takes ~5 min."}
      </p>
      <button onClick={() => { setDone(false); setSelected(null); setDestination(""); }}
        className="text-base text-slate-400 hover:text-white underline underline-offset-2 transition-colors">
        Withdraw another
      </button>
    </div>
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 space-y-5">
      <p className="text-slate-300 text-xl font-medium font-sans">Withdraw winnings</p>

      <div>
        <p className="text-slate-300 text-xl font-sans font-medium mb-3">Select winning ticket</p>
        <div className="space-y-2">
          {wonTickets.map(t => (
            <button key={t.id} onClick={() => setSelected(t.id)}
              className={["w-full flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all duration-200 text-left",
                selected === t.id ? "bg-[#FF7A2A]/10 border-[#FF7A2A]/30 shadow-[0_0_0_1px_rgba(255,122,42,0.2)]"
                  : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"].join(" ")}>
              <div>
                <p className="text-white text-base font-medium">{t.numTickets} ticket{t.numTickets > 1 ? "s" : ""}</p>
                <p className="text-slate-500 text-sm mt-0.5">
                  {t.drawTime ? new Date(t.drawTime).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                  {t.winTier ? ` · Tier ${t.winTier}` : ""}
                </p>
              </div>
              <span className="text-emerald-400 font-semibold tabular-nums">{fmt(t.winAmountUsdc ?? 0)}</span>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <>
          <div>
            <p className="text-slate-300 text-xl font-sans font-medium mb-3">How to receive</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "solana_private" as const, title: "Loofta balance", sub: "Private · ~$0.50 fee", icon: <ShieldCheck className="w-4 h-4" /> },
                { key: "base" as const, title: "Base wallet", sub: "Free · on-chain link", icon: <ArrowUpRight className="w-4 h-4" /> },
              ]).map(opt => (
                <button key={opt.key} onClick={() => { setRoute(opt.key); setDestination(opt.key === "solana_private" ? userSolanaAddress : ""); }}
                  className={["px-3.5 py-3.5 rounded-xl border text-left transition-all duration-200",
                    route === opt.key ? "bg-[#FF7A2A]/10 border-[#FF7A2A]/30 shadow-[0_0_0_1px_rgba(255,122,42,0.2)]"
                      : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06]"].join(" ")}>
                  <div className={["mb-1.5", route === opt.key ? "text-[#FF7A2A]" : "text-slate-500"].join(" ")}>{opt.icon}</div>
                  <p className="text-base font-semibold text-white">{opt.title}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{opt.sub}</p>
                </button>
              ))}
            </div>
          </div>

          {route === "base" ? (
            <div>
              <p className="text-slate-300 text-xl font-sans font-medium mb-3">Your Base wallet address</p>
              <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="0x..."
                className="w-full h-12 px-4 rounded-xl text-base text-white placeholder-slate-600 bg-white/5 border border-white/10 focus:outline-none focus:border-white/20 transition-all" />
              <p className="text-base text-amber-400/70 mt-1.5">Creates a visible on-chain link to this address.</p>
            </div>
          ) : (
            <div className="rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3.5 space-y-1">
              <p className="text-base text-slate-300 font-medium">Sending to your Loofta balance</p>
              <p className="text-sm font-mono text-slate-600 truncate">{userSolanaAddress}</p>
              <p className="text-base text-emerald-400/70">NEAR Intents bridge → fresh burner → MagicBlock private → your balance</p>
            </div>
          )}

          <FeeBreakdown ticketCostUsd={ticket?.winAmountUsdc ?? 0} mode={route} solPriceUsd={solPriceUsd} />
          {error && <p className="text-base text-red-400">{error}</p>}

          <button onClick={handleWithdraw} disabled={loading || !destination}
            className="w-full h-12 rounded-xl font-semibold text-lg bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Processing..." : `Withdraw ${fmt(ticket?.winAmountUsdc ?? 0)}`}
          </button>
        </>
      )}
    </div>
  );
}

// ─── History drawer ───────────────────────────────────────────────────────────

function ticketStatusBadgeClass(s: TicketStatus, bridgeStatus?: string | null): string {
  if (s === "failed" && bridgeStatus) {
    const bs = bridgeStatus.toUpperCase();
    if (bs === "REFUNDED") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (bs === "EXPIRED") return "bg-slate-500/20 text-slate-400 border-slate-500/30";
  }
  switch (s) {
    case "won": return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "lost": return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    case "failed": return "bg-red-500/20 text-red-400 border-red-500/30";
    case "active": return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default: return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  }
}

const IS_LOCALHOST = typeof window !== "undefined" && window.location.hostname === "localhost";

function HistoryTab({ history, withdrawals, activeTickets, getAccessToken, onRefresh, refetch, userSolanaAddress }: {
  history: TicketSummary[]; withdrawals: WithdrawalSummary[]; activeTickets: TicketSummary[];
  getAccessToken: () => Promise<string | null>; onRefresh: () => void; refetch?: () => void;
  userSolanaAddress: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [rescuing, setRescuing] = useState<string | null>(null);
  const [rescueResult, setRescueResult] = useState<Record<string, string>>({});
  const [rescuingBurner, setRescuingBurner] = useState<string | null>(null);
  const [rescueBurnerResult, setRescueBurnerResult] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  const awaitingDeposit = activeTickets.filter(t => t.status === "pending_send");
  const inFlight = activeTickets.filter(t => ["sent", "bridging", "buying"].includes(t.status));
  const completed = [...activeTickets.filter(t => t.status === "active"), ...history]
    .filter(t => t.bridgeStatus !== "CANCELLED")
    .sort((a, b) => {
      // Failed tickets float to top
      if (a.status === "failed" && b.status !== "failed") return -1;
      if (b.status === "failed" && a.status !== "failed") return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const allForStats = [...activeTickets, ...history];
  const totalSpent = allForStats.filter(t => t.status !== "failed").reduce((s, t) => s + t.costUsdc, 0);
  const totalWon = allForStats.filter(t => t.status === "won").reduce((s, t) => s + (t.winAmountUsdc ?? 0), 0);

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
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ticketStatusBadgeClass(t.status, t.bridgeStatus)}`}>
                      {statusLabel(t.status, t.bridgeStatus)}
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
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => handleCancel(t.id)}
                          disabled={cancelling === t.id || rescuingBurner === t.id}
                          className="flex-1 h-10 rounded-xl text-sm font-semibold border border-white/10 text-slate-400 hover:bg-white/[0.06] transition-all disabled:opacity-40">
                          {cancelling === t.id ? "Cancelling..." : "Cancel"}
                        </button>
                        <button type="button"
                          onClick={() => handleRescueBurner(t.id)}
                          disabled={rescuingBurner === t.id || cancelling === t.id}
                          className="flex-1 h-10 rounded-xl text-sm font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40">
                          {rescuingBurner === t.id ? "Rescuing..." : "Rescue from Solana"}
                        </button>
                      </div>
                    </div>
                  )}
                  {t.status === "bridging" && (
                    <button type="button"
                      onClick={() => handleCancel(t.id)}
                      disabled={cancelling === t.id}
                      className="w-full h-10 rounded-xl text-sm font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 active:bg-red-500/20 transition-all disabled:opacity-40">
                      {cancelling === t.id ? "Cancelling..." : "Cancel purchase"}
                    </button>
                  )}
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
                          className="flex-1 h-10 rounded-xl text-sm font-semibold border border-violet-500/30 text-violet-400 hover:bg-violet-500/10 transition-all disabled:opacity-40">
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
      {completed.length === 0 && awaitingDeposit.length === 0 && inFlight.length === 0 ? (
        <p className="text-slate-500 text-base text-center pt-8">No tickets yet.</p>
      ) : completed.length > 0 && (
        <div>
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Tickets</p>
          <div className="space-y-2">
            {completed.map(t => {
              const dateStr = (t.drawTime ? new Date(t.drawTime) : new Date(t.createdAt))
                .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
              return (
                <details key={t.id} open={t.status === "failed"} className="rounded-xl border border-white/10 bg-white/5 group">
                  <summary className="flex items-center justify-between p-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-white">{t.numTickets} ticket{t.numTickets !== 1 ? "s" : ""}</span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ticketStatusBadgeClass(t.status, t.bridgeStatus)}`}>
                        {statusLabel(t.status, t.bridgeStatus)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold font-sans">
                        {t.status === "won"
                          ? <span className="text-emerald-400">+{fmt(t.winAmountUsdc ?? 0)}</span>
                          : <span className="text-slate-400">−{fmt(t.costUsdc)}</span>}
                      </span>
                      <ChevronDown className="w-4 h-4 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
                    </div>
                  </summary>
                  <div className="px-3 pb-3 pt-2 space-y-1 border-t border-white/10">
                    <p className="text-base text-slate-500">{dateStr}</p>
                    {(t.roundId || t.winTier) && (
                      <p className="text-base text-slate-400">
                        {t.roundId ? `Round ${t.roundId}` : ""}
                        {t.winTier ? ` · Tier ${t.winTier}` : ""}
                      </p>
                    )}
                    {t.status === "failed" && (
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                        className="w-full mt-2 h-10 rounded-xl text-sm font-semibold border border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition-all disabled:opacity-40"
                      >
                        {deleting === t.id ? "Removing…" : "Remove from history"}
                      </button>
                    )}
                    {t.status === "failed" && !["CANCELLED", "RESCUED"].includes(t.bridgeStatus ?? "") && (
                      <div className="mt-2 p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
                        <p className="text-sm font-semibold text-slate-400">Troubleshoot</p>
                        {(retryResult[t.id] || rescueResult[t.id]) && (
                          <p className="text-sm text-amber-400">{retryResult[t.id] || rescueResult[t.id]}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRetry(t.id)}
                            disabled={retrying === t.id || rescuing === t.id}
                            className="flex-1 h-10 rounded-xl text-sm font-semibold border border-violet-500/30 text-violet-400 hover:bg-violet-500/10 transition-all disabled:opacity-40"
                          >
                            {retrying === t.id ? "Retrying..." : "Retry purchase"}
                          </button>
                          <button
                            onClick={() => handleRescue(t.id)}
                            disabled={rescuing === t.id || retrying === t.id}
                            className="flex-1 h-10 rounded-xl text-sm font-semibold border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all disabled:opacity-40"
                          >
                            {rescuing === t.id ? "Rescuing..." : "Rescue funds"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {/* Redemptions */}
      {withdrawals.length > 0 && (
        <div>
          <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Redemptions</p>
          <ul className="space-y-2">
            {withdrawals.map(w => (
              <li key={w.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-semibold text-emerald-400">{fmt(w.amountUsdc)}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                    w.status === "complete" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                    : w.status === "failed" ? "bg-red-500/20 text-red-400 border-red-500/30"
                    : "bg-violet-500/20 text-violet-400 border-violet-500/30"
                  }`}>{w.status}</span>
                </div>
                <div className="mt-1 text-base text-slate-500">
                  {w.route === "base" ? "Base wallet" : "Loofta balance"} · {new Date(w.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────

const FAQ_ITEMS: { question: string; answer: ReactNode }[] = [
  {
    question: "What are the fees to buy tickets?",
    answer: (
      <>
        <p className="mb-3">Each ticket costs <span className="font-medium text-slate-300">$1 USDC</span>. On top of that:</p>
        <p className="mb-3"><span className="font-medium text-slate-300">MagicBlock privacy fee:</span> 10 BPS (0.1%) of the ticket amount + 0.002 SOL for gas relay (~$0.28 at $140/SOL). For 10 tickets the privacy fee is about $0.29.</p>
        <p><span className="font-medium text-slate-300">Bridge fee:</span> ~$0.10 est. per bridge hop (Solana → Base) — actual fee quoted at time of bridge. Your total for 10 tickets is roughly <span className="font-medium text-slate-300">$10.59</span>.</p>
      </>
    ),
  },
  {
    question: "How does privacy work?",
    answer: (
      <>
        <p className="mb-3">Your Solana identity is shielded by <span className="font-medium text-slate-300">MagicBlock</span> — a privacy pool that adds a random delay (up to 2 min for ticket purchases), making on-chain timing analysis useless.</p>
        <p className="mb-3">A fresh one-time Solana burner wallet bridges funds to Base via <span className="font-medium text-slate-300">NEAR Intents</span>, which creates a unique deposit address per transaction.</p>
        <p>A <span className="font-medium text-slate-300">brand-new companion wallet is created for every ticket purchase</span>, so even if someone watches Base they can't link your tickets to each other or to you.</p>
      </>
    ),
  },
  {
    question: "What is MagicBlock?",
    answer: (
      <>
        <p className="mb-3">MagicBlock is a <span className="font-medium text-slate-300">Solana privacy protocol</span> that routes USDC through a shielded pool with randomized delays — up to 2 minutes for ticket purchases.</p>
        <p>The relay fee is <span className="font-medium text-slate-300">10 BPS + 0.002 SOL gas</span>. The SOL gas cannot be set to zero — it funds the relay node that submits the transaction privately.</p>
      </>
    ),
  },
  {
    question: "What is NEAR Intents?",
    answer: (
      <>
        <p className="mb-3">NEAR Intents (OneClick SDK) is a cross-chain bridge. It generates a <span className="font-medium text-slate-300">unique deposit address per quote</span> — sending to it triggers the bridge automatically with no linking metadata.</p>
        <p>We use it for Solana → Base (to fund ticket purchases) and Base → Solana (for private withdrawals). Each hop uses a fresh address.</p>
      </>
    ),
  },
  {
    question: "What are the withdrawal fees for winnings?",
    answer: (
      <>
        <p className="mb-3"><span className="font-medium text-slate-300">Base wallet — free.</span> The companion wallet sends USDC directly. No fee, but creates a visible on-chain link between the companion wallet and your Base address.</p>
        <p><span className="font-medium text-slate-300">Loofta balance (private) — ~$0.50.</span> bridge (Base→Solana, ~$0.10 est.) + MagicBlock relay (10 BPS + 0.002 SOL, ~$0.28). Fully unlinkable — worth it for meaningful winnings.</p>
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

  const wonTickets = [...(dashboard?.activeTickets ?? []), ...(dashboard?.history ?? [])].filter(t => t.status === "won");

  return (
    <div className="bg-[#0f0f12] text-white mobile-first">
      <div className="w-full max-w-lg mx-auto px-4 py-6 min-h-[calc(100svh-var(--header-h,0px)-4rem)]">

        <MegapotTabs activeTab={tab} wonCount={wonTickets.length} />

        {tab === "buy" && (
          <>
            {/* Prize pool hero */}
            <div className="text-center pt-2 pb-7">
              <p className="text-xs font-bold tracking-[0.22em] text-slate-500 uppercase mb-3">Prize Pool</p>
              <p
                className="text-[76px] sm:text-[88px] font-black leading-none tracking-tight bg-gradient-to-b from-white via-slate-100 to-amber-200 bg-clip-text text-transparent select-none"
                style={{ filter: "drop-shadow(0 3px 24px rgba(234,179,8,0.18))" }}
              >
                {dashboard?.nextDraw?.prizePool
                  ? `$${Math.round(parseFloat(dashboard.nextDraw.prizePool)).toLocaleString("en-US")}`
                  : "$1,100,000"}
              </p>
              {dashboard?.nextDraw?.drawTime && (
                <p className="text-sm text-slate-500 mt-2">
                  {(() => {
                    const d = new Date(dashboard.nextDraw.drawTime);
                    const diff = d.getTime() - Date.now();
                    if (diff <= 0) return "Draw in progress";
                    const h = Math.floor(diff / 3_600_000);
                    const m = Math.floor((diff % 3_600_000) / 60_000);
                    return `Next draw in ${h}h ${m}m`;
                  })()}
                </p>
              )}
              <div className="flex items-center justify-center gap-3 mt-5">
                <button
                  onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
                  className="px-5 py-2 rounded-full border border-white/20 text-white font-medium text-sm hover:bg-white/[0.06] transition-colors"
                >
                  How to Play
                </button>
                <button
                  onClick={() => setPrizeTiersOpen(true)}
                  className="px-5 py-2 rounded-full border border-white/20 text-white font-medium text-sm hover:bg-white/[0.06] transition-colors"
                >
                  Prize Tiers
                </button>
              </div>
            </div>

            <BuyTab accessToken={accessToken.current} solPriceUsd={solPriceUsd} onPurchased={fetchDashboard} activeTickets={dashboard?.activeTickets ?? []} dashboardLoading={dashboardLoading} />
          </>
        )}
        {tab === "redeem" && (
          <WithdrawTab wonTickets={wonTickets} accessToken={accessToken.current} userSolanaAddress={userSolanaAddress} solPriceUsd={solPriceUsd} onWithdrawn={fetchDashboard} />
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
          />
        )}
      </div>

      {prizeTiersOpen && (
        <PrizeTiersModal onClose={() => setPrizeTiersOpen(false)} totalPool={dashboard?.nextDraw?.prizePool} />
      )}

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
