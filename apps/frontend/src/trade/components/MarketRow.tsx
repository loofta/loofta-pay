"use client";

import { haptic } from "@/trade/lib/telegram";
import { formatChange, formatUsd } from "@/trade/lib/memecoin";
import type { CoinRef } from "@/trade/lib/coin";
import { Avatar } from "@/trade/components/ui";

export type MarketLabel = "Meme" | "Stock" | "Pre-IPO" | "Coin";
export interface MarketItem {
  coin: CoinRef;
  label: MarketLabel;
}

/** Dollar price with sensible digits: $148.20, $0.0133, $0.00310. */
export function priceText(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "-";
  if (p >= 1000) return `$${p.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  const digits = Math.min(10, Math.max(4, 2 - Math.floor(Math.log10(p || 1))));
  return `$${p.toFixed(digits)}`;
}

/** The second line: what kind of thing it is, and its market cap or full name. */
export function subline(m: MarketItem): string {
  const { coin, label } = m;
  if (label === "Stock" || label === "Pre-IPO") return `${label} · ${coin.name}`;
  return `${label} · ${coin.mcap != null ? `${formatUsd(coin.mcap)} MC` : coin.name}`;
}

/** One row of the Trade list: picture with a rank badge, name, kind, price and change. */
export function MarketRow({ item, rank, onOpen }: { item: MarketItem; rank?: number; onOpen: (c: CoinRef) => void }) {
  const { coin } = item;
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
      <div className="relative shrink-0">
        <Avatar mint={coin.mint} symbol={coin.symbol} src={coin.icon} size={52} />
        {rank != null && <span className="absolute -bottom-1 -right-1 grid h-6 min-w-6 place-items-center rounded-full border-2 border-bg bg-raised px-1 text-base font-bold leading-none">{rank}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-base font-bold">{coin.symbol || coin.name}</div>
        <div className="truncate text-base text-mute">{subline(item)}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-display text-base font-bold">{priceText(coin.usd)}</div>
        <div className="text-base font-semibold" style={{ color: change.color }}>
          {change.text}
        </div>
      </div>
    </button>
  );
}
