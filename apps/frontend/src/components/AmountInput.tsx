"use client";

import { useEffect, useRef, useState } from "react";
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
}

/** Same sanitize logic as the send page's amount field (apps/frontend/src/app/app/page.tsx) —
 * keeps digits and a single decimal point, capped at maxDecimals. */
function sanitizeAmount(raw: string, maxDecimals: number): string {
  let s = String(raw || "").replace(/,/g, ".");
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

function computeFontPx(chars: number) {
  const maxPx = 36;
  const minPx = 18;
  const startChars = 6;
  const stepPerChar = 3;
  const delta = Math.max(0, chars - startChars) * stepPerChar;
  return Math.max(minPx, maxPx - delta);
}

/**
 * Big auto-sizing amount field — same visual language as the send page's amount input
 * (apps/frontend/src/app/app/page.tsx), scaled down for use inside BalanceModal.
 */
export function AmountInput({
  value, onChange, dark, prefix, suffix, placeholder = "0", maxDecimals = 6,
  disabled, autoFocus, className, id, ...rest
}: AmountInputProps) {
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const [inputWidthPx, setInputWidthPx] = useState(0);

  const displayValue = value && value.length > 0 ? value : placeholder;
  const charCount = displayValue.replace(/[^0-9.]/g, "").length || 1;
  const fontPx = computeFontPx(charCount);
  const affixFontPx = Math.max(13, Math.round(fontPx * 0.55));
  const gapPx = 6;

  useEffect(() => {
    const el = mirrorRef.current;
    if (!el) return;
    setInputWidthPx(Math.ceil(el.getBoundingClientRect().width));
  }, [displayValue, fontPx]);

  return (
    <div className={cn("flex items-baseline tabular-nums", className)}>
      {prefix && (
        <span
          className={cn("font-semibold mr-1", dark ? "text-slate-500" : "text-gray-400")}
          style={{ fontSize: `${affixFontPx}px`, lineHeight: 1.05 }}
        >
          {prefix}
        </span>
      )}
      <span
        ref={mirrorRef}
        aria-hidden="true"
        className="invisible absolute -z-50 font-medium tracking-tight tabular-nums"
        style={{ fontSize: `${fontPx}px`, lineHeight: 1.05 }}
      >
        {displayValue}
      </span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onBeforeInput={(e) => {
          const data = (e.nativeEvent as InputEvent).data;
          if (data && /[^0-9.,]/.test(data)) e.preventDefault();
        }}
        onChange={(e) => onChange(sanitizeAmount(e.target.value, maxDecimals))}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className={cn(
          "font-semibold tracking-tight tabular-nums border-0 bg-transparent outline-none p-0 m-0 disabled:opacity-50",
          dark ? "text-white placeholder:text-slate-600" : "text-gray-900 placeholder:text-gray-300"
        )}
        style={{
          fontSize: `${fontPx}px`,
          lineHeight: 1.05,
          width: `${Math.max(inputWidthPx, Math.round(fontPx * 0.6)) + gapPx}px`,
        }}
        {...rest}
      />
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
