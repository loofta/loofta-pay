"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Info, Search, X } from "lucide-react";
import { Sheet } from "@/trade/components/Sheet";
import { fromToken, type CoinRef, type JupToken } from "@/trade/lib/coin";
import { formatChange } from "@/trade/lib/memecoin";
import { haptic } from "@/trade/lib/telegram";
import { Avatar, Skeleton } from "@/trade/components/ui";
import { MarketRow, priceText, type MarketItem, type MarketLabel } from "@/trade/components/MarketRow";
import { MemepadTab } from "@/trade/components/tabs/MemepadTab";
import { PredictTab } from "@/trade/components/tabs/PredictTab";
import { cents, eventImage, hottest, leadOpenMarket, listEvents, type PredictEvent } from "@/trade/lib/predict";

type Chip = "trending" | "predict" | "memes" | "stocks" | "preipo" | "majors";
const CHIPS: { id: Chip; label: string }[] = [
  { id: "trending", label: "Trending" },
  { id: "predict", label: "Predict" },
  { id: "memes", label: "Memes" },
  { id: "stocks", label: "Stocks" },
  { id: "preipo", label: "Pre-IPO" },
  { id: "majors", label: "Majors" },
];

const STOCK_NAME = /(\bxStock\b|Backpack Securities|Ondo Tokenized|PreStocks?)/i;

const toItems = (tokens: JupToken[] | undefined, label: (t: JupToken) => MarketLabel): MarketItem[] => (tokens ?? []).map((t) => ({ coin: { ...fromToken(t), kind: label(t) as CoinRef["kind"] }, label: label(t) }));
const coinLabel = (t: JupToken): MarketLabel => (/PreStocks?/i.test(t.name) ? "Pre-IPO" : STOCK_NAME.test(t.name) ? "Stock" : t.mint.endsWith("pump") ? "Meme" : "Coin");

/** Coins and stocks mixed, two coins for every stock, so the list reads like the market and not like one category. */
function interleave(coins: MarketItem[], stocks: MarketItem[]): MarketItem[] {
  const out: MarketItem[] = [];
  let c = 0;
  let s = 0;
  while (out.length < 40 && (c < coins.length || s < stocks.length)) {
    for (let k = 0; k < 2 && c < coins.length; k++) out.push(coins[c++]);
    if (s < stocks.length) out.push(stocks[s++]);
  }
  return out;
}

type HotCard = { kind: "coin"; m: MarketItem } | { kind: "pred"; e: PredictEvent };

/** Coins and stocks for the Hot right now strip, with the busiest predictions worked in: always one in the first few cards, then one every few more. */
function mixHot(items: MarketItem[], preds: PredictEvent[]): HotCard[] {
  const out: HotCard[] = items.map((m) => ({ kind: "coin", m }));
  preds.slice(0, 3).forEach((e, i) => out.splice(Math.min(out.length, 1 + i * 4), 0, { kind: "pred", e }));
  return out;
}

