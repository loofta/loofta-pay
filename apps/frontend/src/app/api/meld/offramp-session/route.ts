import { NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { MELD_SELL_COUNTRIES } from "@/lib/meldOfframp";

const LOG = "[meld/offramp-session]";

// Production keys only work on api.meld.io, sandbox keys only on api-sb.meld.io
const MELD_API_BASE = process.env.MELD_API_BASE || "https://api.meld.io";

// Providers that support Meld's redirect flow (user confirms the quote in the widget, then returns to
// Loofta so we send the USDC for them). Others make the user copy a deposit address by hand.
const REDIRECT_FLOW_PROVIDERS = new Set(["BANXA", "TRANSAK", "ALCHEMYPAY", "UNLIMIT"]);

const ALLOWED_ORIGINS = [
  "https://pay.loofta.xyz",
  "https://loofta.xyz",
  "https://pay.loofta.com",
  "https://loofta.com",
  ...(process.env.NODE_ENV === "development"
    ? ["http://localhost:3000", "http://localhost:3001"]
    : []),
];

/** Meld says the exact minimum when an amount is too low ("below the minimum allowed, which is 5.00 USD"); pass that on. */
function tooLow(quoteData: unknown): string | null {
  const q = quoteData as { code?: string; message?: string } | null;
  const min = q?.message?.match(/minimum[^0-9]*([0-9.]+)\s*(USD|USDC)/i);
  return q?.code?.startsWith("INVALID_AMOUNT") && min ? `The minimum is ${Number(min[1])} ${min[2].toUpperCase()}. Enter a bit more.` : null;
}

/** Meld's own error code from a failed response body (e.g. "INVALID_PARAMETER"); safe to show, carries no secrets. */
function meldReason(body: string, status: number): string {
  try { const j = JSON.parse(body) as { code?: string }; if (j.code) return `${status} ${j.code}`; } catch { /* not JSON */ }
  return String(status);
}

/** The caller's country from Vercel's edge geolocation; the client never sends one, so "US" was applied to everyone. */
function requestCountry(request: Request): string {
  const c = request.headers.get("x-vercel-ip-country");
  return c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : "US";
}

/** Currencies to try for a payout: the country's own first (Meld's default for it), then dollars and euros. */
async function payoutCurrencies(country: string, headers: Record<string, string>): Promise<string[]> {
  let local: string | undefined;
  try {
    const res = await fetch(`${MELD_API_BASE}/service-providers/properties/defaults/by-country?countries=${country}`, { headers, cache: "no-store" });
    if (res.ok) local = ((await res.json()) as { defaultCurrencyCode?: string }[])[0]?.defaultCurrencyCode;
  } catch { /* fall back to dollars and euros */ }
  return [...new Set([local, "USD", "EUR"].filter((c): c is string => !!c))];
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    ...(origin && ALLOWED_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

// GET: does bank cash-out exist where this caller is? Lets the sheet hide the row instead of failing on click.
export async function GET(request: Request) {
  const country = requestCountry(request);
  return NextResponse.json({ country, supported: MELD_SELL_COUNTRIES.has(country) }, { headers: { "Cache-Control": "no-store" } });
}

// POST: create a Meld widget session to sell USDC (Solana) for fiat
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin) };

  const userId = await getVerifiedUserId(request);
  if (!userId && process.env.NODE_ENV !== "development") {
    return new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  let walletAddress: string | undefined;
  let amount: number | undefined;
  let countryCode = requestCountry(request);
  let redirectUrl: string | undefined;
  let chosenProvider: string | undefined;
  let chosenCurrency: string | undefined;
  try {
    const body = await request.json();
    walletAddress = body.walletAddress;
    amount = Number(body.amount) > 0 ? Number(body.amount) : undefined;
    if (typeof body.countryCode === "string" && /^[A-Za-z]{2}$/.test(body.countryCode)) countryCode = body.countryCode.toUpperCase();
    if (typeof body.serviceProvider === "string" && /^[A-Z_]{2,30}$/.test(body.serviceProvider)) chosenProvider = body.serviceProvider;
    if (typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)) chosenCurrency = body.currency;
    if (typeof body.redirectUrl === "string" && ALLOWED_ORIGINS.some((o) => body.redirectUrl.startsWith(`${o}/`) || body.redirectUrl === o)) {
      redirectUrl = body.redirectUrl;
    }
  } catch {
    return new NextResponse(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
  }
  if (!walletAddress) {
    return new NextResponse(JSON.stringify({ error: "walletAddress is required" }), { status: 400, headers });
  }

  const apiKey = process.env.MELD_API_KEY;
  if (!apiKey) {
    console.error(`${LOG} Missing MELD_API_KEY`);
    return new NextResponse(JSON.stringify({ error: "Offramp not configured" }), { status: 503, headers });
  }

  // Some providers (Transak) require the end user's IP
  const clientIpAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || (process.env.NODE_ENV === "development" ? "8.8.8.8" : undefined);

  const meldHeaders = {
    "Content-Type": "application/json",
    Authorization: `BASIC ${apiKey}`,
    "Meld-Version": "2026-05-01",
  };

  try {
    // Meld needs a serviceProvider and a payout currency: try the user's own currency first, then dollars and euros
    let quotes: { serviceProvider: string; destinationAmount: number }[] = [];
    let payoutCurrency = "USD";
    let quoteStatus = 0;
    let quoteData: unknown = null;
    for (const currency of [...new Set([chosenCurrency, ...(await payoutCurrencies(countryCode, meldHeaders))].filter((c): c is string => !!c))]) {
      const quoteRes = await fetch(`${MELD_API_BASE}/payments/crypto/quote`, {
        method: "POST",
        headers: meldHeaders,
        body: JSON.stringify({
          countryCode,
          sourceCurrencyCode: "USDC_SOLANA",
          sourceAmount: String(amount ?? 20),
          destinationCurrencyCode: currency,
        }),
      });
      quoteStatus = quoteRes.status;
      quoteData = await quoteRes.json().catch(() => null);
      quotes = [...((quoteData as { quotes?: typeof quotes } | null)?.quotes ?? [])].sort((a, b) => b.destinationAmount - a.destinationAmount);
      if (quoteRes.ok && quotes.length) { payoutCurrency = currency; break; }
    }
    if (!quotes.length) {
      console.error(`${LOG} No Meld quote ${quoteStatus} for ${countryCode} (base ${MELD_API_BASE}):`, JSON.stringify(quoteData));
      return new NextResponse(JSON.stringify({ error: tooLow(quoteData) ?? `Bank cash-out isn't available in your country yet (ref quote ${quoteStatus}).` }), { status: 502, headers });
    }
    // Providers with the redirect flow first (best quote within each group); fall through if one refuses the session
    const preferFirst = <T extends { serviceProvider: string }>(list: T[]) => [...list].sort((a, b) => Number(b.serviceProvider === chosenProvider) - Number(a.serviceProvider === chosenProvider));
    const ordered = preferFirst([...quotes.filter((q) => REDIRECT_FLOW_PROVIDERS.has(q.serviceProvider)), ...quotes.filter((q) => !REDIRECT_FLOW_PROVIDERS.has(q.serviceProvider))]);

    let data: { id?: string; widgetUrl?: string } | null = null;
    let lastFailure = "";
    for (const quote of ordered) {
      const res = await fetch(`${MELD_API_BASE}/crypto/session/widget`, {
        method: "POST",
        headers: meldHeaders,
        body: JSON.stringify({
          sessionType: "SELL",
          externalCustomerId: userId ?? "dev-user",
          sessionData: {
            countryCode,
            serviceProvider: quote.serviceProvider,
            sourceCurrencyCode: "USDC_SOLANA",
            destinationCurrencyCode: payoutCurrency,
            walletAddress,
            ...(clientIpAddress ? { clientIpAddress } : {}),
            // Meld rejects a sell session with no amount; same default as the quote above
            sourceAmount: String(amount ?? 20),
            redirectFlow: true,
            ...(redirectUrl ? { redirectUrl } : {}),
          },
        }),
      });
      if (res.ok) { data = await res.json() as { id?: string; widgetUrl?: string }; if (data.widgetUrl) break; continue; }
      const text = await res.text();
      lastFailure = meldReason(text, res.status);
      console.error(`${LOG} ${quote.serviceProvider} refused ${res.status} (base ${MELD_API_BASE}):`, text);
    }
    if (!data?.widgetUrl) {
      return new NextResponse(JSON.stringify({ error: `Couldn't start the cash-out${lastFailure ? ` (ref ${lastFailure})` : ""}. Try a different amount.` }), { status: 502, headers });
    }
    return new NextResponse(JSON.stringify({ widgetUrl: data.widgetUrl, sessionId: data.id }), { status: 200, headers });
  } catch (err: unknown) {
    console.error(`${LOG} Error:`, err instanceof Error ? err.message : String(err));
    return new NextResponse(JSON.stringify({ error: "Internal error" }), { status: 500, headers });
  }
}
