"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CircleHelp, Search, SlidersHorizontal, X } from "lucide-react";
import { STAGE_STYLE, fetchLive, fetchMemecoinFeed, fetchMemecoinStories, storyMood, type LiveBits, type MemecoinFeed, type StageKey, type StoryCard } from "@/trade/lib/memecoin";
import { fromMemecoin, type CoinRef } from "@/trade/lib/coin";
import { DEFAULT_SETTINGS, loadSettings, needsPro, passes, saveSettings, type MemeFilterSettings } from "@/trade/lib/memeFilters";
import { haptic } from "@/trade/lib/telegram";
import { FilterSheet } from "@/trade/components/FilterSheet";
import { MemeRow } from "@/trade/components/MemeRow";
import { Sheet } from "@/trade/components/Sheet";
import { Avatar, Segmented, Skeleton } from "@/trade/components/ui";

const TAGLINE: Record<StageKey, string> = {
  new: "can jump or drop fast",
  final: "nearly sold out of its first batch",
  grad: "now on the open market",
};

/**
 * The change to show next to a coin. A coin seconds old has no hourly change (the provider says 0 or
 * nothing), so the order is: real hourly change, then the 5 minute change, then the change since
 * launch worked out from its market cap now against where it started.
 */
function bestChange(i: { priceChange1h: number | null; startMcapUsd?: number | null }, h1: number | null | undefined, m5: number | null | undefined, mcap: number | null): number | null {
  if (h1 != null && h1 !== 0) return h1;
  if (i.priceChange1h != null && i.priceChange1h !== 0) return i.priceChange1h;
  if (m5 != null && m5 !== 0) return m5;
  if (i.startMcapUsd && mcap) return (mcap / i.startMcapUsd - 1) * 100;
  return i.priceChange1h;
}

