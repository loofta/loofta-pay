"use client";

import { cn } from "@/lib/utils";

/** Pay-privately row from the app mock: orange lock tile, title, hint, gradient switch.
 *  The whole row toggles. `light` keeps the same shape on a light card (guest checkout). */
export function IncognitoModeToggle({
  checked,
  onCheckedChange,
  onLabel = "Pay privately",
  offLabel = "Pay privately",
  description,
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
  /** Second line under the label. Defaults to the mockup hint on the pay-privately row. */
  description?: string;
  ariaLabel?: string;
  className?: string;
  /** Text/icon are slate-toned by default — fine on the dark pay card this was built for, unreadable
   *  on a light host background (e.g. GuestCheckoutPay's card). Set this there, same convention as
   *  TokenCombobox's own `light` prop. */
  light?: boolean;
}) {
  const label = checked ? onLabel : offLabel;
  const hint =
    description ??
    (onLabel === "Pay privately" || onLabel === "Send privately" ? "Hide who paid and how much" : undefined);

  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={cn("flex w-full items-center gap-3.5 rounded-[18px] px-4 py-3.5 text-left", className)}
      style={{
        background: light
          ? checked ? "rgba(255,90,26,0.08)" : "#F6F5F2"
          : checked ? "rgba(255,90,26,0.08)" : "#0E0E12",
        border: `1px solid ${checked ? "rgba(255,90,26,0.35)" : light ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"}`,
      }}
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px]"
        style={{
          background: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)",
          boxShadow: "inset 0 2px 4px rgba(255,255,255,0.5), 0 3px 0 #9C2802",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4.5" y="11" width="15" height="10" rx="2.5" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("text-[15px] font-bold", light ? "text-[#16161C]" : "text-[#F2EFE8]")}>{label}</span>
        {hint && <span className="text-[13px] text-[#8A8893]">{hint}</span>}
      </span>
      <span
        aria-hidden
        className="inline-flex h-[30px] w-[52px] shrink-0 items-center rounded-full p-[3px]"
        style={{
          background: checked ? "linear-gradient(90deg,#FF2D0A,#F5B70C)" : light ? "#D5D3CC" : "#3A3A44",
          justifyContent: checked ? "flex-end" : "flex-start",
        }}
      >
        <span className="block h-6 w-6 shrink-0 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.28)]" />
      </span>
    </button>
  );
}
