"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface AmountInputProps {
  value: string;
  onChange: (raw: string) => void;
  dark: boolean;
  /** Rendered before the number, e.g. "$" or "₦". */
  prefix?: string;
  /** Rendered after the number, e.g. "USDC". */
  suffix?: string;
  placeholder?: string;
  maxDecimals?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  /** Font-size range the field scales between as digits are added. Defaults suit BalanceModal;
   *  hero-sized fields (e.g. the /fomo pay card) pass larger values. */
  maxFontPx?: number;
  minFontPx?: number;
  /** Digit count at which the font is still `maxFontPx`. Each digit past this shrinks by `shrinkStepPx`. */
  shrinkStartChars?: number;
  shrinkStepPx?: number;
}

/** Digits only when maxDecimals is 0 (fractional keystrokes are dropped, not concatenated).
 *  Otherwise keeps digits and a single decimal point, capped at maxDecimals. */
function sanitizeAmount(raw: string, maxDecimals: number): string {
  let s = String(raw || "").replace(/,/g, ".");
  if (maxDecimals <= 0) {
    return s.split(".")[0].replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  }
  s = s.replace(/[^0-9.]/g, "");
  const hadTrailingDot = s.endsWith(".");
  const parts = s.split(".");
  if (parts.length > 2) {
    s = parts[0] + "." + parts.slice(1).join("");
  }
  const p = s.split(".");
  if (p.length === 2) {
    const int = p[0] || "";
    const dec = (p[1] || "").slice(0, Math.max(0, maxDecimals));
    const result = dec.length > 0 ? `${int}.${dec}` : int;
    return hadTrailingDot && dec === "" ? `${int}.` : result;
  }
  return p[0] || "";
}

function computeFontPx(chars: number, maxPx: number, minPx: number, startChars: number, stepPerChar: number) {
  const delta = Math.max(0, chars - startChars) * stepPerChar;
  return Math.max(minPx, maxPx - delta);
}

/**
 * Big auto-sizing amount field — same visual language as the send page's amount input
 * (apps/frontend/src/app/app/page.tsx), scaled down for use inside BalanceModal.
 */
export function AmountInput({
  value, onChange, dark, prefix, suffix, placeholder = "0", maxDecimals = 6,
  disabled, autoFocus, className, id, maxFontPx = 36, minFontPx = 18,
  shrinkStartChars = 6, shrinkStepPx = 3, ...rest
}: AmountInputProps) {
  const wholeDollars = maxDecimals <= 0;
  const displayValue = value && value.length > 0 ? value : placeholder;
  const charCount = displayValue.replace(/[^0-9.]/g, "").length || 1;
  const fontPx = computeFontPx(charCount, maxFontPx, minFontPx, shrinkStartChars, shrinkStepPx);
  const affixFontPx = Math.max(13, Math.round(fontPx * 0.55));
  const textStyle = {
    fontSize: `${fontPx}px`,
    lineHeight: 1.15,
    letterSpacing: "-0.04em",
  } as const;

  useEffect(() => {
    if (!wholeDollars) return;
    const next = sanitizeAmount(value, 0);
    if (next !== value) onChange(next);
  }, [wholeDollars, value, onChange]);

  return (
    <div className={cn("flex max-w-full items-baseline tabular-nums", className)}>
      {prefix && (
        <span
          className={cn("font-semibold mr-1 shrink-0", dark ? "text-slate-500" : "text-gray-400")}
          style={{ fontSize: `${affixFontPx}px`, lineHeight: 1.15 }}
        >
          {prefix}
        </span>
      )}
      {/* Grid sizer: the hidden span sets the box to the real glyph width (same weight as the
          input). A measured pixel width was clipping the last digit — "50" rendered as "5C". */}
      <span className="inline-grid">
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 whitespace-pre font-semibold tabular-nums pr-[0.12em]"
          style={textStyle}
        >
          {displayValue}
        </span>
        <input
          id={id}
          inputMode={wholeDollars ? "numeric" : "decimal"}
          value={value}
          onBeforeInput={(e) => {
            const data = (e.nativeEvent as InputEvent).data;
            if (!data) return;
            if (wholeDollars ? /[^0-9]/.test(data) : /[^0-9.,]/.test(data)) e.preventDefault();
          }}
          onChange={(e) => onChange(sanitizeAmount(e.target.value, maxDecimals))}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className={cn(
            "col-start-1 row-start-1 w-full min-w-0 font-semibold tabular-nums border-0 bg-transparent outline-none p-0 m-0 pr-[0.12em] disabled:opacity-50",
            dark ? "text-white placeholder:text-slate-600" : "text-gray-900 placeholder:text-gray-300"
          )}
          style={textStyle}
          {...rest}
        />
      </span>
      {suffix && (
        <span
          className={cn("font-semibold ml-1.5", dark ? "text-slate-500" : "text-gray-400")}
          style={{ fontSize: `${affixFontPx}px`, lineHeight: 1.05 }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}
