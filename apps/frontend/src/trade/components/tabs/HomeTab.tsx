"use client";

import { useState } from "react";
import { ChevronRight, Trophy } from "lucide-react";
import { AddCashIcon, CandlesIcon, SendIcon, VaultIcon } from "@/trade/components/icons";
import { RewardsSheet } from "@/trade/components/RewardsSheet";
import { ProfileChip } from "@/trade/components/ProfileChip";
import { useWallet } from "@/trade/hooks/useWallet";
import { usePortfolio } from "@/trade/lib/portfolio";
import { fmt } from "@/trade/lib/solana";
import { haptic } from "@/trade/lib/telegram";
import type { CoinRef } from "@/trade/lib/coin";
import { CoinRow } from "@/trade/components/CoinRow";
import { Skeleton, Tile } from "@/trade/components/ui";

type TabId = "home" | "trade" | "pay" | "earn" | "wallet";

export function HomeTab({ onOpen, goTo }: { onOpen: (c: CoinRef, side?: "buy" | "sell") => void; goTo: (t: TabId) => void }) {
  const { address } = useWallet();
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const { pf, total, coinsUsd } = usePortfolio(address);
  const holdings = pf ? pf.holdings : null;

  const actions: { label: string; icon: React.ReactNode; tone: "brand" | "green" | "gold" | "blue"; go: TabId }[] = [
    { label: "Trade", icon: <CandlesIcon size={30} />, tone: "brand", go: "trade" },
    { label: "Send", icon: <SendIcon size={30} />, tone: "brand", go: "pay" },
    { label: "Earn", icon: <VaultIcon size={30} />, tone: "brand", go: "earn" },
    { label: "Add cash", icon: <AddCashIcon size={30} />, tone: "brand", go: "wallet" },
  ];

  return (
    <div className="px-4 pt-2">
      <ProfileChip />
      {/* hero balance */}
      <div className="relative overflow-hidden rounded-[32px] p-6" style={{ background: "linear-gradient(135deg,#2a150c,#16110d 62%)", border: "1px solid rgba(255,90,26,0.28)" }}>
        <div className="text-base text-mute">Your balance</div>
        <div className="mt-1 font-display text-5xl font-extrabold tracking-tight">{total == null ? "$-" : `$${fmt(total, 2)}`}</div>
        <div className="mt-2 text-base text-mute">{total == null ? "Loading wallet..." : `Cash $${fmt(pf?.usdc ?? 0, 2)} · Coins $${fmt(coinsUsd, 2)}`}</div>
        <div className="anim-bob absolute right-6 top-6">
          <Tile tone="brand" size={80}>
            <img src="/icons/loofta-icon-white.svg" alt="" className="h-12 w-12" />
          </Tile>
        </div>
      </div>

      {/* quick actions */}
      <div className="mt-6 grid grid-cols-4 gap-3">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              haptic("tap");
              goTo(a.go);
            }}
            className="flex flex-col items-center gap-2 transition-transform active:scale-95"
          >
            <Tile tone={a.tone} size={64}>
              <span className="text-white">{a.icon}</span>
            </Tile>
            <span className="font-display text-base font-semibold">{a.label}</span>
          </button>
        ))}
      </div>

      {/* rewards */}
      <button
        type="button"
        onClick={() => {
          haptic("tap");
          setRewardsOpen(true);
        }}
        className="card mt-6 flex w-full items-center gap-3 px-4 py-4 text-left transition-transform active:scale-[0.98]"
      >
        <Tile tone="gold" size={48}>
          <Trophy size={24} className="text-white" />
        </Tile>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-bold">Rewards</div>
          <div className="text-base leading-snug text-mute">Invite a friend, both pay 5% lower fees. Badges and weekly leaderboard.</div>
        </div>
        <ChevronRight size={22} className="shrink-0 text-mute" />
      </button>
      {rewardsOpen && <RewardsSheet onClose={() => setRewardsOpen(false)} />}

      {/* positions */}
      <h2 className="mb-3 mt-8 font-display text-lg font-bold">Your coins</h2>
      <div className="space-y-3">
        {holdings === null && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        {holdings?.map((h) => (
          <CoinRow
            key={h.coin.mint}
            coin={h.coin}
            onOpen={(c) => onOpen(c, "sell")}
            right={
              <div className="text-right">
                <div className="font-display text-base font-bold">{h.usd != null ? `$${fmt(h.usd, 2)}` : "-"}</div>
                <div className="text-base text-mute">{fmt(h.amount)}</div>
              </div>
            }
          />
        ))}
        {holdings && holdings.length === 0 && (
          <div className="card flex flex-col items-center gap-3 px-4 py-8 text-center">
            <div className="font-display text-lg font-bold">No coins yet</div>
            <div className="text-base text-mute">Add some cash, then pick your first coin.</div>
            <button type="button" onClick={() => goTo("trade")} className="btn3d mt-1 h-14 w-full text-base">
              Browse markets
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
