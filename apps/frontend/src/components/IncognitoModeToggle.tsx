"use client";

import { VenetianMask } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Compact row for the optional per-payment privacy toggle. The dramatic "incognito" moment
 *  (dark card + a small "Private" badge) lives on the whole pay card (see IncognitoCardBadge in
 *  c/[id]/page.tsx) — this row just needs to read clearly at a glance. Deliberately muted: no
 *  bright color or glow — those read as a privacy red flag in user feedback, the opposite of
 *  what a "private" indicator should feel like. */
export function IncognitoModeToggle({
  checked,
  onCheckedChange,
  onLabel = "Pay privately",
  offLabel = "Pay privately",
  ariaLabel = "Make this payment private",
  className,
  light = false,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Checked-state label — was hardcoded to "Pay privately" everywhere, including the lottery
   *  redeem/withdraw flow where the user is claiming winnings, not paying. Override per context. */
  onLabel?: string;
  offLabel?: string;
  ariaLabel?: string;
  className?: string;
  /** Text/icon are slate-toned by default — fine on the dark pay card this was built for, unreadable
   *  on a light host background (e.g. GuestCheckoutPay's card). Set this there, same convention as
   *  TokenCombobox's own `light` prop. */
  light?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2.5 rounded-xl border px-3 py-2",
      light ? "border-gray-200 bg-gray-50 [@media(prefers-color-scheme:dark)]:border-white/10 [@media(prefers-color-scheme:dark)]:bg-white/5" : "border-white/10 bg-white/5",
      className
    )}>
      {checked && (
        <VenetianMask
          className={cn("h-4 w-4 shrink-0", light ? "text-gray-500 [@media(prefers-color-scheme:dark)]:text-slate-300" : "text-slate-300")}
          strokeWidth={1.75}
        />
      )}
      <span className={cn(
        "flex-1 min-w-0 text-sm font-medium transition-colors",
        light
          ? (checked ? "text-gray-900 [@media(prefers-color-scheme:dark)]:text-slate-100" : "text-gray-700 [@media(prefers-color-scheme:dark)]:text-slate-200")
          : (checked ? "text-slate-100" : "text-slate-200")
      )}>
        {checked ? onLabel : offLabel}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} />
    </div>
  );
}
