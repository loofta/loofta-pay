"use client";

import { Landmark } from "lucide-react";
import { PEER_PLATFORMS } from "@/lib/peerPlatforms";

/** A few popular cash apps, a bank icon and a "+", instead of every provider. The full list is on the next screen. */
const SHOWN = ["revolut", "venmo", "wise", "paypal"];

export function ClaimCashTiles() {
  const apps = SHOWN.map((id) => PEER_PLATFORMS.find((p) => p.id === id)).filter(
    (p): p is (typeof PEER_PLATFORMS)[number] => Boolean(p),
  );
  return (
    <span className="grid grid-cols-3 gap-x-2 gap-y-3">
      {apps.map((p) => (
        <span key={p.id} className="flex flex-col items-center gap-1.5">
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/5 border border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.logo} alt="" className="h-7 w-7 object-contain" />
          </span>
          <span className="text-sm font-normal text-slate-400">{p.name}</span>
        </span>
      ))}
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/10">
          <Landmark className="h-6 w-6 text-slate-200" />
        </span>
        <span className="text-sm font-normal text-slate-400">Bank</span>
      </span>
      <span className="flex flex-col items-center gap-1.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-xl font-semibold text-slate-200">+</span>
        <span className="text-sm font-normal text-slate-400">More</span>
      </span>
    </span>
  );
}
