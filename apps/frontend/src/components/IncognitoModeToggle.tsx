"use client";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Compact row for the optional per-payment privacy toggle. The dramatic "incognito" moment
 *  (ghost mascot + amber glow border) lives on the whole pay card (see IncognitoCardGhost in
 *  c/[id]/page.tsx) — this row just needs to read clearly at a glance. Amber/gold to match the
 *  existing private-payment lock icon elsewhere on this page and the brand gradient's gold end. */
export function IncognitoModeToggle({
  checked,
  onCheckedChange,
  offLabel = "Private payment",
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  offLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2", className)}>
      <span className={cn("flex-1 min-w-0 text-sm font-medium transition-colors", checked ? "text-amber-300" : "text-slate-200")}>
        {checked ? "Incognito mode" : offLabel}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label="Make this payment private" />
    </div>
  );
}
