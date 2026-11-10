"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import posthog from "posthog-js";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { STAKE_UPSELL_MIN_USDC, TICKETS_PER_DOLLAR } from "@/hooks/useStakeUpsell";

interface StakeUpsellCardProps {
  checked: boolean;
  /** Called with the new switch state and the stake amount in USDC. */
  onChange: (checked: boolean, amount: number) => void;
  amount: number;
  /** Most that can be staked (the available balance). */
  max: number;
  dark?: boolean;
  disabled?: boolean;
  reduceMotion?: boolean;
  /** Which surface is showing the card, sent with the PostHog shown/toggled events. */
  source?: string;
}

const PRESETS = [1, 5, 10, 25];

/**
 * Stake to win add-on shown before a withdrawal or cash out: min $1, any larger amount, shows the weekly-draw
 * tickets it earns. The parent decides what toggling does to the withdrawal amount.
 */
export function StakeUpsellCard({ checked, onChange, amount, max, dark, disabled, reduceMotion, source }: StakeUpsellCardProps) {
  const [text, setText] = useState(String(amount));
  useEffect(() => { posthog.capture("stake_upsell_shown", { source }); }, [source]);
  useEffect(() => { setText(String(amount)); }, [amount]);

  const tickets = Math.floor(amount * TICKETS_PER_DOLLAR);
  const cap = Math.max(STAKE_UPSELL_MIN_USDC, Math.floor(max * 100) / 100);
  const clamp = (n: number) => Math.min(Math.max(STAKE_UPSELL_MIN_USDC, n), cap);
  const commit = (n: number) => onChange(true, clamp(n));

  return (
    <div className="relative rounded-2xl">
      <style>{`
        @keyframes looftaGlowShift { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
        @keyframes looftaGlowPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
      `}</style>
      <div
        aria-hidden
        className="absolute -inset-[2.5px] rounded-2xl blur-[7px]"
        style={{
          background: "linear-gradient(110deg,#FF1301,#FF6A00,#EAB308,#FF4A26,#FF1301)",
          backgroundSize: "220% 100%",
          animation: reduceMotion ? undefined : "looftaGlowShift 2.4s linear infinite, looftaGlowPulse 2.4s ease-in-out infinite",
          opacity: reduceMotion ? 0.7 : undefined,
        }}
      />
      <div className={cn("relative rounded-2xl border p-4", dark ? "bg-[#15110d] border-white/10" : "bg-white border-orange-100")}>
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/usdc.svg" alt="" width={44} height={44} className="shrink-0 h-11 w-11 object-contain" />
          <div className="flex-1 min-w-0">
            <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{`Stake $${amount} to win every week`}</p>
            <p className={`text-base mt-0.5 ${dark ? "text-slate-300" : "text-gray-600"}`}>
              {`That is about ${tickets.toLocaleString("en-US")} tickets in the weekly prize draw. Your USDC stays yours and you can withdraw it any time.`}
            </p>
          </div>
          <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => {
              posthog.capture("stake_upsell_toggled", { source, checked: next });
              onChange(next, clamp(amount));
            }}
            className="shrink-0 mt-1 data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#FF4A26] data-[state=checked]:to-[#E1A041]"
          />
        </div>
        {checked && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.filter((p) => p <= cap).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={disabled}
                  onClick={() => commit(p)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-base font-semibold transition-colors",
                    p === amount
                      ? "border-[#FF7A2A]/70 bg-[#FF5A1A]/15 text-[#FF8A3D]"
                      : dark ? "border-white/10 bg-white/5 text-white hover:bg-white/10" : "border-orange-100 bg-orange-50 text-gray-900",
                  )}
                >
                  {`$${p}`}
                </button>
              ))}
              <label className={cn("flex items-center gap-1 rounded-full border px-3.5 py-1.5", dark ? "border-white/10 bg-white/5" : "border-orange-100 bg-orange-50")}>
                <span className={dark ? "text-slate-400" : "text-gray-500"}>$</span>
                <input
                  inputMode="decimal"
                  aria-label="Stake amount in USDC"
                  value={text}
                  disabled={disabled}
                  onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
                  onBlur={() => commit(Number(text) || STAKE_UPSELL_MIN_USDC)}
                  className={cn("w-16 bg-transparent text-base font-semibold outline-none", dark ? "text-white" : "text-gray-900")}
                />
              </label>
            </div>
            <div className={cn("flex items-center justify-between rounded-xl px-3 py-2 text-base font-semibold", dark ? "bg-white/10 text-white" : "bg-orange-50 text-gray-900")}>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />{`Staked, ${tickets.toLocaleString("en-US")} tickets`}</span>
              <span>{`+$${amount.toFixed(2)}`}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
