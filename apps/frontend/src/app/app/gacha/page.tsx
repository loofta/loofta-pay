"use client";

// Gacha "Rip Party" — explainer + Start. A separate route (not a stage inside /play) specifically
// so this one keeps the normal app header/chrome — only /app/gacha/play and the room itself go
// fully chromeless (see AppShell's isGachaRoomPage), so hitting Start is the moment it visually
// commits to "you're in the game now."

import Link from "next/link";
import GachaPack from "@/components/GachaPack";

export default function GachaExplainerPage() {
  return (
    <div className="relative w-full min-h-[calc(100vh-var(--header-h,0px))] bg-[#111114] text-slate-100">
      <div className="max-w-3xl mx-auto px-5 pt-6 pb-16">
        <div className="flex flex-col items-center text-center gap-6 py-10">
          <GachaPack width={180} />
          <div>
            <p className="font-display text-sm tracking-[0.2em] uppercase text-slate-400 mb-2">
              Loofta <span className="bg-gradient-to-r from-[#FF1301] via-[#FF6A00] to-[#EAB308] bg-clip-text text-transparent font-semibold">Rip Party</span>
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-[-0.02em] text-white">
              POOL UP. RIP A <span className="bg-gradient-to-r from-[#FF1301] via-[#FF6A00] to-[#EAB308] bg-clip-text text-transparent">REAL PACK.</span>
            </h1>
            <p className="text-slate-300 text-lg mt-4 max-w-md mx-auto">
              Everyone pays in, one real Pokemon pack gets pulled for the room. A roulette knocks a few people out —
              survivors can vote to cut even more for a bigger share. Last ones standing split the buyback.
            </p>
          </div>
          <Link
            href="/app/gacha/play"
            className="w-full max-w-xs h-12 flex items-center justify-center rounded-full bg-gradient-to-r from-[#FF1301] via-[#FF6A00] to-[#EAB308] text-white font-display font-semibold text-lg hover:opacity-90 transition-opacity"
          >
            START →
          </Link>
          <Link href="/app/gacha/demo" className="text-slate-400 hover:text-white text-sm underline underline-offset-2 transition-colors">
            Try the demo — no money, no backend
          </Link>
        </div>
      </div>
    </div>
  );
}
