"use client";

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { haptic } from "@/trade/lib/telegram";
import { STAGE_STYLE, fillText, formatAge, formatAgeAt, formatChange, formatUsd } from "@/trade/lib/memecoin";
import type { CoinRef } from "@/trade/lib/coin";
import { Avatar } from "@/trade/components/ui";

const RISK_DOT = { low: "#3CB371", med: "#F5B70C", high: "#FF5A4A" } as const;

/** "up" or "down" for a moment whenever the number changes, so you can see it move. */
function useFlash(value: number | null | undefined): "up" | "down" | null {
  const prev = useRef(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value != null && prev.current != null && value !== prev.current) {
      setDir(value > prev.current ? "up" : "down");
      const t = setTimeout(() => setDir(null), 700);
      prev.current = value;
      return () => clearTimeout(t);
    }
    prev.current = value;
  }, [value]);
  return dir;
}

/** One line of the Memepad list: picture, name and risk dot, age, holders, how full, then market cap and change. */
export function MemeRow({ coin, onOpen, now }: { coin: CoinRef; onOpen: (c: CoinRef) => void; now: number }) {
  const item = coin.item;
  const mcapFlash = useFlash(coin.mcap);
  const holdersFlash = useFlash(item?.holders);
  if (!item) return null;
  const change = formatChange(coin.change);
  return (
    <button
      type="button"
      onClick={() => {
        haptic("tap");
        onOpen(coin);
      }}
      className="flex w-full items-center gap-3 border-b border-white/5 py-3 text-left transition-transform active:scale-[0.99]"
    >
      <Avatar mint={coin.mint} symbol={coin.symbol} src={coin.icon} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-base font-bold">{coin.name}</span>
          {/* The risk dot only means something when we actually checked holders. Without that data it would be a made-up "some risk". */}
          {item.holders != null && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RISK_DOT[item.risk] }} aria-label={`${item.risk} risk`} />}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-base text-mute">
          <span>{formatAgeAt(item.createdAt, now) ?? (formatAge(item.ageMinutes) || "now")}</span>
          {/* No holder count in free data mode: show nothing rather than a dash that looks broken. */}
          {item.holders != null && (
            <span className={`inline-flex items-center gap-1 ${holdersFlash ? `flash-${holdersFlash}` : ""}`}>
              <Users size={14} />
              {item.holders.toLocaleString("en-US")}
            </span>
          )}
          <span style={{ color: STAGE_STYLE[item.stage.key].color }} className="font-semibold">
            {item.stage.key === "grad" ? fillText(item) : `${item.stage.percent}%`}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={`font-display text-base font-bold ${mcapFlash ? `flash-${mcapFlash}` : ""}`}>{coin.mcap != null ? formatUsd(coin.mcap) : "-"}</div>
        <div className="text-base font-semibold" style={{ color: change.color }}>
          {change.text}
        </div>
      </div>
    </button>
  );
}
