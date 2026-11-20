"use client";

import { Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { FAST_RATE_PERCENT } from "@/services/peerCash";

/**
 * Plain-language switch for getting a cash-out picked up sooner. Someone sends the money from their own
 * account, so a small extra makes the order worth taking. Loofta keeps none of it. Chosen when the order is
 * created; a person who is not happy can cancel and place it again with the switch on.
 */

/** The switch shown when paying, next to Peer's own estimate for how long it usually takes. */
export function FastDeliverySwitch({
  checked,
  onChange,
  disabled,
  dark = true,
  estimateLabel,
  estimateLoading,
  extraUsd,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  dark?: boolean;
  /**
   * Peer's estimate for how long a standard order usually takes, e.g. "About 20 minutes". It is based on
   * recent orders at standard pricing, so it does not change with the switch and no faster time is made up.
   */
  estimateLabel?: string | null;
  estimateLoading?: boolean;
  /** What switching it on adds to the price, in dollars. */
  extraUsd?: number;
}) {
  return (
    <div className="w-full">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left disabled:opacity-60",
          checked ? "border-orange-500/60" : dark ? "border-white/10" : "border-gray-200",
          dark ? "bg-[#0E0E12]" : "bg-white",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cn("block text-base font-semibold", dark ? "text-white" : "text-gray-900")}>
            Fast delivery{extraUsd && extraUsd > 0 ? ` · +$${extraUsd.toFixed(2)}` : ""}
          </span>
          <span className={cn("mt-0.5 block text-base", dark ? "text-[#8A8893]" : "text-gray-500")}>
            {FAST_RATE_PERCENT}% goes to the person sending the money. Loofta keeps nothing.
          </span>
        </span>
        <span className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors", checked ? "bg-orange-500" : dark ? "bg-white/20" : "bg-gray-300")}>
          <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", checked ? "left-[22px]" : "left-0.5")} />
        </span>
      </button>
      {estimateLoading ? (
        <p className={cn("mt-2 flex items-center gap-1.5 px-1 text-base", dark ? "text-[#8A8893]" : "text-gray-500")}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking Peer's estimate
        </p>
      ) : (
        (estimateLabel || checked) && (
          <div className="mt-2 space-y-1 px-1 text-base">
            {estimateLabel && (
              <p className={cn(checked ? (dark ? "text-[#6E6B78] line-through" : "text-gray-400 line-through") : dark ? "text-[#8A8893]" : "text-gray-500")}>
                Standard: {estimateLabel}
              </p>
            )}
            {checked && (
              <p className="flex items-center gap-1.5 font-semibold text-orange-400">
                <Zap className="h-3.5 w-3.5" />
                With fast delivery: picked up sooner than standard orders
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
}
