"use client";

import { useEffect, useState } from "react";
import { AmplePackCard } from "@/components/app-home/AmplePackCard";

const day = 86_400_000;
const base = { id: "demo", network: "EVM", bonusTickets: 50, minDepositUsd: 10, withdrawnBeforeOpenUsd: 0 };
const STATES: Array<[string, any]> = [
  ["Just ripped, nothing deposited yet", { eligible: true, pack: { ...base, status: "OPENED", depositedUsd: 0, fundingDeadline: new Date(Date.now() + 3 * day).toISOString() } }],
  ["Partly deposited", { eligible: true, pack: { ...base, status: "OPENED", depositedUsd: 4.5, fundingDeadline: new Date(Date.now() + 3 * day).toISOString() } }],
  ["Deposit counted, gift on the way", { eligible: true, pack: { ...base, status: "UNLOCKED", depositedUsd: 10, drawEndsAt: new Date(Date.now() + 6 * day).toISOString() } }],
  ["Deposit window missed", { eligible: true, pack: { ...base, status: "EXPIRED", depositedUsd: 0 } }],
];

/** Localhost-only preview of the home card in each state after a pack is ripped. */
export default function CardDemoPage() {
  const [local, setLocal] = useState(false);
  useEffect(() => { setLocal(["localhost", "127.0.0.1"].includes(window.location.hostname)); }, []);
  if (!local) return null;
  return (
    <div className="min-h-screen bg-[#0f0f12] p-6 text-white">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        {STATES.map(([label, pack]) => (
          <div key={label} className="flex flex-col gap-2">
            <p className="text-base font-bold text-white/70">{label}</p>
            <AmplePackCard demoPack={pack} getAccessToken={async () => null} />
          </div>
        ))}
      </div>
    </div>
  );
}
