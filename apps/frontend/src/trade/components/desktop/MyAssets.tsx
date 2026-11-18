"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Loader2 } from "lucide-react";
import type { CoinRef } from "@/trade/lib/coin";
import { useWallet } from "@/trade/hooks/useWallet";
import { useSignIn } from "@/trade/hooks/useSignIn";
import { errText, useBetAction } from "@/trade/hooks/usePredictActions";
import { usePortfolio } from "@/trade/lib/portfolio";
import { betState, usd, type PredictPosition } from "@/trade/lib/predict";
import { fmt } from "@/trade/lib/solana";
import { Avatar, Skeleton } from "@/trade/components/ui";
import { priceText } from "@/trade/components/MarketRow";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Everything you own here: cash, coins and stocks, and your open bets. All read from your own wallet and Jupiter. */
export function MyAssets({ bets, reloadBets, onTrade, onOpenCoin }: { bets: PredictPosition[] | null; reloadBets: () => void; onTrade: (c: CoinRef, side: "buy" | "sell") => void; onOpenCoin: (c: CoinRef) => void }) {
  const { address } = useWallet();
  const { pf, total, coinsUsd } = usePortfolio(address);
  const act = useBetAction();
  const { authed, signIn } = useSignIn();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const open = useMemo(() => (bets ?? []).filter((p) => betState(p) === "active" || p.claimable), [bets]);
  const betsValue = open.reduce((a, p) => a + usd(p.valueUsd), 0);
  const betsCost = open.reduce((a, p) => a + usd(p.totalCostUsd), 0);
  const betsPnl = betsValue - betsCost;
  const all = (total ?? 0) + betsValue;

  const run = async (p: PredictPosition, kind: "sell" | "claim") => {
    setBusy(p.pubkey);
    setErr(null);
    try {
      await act(p, kind);
      setTimeout(reloadBets, 2500);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const cards: Array<[string, string, string?]> = [
    ["Total value", pf ? money(all) : "-"],
    ["Open bets", bets ? money(betsValue) : "-", bets && open.length ? `${open.length} open` : undefined],
    ["Bets profit or loss", bets && open.length ? `${betsPnl >= 0 ? "+" : "-"}${money(Math.abs(betsPnl))}` : "-"],
    ["Coins and stocks", pf ? money(coinsUsd) : "-"],
    ["Cash (USDC)", pf ? money(pf.usdc) : "-"],
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold text-white">My assets</h1>
      {!authed && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-[#101014] px-4 py-12 text-center">
          <div className="text-base text-slate-400">Sign in to see your coins, stocks and bets.</div>
          <button type="button" onClick={signIn} className="btn3d h-12 px-8 text-base">Sign in</button>
        </div>
      )}
      {authed && !address && <div className="rounded-2xl border border-white/10 bg-[#101014] px-4 py-12 text-center text-base text-slate-400">Your wallet is loading.</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {cards.map(([k, v, sub]) => (
          <div key={k} className="rounded-xl border border-white/10 bg-[#121216] px-4 py-4">
            <div className="text-base text-slate-500">{k}</div>
            <div className={clsx("text-2xl font-bold", k.startsWith("Bets profit") && v.startsWith("+") ? "text-[#3cb371]" : k.startsWith("Bets profit") && v.startsWith("-") && v !== "-" ? "text-[#ff5a4a]" : "text-white")}>{v}</div>
            {sub && <div className="text-base text-slate-400">{sub}</div>}
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">Coins and stocks</h2>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101014]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-4 py-3 text-base text-slate-500 md:grid-cols-[minmax(0,2fr)_130px_110px_110px_150px]">
            <span>Asset</span>
            <span className="hidden text-right md:block">Amount</span>
            <span className="hidden text-right md:block">Price</span>
            <span className="text-right">Value</span>
            <span className="hidden md:block" />
          </div>
          {!pf && address && <Skeleton className="m-3 h-14" />}
          {pf && pf.holdings.length === 0 && <div className="px-4 py-10 text-center text-base text-slate-400">No coins or stocks yet. Buy one from Trending.</div>}
          {pf?.holdings.map((h) => (
            <div key={h.coin.mint} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-white/5 px-4 py-3 md:grid-cols-[minmax(0,2fr)_130px_110px_110px_150px]">
              <button type="button" onClick={() => onOpenCoin(h.coin)} className="flex min-w-0 items-center gap-3 text-left">
                <Avatar mint={h.coin.mint} symbol={h.coin.symbol} src={h.coin.icon} size={38} />
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold text-white">{h.coin.symbol}</div>
                  <div className="truncate text-base text-slate-400">{h.coin.name}</div>
                </div>
              </button>
              <span className="hidden text-right text-base text-slate-300 md:block">{fmt(h.amount, h.amount < 1 ? 4 : 2)}</span>
              <span className="hidden text-right text-base text-slate-300 md:block">{priceText(h.usd != null && h.amount > 0 ? h.usd / h.amount : null)}</span>
              <span className="text-right text-base font-semibold text-white">{h.usd != null ? money(h.usd) : "-"}</span>
              <div className="col-span-2 flex justify-end gap-2 md:col-span-1">
                <button type="button" onClick={() => onTrade(h.coin, "buy")} className="rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-4 py-2 text-base font-semibold text-white hover:opacity-90">
                  Buy
                </button>
                <button type="button" onClick={() => onTrade(h.coin, "sell")} className="rounded-xl border border-white/10 px-4 py-2 text-base font-medium text-slate-300 hover:bg-white/[0.06]">
                  Sell
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-white">Open bets</h2>
        {err && <div className="text-base text-[#ff5a4a]">{err}</div>}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101014]">
          {bets === null && address && <Skeleton className="m-3 h-14" />}
          {bets && open.length === 0 && <div className="px-4 py-10 text-center text-base text-slate-400">No open bets. Pick one from Predict.</div>}
          {open.map((p) => {
            const cost = usd(p.totalCostUsd);
            const val = usd(p.valueUsd);
            const pnl = val - cost;
            const win = !!p.claimable;
            return (
              <div key={p.pubkey} className="flex flex-wrap items-center gap-3 border-t border-white/5 px-4 py-3 first:border-t-0">
                <div className="min-w-[200px] flex-1">
                  <div className="line-clamp-2 text-base font-semibold text-white">{p.eventMetadata?.title ?? p.marketMetadata?.title ?? "Bet"}</div>
                  <div className="text-base text-slate-400">
                    <span className={p.isYes ? "text-[#3cb371]" : "text-[#ff5a4a]"}>{p.isYes ? "Yes" : "No"}</span> · {fmt(Number(p.contractsDecimal ?? p.contracts ?? 0), 2)} contracts · cost {money(cost)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-semibold text-white">{money(val)}</div>
                  <div className="text-base" style={{ color: pnl >= 0 ? "#3cb371" : "#ff5a4a" }}>
                    {pnl >= 0 ? "+" : "-"}{money(Math.abs(pnl))}
                  </div>
                </div>
                <button type="button" disabled={busy === p.pubkey} onClick={() => run(p, win ? "claim" : "sell")} className={clsx("flex h-11 items-center gap-2 rounded-xl px-5 text-base font-semibold", win ? "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white" : "border border-white/10 text-slate-200 hover:bg-white/[0.06]")}>
                  {busy === p.pubkey && <Loader2 size={18} className="animate-spin" />}
                  {win ? "Claim" : "Cash out"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
