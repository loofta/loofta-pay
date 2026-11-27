"use client";

import { useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Kind = "stock" | "device" | "game" | "cash" | "tickets";
type Prize = { no: string; title: string; sub: string; need: string; kind: Kind; image?: string };

/**
 * Prize cards styled after packs.ample.money. Cash and bonus tickets are pure type on a gradient and the stock card draws its own
 * chart, so they need no files. AirPods and GTA VI use a photo: drop airpods.jpg and gta-vi.jpg into /public/ample-pack/prizes/
 * (until then they show a gradient with an icon).
 */
export const PACK_PRIZES: Prize[] = [
  { no: "01", title: "Up to $250 of stocks", sub: "Stock prize", need: "Deposit $150 to activate", kind: "stock" },
  { no: "02", title: "AirPods", sub: "Physical prize", need: "Deposit $150 to activate", kind: "device", image: "/ample-pack/prizes/airpods.jpg" },
  { no: "03", title: "GTA VI", sub: "Game prize", need: "Deposit $150 to activate", kind: "game", image: "/ample-pack/prizes/gta-vi.jpg" },
  { no: "04", title: "$1", sub: "Cash", need: "$150 deposit, full weekly cycle", kind: "cash" },
  { no: "05", title: "$10", sub: "Bonus tickets", need: "Deposit $10 to activate", kind: "tickets" },
  { no: "06", title: "$25", sub: "Bonus tickets", need: "Deposit $10 to activate", kind: "tickets" },
  { no: "07", title: "$50", sub: "Bonus tickets", need: "Deposit $10 to activate", kind: "tickets" },
  { no: "08", title: "$25", sub: "Cash", need: "$150 deposit, full weekly cycle", kind: "cash" },
  { no: "09", title: "$100", sub: "Cash", need: "$150 deposit, full weekly cycle", kind: "cash" },
  { no: "10", title: "$500", sub: "Cash", need: "$150 deposit, full weekly cycle", kind: "cash" },
  { no: "11", title: "$150", sub: "Bonus tickets", need: "Deposit $10 to activate", kind: "tickets" },
];

const BG: Record<Kind, string> = {
  stock: "linear-gradient(180deg,#14307A,#0A1233)",
  device: "linear-gradient(180deg,#F4F5F1,#D6D8D2)",
  game: "linear-gradient(180deg,#3A1466 0%,#8A2D8C 55%,#F29A55 100%)",
  cash: "linear-gradient(180deg,#4FA06F,#1D5C3A)",
  tickets: "linear-gradient(180deg,#1C2420,#0A0F0D)",
};

function Logo({ dark }: { dark?: boolean }) {
  const c = dark ? "#111" : "#fff";
  return (
    <span className="flex items-center gap-1.5" style={{ color: c }}>
      <svg viewBox="0 0 28 14" width={22} height={11} aria-hidden><circle cx="21" cy="7" r="6.5" fill={c} /><circle cx="11" cy="8" r="4.2" fill={c} opacity=".85" /><circle cx="4" cy="9.5" r="2.6" fill={c} opacity=".7" /></svg>
      <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>ample</span>
    </span>
  );
}

function StockChart() {
  const bars = [[22, 38, "g"], [30, 42, "r"], [40, 32, "g"], [50, 36, "g"], [62, 44, "r"], [74, 30, "g"], [86, 24, "g"], [98, 18, "g"]] as const;
  return (
    <svg viewBox="0 0 140 90" className="h-full w-full" aria-hidden>
      {[20, 40, 60, 80].map((y) => <line key={y} x1="6" x2="134" y1={y} y2={y} stroke="#fff" strokeOpacity=".08" />)}
      <path d="M8 80 L24 66 L36 62 L48 52 L60 54 L72 40 L84 30 L96 22 L110 14 L110 84 L8 84 Z" fill="#fff" fillOpacity=".08" />
      {bars.map(([x, y, c], i) => <rect key={i} x={x - 3} y={y + 20} width="6" height="16" rx="1.5" fill={c === "g" ? "#6FD6A0" : "#FF7A8A"} opacity=".9" />)}
      <path d="M8 80 L24 66 L36 62 L48 52 L60 54 L72 40 L84 30 L96 22 L110 14" fill="none" stroke="#FFD36A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="110" cy="14" r="5" fill="#FFD36A" />
    </svg>
  );
}

function Fallback({ kind }: { kind: Kind }) {
  const c = { fill: "none", stroke: kind === "device" ? "#555" : "#fff", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const p: Partial<Record<Kind, ReactNode>> = {
    device: <><path d="M8 4c-2 0-3 2-3 5v3c0 1.4 1 2 2 2h1v5a1 1 0 002 0v-5" {...c} /><path d="M16 4c2 0 3 2 3 5v3c0 1.4-1 2-2 2h-1v5a1 1 0 01-2 0v-5" {...c} /></>,
    game: <><rect x="3" y="8" width="18" height="9" rx="4" {...c} /><path d="M8 12.5h3M9.5 11v3" {...c} /></>,
  };
  return <svg viewBox="0 0 24 24" width={64} height={64} aria-hidden>{p[kind]}</svg>;
}

function Card({ x }: { x: Prize }) {
  const [broken, setBroken] = useState(false);
  const light = x.kind === "device";
  const big = x.kind === "cash" || x.kind === "tickets";
  const ink = light ? "#111" : "#fff";
  const muted = light ? "rgba(0,0,0,.6)" : "rgba(255,255,255,.7)";
  return (
    <li className="relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-2xl border border-white/15 p-3" style={{ background: x.kind === "game" && x.image && !broken ? `linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,0) 30%,rgba(8,4,20,.85) 100%), url(${x.image}) center/cover` : BG[x.kind], color: ink }}>
      <div className="flex items-center justify-between">
        <Logo dark={light} />
        <span className="text-[15px] font-semibold" style={{ color: muted }}>No. {x.no}</span>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center py-1">
        {x.kind === "stock" && <div className="h-full w-full p-1"><StockChart /></div>}
        {big && <span className="text-5xl font-extrabold leading-none tracking-tight" style={{ textShadow: "0 4px 18px rgba(0,0,0,.25)" }}>{x.title}</span>}
        {x.image && !broken && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={x.image} alt={x.title} onError={() => setBroken(true)} className={x.kind === "game" ? "hidden" : "max-h-full max-w-full object-contain"} style={x.kind === "device" ? { mixBlendMode: "multiply" } : undefined} />
        )}
        {x.image && broken && <Fallback kind={x.kind} />}
      </div>
      <div className="flex flex-col">
        {!big && <span className="text-lg font-extrabold leading-tight">{x.title}</span>}
        {big && <span className="text-lg font-extrabold leading-tight">{x.sub}</span>}
        <span className="text-[15px] leading-snug" style={{ color: muted }}>{big ? (x.kind === "cash" ? "Paid in USDC" : "Draw entries, not cash") : x.sub}</span>
        <span className="mt-1 text-[14px] leading-snug" style={{ color: muted }}>{x.need}</span>
      </div>
    </li>
  );
}

export function PrizeGrid() {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {PACK_PRIZES.map((x) => <Card key={x.no} x={x} />)}
    </ul>
  );
}

