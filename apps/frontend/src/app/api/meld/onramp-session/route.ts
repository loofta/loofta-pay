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

  let body: { walletAddress?: string; amount?: number; countryCode?: string; redirectUrl?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const walletAddress = String(body.walletAddress || "").trim();
  if (!walletAddress) return json({ error: "walletAddress is required" }, 400);
  // Only ever deliver to a wallet that Privy says belongs to this user
  const ownWallets = await getVerifiedSolanaWallets(userId);
  if (!ownWallets.includes(walletAddress)) return json({ error: "That wallet isn't on your account." }, 403);

  const amount = Number(body.amount) > 0 ? Number(body.amount) : undefined;
  const countryCode = typeof body.countryCode === "string" && /^[A-Za-z]{2}$/.test(body.countryCode) ? body.countryCode.toUpperCase() : "US";
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
    const best = [...(quoteData?.quotes ?? [])].sort((a, b) => b.destinationAmount - a.destinationAmount)[0];
    if (!quoteRes.ok || !best) {
      console.error(`${LOG} No Meld quote ${quoteRes.status}:`, JSON.stringify(quoteData));
      return json({ error: "Card deposits aren't available for this amount or country yet." }, 502);
    }

    const externalSessionId = `dep_${randomUUID()}`;
    const res = await fetch(`${MELD_API_BASE}/crypto/session/widget`, {
      method: "POST",
      headers: meldHeaders,
      body: JSON.stringify({
        sessionType: "BUY",
        externalCustomerId: userId,
        externalSessionId,
        sessionData: {
          countryCode,
          serviceProvider: best.serviceProvider,
          sourceCurrencyCode: "USD",
          destinationCurrencyCode: "USDC_SOLANA",
          walletAddress,
          ...(clientIpAddress ? { clientIpAddress } : {}),
          ...(amount ? { sourceAmount: String(amount) } : {}),
          ...(redirectUrl ? { redirectUrl } : {}),
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`${LOG} Meld API ${res.status}:`, text);
      return json({ error: "Couldn't start the card deposit.", detail: process.env.NODE_ENV === "development" ? text : undefined }, 502);
    }
    const data = await res.json() as { widgetUrl?: string };
    if (!data.widgetUrl) return json({ error: "Meld returned no checkout link." }, 502);

    const { error: insertError } = await getSupabaseAdmin().from("user_deposits").insert({
      user_id: userId,
      type: "card-onramp",
      status: "pending",
      amount_usdc: null,
      deposit_address: walletAddress,
      provider_order_id: externalSessionId,
    });
    if (insertError) console.error(`${LOG} deposit row failed (history will miss this one):`, insertError.message);

    return json({ widgetUrl: data.widgetUrl });
  } catch (err) {
    console.error(`${LOG} Error:`, err instanceof Error ? err.message : String(err));
    return json({ error: "Internal error" }, 500);
  }
}
