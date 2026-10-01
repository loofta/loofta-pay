"use client";

/**
 * Shared "Split into" + "Spread over" (minutes/hours/days) + "How private mode works" controls
 * for a MagicBlock private transfer — used by every private-pay surface in this app (the Send &
 * Receive form, the home-v3 hero, GuestCheckoutPay's guest wallet-pay option, and the
 * authenticated Pay Now sliders on /c/[id]) so the actual delay range (MagicBlock documents no
 * maximum on the transfer endpoint — see @/lib/privacyDelay) and split range (1-15, MagicBlock's
 * real documented cap) only need to be correct in one place.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Info, ChevronDown } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { MAGICBLOCK_MAX_SPLIT } from "@/services/magicblockPrivateTransfer";
import { DELAY_UNITS, DELAY_UNIT_MAX, DELAY_UNIT_MS, DELAY_UNIT_LABEL, type DelayUnit, unitForDelayMs } from "@/lib/privacyDelay";

const easeBrand = [0.16, 1, 0.3, 1] as const;

type Theme = "dark" | "auto";

const TEXT: Record<Theme, { label: string; value: string; hint: string; info: string; infoHover: string; card: string }> = {
  dark: {
    label: "text-slate-200",
    value: "text-slate-100",
    hint: "text-slate-500",
    info: "text-slate-400",
    infoHover: "hover:text-slate-200",
    card: "border-white/10 bg-white/[0.03]",
  },
  auto: {
    label: "text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-300",
    value: "text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100",
    hint: "text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-400",
    info: "text-gray-600 [@media(prefers-color-scheme:dark)]:text-slate-300",
    infoHover: "hover:text-gray-900 [@media(prefers-color-scheme:dark)]:hover:text-slate-100",
    card: "border-gray-200 bg-gray-50 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5",
  },
};

const SLIDER_TRACK_DARK = "[&>span:first-child]:bg-white/10 [&>span:first-child>span]:bg-[#FF7A2A] [&_[role=slider]]:border-[#FF7A2A] [&_[role=slider]]:bg-[#16161a]";

export function PrivacyTimingControls({
  idPrefix,
  split,
  onSplitChange,
  delayMs,
  onDelayMsChange,
  amountUsd,
  infoOpen,
  onInfoOpenChange,
  theme = "dark",
  wrapInCard = true,
  className,
}: {
  idPrefix: string;
  split: number;
  onSplitChange: (v: number) => void;
  delayMs: number;
  onDelayMsChange: (v: number) => void;
  amountUsd?: number;
  infoOpen: boolean;
  onInfoOpenChange: (v: boolean) => void;
  theme?: Theme;
  /** Set false when the caller already wraps this in its own bordered card (e.g. inside an
   *  existing AnimatePresence height-reveal container that provides the card chrome). */
  wrapInCard?: boolean;
  className?: string;
}) {
  const t = TEXT[theme];
  const [unit, setUnit] = useState<DelayUnit>(() => unitForDelayMs(delayMs));
  const amountInUnit = Math.min(DELAY_UNIT_MAX[unit], Math.round(delayMs / DELAY_UNIT_MS[unit]));

  const changeUnit = (next: DelayUnit) => {
    if (next === unit) return;
    // Carry the current value over converted into the new unit, clamped to its range, instead of
    // resetting to 0 — switching from "45 min" to hours should land on "1 hr", not "no delay".
    const nextAmount = Math.min(DELAY_UNIT_MAX[next], Math.round(delayMs / DELAY_UNIT_MS[next]));
    setUnit(next);
    onDelayMsChange(nextAmount * DELAY_UNIT_MS[next]);
  };

  const content = (
    <>
      <div>
        <button
          type="button"
          onClick={() => onInfoOpenChange(!infoOpen)}
          aria-expanded={infoOpen}
          aria-controls={`${idPrefix}-privacy-info`}
          className={`inline-flex items-center gap-2 rounded-lg -mx-1 px-1 py-0.5 text-base ${t.info} ${t.infoHover} transition-colors`}
        >
          <Info className="h-4 w-4 shrink-0" aria-hidden />
          How private mode works
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${infoOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        <AnimatePresence initial={false}>
          {infoOpen && (
            <motion.p
              id={`${idPrefix}-privacy-info`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className={`overflow-hidden text-base leading-[1.55] ${t.hint}`}
            >
              <span className="block pt-3">
                MagicBlock hides the link between your wallet and theirs on-chain. Split the amount
                and spread it over time to make it harder to trace. Gasless: they don&apos;t need
                SOL, MagicBlock takes its fee in USDC.
              </span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <label htmlFor={`${idPrefix}-split`} className={`text-base ${t.label}`}>Split into</label>
          <span className={`font-display text-lg font-semibold ${t.value} tabular-nums`}>
            {split} {split === 1 ? "part" : "parts"}
          </span>
        </div>
        <Slider
          id={`${idPrefix}-split`}
          min={1}
          max={MAGICBLOCK_MAX_SPLIT}
          step={1}
          value={[split]}
          onValueChange={([v]) => onSplitChange(v)}
          aria-label="Number of parts"
          className={theme === "dark" ? SLIDER_TRACK_DARK : undefined}
        />
        {amountUsd != null && amountUsd > 0 && split > 1 && (
          <p className={`mt-2 text-base ${t.hint} tabular-nums`}>About ${(amountUsd / split).toFixed(2)} per part</p>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-3">
          <label htmlFor={`${idPrefix}-delay`} className={`text-base ${t.label}`}>Spread over</label>
          <div className="flex items-center gap-2">
            <span className={`font-display text-lg font-semibold ${t.value} tabular-nums`}>
              {amountInUnit === 0 ? "No delay" : `up to ${amountInUnit} ${DELAY_UNIT_LABEL[unit]}${amountInUnit === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
        {DELAY_UNITS.length > 1 && (
          <div className={`mb-3 inline-flex items-center gap-1 rounded-full p-1 ${theme === "dark" ? "bg-white/[0.06]" : "bg-gray-100 [@media(prefers-color-scheme:dark)]:bg-white/5"}`}>
            {DELAY_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => changeUnit(u)}
                className={`rounded-full px-3 py-1 text-sm font-medium capitalize transition-colors ${
                  unit === u
                    ? theme === "dark"
                      ? "bg-white/[0.14] text-white"
                      : "bg-white text-gray-900 shadow-sm [@media(prefers-color-scheme:dark)]:bg-white/10 [@media(prefers-color-scheme:dark)]:text-slate-100"
                    : `${t.hint} hover:${theme === "dark" ? "text-slate-200" : "text-gray-700"}`
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        )}
        <Slider
          id={`${idPrefix}-delay`}
          min={0}
          max={DELAY_UNIT_MAX[unit]}
          step={1}
          value={[amountInUnit]}
          onValueChange={([v]) => onDelayMsChange(v * DELAY_UNIT_MS[unit])}
          aria-label={`Maximum delivery delay in ${unit}`}
          className={theme === "dark" ? SLIDER_TRACK_DARK : undefined}
        />
        <p className={`mt-2 text-base ${t.hint}`}>
          {delayMs === 0 ? "Every part is delivered right away." : `Each part lands at a random moment within ${amountInUnit} ${DELAY_UNIT_LABEL[unit]}${amountInUnit === 1 ? "" : "s"}.`}
        </p>
      </div>
    </>
  );

  if (!wrapInCard) return <div className="space-y-5">{content}</div>;

  return (
    <div className={`rounded-2xl border ${t.card} px-4 py-4 space-y-5 ${className ?? ""}`}>
      {content}
    </div>
  );
}
