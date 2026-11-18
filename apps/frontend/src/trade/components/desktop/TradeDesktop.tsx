"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Search, X } from "lucide-react";
import { fromToken, type CoinRef, type JupToken } from "@/trade/lib/coin";
import { formatChange, formatUsd } from "@/trade/lib/memecoin";
import { cents, eventImage, hottest, leadOpenMarket, listEvents, type PredictEvent, type PredictMarket } from "@/trade/lib/predict";
import { Avatar, Skeleton } from "@/trade/components/ui";
import { priceText, type MarketItem, type MarketLabel } from "@/trade/components/MarketRow";
import { MemepadTab } from "@/trade/components/tabs/MemepadTab";
import { MyAssets } from "@/trade/components/desktop/MyAssets";
import { rowLabel as rowLabelOf, PredictDetail, PredictGrid, PredictPanel, type BetPick } from "@/trade/components/desktop/Predict";
import { useSignIn } from "@/trade/hooks/useSignIn";
import { useWallet } from "@/trade/hooks/useWallet";
import { useMyBets } from "@/trade/hooks/usePredictActions";
import { ComboSheet } from "@/trade/components/ComboSheet";
import { betState, type ComboLeg } from "@/trade/lib/predict";
import { AssetDetail } from "@/trade/components/desktop/AssetDetail";
import { Spark } from "@/trade/components/desktop/PriceLine";
import { TradePanel } from "@/trade/components/desktop/TradePanel";

type Tab = "assets" | "trending" | "predict" | "memes" | "stocks" | "preipo" | "majors";
const TABS: Array<{ id: Tab; label: string; blurb: string }> = [
  { id: "assets", label: "My assets", blurb: "Everything you hold here." },
  { id: "trending", label: "Trending", blurb: "The most traded coins and stocks on Loofta right now." },
  { id: "predict", label: "Predict", blurb: "Bet Yes or No on real events. A right call pays $1 per contract." },
  { id: "memes", label: "Memes", blurb: "New community coins on Solana. Prices move fast." },
  { id: "stocks", label: "Stocks", blurb: "Tokenised shares you can hold and trade around the clock." },
  { id: "preipo", label: "Pre-IPO", blurb: "Exposure to private companies before they list." },
  { id: "majors", label: "Majors", blurb: "Large, established crypto assets." },
];
const STOCK_NAME = /(\bxStock\b|Backpack Securities|Ondo Tokenized|PreStocks?)/i;
const coinLabel = (t: JupToken): MarketLabel => (/PreStocks?/i.test(t.name) ? "Pre-IPO" : STOCK_NAME.test(t.name) ? "Stock" : t.mint.endsWith("pump") ? "Meme" : "Coin");
const toItems = (tokens: JupToken[] | undefined, label: (t: JupToken) => MarketLabel): MarketItem[] => (tokens ?? []).map((t) => ({ coin: { ...fromToken(t), kind: label(t) as CoinRef["kind"] }, label: label(t) }));

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

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

type Lists = { coins: MarketItem[]; stocks: MarketItem[]; preipo: MarketItem[]; majors: MarketItem[] };
const EMPTY: Lists = { coins: [], stocks: [], preipo: [], majors: [] };
type WatchEntry = Pick<CoinRef, "mint" | "symbol" | "name" | "icon" | "decimals" | "kind">;
const WATCH_KEY = "trade-watch-v2";
const GRID = "grid items-center gap-3 md:grid-cols-[40px_minmax(0,2fr)_110px_90px_110px_120px_76px] grid-cols-[minmax(0,1fr)_auto_auto]";

/**
 * The web trade page: markets on the left, the list in the middle, the buy box on the right. Everything is real:
 * prices and pictures from the market feed, charts from real candles, trades through the same swap code as the phone app.
 */
