"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCandles, queueSpark, RANGES, type Candle, type Range } from "@/trade/lib/candles";
import { priceText } from "@/trade/components/MarketRow";

const UP = "#3cb371";
const DOWN = "#ff5a4a";

/** A small trend line from real candles. Loads lazily and shows a flat placeholder until it has data. */
export function Spark({ mint, width = 110, height = 32, change }: { mint: string; width?: number; height?: number; change: number | null }) {
  const [vals, setVals] = useState<number[] | null>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const el = host.current;
    if (!el) return;
    // Only ask for the line once the row is on screen.
    const io = new IntersectionObserver(
      (e) => {
        if (e[0].isIntersecting) {
          io.disconnect();
          void queueSpark(mint).then((v) => alive && setVals(v));
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [mint]);
  const d = useMemo(() => {
    if (!vals || vals.length < 2) return null;
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);
    const r = mx - mn || 1;
    return vals.map((v, i) => `${i ? "L" : "M"}${((i * width) / (vals.length - 1)).toFixed(1)} ${(height - 3 - ((v - mn) / r) * (height - 6)).toFixed(1)}`).join(" ");
  }, [vals, width, height]);
  const up = vals && vals.length > 1 ? vals[vals.length - 1] >= vals[0] : (change ?? 0) >= 0;
  return (
    <div ref={host} style={{ width, height }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {d ? <path d={d} fill="none" stroke={up ? UP : DOWN} strokeWidth={1.6} strokeLinejoin="round" /> : <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 4" />}
      </svg>
    </div>
  );
}

/** A real price chart with range buttons and a hover readout. Used in the trade panel. */
export function PriceLine({ mint, height = 120, onRange }: { mint: string; height?: number; onRange?: (r: Range) => void }) {
  const [range, setRange] = useState<Range>("1D");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    setCandles(null);
    void fetchCandles(mint, range).then((c) => alive && setCandles(c));
    return () => {
      alive = false;
    };
  }, [mint, range]);
  const w = 300;
  const closes = candles?.map((c) => c.close) ?? [];
  const up = closes.length > 1 ? closes[closes.length - 1] >= closes[0] : true;
  const col = up ? UP : DOWN;
  const geo = useMemo(() => {
    if (closes.length < 2) return null;
    const mn = Math.min(...closes);
    const mx = Math.max(...closes);
    const pad = (mx - mn) * 0.08 || mx * 0.02;
    const lo = mn - pad;
    const hi = mx + pad;
    const X = (i: number) => (i * w) / (closes.length - 1);
    const Y = (v: number) => 4 + (1 - (v - lo) / (hi - lo)) * (height - 8);
    const line = closes.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
    return { line, area: `${line} L${w} ${height} L0 ${height} Z`, X, Y };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, height]);
  const idx = hover == null || closes.length < 2 ? null : Math.max(0, Math.min(closes.length - 1, Math.round(hover * (closes.length - 1))));
  return (
    <div>
      <div
        className="relative cursor-crosshair"
        style={{ height }}
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {candles === null && <div className="absolute inset-0 animate-pulse rounded-lg bg-white/[0.04]" />}
        {candles !== null && !geo && <div className="grid h-full place-items-center text-base text-slate-500">No chart yet</div>}
        {geo && (
          <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block">
            <path d={geo.area} fill={col} opacity={0.1} />
            <path d={geo.line} fill="none" stroke={col} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
        )}
        {geo && idx != null && (
          <>
            <div className="pointer-events-none absolute inset-y-0 border-l border-white/25" style={{ left: `${(idx / (closes.length - 1)) * 100}%` }} />
            <div className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-[#0f0f12] px-2 py-1 text-base font-medium text-white ring-1 ring-white/15" style={{ left: `${(idx / (closes.length - 1)) * 100}%`, top: 0 }}>
              {priceText(closes[idx])}
            </div>
          </>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              setRange(r);
              onRange?.(r);
            }}
            className={r === range ? "rounded-lg bg-white/[0.09] py-1.5 text-base font-medium text-white" : "rounded-lg py-1.5 text-base text-slate-400 hover:text-white"}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
