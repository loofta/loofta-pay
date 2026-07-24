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
  offLabel = "Pay privately",
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  offLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2", className)}>
      {checked && <VenetianMask className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={1.75} />}
      <span className={cn("flex-1 min-w-0 text-sm font-medium transition-colors", checked ? "text-slate-100" : "text-slate-200")}>
        {checked ? "Pay privately" : offLabel}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label="Make this payment private" />
    </div>
  );
}
