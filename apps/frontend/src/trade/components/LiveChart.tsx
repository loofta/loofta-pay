"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { CandlestickChart, LineChart } from "lucide-react";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import { Skeleton } from "@/trade/components/ui";
import { useFlash } from "@/trade/hooks/useFlash";
import type { LiveTrade } from "@/trade/hooks/useLiveTrades";

type Candle = { time: number; open: number; high: number; low: number; close: number };
const FRAMES = [
  { id: "15s", label: "Live" },
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
] as const;
type Frame = (typeof FRAMES)[number]["id"];
const UP = "#3cb371";
const DOWN = "#ff5a4a";
const HEIGHT = 300;
/** Every pump coin has one billion tokens, so price times a billion is its market cap. */
const PUMP_SUPPLY = 1_000_000_000;

function compactUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(v >= 1e5 ? 0 : 2)}K`;
  return `$${v.toFixed(v >= 100 ? 0 : 2)}`;
}

function priceText(price: number): string {
  const p = price >= 100 ? 2 : price >= 1 ? 4 : Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(price || 1))));
  return `$${price.toFixed(p)}`;
}

type Disposable = IChartApi & { __ro?: ResizeObserver };
type Bubble = { id: string; side: "buy" | "sell"; usd: number; lane: number };

/**
 * Live chart. It moves with every trade, not just with each refresh: the line's last point follows each buy and
 * sell as it happens, the last point pulses, the card glows green or red on a trade, and the size of each trade
 * floats up from the line. Pump coins are shown as market cap, other coins as price. Line by default, with a
 * candles switch, and buys and sells pinned on the line as small arrows.
 */
export function LiveChart({ mint, trades, price }: { mint: string; trades: LiveTrade[]; price?: number | null }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Disposable | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | ISeriesApi<"Candlestick"> | null>(null);
  const liveBar = useRef<Candle | null>(null);
  const seen = useRef<string | null>(null);
  const fitted = useRef(-1);
  const [tf, setTf] = useState<Frame>("1m");
  const [candlesOn, setCandlesOn] = useState(true);
  const [fetched, setFetched] = useState<Candle[] | null>(null);
  const [built, setBuilt] = useState(0);
  const [glow, setGlow] = useState<"buy" | "sell" | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [tick, setTick] = useState<number | null>(null);
  const isMcap = mint.endsWith("pump");
  const scale = isMcap ? PUMP_SUPPLY : 1;
  // Every frame is live. The 1m view shows seconds on its time axis so movement is visible.
  const seconds = tf === "1m";
  const flash = useFlash(tick, 500);

  useEffect(() => {
    let alive = true;
    setFetched(null);
    const load = () =>
      fetch(`/api/backend/mini/chart?mint=${mint}&tf=${tf}`)
        .then((r) => r.json())
        // An empty answer (rate limit, upstream hiccup) never wipes candles we already have. That swap is what flickered.
        .then((d: { candles?: Candle[] }) => alive && setFetched((prev) => (d.candles && d.candles.length > 0 ? d.candles : prev && prev.length > 0 ? prev : [])))
        .catch(() => alive && setFetched((prev) => prev ?? []));
    void load();
    const t = setInterval(() => !document.hidden && void load(), 2_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [mint, tf]);

  // A coin seconds old has no history upstream yet. Rather than an empty box, draw it from its own trades, or from
  // its current price as a flat first candle, and swap in the real candles the moment they exist.
  const synth = useRef<{ key: string; data: Candle[] } | null>(null);
  const hasTrades = trades.length > 0;
  const candles = useMemo<Candle[] | null>(() => {
    if (fetched && fetched.length > 0) {
      synth.current = null;
      return fetched;
    }
    // Still loading: say nothing yet rather than flash a rough drawing that the real candles then replace.
    if (fetched === null) return null;
    // Drawn once and then left alone. New trades extend its last candle through the live update below.
    const key = `${mint}:${tf}`;
    if (synth.current?.key === key) return synth.current.data;
    const size = { "15s": 15, "1m": 60, "5m": 300, "15m": 900, "1h": 3600 }[tf];
    const byBucket = new Map<number, Candle>();
    for (const t of [...trades].reverse()) {
      if (!(t.price > 0)) continue;
      const time = Math.floor(t.time / 1000 / size) * size;
      const c = byBucket.get(time);
      if (!c) byBucket.set(time, { time, open: t.price, high: t.price, low: t.price, close: t.price });
      else {
        c.high = Math.max(c.high, t.price);
        c.low = Math.min(c.low, t.price);
        c.close = t.price;
      }
    }
    let out: Candle[] | null = null;
    if (byBucket.size > 0) out = [...byBucket.values()].sort((a, b) => a.time - b.time);
    else if (price && price > 0) {
      const time = Math.floor(Date.now() / 1000 / size) * size;
      out = [{ time, open: price, high: price, low: price, close: price }];
    }
    if (out) synth.current = { key, data: out };
    return out ?? fetched;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetched, hasTrades, price, tf, mint]);

  const hasData = !!candles && candles.length > 0;

  // Build the chart once per style, then only swap the data in. That keeps live updates smooth.
  useEffect(() => {
    if (!host.current || !hasData) return;
    let disposed = false;
    void import("lightweight-charts").then(({ createChart, CrosshairMode, LastPriceAnimationMode }) => {
      if (disposed || !host.current) return;
      const chart = createChart(host.current, {
        height: HEIGHT,
        layout: { background: { color: "transparent" }, textColor: "#9a98a3", fontSize: 11 },
        grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.035)" } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.15 }, minimumWidth: 64 },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: seconds, rightOffset: 6, minBarSpacing: 0.5 },
        crosshair: { mode: CrosshairMode.Normal },
        // Pinch to zoom, drag sideways to pan, drag the price or time axis to stretch it. Vertical drags still scroll the page.
        handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
        handleScroll: { horzTouchDrag: true, vertTouchDrag: false, pressedMouseMove: true, mouseWheel: false },
      }) as Disposable;
      // A coin seconds old has a tiny price range, and the scale then pads below zero. Prices cannot be negative.
      const noNegative = (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = original();
        if (r) r.priceRange.minValue = Math.max(0, r.priceRange.minValue);
        return r;
      };
      const fmt = { type: "custom" as const, minMove: 0.0000001, formatter: (v: number) => (isMcap ? compactUsd(v) : priceText(v)) };
      seriesRef.current = candlesOn
        ? chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN, priceFormat: fmt, autoscaleInfoProvider: noNegative })
        : chart.addAreaSeries({ lineWidth: 3, lineColor: UP, topColor: "rgba(60,179,113,0.35)", bottomColor: "rgba(60,179,113,0)", priceFormat: fmt, crosshairMarkerVisible: false, autoscaleInfoProvider: noNegative, lastPriceAnimation: LastPriceAnimationMode.Continuous });
      chartRef.current = chart;
      const ro = new ResizeObserver(() => host.current && chart.applyOptions({ width: host.current.clientWidth }));
      ro.observe(host.current);
      chart.__ro = ro;
      setBuilt((n) => n + 1);
    });
    return () => {
      disposed = true;
      const c = chartRef.current;
      c?.__ro?.disconnect();
      c?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [hasData, candlesOn, isMcap, seconds]);

  const line = useMemo(() => (candles ?? []).map((c) => ({ time: c.time as Time, value: c.close * scale })), [candles, scale]);
  const bars = useMemo(() => (candles ?? []).map((c) => ({ time: c.time as Time, open: c.open * scale, high: c.high * scale, low: c.low * scale, close: c.close * scale })), [candles, scale]);

  // Push new data and colour the line by direction.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !hasData || !candles) return;
    liveBar.current = { ...candles[candles.length - 1] };
    if (candlesOn) (s as ISeriesApi<"Candlestick">).setData(bars);
    else {
      const up = line[line.length - 1].value >= line[0].value;
      (s as ISeriesApi<"Area">).applyOptions({ lineColor: up ? UP : DOWN, topColor: up ? "rgba(60,179,113,0.35)" : "rgba(255,90,74,0.3)", bottomColor: "rgba(0,0,0,0)" });
      (s as ISeriesApi<"Area">).setData(line);
    }
    // Fit once per chart build, never on a refresh, or every second would undo the person's zoom.
    if (fitted.current !== built) {
      fitted.current = built;
      chartRef.current?.timeScale().fitContent();
    }
  }, [line, bars, candlesOn, hasData, built, candles]);

  // Reset zoom when the timeframe changes.
  useEffect(() => {
    fitted.current = -1;
  }, [tf]);

  // Keep the line moving between trades: once a second the last point follows the clock at the latest price,
  // so a quiet coin draws a live line instead of sitting still.
  useEffect(() => {
    if (candlesOn) return;
    const size = { "15s": 15, "1m": 60, "5m": 300, "15m": 900, "1h": 3600 }[tf];
    const t = setInterval(() => {
      const s = seriesRef.current;
      const bar = liveBar.current;
      if (!s || !bar || document.hidden) return;
      const time = Math.floor(Date.now() / 1000 / size) * size;
      if (time < bar.time) return;
      if (time > bar.time) liveBar.current = { time, open: bar.close, high: bar.close, low: bar.close, close: bar.close };
      (s as ISeriesApi<"Area">).update({ time: time as Time, value: bar.close * scale });
    }, 1_000);
    return () => clearInterval(t);
  }, [candlesOn, tf, scale]);

  // Every new trade moves the last point at once, makes the card glow, and floats its size up from the line.
  useEffect(() => {
    const s = seriesRef.current;
    const bar = liveBar.current;
    if (!trades.length) return;
    const fresh: LiveTrade[] = [];
    for (const t of trades) {
      if (t.id === seen.current) break;
      fresh.push(t);
    }
    if (fresh.length === 0) return;
    const first = seen.current === null;
    seen.current = trades[0].id;
    // The first batch after opening is history, not news.
    if (first) return;
    const ordered = fresh.slice(0, 8).reverse();
    if (s && bar) {
      for (const t of ordered) {
        const v = t.price * scale;
        bar.close = t.price;
        bar.high = Math.max(bar.high, t.price);
        bar.low = Math.min(bar.low, t.price);
        if (candlesOn) (s as ISeriesApi<"Candlestick">).update({ time: bar.time as Time, open: bar.open * scale, high: bar.high * scale, low: bar.low * scale, close: v });
        else (s as ISeriesApi<"Area">).update({ time: bar.time as Time, value: v });
      }
    }
    const last = ordered[ordered.length - 1];
    setTick(last.price * scale);
    setGlow(last.side);
    const t = setTimeout(() => setGlow(null), 450);
    const added = ordered.slice(-3).map((x, i) => ({ id: x.id, side: x.side, usd: x.usd, lane: (Date.now() + i) % 3 }));
    setBubbles((prev) => [...prev, ...added].slice(-8));
    const clear = setTimeout(() => setBubbles((prev) => prev.filter((b) => !added.some((a) => a.id === b.id))), 1_600);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [trades, scale, candlesOn]);

  const last = tick ?? (candles && candles.length > 0 ? candles[candles.length - 1].close * scale : null);

  return (
    <div
      className="card relative mt-3 overflow-hidden p-2.5 transition-shadow duration-300"
      style={glow ? { boxShadow: `0 0 0 1px ${glow === "buy" ? UP : DOWN}66, 0 0 22px ${glow === "buy" ? "rgba(60,179,113,0.28)" : "rgba(255,90,74,0.25)"}` } : undefined}
    >
      <div className="hscroll mb-1 flex items-center gap-1 " style={{ touchAction: "pan-x" }}>
        <span className="ml-1 mr-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-up" aria-label="Live" />
        {FRAMES.filter((f) => f.id !== "15s").map((f) => (
          <button key={f.id} type="button" onClick={() => setTf(f.id)} className={clsx("h-9 flex-1 rounded-xl px-2 font-display text-base font-semibold", tf === f.id ? "bg-raised text-ink" : "text-mute")}>
            {f.label}
          </button>
        ))}
        <button type="button" aria-label={candlesOn ? "Show line" : "Show candles"} onClick={() => setCandlesOn((v) => !v)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface text-mute">
          {candlesOn ? <LineChart size={18} /> : <CandlestickChart size={18} />}
        </button>
      </div>
      {last != null && (
        <div className={clsx("px-1 font-display text-base font-bold text-mute", flash && `flash-${flash}`)}>{isMcap ? `Market cap ${compactUsd(last)}` : priceText(last)}</div>
      )}
      {candles === null && <Skeleton className="h-[300px]" />}
      {candles !== null && candles.length === 0 && <div className="grid h-[300px] place-items-center px-6 text-center text-base text-mute">No chart yet. Brand new coins can take a minute to show up.</div>}
      <div ref={host} className={hasData ? "" : "hidden"} style={{ touchAction: "pan-y" }} />
      {hasData && <div className="px-1 pt-1 text-center text-base text-mute">Scroll or pinch to zoom, drag to move, double click an axis to reset</div>}

      {/* the size of each trade floats up from the line */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 top-12" aria-hidden>
        {bubbles.map((b) => (
          <span key={b.id} className={clsx("chart-bubble", b.side === "buy" ? "text-up" : "text-down")} style={{ right: `${8 + b.lane * 16}%` }}>
            {b.side === "buy" ? "+" : "-"}${b.usd >= 10 ? Math.round(b.usd) : b.usd.toFixed(1)}
          </span>
        ))}
      </div>
    </div>
  );
}
