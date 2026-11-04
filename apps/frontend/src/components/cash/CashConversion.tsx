"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPeerCurrency, getPlatform, platformPayoutCurrency } from "@/lib/peerPlatforms";

type RateEntry = { rate: number; at: number };
const RATE_TTL_MS = 60_000;
const rateCache = new Map<string, RateEntry>();

/** Currencies offered in the "check conversion" switch when the platform itself pays out in USD. */
const CHECK_CURRENCIES = ["EUR", "GBP", "INR", "CAD", "AUD", "MXN", "CHF", "SGD", "ZAR", "TRY"] as const;
const SWITCH_KEY = "loofta.cashConversion.v1";

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹", CAD: "CA$", AUD: "A$", MXN: "MX$", CHF: "CHF ", SGD: "S$", ZAR: "R", TRY: "₺" };

export function formatLocalAmount(amount: number, currency: string): string {
  const symbol = getPeerCurrency(currency)?.symbol ?? SYMBOLS[currency] ?? "";
  const text = amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol || ""}${text}${symbol ? "" : ` ${currency}`}`;
}

/**
 * Live oracle rate (units of `currency` per 1 USD) from Peer Cash. The rate is zero-spread and
 * independent of size, so it is looked up on a fixed $100 and cached for a minute.
 */
export function useCashRate(currency: string, platformProcessor?: string, enabled = true) {
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !currency) { setRate(null); return; }
    if (currency === "USD") { setRate(1); return; }
    const key = `${platformProcessor ?? ""}:${currency}`;
    const hit = rateCache.get(key);
    if (hit && Date.now() - hit.at < RATE_TTL_MS) { setRate(hit.rate); return; }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { getPeerEstimate, usdc } = await import("@/services/peerCash");
        const est = await getPeerEstimate(usdc(100), currency, platformProcessor, false);
        if (cancelled) return;
        rateCache.set(key, { rate: est.rate, at: Date.now() });
        setRate(est.rate);
      } catch {
        if (!cancelled) setRate(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currency, platformProcessor, enabled]);

  return { rate, loading };
}

function readSaved(): { on: boolean; currency: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(SWITCH_KEY) || "{}");
    return {
      on: raw?.on === true,
      currency: CHECK_CURRENCIES.includes(raw?.currency) ? raw.currency : "EUR",
    };
  } catch {
    return { on: false, currency: "EUR" };
  }
}

/**
 * What the recipient gets in local money. Platforms that pay out in a non-USD currency (Monzo GBP,
 * UPI INR) always show it. For USD platforms there is a switch to check the conversion to any currency.
 */
export function CashConversion({
  platformId,
  amountUsd,
  dark = true,
  className = "",
}: {
  platformId: string;
  /** What the recipient receives, in USD. */
  amountUsd: number;
  dark?: boolean;
  className?: string;
}) {
  const platform = getPlatform(platformId);
  const payoutCurrency = platformPayoutCurrency(platformId);
  const fixed = payoutCurrency !== "USD";

  const [on, setOn] = useState(false);
  const [checkCurrency, setCheckCurrency] = useState("EUR");
  useEffect(() => {
    const saved = readSaved();
    setOn(saved.on);
    setCheckCurrency(saved.currency);
  }, []);
  const persist = (next: { on: boolean; currency: string }) => {
    try { localStorage.setItem(SWITCH_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  const currency = fixed ? payoutCurrency : checkCurrency;
  const active = fixed || on;
  const { rate, loading } = useCashRate(currency, fixed ? platform?.processorName : undefined, active);

  const muted = dark ? "text-[#9A98A3]" : "text-gray-500";
  const strong = dark ? "text-[#F2EFE8]" : "text-gray-900";
  const box = dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white";

  const result = active && amountUsd > 0 ? (
    loading || rate == null ? (
      <span className={`flex items-center gap-1.5 text-base ${muted}`}>
        {loading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Fetching rate…</> : "Rate unavailable"}
      </span>
    ) : (
      <span className={`text-base font-semibold ${strong}`}>
        {fixed ? "" : "≈ "}{formatLocalAmount(amountUsd * rate, currency)}
      </span>
    )
  ) : null;

  const link = dark ? "text-[#9A98A3] hover:text-[#F2EFE8]" : "text-gray-500 hover:text-gray-900";

  if (!fixed && !on) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => { setOn(true); persist({ on: true, currency: checkCurrency }); }}
          className={`text-base underline underline-offset-4 decoration-dotted transition-colors ${link}`}
        >
          Check conversion
        </button>
      </div>
    );
  }

  const rateText = rate != null
    ? `1 USD = ${rate.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${currency} at today's market rate.${fixed ? "" : ` ${platform?.name ?? "This app"} pays out in USD, this is for reference.`}`
    : null;

  return (
    <div className={`rounded-2xl border px-4 py-3 space-y-2 ${box} ${className}`}>
      {fixed ? (
        <div className="flex items-center justify-between gap-3">
          <span className={`text-base ${muted}`}>They receive in {currency}</span>
          {result ?? <span className={`text-base ${muted}`}>Enter an amount</span>}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`text-base ${muted}`}>In</span>
            <Select
              value={checkCurrency}
              onValueChange={(v) => { setCheckCurrency(v); persist({ on, currency: v }); }}
            >
              <SelectTrigger
                aria-label="Currency to compare"
                className={`h-8 w-auto gap-1.5 px-2.5 text-base font-medium ${dark ? "border-white/10 bg-white/[0.03] text-slate-100" : "border-gray-300 bg-white text-gray-900"}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={`z-[100] ${dark ? "border-white/10 bg-[#1a1a1f] text-slate-100" : ""}`}>
                {CHECK_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c} className={dark ? "focus:bg-white/10 focus:text-slate-100" : ""}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {result ?? <span className={`text-base ${muted}`}>Enter an amount</span>}
        </div>
      )}
      {rateText && <p className={`text-base ${muted}`}>{rateText}</p>}
      {!fixed && (
        <button
          type="button"
          onClick={() => { setOn(false); persist({ on: false, currency: checkCurrency }); }}
          className={`text-base underline underline-offset-4 decoration-dotted transition-colors ${link}`}
        >
          Hide
        </button>
      )}
    </div>
  );
}
