"use client";

import { haptic } from "@/trade/lib/telegram";
import { RISK_STYLE, STAGE_STYLE, fillText, formatAge, formatChange, formatUsd } from "@/trade/lib/memecoin";
import { fmt } from "@/trade/lib/solana";
import type { CoinRef } from "@/trade/lib/coin";
import { Users } from "lucide-react";
import { Avatar, Pill } from "@/trade/components/ui";

/** One tappable coin row, used by Memepad, Spot and Home. */
export function CoinRow({ coin, onOpen, right }: { coin: CoinRef; onOpen: (c: CoinRef) => void; right?: React.ReactNode }) {
  const item = coin.item;
  const change = formatChange(coin.change);
  return (
    <button
      type="button"
      onClick={() => {
        haptic("tap");
        onOpen(coin);
      }}
      className="card flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    >
      <Avatar mint={coin.mint} symbol={coin.symbol} src={coin.icon} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-base font-bold">{coin.name}</span>
          {item?.fresh && item.stage.key === "new" && <span className="shrink-0 rounded-full bg-brand/20 px-2 py-0.5 text-base font-bold text-[#ff8a4a]">New</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 truncate text-base text-mute">
          <span>{coin.mcap != null ? `MC ${formatUsd(coin.mcap)}` : coin.usd != null ? `$${fmt(coin.usd, 6)}` : coin.symbol}</span>
          {item && formatAge(item.ageMinutes) && <span>· {formatAge(item.ageMinutes)}</span>}
        </div>
        {item?.holders != null && (
          <div className="mt-0.5 flex items-center gap-1.5 text-base text-mute">
            <Users size={15} />
            {item.holders.toLocaleString("en-US")} holders
          </div>
        )}
        {item && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 w-10 shrink-0 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full" style={{ width: `${Math.max(4, item.stage.percent)}%`, background: STAGE_STYLE[item.stage.key].color }} />
            </div>
            <span className="whitespace-nowrap text-base" style={{ color: STAGE_STYLE[item.stage.key].color }}>
              {fillText(item)}
            </span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {right ?? (
          <span style={{ color: change.color }} className="font-display text-base font-bold">
            {change.text}
          </span>
        )}
        {item && item.risk !== "med" && (
          <Pill color={RISK_STYLE[item.risk].color} bg={RISK_STYLE[item.risk].bg} border={RISK_STYLE[item.risk].border}>
            {item.risk === "low" ? "Lower risk" : "High risk"}
          </Pill>
        )}
      </div>
    </button>
  );
}
