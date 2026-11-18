"use client";

import clsx from "clsx";
import { Check, ExternalLink, Loader2, Star, X } from "lucide-react";
import type { CoinRef } from "@/trade/lib/coin";
import { formatChange, formatUsd } from "@/trade/lib/memecoin";
import { openExternal } from "@/trade/lib/telegram";
import { useCoinInfo } from "@/trade/lib/coinInfo";
import { useSignIn } from "@/trade/hooks/useSignIn";
import { useCoinTrade, BUY_PRESETS, SELL_PRESETS } from "@/trade/hooks/useCoinTrade";
import { Avatar } from "@/trade/components/ui";
import { priceText } from "@/trade/components/MarketRow";
import { PriceLine } from "@/trade/components/desktop/PriceLine";

/** The buy / sell box. A sticky column on desktop, a bottom sheet on a phone. */
export function TradePanel({ coin, starred, onStar, onClose, onFull, hideChart, startSide = "buy" }: { coin: CoinRef; starred: boolean; onStar: () => void; onClose?: () => void; onFull?: () => void; hideChart?: boolean; startSide?: "buy" | "sell" }) {
  const t = useCoinTrade(coin, startSide);
  const { authed, signIn } = useSignIn();
  const info = useCoinInfo(coin.mint);
  const ch = formatChange(coin.change);
  const presets = t.side === "buy" ? BUY_PRESETS : SELL_PRESETS.map(String);
  const cta = t.busy ? "Confirming" : !t.typed ? "Enter an amount" : t.over ? "Not enough balance" : t.side === "buy" ? `Buy ${coin.symbol}` : `Sell ${coin.symbol}`;

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-[#121216] p-5">
      <div className="flex items-center gap-3">
        <Avatar mint={coin.mint} symbol={coin.symbol} src={coin.icon} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold text-white">{coin.symbol}</div>
          <div className="truncate text-base text-slate-400">{[coin.kind ?? "Coin", coin.name].join(" · ")}</div>
        </div>
        <button type="button" onClick={onStar} aria-label="Watch" className={clsx("grid h-10 w-10 place-items-center rounded-xl border border-white/10 hover:bg-white/[0.08]", starred ? "text-[#EAB308]" : "text-slate-400")}>
          <Star size={18} fill={starred ? "currentColor" : "none"} />
        </button>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-white/[0.08] hover:text-white">
            <X size={20} />
          </button>
        )}
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold text-white">{priceText(coin.usd)}</span>
        <span className="text-base font-semibold" style={{ color: ch.color }}>
          {ch.text}
        </span>
      </div>

      {!hideChart && <PriceLine mint={coin.mint} />}

      {t.balance != null && t.balance > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-3 text-base">
          <span className="text-slate-400">You hold</span>
          <span className="font-semibold text-white">
            {Number(t.balance.toFixed(4))} {coin.symbol}
            {coin.usd != null ? ` (${formatUsd(t.balance * coin.usd)})` : ""}
          </span>
        </div>
      )}

      {onFull && (
        <button type="button" onClick={onFull} className="self-start rounded-full border border-white/10 px-4 py-1.5 text-base text-slate-300 hover:bg-white/[0.06]">
          Full view: chart, holders, comments
        </button>
      )}

      {t.done ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-[#3cb371]/20 text-[#3cb371]">
            <Check size={30} strokeWidth={3} />
          </div>
          <div className="text-xl font-semibold text-white">{t.done.side === "buy" ? "Bought" : "Sold"}</div>
          <div className="text-base text-slate-400">You received {t.done.out}</div>
          <button type="button" onClick={() => openExternal(`https://solscan.io/tx/${t.done!.sig}`)} className="inline-flex items-center gap-2 text-base font-medium text-slate-300 hover:text-white">
            <ExternalLink size={16} /> View transaction
          </button>
          <button type="button" onClick={() => t.setDone(null)} className="btn3d mt-2 h-12 w-full text-base">
            Done
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#0b0b0e] p-1">
            {(["buy", "sell"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => t.setSide(s)}
                className={clsx("rounded-lg py-2.5 text-base font-semibold transition-colors", t.side === s ? (s === "buy" ? "bg-white/[0.08] text-[#3cb371]" : "bg-white/[0.08] text-[#ff5a4a]") : "text-slate-400 hover:text-white")}
              >
                {s === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-base text-slate-400">
              <span>Amount</span>
              <button type="button" onClick={t.setMax} className="hover:text-white">
                {t.side === "buy" ? `Balance $${(t.usdcBal ?? 0).toFixed(2)}` : `Balance ${t.balance == null ? "-" : Number(t.balance.toFixed(4))} ${coin.symbol}`}
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0b0b0e] px-4">
              {t.side === "buy" && <span className="text-2xl font-semibold text-slate-400">$</span>}
              <input
                inputMode="decimal"
                value={t.amount}
                onChange={(e) => t.setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0"
                className="h-14 min-w-0 flex-1 bg-transparent text-2xl font-semibold text-white outline-none placeholder:text-slate-600"
              />
              {t.side === "sell" && <span className="text-base font-medium text-slate-400">{coin.symbol}</span>}
            </div>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((p) => (
                <button key={p} type="button" onClick={() => t.setPreset(p)} className="rounded-xl border border-white/10 py-2 text-base font-medium text-slate-300 hover:bg-white/[0.06] hover:text-white">
                  {t.side === "buy" ? `$${p}` : `${p}%`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-base">
            <span className="text-slate-400">You get about</span>
            <span className="font-semibold text-white">{t.quoting ? "..." : (t.outText ?? "-")}</span>
          </div>
          {t.problem && <div className="text-base text-[#ff5a4a]">{t.problem}</div>}
          {t.impact != null && t.impact >= 1 && <div className={clsx("text-base", t.impact >= 5 ? "text-[#ff5a4a]" : "text-slate-400")}>Price impact {t.impact.toFixed(1)}%</div>}

          {authed ? (
            <button type="button" onClick={t.trade} disabled={!t.ready} className={clsx("btn3d flex h-14 items-center justify-center gap-2 text-base", t.side === "sell" && "down")}>
              {t.busy && <Loader2 size={20} className="animate-spin" />}
              {cta}
            </button>
          ) : (
            <button type="button" onClick={signIn} className="btn3d flex h-14 items-center justify-center text-base">
              Sign in to {t.side === "buy" ? "buy" : "sell"}
            </button>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
        <div>
          <div className="text-base text-slate-500">Market cap</div>
          <div className="text-base font-semibold text-white">{(info?.marketCap ?? coin.mcap) != null ? formatUsd((info?.marketCap ?? coin.mcap)!) : "-"}</div>
        </div>
        <div>
          <div className="text-base text-slate-500">24h volume</div>
          <div className="text-base font-semibold text-white">{info?.volume24hUsd != null ? formatUsd(info.volume24hUsd) : "-"}</div>
        </div>
      </div>
    </div>
  );
}
