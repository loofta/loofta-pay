"use client";

import { Landmark } from "lucide-react";
import { PEER_PLATFORMS } from "@/lib/peerPlatforms";

/** One row of overlapping logos (like the deposit "Payment app" row): popular apps, a bank icon and a "+". */
const SHOWN = ["revolut", "venmo", "wise", "paypal", "cashapp", "zelle"];
const TILE = "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-[#0f0f12] bg-[#1C1C22]";

export function ClaimCashTiles() {
  const apps = SHOWN.map((id) => PEER_PLATFORMS.find((p) => p.id === id)).filter(
    (p): p is (typeof PEER_PLATFORMS)[number] => Boolean(p),
  );
  return (
    <span className="flex items-center -space-x-2.5">
      {apps.map((p) => (
        <span key={p.id} className={TILE}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.logo} alt={p.name} className="h-6 w-6 object-contain" />
        </span>
      ))}
      <span className={TILE}>
        <Landmark className="h-5 w-5 text-slate-200" />
      </span>
      <span className={`${TILE} text-lg font-semibold text-slate-200`}>+</span>
    </span>
  );
}
