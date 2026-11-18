"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ExternalLink, Globe, Send, Star } from "lucide-react";
import type { CoinRef } from "@/trade/lib/coin";
import { assetAbout } from "@/trade/lib/assetAbout";
import { getTokenBalance } from "@/trade/lib/balances";
import { formatAge, formatChange, formatUsd } from "@/trade/lib/memecoin";
import { openExternal } from "@/trade/lib/telegram";
import { useCoinInfo } from "@/trade/lib/coinInfo";
import { useSignIn } from "@/trade/hooks/useSignIn";
import { useWallet } from "@/trade/hooks/useWallet";
import { useLiveTrades } from "@/trade/hooks/useLiveTrades";
import { Avatar } from "@/trade/components/ui";
import { priceText } from "@/trade/components/MarketRow";
import { LiveChart } from "@/trade/components/LiveChart";
import { ChatPanel, HoldersList, TradesList } from "@/trade/components/CoinTabs";

type Tab = "comments" | "holders" | "activity" | "about";

const compact = (n: number | null | undefined) => (n == null ? "-" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(n < 10 ? 2 : 0));

/** The full page for one coin: real live chart, real numbers, and the people talking about it. */
export function AssetDetail({ coin, starred, onStar, onBack, onTrade, showTrade }: { coin: CoinRef; starred: boolean; onStar: () => void; onBack: () => void; onTrade: () => void; showTrade: boolean }) {
  const [tab, setTab] = useState<Tab>("comments");
  const info = useCoinInfo(coin.mint);
  const trades = useLiveTrades(coin.mint);
  const { address } = useWallet();
  const { authed, signIn } = useSignIn();
  const [held, setHeld] = useState<number | null>(null);
  useEffect(() => {
    if (!address) return;
    let alive = true;
    getTokenBalance(address, coin.mint)
      .then((v) => alive && setHeld(v))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [address, coin.mint]);

  const price = coin.usd;
  const ch = formatChange(info?.change24h ?? coin.change);
  const about = assetAbout(coin.kind, coin.name, coin.symbol);
  const stats: Array<[string, string]> = [
    ["Market cap", formatUsd(info?.marketCap ?? coin.mcap)],
    ["24h volume", info?.volume24hUsd != null ? formatUsd(info.volume24hUsd) : "-"],
    ["Liquidity", info?.liquidityUsd != null ? formatUsd(info.liquidityUsd) : "-"],
    ["Supply", compact(info?.circulatingSupply ?? info?.totalSupply)],
    ["All-time high", info?.athUsd != null ? priceText(info.athUsd) : "-"],
    ["Age", info?.createdAt ? (formatAge(Math.max(0, (Date.now() / 1000 - info.createdAt) / 60)) ?? "-") : "-"],
  ];
  const tabs: Array<[Tab, string]> = [
    ["comments", "Comments"],
    ["holders", "Holders"],
    ["activity", "Activity"],
    ["about", "About"],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-base text-slate-400">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-1.5 text-white hover:bg-white/[0.06]">
          <ArrowLeft size={16} /> Trade
        </button>
        <span>/</span>
        <span className="truncate text-white">{coin.symbol}</span>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <Avatar mint={coin.mint} symbol={coin.symbol} src={coin.icon} size={60} />
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold text-white">{coin.symbol}</h1>
            <span className="rounded-full bg-white/[0.07] px-3 py-0.5 text-base text-slate-300">{coin.kind ?? "Coin"}</span>
          </div>
          <div className="mt-1 text-base text-slate-400">{coin.name} · on Solana</div>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-bold text-white">{priceText(price)}</span>
            <span className="text-lg font-semibold" style={{ color: ch.color }}>
              {ch.text}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onStar} aria-label="Watch" className={clsx("grid h-11 w-11 place-items-center rounded-xl border border-white/10 hover:bg-white/[0.08]", starred ? "text-[#EAB308]" : "text-slate-400")}>
            <Star size={18} fill={starred ? "currentColor" : "none"} />
          </button>
          {showTrade && (
            <button type="button" onClick={authed ? onTrade : signIn} className="btn3d h-11 px-6 text-base">
              {authed ? `Buy ${coin.symbol}` : "Sign in"}
            </button>
          )}
        </div>
      </div>

      <LiveChart mint={coin.mint} trades={trades} price={price} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-white/10 bg-[#121216] px-4 py-3">
            <div className="text-base text-slate-500">{k}</div>
            <div className="text-lg font-semibold text-white">{v}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex gap-6 overflow-x-auto border-b border-white/10">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={clsx("-mb-px whitespace-nowrap border-b-2 pb-3 pt-1 text-base font-semibold", tab === id ? "border-[#EAB308] text-white" : "border-transparent text-slate-400 hover:text-white")}>
              {label}
            </button>
          ))}
        </div>
        <div className="pt-2">
          {tab === "comments" && <ChatPanel mint={coin.mint} name={coin.name} price={price} myHoldingUsd={held != null && price != null ? held * price : null} />}
          {tab === "holders" && <HoldersList mint={coin.mint} />}
          {tab === "activity" && <TradesList trades={trades} />}
          {tab === "about" && (
            <div className="mt-4 flex max-w-3xl flex-col gap-4 text-base leading-relaxed text-slate-300">
              {info?.description && <p>{info.description}</p>}
              {about && (
                <div className="rounded-xl border border-white/10 bg-[#121216] p-4">
                  <div className="mb-2 font-semibold text-white">{about.title}</div>
                  {about.lines.map((l) => (
                    <p key={l} className="mb-2 last:mb-0">
                      {l}
                    </p>
                  ))}
                </div>
              )}
              {!info?.description && !about && <p className="text-slate-400">No description yet.</p>}
              <div className="flex flex-wrap gap-2">
                {info?.website && (
                  <button type="button" onClick={() => openExternal(info.website!)} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 hover:bg-white/[0.06]">
                    <Globe size={16} /> Website
                  </button>
                )}
                {info?.twitter && (
                  <button type="button" onClick={() => openExternal(info.twitter!)} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 hover:bg-white/[0.06]">
                    <ExternalLink size={16} /> X
                  </button>
                )}
                {info?.telegram && (
                  <button type="button" onClick={() => openExternal(info.telegram!)} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 hover:bg-white/[0.06]">
                    <Send size={16} /> Telegram
                  </button>
                )}
                <button type="button" onClick={() => openExternal(`https://solscan.io/token/${coin.mint}`)} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 hover:bg-white/[0.06]">
                  <ExternalLink size={16} /> Solscan
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
