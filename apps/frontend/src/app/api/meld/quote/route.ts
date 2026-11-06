import { NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { MELD_SELL_COUNTRIES } from "@/lib/meldOfframp";

const LOG = "[meld/quote]";
const MELD_API_BASE = process.env.MELD_API_BASE || "https://api.meld.io";

const EURO_FALLBACK = new Set(["AT","BE","CY","DE","EE","ES","FI","FR","GR","HR","IE","IT","LT","LU","LV","MT","NL","PT","SI","SK"]);

type MeldQuote = {
  serviceProvider: string;
  destinationAmount: number;
  destinationCurrencyCode: string;
  exchangeRate?: number;
  totalFee?: number;
  paymentMethodType?: string;
};

export type QuoteOption = {
  id: string;           // provider id, sent back when the session is opened (never shown to the user)
  method?: string;      // payment method for a buy (APPLE_PAY, GOOGLE_PAY, CREDIT_DEBIT_CARD, ACH...), sent back too
  label: string;        // "Bank transfer", "Debit or credit card"
  eta: string;          // typical arrival, e.g. "about 1 business day"
  receive: number;      // fiat for a sell, USDC for a buy
  currency: string;     // fiat code of the payout (sell) or the card charge (buy)
  fee: number;          // in the fiat currency
  rate: number | null;  // fiat per 1 USDC
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function requestCountry(request: Request): string {
  const c = request.headers.get("x-vercel-ip-country");
  return c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : "US";
}

const METHOD_LABELS: Record<string, string> = {
  PAYOUT_TO_BANK: "Bank transfer",
  SEPA: "Bank transfer (SEPA)",
  SEPA_INSTANT: "Instant bank transfer (SEPA)",
  ACH: "Bank transfer (ACH)",
  BANK_TRANSFER: "Bank transfer",
  FASTER_PAYMENTS: "Bank transfer (Faster Payments)",
  CREDIT_DEBIT_CARD: "Debit or credit card",
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
  PIX: "Pix",
  UPI: "UPI",
};
function methodLabel(type: string | undefined, side: "buy" | "sell"): string {
  if (type && METHOD_LABELS[type]) return METHOD_LABELS[type];
  if (type) return type.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return side === "sell" ? "Bank transfer" : "Debit or credit card";
}

/**
 * Typical arrival time per payment rail. Meld gives no timing in quotes or provider data, so these are the usual
 * times for each rail, not a promise; a first-time verification adds a few minutes on top.
 */
function methodEta(type: string | undefined, side: "buy" | "sell"): string {
  if (side === "buy") {
    if (!type || type === "CREDIT_DEBIT_CARD" || type === "APPLE_PAY" || type === "GOOGLE_PAY") return "a few minutes";
    if (type === "ACH" || type === "SAME_DAY_ACH") return "1 to 3 business days";
    return "up to 1 business day";
  }
  if (type === "SEPA" || type === "SEPA_INSTANT") return "about 1 business day";
  if (type === "ACH") return "1 to 3 business days";
  if (type === "PAYOUT_TO_BANK") return "minutes to a few hours";
  return "1 to 2 business days";
}

async function meld<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(`${MELD_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `BASIC ${process.env.MELD_API_KEY}`,
      "Meld-Version": "2026-05-01",
    },
    cache: "no-store",
  });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => null)) as T | null };
}

/** Meld words the minimum as "below the minimum allowed, which is 5.00 USD"; pass the number on. */
function minimumFrom(data: unknown): string | null {
  const q = data as { code?: string; message?: string } | null;
  const m = q?.message?.match(/minimum[^0-9]*([0-9.]+)\s*(USD|USDC)/i);
  return q?.code?.startsWith("INVALID_AMOUNT") && m ? `The minimum is ${Number(m[1])} ${m[2].toUpperCase()}.` : null;
}

/**
 * POST { side: "buy" | "sell", amount } — every way to complete this amount, best first, so the user can pick
 * before anything opens. Buy: amount is dollars on a card, receives USDC. Sell: amount is USDC, receives local fiat.
 */
export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return json({ error: "Unauthorized" }, 401);
  if (!process.env.MELD_API_KEY) return json({ error: "Not configured" }, 503);

  let body: { side?: string; amount?: number };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const side = body.side === "sell" ? "sell" : "buy";
  const amount = Number(body.amount);
  if (!(amount > 0) || amount > 100_000) return json({ error: "Enter an amount." }, 400);

  const country = requestCountry(request);
  if (side === "sell" && !MELD_SELL_COUNTRIES.has(country)) {
    return json({ country, supported: false, options: [] });
  }

  try {
    let currencies = ["USD"];
    if (side === "sell") {
      const defaults = await meld<{ defaultCurrencyCode?: string }[]>(`/service-providers/properties/defaults/by-country?countries=${country}`);
      const local = defaults.data?.[0]?.defaultCurrencyCode ?? (EURO_FALLBACK.has(country) ? "EUR" : undefined);
      currencies = [...new Set([local, "USD", "EUR"].filter((c): c is string => !!c))];
    }

    let quotes: MeldQuote[] = [];
    let currency = currencies[0];
    let lastData: unknown = null;
    const buyMethods = ["APPLE_PAY", "GOOGLE_PAY", "CREDIT_DEBIT_CARD"];
    if (side === "buy") {
      // A quote with no method only returns each provider's default (a card or ACH), so ask for each wallet and the
      // card by name, plus the plain quote to catch bank transfer. Keep the best provider per method.
      const ask = (method?: string) => meld<{ quotes?: MeldQuote[] }>("/payments/crypto/quote", {
        method: "POST",
        body: JSON.stringify({ countryCode: country, sourceCurrencyCode: "USD", sourceAmount: String(amount), destinationCurrencyCode: "USDC_SOLANA", ...(method ? { paymentMethodType: method } : {}) }),
      });
      const results = await Promise.all([...buyMethods.map((m) => ask(m)), ask()]);
      lastData = results.find((r) => !r.ok)?.data ?? results[0].data;
      const best = new Map<string, MeldQuote>();
      for (const q of results.flatMap((r) => r.data?.quotes ?? [])) {
        const key = q.paymentMethodType ?? "CREDIT_DEBIT_CARD";
        const cur = best.get(key);
        if (!cur || q.destinationAmount > cur.destinationAmount) best.set(key, q);
      }
      quotes = [...best.values()];
    } else {
      for (const c of currencies) {
        const r = await meld<{ quotes?: MeldQuote[] }>("/payments/crypto/quote", {
          method: "POST",
          body: JSON.stringify({ countryCode: country, sourceCurrencyCode: "USDC_SOLANA", sourceAmount: String(amount), destinationCurrencyCode: c }),
        });
        lastData = r.data;
        quotes = r.data?.quotes ?? [];
        if (r.ok && quotes.length) { currency = c; break; }
      }
    }

    if (!quotes.length) {
      const min = minimumFrom(lastData);
      if (min) return json({ country, supported: true, options: [], error: min });
      console.error(`${LOG} no ${side} quotes for ${country} ${amount}:`, JSON.stringify(lastData));
      return json({ country, supported: side === "buy", options: [] });
    }

    // Providers report fees inconsistently: one lists a fee and a good rate, another lists 0 but pays a worse rate
    // (the cost is hidden in the spread). For a sell, price every option against the best gross payout seen
    // (payout + reported fee) so "fee" always means the real cost of that option, and 0 only if it truly is the best.
    const grossBest = side === "sell" ? Math.max(...quotes.map((q) => q.destinationAmount + Number(q.totalFee ?? 0))) : 0;
    const realFee = (q: MeldQuote) => side === "sell"
      ? Math.max(Number(q.totalFee ?? 0), Math.round((grossBest - q.destinationAmount) * 100) / 100)
      : Number(q.totalFee ?? 0);

    const options: QuoteOption[] = quotes
      .sort((a, b) => b.destinationAmount - a.destinationAmount)
      .map((q) => ({
        id: q.serviceProvider,
        method: side === "buy" ? (q.paymentMethodType ?? "CREDIT_DEBIT_CARD") : undefined,
        label: methodLabel(q.paymentMethodType, side),
        eta: methodEta(q.paymentMethodType, side),
        receive: q.destinationAmount,
        currency: side === "sell" ? q.destinationCurrencyCode || currency : "USD",
        fee: realFee(q),
        rate: side === "sell" ? (q.destinationAmount > 0 ? q.destinationAmount / amount : null) : null,
      }));
    return json({ country, supported: true, side, currency: side === "sell" ? currency : "USD", options });
  } catch (err) {
    console.error(`${LOG} error:`, err instanceof Error ? err.message : String(err));
    return json({ error: "Couldn't load options. Try again." }, 502);
  }
}
