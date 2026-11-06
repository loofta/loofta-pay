import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getVerifiedSolanaWallets, getVerifiedUserId } from "@/lib/serverAuth";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

const LOG = "[meld/onramp-session]";
const MELD_API_BASE = process.env.MELD_API_BASE || "https://api.meld.io";

const ALLOWED_ORIGINS = [
  "https://pay.loofta.xyz",
  "https://loofta.xyz",
  "https://pay.loofta.com",
  "https://loofta.com",
  ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000", "http://localhost:3001"] : []),
];

/** Meld says the exact minimum when an amount is too low ("below the minimum allowed, which is 5.00 USD"); pass that on. */
function tooLow(quoteData: unknown): string | null {
  const q = quoteData as { code?: string; message?: string } | null;
  const min = q?.message?.match(/minimum[^0-9]*([0-9.]+)\s*(USD|USDC)/i);
  return q?.code?.startsWith("INVALID_AMOUNT") && min ? `The minimum is ${Number(min[1])} ${min[2].toUpperCase()}. Enter a bit more.` : null;
}

/** The caller's country from Vercel's edge geolocation; the client never sends one, so "US" was applied to everyone. */
function requestCountry(request: Request): string {
  const c = request.headers.get("x-vercel-ip-country");
  return c && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : "US";
}

/** Meld's own error code from a failed response body (e.g. "INVALID_PARAMETER"); safe to show, carries no secrets. */
function meldReason(body: string, status: number): string {
  try { const j = JSON.parse(body) as { code?: string }; if (j.code) return `${status} ${j.code}`; } catch { /* not JSON */ }
  return String(status);
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST { walletAddress, amount?, countryCode?, redirectUrl? } — create a Meld card / Apple Pay buy session that
 * delivers USDC on Solana to the caller's own wallet. The deposit row is written here, keyed by our own
 * externalSessionId, so the Meld webhook can mark it complete and history shows it from the first minute.
 */
export async function POST(request: Request) {
  const userId = await getVerifiedUserId(request);
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const apiKey = process.env.MELD_API_KEY;
  if (!apiKey) return json({ error: "Card deposits aren't configured." }, 503);

  let body: { walletAddress?: string; amount?: number; countryCode?: string; redirectUrl?: string; serviceProvider?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const walletAddress = String(body.walletAddress || "").trim();
  if (!walletAddress) return json({ error: "walletAddress is required" }, 400);
  // Only ever deliver to a wallet that Privy says belongs to this user
  const ownWallets = await getVerifiedSolanaWallets(userId);
  if (!ownWallets.includes(walletAddress)) return json({ error: "That wallet isn't on your account." }, 403);

  const amount = Number(body.amount) > 0 ? Number(body.amount) : undefined;
  const countryCode = typeof body.countryCode === "string" && /^[A-Za-z]{2}$/.test(body.countryCode) ? body.countryCode.toUpperCase() : requestCountry(request);
  const origin = request.headers.get("origin");
  const redirectUrl = typeof body.redirectUrl === "string" && ALLOWED_ORIGINS.some((o) => body.redirectUrl!.startsWith(`${o}/`) || body.redirectUrl === o)
    ? body.redirectUrl
    : origin && ALLOWED_ORIGINS.includes(origin) ? `${origin}/` : undefined;

  const clientIpAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || (process.env.NODE_ENV === "development" ? "8.8.8.8" : undefined);

  const meldHeaders = {
    "Content-Type": "application/json",
    Authorization: `BASIC ${apiKey}`,
    "Meld-Version": "2026-05-01",
  };

  try {
    // Pick the provider that delivers the most USDC for the amount
    const quoteRes = await fetch(`${MELD_API_BASE}/payments/crypto/quote`, {
      method: "POST",
      headers: meldHeaders,
      body: JSON.stringify({
        countryCode,
        sourceCurrencyCode: "USD",
        sourceAmount: String(amount ?? 50),
        destinationCurrencyCode: "USDC_SOLANA",
      }),
    });
    const quoteData = await quoteRes.json().catch(() => null) as { quotes?: { serviceProvider: string; destinationAmount: number }[] } | null;
    const ranked = [...(quoteData?.quotes ?? [])].sort((a, b) => b.destinationAmount - a.destinationAmount);
    // The user picked an option on the quote screen: try that provider first, the rest only as a fallback
    if (body.serviceProvider) ranked.sort((a, b) => Number(b.serviceProvider === body.serviceProvider) - Number(a.serviceProvider === body.serviceProvider));
    if (!quoteRes.ok || !ranked.length) {
      console.error(`${LOG} No Meld quote ${quoteRes.status} (base ${MELD_API_BASE}):`, JSON.stringify(quoteData));
      return json({ error: tooLow(quoteData) ?? `Card deposits aren't available for this amount or country yet (ref quote ${quoteRes.status}).` }, 502);
    }

    // Best quote first; if a provider refuses the session (limits, country, KYC rules) fall through to the next
    const externalSessionId = `dep_${randomUUID()}`;
    let widgetUrl: string | undefined;
    let lastFailure = "";
    for (const quote of ranked) {
      const res = await fetch(`${MELD_API_BASE}/crypto/session/widget`, {
        method: "POST",
        headers: meldHeaders,
        body: JSON.stringify({
          sessionType: "BUY",
          externalCustomerId: userId,
          externalSessionId,
          sessionData: {
            countryCode,
            serviceProvider: quote.serviceProvider,
            sourceCurrencyCode: "USD",
            destinationCurrencyCode: "USDC_SOLANA",
            walletAddress,
            ...(clientIpAddress ? { clientIpAddress } : {}),
            // Meld rejects a session with no amount; 50 matches the quote above and the user can change it in checkout
            sourceAmount: String(amount ?? 50),
            ...(redirectUrl ? { redirectUrl } : {}),
          },
        }),
      });
      if (res.ok) {
        widgetUrl = ((await res.json()) as { widgetUrl?: string }).widgetUrl;
        if (widgetUrl) break;
        continue;
      }
      const text = await res.text();
      lastFailure = meldReason(text, res.status);
      console.error(`${LOG} ${quote.serviceProvider} refused ${res.status} (base ${MELD_API_BASE}):`, text);
    }
    if (!widgetUrl) {
      return json({ error: `Couldn't start the card deposit${lastFailure ? ` (ref ${lastFailure})` : ""}.` }, 502);
    }

    const { error: insertError } = await getSupabaseAdmin().from("user_deposits").insert({
      user_id: userId,
      type: "card-onramp",
      status: "pending",
      amount_usdc: null,
      deposit_address: walletAddress,
      provider_order_id: externalSessionId,
    });
    if (insertError) console.error(`${LOG} deposit row failed (history will miss this one):`, insertError.message);

    return json({ widgetUrl });
  } catch (err) {
    console.error(`${LOG} Error:`, err instanceof Error ? err.message : String(err));
    return json({ error: "Internal error" }, 500);
  }
}