function PredictImg({ src }: { src: string | null }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className="h-10 w-10 shrink-0 rounded-xl bg-[#1f1f26]" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-10 w-10 shrink-0 rounded-xl object-cover" />;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * One place to trade everything: what is trending across all markets, new memecoins, stocks and the
 * big names. Search looks across all of them. Trades route through Jupiter.
 */
export function TradeTab({ onOpen, paused = false, openPrediction = null }: { onOpen: (c: CoinRef) => void; paused?: boolean; openPrediction?: { id: string; n: number } | null }) {
  const [chip, setChip] = useState<Chip>("trending");
  // Predict keeps its state (bets in progress, a combo being built) while you look at other lists, so it stays mounted once opened.
  const [predictSeen, setPredictSeen] = useState(false);
  const [predictReq, setPredictReq] = useState<{ id: string; n: number } | null>(null);
  const [hotPredictions, setHotPredictions] = useState<PredictEvent[]>([]);
  const showPrediction = (id: string) => {
    haptic("tap");
    setPredictReq({ id, n: Date.now() });
    setChip("predict");
  };
  useEffect(() => {
    if (chip === "predict") setPredictSeen(true);
  }, [chip]);
  // A prediction tapped in the Feed.
  useEffect(() => {
    if (openPrediction) {
      setPredictReq(openPrediction);
      setChip("predict");
    }
  }, [openPrediction]);
  // The busiest predictions, for the Hot right now strip. The last good answer is kept if a refresh fails.
  useEffect(() => {
    let alive = true;
    const load = () =>
      listEvents("trending")
        .then((r) => alive && r.length > 0 && setHotPredictions(hottest(r, 3)))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const [searching, setSearching] = useState(false);
  const [preInfo, setPreInfo] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<MarketItem[]>([]);
  const [results, setResults] = useState<MarketItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  // "Hot right now" lives on its own, so it stays in place whichever chip is selected.
  const [hotItems, setHotItems] = useState<MarketItem[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [coins, stocks] = await Promise.all([getJson<{ tokens?: JupToken[] }>("/api/backend/mini/tokens/search"), getJson<{ tokens?: JupToken[] }>("/api/backend/mini/tokens/stocks").catch(() => ({ tokens: [] as JupToken[] }))]);
        const next = interleave(toItems(coins.tokens, coinLabel), toItems(stocks.tokens?.slice(0, 12), () => "Stock")).slice(0, 8);
        if (alive && next.length > 0) setHotItems(next);
      } catch {
        /* keep the cards we have */
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // The lists for the Trending, Stocks and Majors chips. Refreshed every 10 seconds so prices stay current.
  useEffect(() => {
    if (chip === "memes" || chip === "predict") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setItems([]);
    setFailed(false);
    setBuilding(false);
    const ctrl = new AbortController();
    setLoading(true);
    const load = async () => {
      try {
        let next: MarketItem[] = [];
        let wait = 10_000;
        if (chip === "trending") {
          const [coins, stocks] = await Promise.all([getJson<{ tokens?: JupToken[] }>("/api/backend/mini/tokens/search", ctrl.signal), getJson<{ tokens?: JupToken[] }>("/api/backend/mini/tokens/stocks", ctrl.signal).catch(() => ({ tokens: [] as JupToken[] }))]);
          next = interleave(toItems(coins.tokens, coinLabel), toItems(stocks.tokens?.slice(0, 12), () => "Stock"));
        } else if (chip === "stocks" || chip === "preipo") {
          const d = await getJson<{ tokens?: JupToken[]; building?: boolean }>(chip === "preipo" ? "/api/backend/mini/tokens/prestocks" : "/api/backend/mini/tokens/stocks", ctrl.signal);
          next = toItems(d.tokens, () => (chip === "preipo" ? "Pre-IPO" : "Stock"));
          if (alive) setBuilding(!!d.building);
          // The stock list is put together on the first visit, which takes about half a minute.
          if (d.building) wait = 3_000;
        } else {
          next = toItems((await getJson<{ tokens?: JupToken[] }>("/api/backend/mini/tokens/majors", ctrl.signal)).tokens, () => "Coin");
        }
        if (!alive) return;
        setFailed(false);
        if (next.length > 0 || chip === "stocks") setItems(next);
        timer = setTimeout(load, wait);
      } catch {
        /* aborted or offline, keep the list we have, and say so if there is nothing to show */
        if (alive) {
          setFailed(true);
          timer = setTimeout(load, 5_000);
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      ctrl.abort();
    };
  }, [chip, retry]);

  // Search runs across everything, whichever chip is selected.
  useEffect(() => {
    const term = q.trim();
    if (!searching || term.length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const d = await getJson<{ tokens?: JupToken[] }>(`/api/backend/mini/tokens/search?q=${encodeURIComponent(term)}`, ctrl.signal);
        if (alive) setResults(toItems(d.tokens, coinLabel));
      } catch {
        /* keep the last results */
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, searching]);

  const hot = hotItems;
  const showingSearch = searching && q.trim().length >= 2;
  const list = showingSearch ? results ?? [] : items;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-extrabold">Trade</h1>
        {/* The Memes chip has its own search, so this one is hidden there. */}
        {chip !== "memes" && chip !== "predict" && (
          <button
            type="button"
            aria-label="Search"
            onClick={() => {
              haptic("tap");
              setSearching((v) => !v);
              setQ("");
            }}
            className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl"
          >
            {searching ? <X size={20} /> : <Search size={20} />}
          </button>
        )}
      </div>

      {searching && chip !== "memes" && chip !== "predict" && (
        <div className="card mt-3 flex h-14 items-center gap-3 px-4">
          <Search size={20} className="text-mute" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coins, stocks, memes" className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-mute" />
        </div>
      )}

      {(hot.length > 0 || hotPredictions.length > 0) && !showingSearch && (
        <>
          <h2 className="mt-5 font-display text-base font-bold text-mute">Hot right now</h2>
          <div className="hscroll -mx-4 mt-3 flex gap-3 px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-4 md:[&>*:nth-child(n+9)]:hidden">
            {mixHot(hot, hotPredictions).map((h) => {
              if (h.kind === "pred") {
                const lead = leadOpenMarket(h.e);
                const pct = cents(lead?.pricing?.buyYesPriceUsd);
                return (
                  <button key={h.e.eventId} type="button" onClick={() => showPrediction(h.e.eventId)} className="card w-[210px] shrink-0 p-3 text-left md:w-auto transition-transform active:scale-[0.97]">
                    <div className="flex items-center gap-3">
                      <PredictImg src={eventImage(h.e)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-base font-bold">{lead && h.e.markets && h.e.markets.length > 1 ? lead.title : "Yes"}</div>
                        <div className="text-base text-mute">Prediction</div>
                      </div>
                      <span className="rounded-xl bg-up/15 px-2 py-1 text-base font-bold text-up">{pct}%</span>
                    </div>
                    <div className="mt-3 line-clamp-2 font-display text-base font-bold leading-snug">{h.e.metadata.title}</div>
                  </button>
                );
              }
              const m = h.m;
              const ch = formatChange(m.coin.change);
              return (
                <button
                  key={m.coin.mint}
                  type="button"
                  onClick={() => {
                    haptic("tap");
                    onOpen(m.coin);
                  }}
                  className="card w-[210px] shrink-0 p-3 text-left md:w-auto transition-transform active:scale-[0.97]"
                >
                  <div className="flex items-center gap-3">
                    <Avatar mint={m.coin.mint} symbol={m.coin.symbol} src={m.coin.icon} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-base font-bold">{m.coin.symbol}</div>
                      <div className="text-base text-mute">{m.label}</div>
                    </div>
                    <span className="rounded-xl px-2 py-1 text-base font-bold" style={{ color: ch.color, background: "rgba(255,255,255,0.06)" }}>
                      {ch.text}
                    </span>
                  </div>
                  <div className="mt-3 font-display text-base font-bold">{priceText(m.coin.usd)}</div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {!showingSearch && (
        <div className="hscroll -mx-4 mt-4 flex gap-2 px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                haptic("tap");
                setChip(c.id);
                setItems([]);
                setBuilding(false);
              }}
              className={clsx("btn3d h-12 shrink-0 px-5 !rounded-2xl text-base", chip !== c.id && "dark")}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {predictSeen && (
        <div hidden={chip !== "predict"} className="mt-2">
          <PredictTab embedded openEvent={predictReq} />
        </div>
      )}
      {chip === "predict" ? null : chip === "memes" && !showingSearch ? (
        <div className="-mx-4 md:mx-0">
          <MemepadTab onOpen={onOpen} paused={paused} embedded hideStories />
        </div>
      ) : (
        <div className="mt-2">
          {chip === "preipo" && !showingSearch && (
          <div className="mb-1 mt-3 flex items-center justify-between gap-3">
            <span className="text-base text-mute">Companies not on the stock market yet</span>
            <button type="button" aria-label="What is Pre-IPO?" onClick={() => setPreInfo(true)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 text-mute active:scale-95">
              <Info size={18} />
            </button>
          </div>
        )}
        {(loading || building) && list.length === 0 && !showingSearch && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="my-3 h-14" />)}
          {building && list.length === 0 && !showingSearch && <p className="py-3 text-center text-base text-mute">Loading from Jupiter. The first time takes a minute or two.</p>}
          {showingSearch && results === null && <Skeleton className="my-3 h-14" />}
          <div className="md:grid md:grid-cols-2 md:gap-x-10">
            {list.map((m, i) => (
              <MarketRow key={m.coin.mint} item={m} rank={showingSearch ? undefined : i + 1} onOpen={onOpen} />
            ))}
          </div>
          {failed && list.length === 0 && !showingSearch && (
            <div className="card mt-3 px-4 py-8 text-center text-base text-mute">
              Could not load this list.
              <button type="button" onClick={() => { setLoading(true); setRetry((n) => n + 1); }} className="btn3d dark mx-auto mt-4 h-12 px-6 text-base">Try again</button>
            </div>
          )}
          {!failed && !loading && !building && list.length === 0 && (!showingSearch || results !== null) && <div className="card mt-3 px-4 py-10 text-center text-base text-mute">Nothing found</div>}
        </div>
      )}

      {preInfo && (
        <Sheet title="What is Pre-IPO?" onClose={() => setPreInfo(false)}>
          <div className="mt-3 space-y-3 text-base leading-snug text-mute">
            <p>These tokens give you exposure to companies that are not listed on a stock market yet, like Anthropic or OpenAI.</p>
            <p>They are not the company's shares. You do not own part of the company.</p>
            <p>The price is set only by traders and can move a lot.</p>
          </div>
          <button type="button" onClick={() => setPreInfo(false)} className="btn3d dark mt-5 h-14 w-full text-lg">
            Got it
          </button>
        </Sheet>
      )}
    </div>
  );
}