/** The memecoin terminal: live Pump coins by stage, a ring around each coin showing how full it is, and one filter button. */
export function MemepadTab({ onOpen, paused = false, embedded = false, storyKey, hideStories = false }: { onOpen: (c: CoinRef) => void; paused?: boolean; embedded?: boolean; /** When the parent shows the story cards above the tabs, it passes the chosen one here. */ storyKey?: string | null; hideStories?: boolean }) {
  // Only graduated coins: they trade on the open market with real liquidity, and every number for them is free to read.
  const stage: StageKey = "grad";
  const [settings, setSettings] = useState<MemeFilterSettings>(DEFAULT_SETTINGS);
  const [sheet, setSheet] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [ownStory, setStory] = useState<string | null>(null);
  const story = storyKey !== undefined ? storyKey : ownStory;
  const [feed, setFeed] = useState<MemecoinFeed | null>(null);
  const [feedStage, setFeedStage] = useState<StageKey | null>(null);
  const [stories, setStories] = useState<StoryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState<Record<string, LiveBits>>({});
  // One clock for every row, so ages count up together (12s, 13s, 14s...).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  // Coins already on screen. Anything else that turns up waits behind a button instead of pushing the list around.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const initKey = useRef<string>("");
  const top = useRef<HTMLDivElement>(null);

  // Settings live in localStorage, so they are read after mount.
  useEffect(() => setSettings(loadSettings()), []);
  const update = (s: MemeFilterSettings) => {
    setSettings(s);
    saveSettings(s);
  };

  useEffect(() => {
    if (hideStories) return;
    fetchMemecoinStories()
      .then((r) => setStories(r.stories))
      .catch(() => {});
  }, [hideStories]);

  const pro = needsPro(settings);
  // New coins are the point of this tab, so they refresh every few seconds. The rest can be slower.
  const pollMs = 5_000;

  useEffect(() => {
    if (paused) return;
    let alive = true;
    let busy = false;
    // One request at a time, and none while the app is in the background or a coin page is open.
    const load = () => {
      if (busy || document.hidden) return;
      busy = true;
      return fetchMemecoinFeed({ safe: settings.on, lowRiskOnly: false, stage, story, pro })
        .then((f) => {
          if (!alive) return;
          setFeed(f);
          setFeedStage(stage);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true))
        .finally(() => {
          busy = false;
          if (alive) setLoading(false);
        });
    };
    void load();
    const timer = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [story, pro, pollMs, settings.on, paused, stage]);

  // Put the live numbers over the feed's snapshot: price, change, volume, holders.
  const merged = useMemo(
    () =>
      (feed?.items ?? []).map((i) => {
        const l = live[i.mint];
        // Even before live numbers arrive, a coin too new for an hourly change shows its change since launch.
        if (!l) return { ...i, priceChange1h: bestChange(i, null, null, i.mcapUsd) };
        const mcap = l.mcapUsd ?? i.mcapUsd;
        return {
          ...i,
          mcapUsd: mcap,
          holders: l.holders ?? i.holders,
          priceChange1h: bestChange(i, l.change1h, l.change5m, mcap),
          volume24hUsd: l.volume24hUsd ?? i.volume24hUsd,
          buys: l.buys ?? i.buys,
          sells: l.sells ?? i.sells,
        };
      }),
    [feed, live],
  );
  // Until the stage on screen has arrived, show nothing from the previous one.
  const inStage = useMemo(() => (feedStage === stage || story ? merged.filter((i) => i.stage.key === stage) : []), [merged, stage, feedStage, story]);

  const shown = useMemo(() => {
    let items = inStage;
    const q = query.trim().toLowerCase();
    if (q) items = items.filter((i) => (i.name ?? "").toLowerCase().includes(q) || (i.symbol ?? "").toLowerCase().includes(q) || i.mint.toLowerCase().startsWith(q));
    // Story feeds come from the backend, which already applied its own safe filter.
    if (settings.on && !story) {
      // No coin in this stage has a holder count (free data mode), so the minimum-holders rule is skipped.
      const holdersAvailable = inStage.some((i) => i.holders != null);
      items = items.filter((i) => passes(i, settings.rules[i.stage.key], holdersAvailable));
    }
    const sorted = [...items];
    sorted.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
    return sorted;
  }, [inStage, query, stage, settings, story]);

  // The list shows only coins that were already there. New arrivals are counted, not inserted.
  const viewKey = `${stage}|${query}|${story}|${settings.on}|${JSON.stringify(settings.rules[stage])}`;
  useEffect(() => {
    if (initKey.current !== viewKey && shown.length > 0) {
      initKey.current = viewKey;
      setRevealed(new Set(shown.map((i) => i.mint)));
    }
  }, [viewKey, shown]);
  const visible = useMemo(() => shown.filter((i) => revealed.has(i.mint)), [shown, revealed]);
  const pending = shown.length - visible.length;
  const showPending = () => {
    haptic("tap");
    setRevealed(new Set(shown.map((i) => i.mint)));
    top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Live numbers for the first 15 coins on screen, once a second.
  const watch = useMemo(() => visible.slice(0, 15).map((i) => i.mint).join(","), [visible]);
  useEffect(() => {
    if (paused || !watch) return;
    let alive = true;
    let busy = false;
    const tick = () => {
      if (busy || document.hidden) return;
      busy = true;
      fetchLive(watch.split(","))
        .then((l) => alive && setLive((prev) => ({ ...prev, ...l })))
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    tick();
    const t = setInterval(tick, 1_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [watch, paused]);

  const hidden = inStage.length - shown.length;
  const r = settings.rules[stage];
  // How many rules are doing something for this stage. Shown on the filter button.
  const active = settings.on ? [r.minHolders > 0, r.minVolumeUsd > 0, r.requireSocial, r.maxBundlePct < 100, r.maxDevPct < 100, r.minProTraders > 0].filter(Boolean).length : 0;

  return (
    <div className="px-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        {embedded ? <p className="text-base text-mute">Fresh Pump launches</p> : <h1 className="font-display text-3xl font-extrabold">Memepad</h1>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Search"
            onClick={() => {
              haptic("tap");
              setSearching((v) => !v);
              setQuery("");
            }}
            className="btn3d dark grid h-12 w-12 place-items-center !rounded-2xl"
          >
            {searching ? <X size={20} /> : <Search size={20} />}
          </button>
          <button type="button" aria-label="Filters" onClick={() => setSheet(true)} className="btn3d dark relative grid h-12 w-12 place-items-center !rounded-2xl">
            <SlidersHorizontal size={20} />
            {active > 0 && <span className="absolute -right-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-brand px-1 text-base font-bold leading-none text-white">{active}</span>}
          </button>
        </div>
      </div>

      {searching && (
        <div className="card mt-3 flex h-14 items-center gap-3 px-4">
          <Search size={20} className="text-mute" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, symbol or address" className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-mute" />
        </div>
      )}

      {stories.length > 0 && (
        <div className="hscroll -mx-4 mt-4 flex gap-3 px-4 pb-2">
          {stories.map((s) => {
            const mood = storyMood(s.momentum);
            const on = story === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  haptic("tap");
                  setStory(on ? null : s.key);
                }}
                className={clsx("card w-44 shrink-0 p-3 text-left transition-transform active:scale-[0.97]", on && "!border-[#ff7a2a]")}
              >
                <div className="flex -space-x-2">
                  {s.topCoins.slice(0, 3).map((c) => (
                    <Avatar key={c.mint} mint={c.mint} symbol={c.name ?? "?"} src={c.imageUrl} size={32} />
                  ))}
                </div>
                <div className="mt-2 truncate font-display text-base font-bold">{s.label}</div>
                <div className="text-base font-semibold" style={{ color: mood.color }}>
                  {mood.text}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-base text-mute">
        <span className="font-semibold text-ink">Graduated</span> · {TAGLINE.grad}, biggest 24h volume first
      </p>

      <div ref={top} className="-mt-1 pt-1" />
      {pending > 0 && (
        <div className="sticky top-2 z-20 flex justify-center py-2">
          <button type="button" onClick={showPending} className="btn3d h-12 px-6 text-base shadow-lg">
            Show {pending} new
          </button>
        </div>
      )}

      <div className="mt-1">
        {(loading || (feedStage !== stage && !story)) && shown.length === 0 && !failed && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="my-3 h-14" />)}
        {visible.map((m) => (
          <MemeRow key={m.mint} coin={fromMemecoin(m)} onOpen={onOpen} now={now} />
        ))}
        {!loading && !failed && feed && shown.length === 0 && (
          <div className="card mt-3 px-4 py-10 text-center text-base text-mute">
            {hidden > 0 ? `${hidden} coins are hidden by your filters.` : "Nothing here right now."}
            {hidden > 0 && (
              <div className="mt-4 flex flex-col gap-3">
                <button type="button" onClick={() => update({ ...settings, on: false })} className="btn3d h-14 text-base">
                  Show them anyway
                </button>
                <button type="button" onClick={() => setSheet(true)} className="btn3d dark h-14 text-base">
                  Change filters
                </button>
              </div>
            )}
          </div>
        )}
        {failed && !feed && <div className="card mt-3 px-4 py-10 text-center text-base text-mute">Could not load coins. Try again in a moment.</div>}
      </div>

      {sheet && <FilterSheet settings={settings} stage={stage} count={shown.length} onChange={update} onClose={() => setSheet(false)} />}
    </div>
  );
}