/** Everything about the free Ample pack: how to get it, the prizes as cards, and how to claim. */
export function AmplePackInfoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wrapperZIndexClassName="z-[10001]" overlayZIndexClassName="z-[10000]" className="w-[calc(100vw-24px)] max-w-2xl max-h-[90svh] overflow-y-auto rounded-3xl border border-white/10 bg-[#141418] p-5 text-[#F2EFE8] sm:p-6">
        <DialogTitle className="text-2xl font-extrabold">What is in the drop</DialogTitle>
        <DialogDescription className="text-base text-slate-300">One free pack. Your reward is saved before the reveal. Pay $10 in total on Loofta (from 24 Nov) to rip it.</DialogDescription>

        <PrizeGrid />

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <h3 className="text-lg font-bold">How to claim</h3>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-base text-slate-200">
            <li>Prizes unlock with a qualifying deposit into Earn that stays in until fulfillment.</li>
            <li>Cash needs $150 of net new deposits kept for a full cycle (7 days minimum). Weekly close is Sunday 00:00 UTC, paid in USDC on Base after verification.</li>
            <li>Bonus tickets are for first-time Ample depositors: draw entries, not cash.</li>
            <li>AirPods and GTA VI: we use the email you are logged in with (or ask you to add and confirm one) and pass it to Ample.</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
