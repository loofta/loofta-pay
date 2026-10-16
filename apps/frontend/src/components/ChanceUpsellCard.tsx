"use client";

import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import posthog from "posthog-js";
import { ChanceIcon } from "@/components/ChanceIcon";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface ChanceUpsellCardProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  dark?: boolean;
  disabled?: boolean;
  reduceMotion?: boolean;
  /** Price of one chance in USDC (shown in the "added" row). */
  price: number;
  /** Headline. Defaults to the cash-out wording. */
  title?: string;
  /** Row shown once switched on, e.g. "1 chance added". */
  addedLabel?: string;
  /** Which surface is showing the card, sent with the PostHog shown/toggled events. */
  source?: string;
}

/**
 * "Chance to win $200K today" add-on shown before a withdrawal or cash out. One flowing-glow
 * card with a switch; the parent decides what toggling does to the amount. Same glow as the
 * ticket confirm button on the Megapot page (SlideToPay.tsx).
 */
export function ChanceUpsellCard({
  checked,
  onCheckedChange,
  dark,
  disabled,
  reduceMotion,
  price,
  title = "Keep $1 for a chance to win $200K",
  addedLabel = "1 chance to win today added",
  source,
}: ChanceUpsellCardProps) {
  useEffect(() => {
    posthog.capture("chance_upsell_shown", { source });
  }, [source]);

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
          <ChanceIcon size={44} />
          <div className="flex-1 min-w-0">
            <p className={`text-base font-semibold ${dark ? "text-white" : "text-gray-900"}`}>{title}</p>
            <p className={`text-base mt-0.5 ${dark ? "text-slate-300" : "text-gray-600"}`}>
              {`$${price.toFixed(0)} stays in the draw instead of leaving. Winners are paid straight to the balance.`}
            </p>
          </div>
          <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => {
              posthog.capture("chance_upsell_toggled", { source, checked: next });
              onCheckedChange(next);
            }}
            className="shrink-0 mt-1 data-[state=checked]:bg-gradient-to-r data-[state=checked]:from-[#FF4A26] data-[state=checked]:to-[#E1A041]"
          />
        </div>
        {checked && (
          <div className={cn("mt-3 flex items-center justify-between rounded-xl px-3 py-2 text-base font-semibold", dark ? "bg-white/10 text-white" : "bg-orange-50 text-gray-900")}>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />{addedLabel}</span>
            <span>+${price.toFixed(2)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