export function TradeDesktop({ initialCoin = null }: { initialCoin?: CoinRef | null }) {
  const [tab, setTab] = useState<Tab>("trending");
  const [q, setQ] = useState("");
  const [lists, setLists] = useState<Lists>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [building, setBuilding] = useState(false);
  const [results, setResults] = useState<MarketItem[] | null>(null);
  const [selected, setSelected] = useState<CoinRef | null>(null);
  const [detail, setDetail] = useState<CoinRef | null>(null);
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<{ key: "rank" | "usd" | "change" | "mcap"; dir: 1 | -1 }>({ key: "rank", dir: -1 });
  const [watch, setWatch] = useState<WatchEntry[]>([]);
  const [events, setEvents] = useState<PredictEvent[]>([]);
  const [pEvent, setPEvent] = useState<PredictEvent | null>(null);
  const [picks, setPicks] = useState<BetPick[]>([]);
  const [comboOpen, setComboOpen] = useState(false);
  const [panelSide, setPanelSide] = useState<"buy" | "sell">("buy");
  const { address } = useWallet();
  const myBets = useMyBets(address);
  const { authed, signIn } = useSignIn();
  const activeEventIds = useMemo(() => new Set((myBets.items ?? []).filter((p) => betState(p) === "active" && p.eventMetadata?.eventId).map((p) => p.eventMetadata!.eventId!)), [myBets.items]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Opened from a shared call: go straight to that coin.
  useEffect(() => {
    if (initialCoin) {
      setSelected(initialCoin);
      setDetail(initialCoin);
    }
  }, [initialCoin]);

  // Watchlist lives in this browser.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCH_KEY);
      if (raw) setWatch(JSON.parse(raw) as WatchEntry[]);
    } catch {
      /* private window, start empty */
    }
  }, []);
  const saveWatch = (next: WatchEntry[]) => {
    setWatch(next);
    try {
      localStorage.setItem(WATCH_KEY, JSON.stringify(next));
    } catch {
      /* not saved this time */
    }
  };
  const isWatched = (mint: string) => watch.some((w) => w.mint === mint);
  const toggleWatch = (c: CoinRef) => saveWatch(isWatched(c.mint) ? watch.filter((w) => w.mint !== c.mint) : [...watch, { mint: c.mint, symbol: c.symbol, name: c.name, icon: c.icon, decimals: c.decimals, kind: c.kind }]);

  // The four lists, refreshed every 15 seconds so prices stay current.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const load = async () => {
      const get = (p: string) => getJson<{ tokens?: JupToken[]; building?: boolean }>(`/api/backend/mini/tokens/${p}`, ctrl.signal).catch(() => null);
      const [coins, stocks, pre, majors] = await Promise.all([get("search"), get("stocks"), get("prestocks"), get("majors")]);
      if (!alive) return;
      setLists((prev) => ({
        coins: coins?.tokens?.length ? toItems(coins.tokens, coinLabel) : prev.coins,
        stocks: stocks?.tokens?.length ? toItems(stocks.tokens, () => "Stock") : prev.stocks,
        preipo: pre?.tokens?.length ? toItems(pre.tokens, () => "Pre-IPO") : prev.preipo,
        majors: majors?.tokens?.length ? toItems(majors.tokens, () => "Coin") : prev.majors,
      }));
      setBuilding(!!stocks?.building || !!pre?.building);
      setLoaded(true);
      timer = setTimeout(load, stocks?.building || pre?.building ? 4_000 : 15_000);
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  // Predictions, for the count and the hot strip.
  useEffect(() => {
    let alive = true;
    const load = () =>
      listEvents("trending")
        .then((r) => alive && r.length > 0 && setEvents(r))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Search runs across everything.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    let alive = true;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      getJson<{ tokens?: JupToken[] }>(`/api/backend/mini/tokens/search?q=${encodeURIComponent(term)}`, ctrl.signal)
        .then((d) => alive && setResults(toItems(d.tokens, coinLabel)))
        .catch(() => undefined);
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // "/" jumps to the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(document.activeElement instanceof HTMLInputElement) && !(document.activeElement instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const trending = useMemo(() => interleave(lists.coins, lists.stocks.slice(0, 12)), [lists]);
  const listFor = (t: Tab): MarketItem[] => (t === "trending" ? trending : t === "stocks" ? lists.stocks : t === "preipo" ? lists.preipo : t === "majors" ? lists.majors : []);
  const counts: Record<Tab, number | null> = { assets: activeEventIds.size || null, trending: trending.length || null, predict: events.length || null, memes: null, stocks: lists.stocks.length || null, preipo: lists.preipo.length || null, majors: lists.majors.length || null };

  const rows = useMemo(() => {
    const base = results ?? listFor(tab);
    const withRank = base.map((m, i) => ({ ...m, rank: i + 1 }));
    if (sort.key === "rank") return withRank;
    const val = (m: (typeof withRank)[number]) => (sort.key === "usd" ? m.coin.usd : sort.key === "change" ? m.coin.change : m.coin.mcap) ?? -Infinity;
    return [...withRank].sort((a, b) => (val(a) - val(b)) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, tab, trending, lists, sort]);

  // The buy box starts on the first coin of whatever list is showing.
  useEffect(() => {
    if (!selected && rows.length > 0 && tab !== "predict" && tab !== "memes" && tab !== "assets") setSelected(rows[0].coin);
  }, [rows, selected, tab]);

  const hot = useMemo(() => trending.slice(0, 5), [trending]);
  const hotEvents = useMemo(() => hottest(events, 2), [events]);
  const live = (c: CoinRef): CoinRef => {
    // Prices keep moving while a coin is selected, so the panel reads the newest row for it.
    for (const l of [lists.coins, lists.stocks, lists.preipo, lists.majors]) {
      const hit = l.find((m) => m.coin.mint === c.mint);
      if (hit) return { ...c, usd: hit.coin.usd, mcap: hit.coin.mcap, change: hit.coin.change };
    }
    return c;
  };
  const pickBuy = useCallback((c: CoinRef) => {
    setSelected(c);
    setSheet(true);
  }, []);
  const openDetail = (c: CoinRef) => {
    setSelected(c);
    setDetail(c);
    setSheet(false);
    setTab((t) => (t === "assets" || t === "predict" ? "trending" : t));
    window.scrollTo({ top: 0 });
  };
  const toggleSort = (key: "usd" | "change" | "mcap") => setSort((s) => (s.key === key ? (s.dir === -1 ? { key, dir: 1 } : { key: "rank", dir: -1 }) : { key, dir: -1 }));
  const goPredict = (id: string) => {
    setDetail(null);
    setTab("predict");
    const hit = events.find((e) => e.eventId === id);
    if (hit) setPEvent(hit);
  };
  // One pick is a single bet. Pick more and it becomes a combo on its own.
  const togglePick = (p: BetPick) =>
    setPicks((cur) => {
      const same = cur.find((c) => c.market.marketId === p.market.marketId);
      if (same && same.isYes === p.isYes) return cur.filter((c) => c !== same);
      return [...cur.filter((c) => c.market.marketId !== p.market.marketId), p];
    });
  const legs: ComboLeg[] = picks.map((p) => {
    const m = p.market;
    const single = (m.pricing?.buyNoPriceUsd ?? 0) === 0;
    return { marketId: m.marketId, side: p.isYes ? "yes" : "no", label: single ? m.title : `${p.isYes ? "Yes" : "No"}: ${rowLabelOf(m)}`, event: p.title.split(" · ")[0], cents: cents(p.isYes ? m.pricing?.buyYesPriceUsd : m.pricing?.buyNoPriceUsd) };
  });
  const pPick = picks.length === 1 ? picks[0] : null;
  const picked = useMemo(() => new Set(legs.map((l) => `${l.marketId}:${l.side}`)), [legs]); // eslint-disable-line react-hooks/exhaustive-deps
  const openEvent = (e: PredictEvent, pick?: { market: PredictMarket; isYes: boolean }) => {
    setPEvent(e);
    if (pick) {
      const n = (e.markets ?? []).filter((m) => m.status === "open").length;
      togglePick({ ...pick, title: `${e.metadata.title}${n > 1 ? ` · ${rowLabelOf(pick.market)}` : ""}` });
      setSheet(true);
    }
    window.scrollTo({ top: 0 });
  };
  const tradeFromAssets = (c: CoinRef, side: "buy" | "sell") => {
    setSelected(c);
    setPanelSide(side);
    setSheet(true);
    setTab("assets");
  };

  const showPanel = !!selected && tab !== "predict" && tab !== "assets" && !(tab === "memes" && !selected);
  const showAssetsPanel = tab === "assets" && !!selected && sheet;
  const showPredictPanel = tab === "predict" && !!pEvent;
  const cur = TABS.find((t) => t.id === tab)!;
  const sel = selected ? live(selected) : null;
  const watchRows = watch.map((w) => {
    const hit = [lists.coins, lists.stocks, lists.preipo, lists.majors].flatMap((l) => l).find((m) => m.coin.mint === w.mint);
    const coin: CoinRef = hit ? hit.coin : { ...w, usd: null, mcap: null, change: null };
    return coin;
  });

  const SortHead = ({ k, label }: { k: "usd" | "change" | "mcap"; label: string }) => (
    <button type="button" onClick={() => toggleSort(k)} className={clsx("flex items-center justify-end gap-1 text-base", sort.key === k ? "text-white" : "text-slate-500 hover:text-slate-300")}>
      {label}
      <span>{sort.key === k ? (sort.dir === -1 ? "↓" : "↑") : ""}</span>
    </button>
  );

  const slip = (onClose?: () => void) =>
    picks.length >= 2 ? (
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[#121216] p-5">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-white">Combo of {picks.length}</div>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-white/[0.08] hover:text-white"><X size={20} /></button>
          )}
        </div>
        <p className="text-base text-slate-400">Every pick has to be right for it to pay, and it pays more.</p>
        {legs.map((l) => (
          <div key={l.marketId} className="flex items-center gap-3 text-base">
            <div className="min-w-0 flex-1"><div className="truncate font-semibold text-white">{l.label}</div><div className="truncate text-slate-400">{l.event}</div></div>
            <span className="shrink-0 font-semibold text-white">{l.cents}¢</span>
            <button type="button" aria-label="Remove" onClick={() => setPicks((c) => c.filter((x) => x.market.marketId !== l.marketId))} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/[0.08] hover:text-white"><X size={16} /></button>
          </div>
        ))}
        <button type="button" onClick={() => (authed ? setComboOpen(true) : signIn())} className="btn3d h-14 text-base">{authed ? "Review combo" : "Sign in to bet"}</button>
        <button type="button" onClick={() => setPicks([])} className="text-base text-slate-400 hover:text-white">Clear picks</button>
      </div>
    ) : pPick ? (
      <div className="flex flex-col gap-3">
        <PredictPanel key={pPick.market.marketId} pick={pPick} onClose={onClose} onFlip={(yes) => setPicks([{ ...pPick, isYes: yes }])} onDone={() => { setPicks([]); myBets.reload(); }} />
        <div className="rounded-2xl border border-white/10 bg-[#121216] px-5 py-4 text-base text-slate-400">Want a bigger payout? Tap Yes or No on another outcome and your picks become one combo bet.</div>
      </div>
    ) : (
      <div className="rounded-2xl border border-white/10 bg-[#121216] p-5 text-base text-slate-400">Pick Yes or No on an outcome to place a bet. Pick several and they become one combo.</div>
    );

  const body = tab === "assets" && !q ? (
    <MyAssets bets={myBets.items} reloadBets={myBets.reload} onTrade={tradeFromAssets} onOpenCoin={openDetail} />
  ) : tab === "predict" && !q && pEvent ? (
    <PredictDetail event={pEvent} onBack={() => { setPEvent(null); setSheet(false); }} picked={picked} onPick={(p) => { togglePick(p); setSheet(true); }} />
  ) : detail ? (
    <AssetDetail coin={live(detail)} starred={isWatched(detail.mint)} onStar={() => toggleWatch(detail)} onBack={() => setDetail(null)} onTrade={() => setSheet(true)} showTrade />
  ) : (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-white">Trade</h1>
        <div className="flex min-w-[220px] max-w-[420px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-[#15151a] px-4">
          <Search size={18} className="shrink-0 text-slate-400" />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coins and stocks" className="h-12 min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500" />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear" className="text-slate-400 hover:text-white">
              <X size={18} />
            </button>
          ) : (
            <span className="hidden rounded border border-white/10 px-1.5 text-base text-slate-500 md:block">/</span>
          )}
        </div>
      </div>

      {tab === "trending" && (hot.length > 0 || hotEvents.length > 0) && !q && (
        <section className="flex flex-col gap-3">
          <div className="text-base font-semibold text-slate-400">Hot right now</div>
          <div className="hscroll -mx-4 flex gap-3 px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 xl:grid-cols-4 md:[&>*:nth-child(n+7)]:hidden">
            {hot.map((m) => {
              const ch = formatChange(m.coin.change);
              return (
                <button key={m.coin.mint} type="button" onClick={() => openDetail(m.coin)} className="flex w-[240px] shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-[#131317] p-3 text-left hover:bg-[#17171c] md:w-auto">
                  <Avatar mint={m.coin.mint} symbol={m.coin.symbol} src={m.coin.icon} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold text-white">{m.coin.symbol}</div>
                    <div className="truncate text-base text-slate-400">
                      {m.label} · {priceText(m.coin.usd)}
                    </div>
                  </div>
                  <span className="text-base font-semibold" style={{ color: ch.color }}>
                    {ch.text}
                  </span>
                </button>
              );
            })}
            {hotEvents.map((e) => {
              const lead = leadOpenMarket(e);
              const pct = cents(lead?.pricing?.buyYesPriceUsd);
              return (
                <button key={e.eventId} type="button" onClick={() => goPredict(e.eventId)} className="flex w-[240px] shrink-0 items-center gap-3 rounded-2xl border border-white/10 bg-[#131317] p-3 text-left hover:bg-[#17171c] md:w-auto">
                  <PredictImg src={eventImage(e)} />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-base font-semibold leading-snug text-white">{e.metadata.title}</div>
                    <div className="text-base text-slate-400">Prediction</div>
                  </div>
                  <span className="text-base font-semibold text-[#3cb371]">{pct}%</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {!q && (
        <div className="hscroll -mx-4 flex gap-2 px-4 pb-1 xl:hidden md:mx-0 md:px-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx("h-11 shrink-0 rounded-full px-5 text-base font-medium transition-all", tab === t.id ? "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white" : "border border-white/10 text-slate-300 hover:bg-white/[0.06]")}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {!q && tab !== "predict" && (
        <div>
          <h2 className="text-xl font-semibold text-white">{cur.label}</h2>
          <p className="text-base text-slate-400">{cur.blurb}</p>
        </div>
      )}

      {tab === "predict" && !q ? (
        <PredictGrid activeEventIds={activeEventIds} onOpen={openEvent} onBets={() => setTab("assets")} openId={null} />
      ) : tab === "memes" && !q ? (
        <div className="-mx-4 md:mx-0">
          <MemepadTab
            onOpen={(c) => {
              setSelected({ ...c, kind: "Meme" });
              setSheet(true);
            }}
            paused={!!detail}
            embedded
            hideStories
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101014]">
          <div className={clsx(GRID, "border-b border-white/10 px-4 py-3 text-base text-slate-500")}>
            <span className="hidden md:block">#</span>
            <span>Asset</span>
            <SortHead k="usd" label="Price" />
            <SortHead k="change" label="24h" />
            <span className="hidden md:block">
              <SortHead k="mcap" label="Market cap" />
            </span>
            <span className="hidden text-right md:block">Chart</span>
            <span className="hidden md:block" />
          </div>
          {!loaded && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="m-3 h-14" />)}
          {loaded && rows.length === 0 && (
            <div className="px-4 py-12 text-center text-base text-slate-400">{building ? "Loading the list. The first time takes a minute." : q ? `Nothing matches "${q}".` : "Nothing here yet."}</div>
          )}
          {rows.map((m) => {
            const ch = formatChange(m.coin.change);
            const active = selected?.mint === m.coin.mint && !!sel;
            return (
              <div key={m.coin.mint} role="button" tabIndex={0} onClick={() => openDetail(m.coin)} onKeyDown={(e) => e.key === "Enter" && openDetail(m.coin)} className={clsx(GRID, "cursor-pointer border-t border-white/5 px-4 py-3 hover:bg-white/[0.03]", active && "bg-[#FF7A2A]/[0.06]")}>
                <span className="hidden text-base text-slate-500 md:block">{m.rank}</span>
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar mint={m.coin.mint} symbol={m.coin.symbol} src={m.coin.icon} size={38} />
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-white">{m.coin.symbol}</div>
                    <div className="truncate text-base text-slate-400">
                      {m.label} · {m.coin.name}
                    </div>
                  </div>
                </div>
                <span className="text-right text-base font-semibold text-white">{priceText(m.coin.usd)}</span>
                <span className="text-right text-base font-semibold" style={{ color: ch.color }}>
                  {ch.text}
                </span>
                <span className="hidden text-right text-base text-slate-300 md:block">{m.coin.mcap != null ? formatUsd(m.coin.mcap) : "-"}</span>
                <span className="hidden justify-self-end md:block">
                  <Spark mint={m.coin.mint} change={m.coin.change} />
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!authed) signIn();
                    else pickBuy(m.coin);
                  }}
                  className="hidden justify-self-end rounded-xl bg-gradient-to-r from-[#FF1301] to-[#EAB308] px-5 py-2 text-base font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.99] md:block"
                >
                  {authed ? "Buy" : "Sign in"}
                </button>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1480px] gap-6 px-4 py-6 md:px-8">
      {/* Markets and watchlist, on wide screens */}
      <aside className="sticky top-24 hidden h-fit w-[208px] shrink-0 flex-col gap-6 xl:flex">
        <div className="flex flex-col gap-1">
          <div className="px-3 pb-2 text-base uppercase tracking-wide text-slate-500">Markets</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setDetail(null);
                setQ("");
              }}
              className={clsx("flex items-center justify-between rounded-xl px-3 py-2.5 text-left text-base font-semibold transition-colors", tab === t.id && !detail ? "bg-gradient-to-r from-[#FF1301] to-[#EAB308] text-white" : "text-slate-400 hover:bg-white/[0.05] hover:text-white")}
            >
              <span>{t.label}</span>
              {counts[t.id] != null && <span className={clsx("text-base font-normal", tab === t.id && !detail ? "text-white/80" : "text-slate-500")}>{counts[t.id]}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <div className="px-3 pb-2 text-base uppercase tracking-wide text-slate-500">Watchlist</div>
          {watchRows.length === 0 && <div className="px-3 text-base text-slate-500">Tap the star on a coin to keep it here.</div>}
          {watchRows.map((c) => {
            const ch = formatChange(c.change);
            return (
              <button key={c.mint} type="button" onClick={() => openDetail(c)} className="flex items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/[0.05]">
                <Avatar mint={c.mint} symbol={c.symbol} src={c.icon} size={26} />
                <span className="flex-1 truncate text-base font-semibold text-white">{c.symbol}</span>
                <span className="text-base font-semibold" style={{ color: ch.color }}>
                  {c.change != null ? ch.text : ""}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="min-w-0 flex-1">{body}</main>

      {/* Buy box: a sticky column on desktop */}
      {(showPanel || showAssetsPanel) && sel && (
        <aside className="sticky top-24 hidden h-fit w-[340px] shrink-0 lg:block">
          <TradePanel key={`${sel.mint}-${panelSide}`} coin={sel} starred={isWatched(sel.mint)} onStar={() => toggleWatch(sel)} onFull={detail || tab === "assets" ? undefined : () => openDetail(sel)} hideChart={!!detail || tab === "assets"} startSide={panelSide} onClose={tab === "assets" ? () => setSheet(false) : undefined} />
        </aside>
      )}
      {showPredictPanel && (
        <aside className="sticky top-24 hidden h-fit w-[340px] shrink-0 lg:block">{slip()}</aside>
      )}

      {comboOpen && <ComboSheet legs={legs} onRemove={(id) => setPicks((c) => c.filter((x) => x.market.marketId !== id))} onClose={() => setComboOpen(false)} onPlaced={() => { setPicks([]); setComboOpen(false); myBets.reload(); }} />}
      {picks.length > 0 && !sheet && tab === "predict" && (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4 lg:hidden">
          <button type="button" onClick={() => setSheet(true)} className="btn3d h-12 w-full max-w-md text-base">{picks.length < 2 ? "Open your bet" : `Combo of ${picks.length} picks`}</button>
        </div>
      )}
      {/* ...and a bottom sheet on a phone or small window */}
      {sheet && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl">
            {tab === "predict" && picks.length > 0 ? (
              slip(() => setSheet(false))
            ) : sel ? (
              <TradePanel key={`${sel.mint}-${panelSide}`} coin={sel} starred={isWatched(sel.mint)} onStar={() => toggleWatch(sel)} onClose={() => setSheet(false)} onFull={detail || tab === "assets" ? undefined : () => openDetail(sel)} hideChart={!!detail || tab === "assets"} startSide={panelSide} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function PredictImg({ src }: { src: string | null }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className="h-10 w-10 shrink-0 rounded-xl bg-white/[0.06]" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-10 w-10 shrink-0 rounded-xl object-cover" />;
}
