"use client";

import { useState } from "react";
import clsx from "clsx";
import { DEFAULT_RULES, PRESETS, type MemeFilterSettings, type StageRules } from "@/trade/lib/memeFilters";
import type { StageKey } from "@/trade/lib/memecoin";
import { haptic } from "@/trade/lib/telegram";
import { Sheet } from "@/trade/components/Sheet";
import { Switch } from "@/trade/components/ui";

const STAGES: { id: StageKey; label: string }[] = [
  { id: "new", label: "New" },
  { id: "final", label: "Almost full" },
  { id: "grad", label: "Graduated" },
];

/** A labelled slider with the current value on the right. */
function Slider({ label, hint, value, onChange, min = 0, max, step, format }: { label: string; hint: string; value: number; onChange: (v: number) => void; min?: number; max: number; step: number; format: (v: number) => string }) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-semibold">{label}</span>
        <span className="font-display text-base font-bold">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => haptic("tap")}
        aria-label={label}
        className="mt-2 h-8 w-full cursor-pointer accent-[#ff7a2a]"
      />
      <div className="text-base text-mute">{hint}</div>
    </div>
  );
}

const money = (v: number) => (v === 0 ? "Any" : v >= 1000 ? `$${v / 1000}K` : `$${v}`);

/** Bottom sheet with the filter presets and sliders. Each stage keeps its own rules. */
export function FilterSheet({ settings, stage, count, onChange, onClose }: { settings: MemeFilterSettings; stage: StageKey; count: number; onChange: (s: MemeFilterSettings) => void; onClose: () => void }) {
  const [tab, setTab] = useState<StageKey>(stage);
  const r = settings.rules[tab];
  const patch = (p: Partial<StageRules>) => onChange({ ...settings, rules: { ...settings.rules, [tab]: { ...r, ...p } } });
  const activePreset = (Object.keys(PRESETS) as Array<keyof typeof PRESETS>).find((k) => JSON.stringify(settings.rules) === JSON.stringify(PRESETS[k].rules));

  return (
    <Sheet title="Filters" onClose={onClose}>
      <div className="mt-3">
        <Switch on={settings.on} onChange={(v) => onChange({ ...settings, on: v })} label="Hide bad coins" />
      </div>

      <div className={clsx(!settings.on && "pointer-events-none opacity-40")}>
        <p className="mt-3 text-base text-mute">{activePreset ? PRESETS[activePreset].hint : "Custom rules"}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                haptic("tap");
                onChange({ ...settings, rules: PRESETS[k].rules });
              }}
              className={clsx("btn3d flex h-[76px] flex-col items-center justify-center !rounded-2xl", activePreset === k ? "" : "dark")}
            >
              <span className="font-display text-base font-bold">{PRESETS[k].label}</span>
              <span className="px-1 text-center text-base leading-tight opacity-80">{k === "relaxed" ? "Show most" : k === "balanced" ? "Real holders" : "Safest only"}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-base text-mute">Applies to</span>
          {STAGES.map((s) => (
            <button key={s.id} type="button" onClick={() => setTab(s.id)} className={clsx("h-11 rounded-full border px-4 text-base font-semibold", tab === s.id ? "border-white/20 bg-raised text-ink" : "border-white/10 text-mute")}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-2 divide-y divide-white/5">
          <Slider label="Min holders" hint="How many different people own it" value={r.minHolders} onChange={(v) => patch({ minHolders: v })} max={500} step={5} format={(v) => (v === 0 ? "Any" : String(v))} />
          <Slider label="Min traded today" hint="Money that changed hands in 24 hours" value={r.minVolumeUsd} onChange={(v) => patch({ minVolumeUsd: v })} max={50_000} step={500} format={money} />
          <Slider label="Max bundled buys" hint="Wallets that bought together in the first second, often one person" value={r.maxBundlePct} onChange={(v) => patch({ maxBundlePct: v })} max={100} step={5} format={(v) => (v >= 100 ? "Any" : `${v}%`)} />
          <Slider label="Max creator share" hint="What the person who made the coin still owns" value={r.maxDevPct} onChange={(v) => patch({ maxDevPct: v })} max={100} step={1} format={(v) => (v >= 100 ? "Any" : `${v}%`)} />
          <Slider label="Experienced traders" hint="Wallets already up $1,000 or more on this coin" value={r.minProTraders} onChange={(v) => patch({ minProTraders: v })} max={10} step={1} format={(v) => (v === 0 ? "Any" : `${v}+`)} />
          <div className="py-3">
            <Switch on={r.requireSocial} onChange={(v) => patch({ requireSocial: v })} label="Has a website or social link" />
          </div>
        </div>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => {
            haptic("tap");
            patch(DEFAULT_RULES[tab]);
          }}
          className="btn3d dark h-16 w-28 shrink-0 text-base"
        >
          Reset
        </button>
        <button type="button" onClick={onClose} className="btn3d h-16 min-w-0 flex-1 text-lg">
          Show {count} coins
        </button>
      </div>
    </Sheet>
  );
}
