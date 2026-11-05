import { NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";

const LOG = "[meld/offramp-session]";

// Production keys only work on api.meld.io, sandbox keys only on api-sb.meld.io
const MELD_API_BASE = process.env.MELD_API_BASE || "https://api.meld.io";

const ALLOWED_ORIGINS = [
  "https://pay.loofta.xyz",
  "https://loofta.xyz",
  "https://pay.loofta.com",
  "https://loofta.com",
  ...(process.env.NODE_ENV === "development"
    ? ["http://localhost:3000", "http://localhost:3001"]
    : []),
];

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
  let countryCode = "US";
  let redirectUrl: string | undefined;
  try {
    const body = await request.json();
    walletAddress = body.walletAddress;
    amount = Number(body.amount) > 0 ? Number(body.amount) : undefined;
    if (typeof body.countryCode === "string" && /^[A-Za-z]{2}$/.test(body.countryCode)) countryCode = body.countryCode.toUpperCase();
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
    // Meld needs a serviceProvider: take the one paying the user the most fiat
    const quoteRes = await fetch(`${MELD_API_BASE}/payments/crypto/quote`, {
      method: "POST",
      headers: meldHeaders,
      body: JSON.stringify({
        countryCode,
        sourceCurrencyCode: "USDC_SOLANA",
        sourceAmount: String(amount ?? 20),
        destinationCurrencyCode: "USD",
      }),
    });
    const quoteData = await quoteRes.json().catch(() => null) as { quotes?: { serviceProvider: string; destinationAmount: number }[] } | null;
    const best = [...(quoteData?.quotes ?? [])].sort((a, b) => b.destinationAmount - a.destinationAmount)[0];
    if (!quoteRes.ok || !best) {
      console.error(`${LOG} No Meld quote ${quoteRes.status}:`, JSON.stringify(quoteData));
      return new NextResponse(JSON.stringify({ error: "Cash-out isn't available for this amount or country yet." }), { status: 502, headers });
    }

    const res = await fetch(`${MELD_API_BASE}/crypto/session/widget`, {
      method: "POST",
      headers: meldHeaders,
      body: JSON.stringify({
        sessionType: "SELL",
        externalCustomerId: userId ?? "dev-user",
        sessionData: {
          countryCode,
          serviceProvider: best.serviceProvider,
          sourceCurrencyCode: "USDC_SOLANA",
          destinationCurrencyCode: "USD",
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
      const detail = process.env.NODE_ENV === "development" ? text : undefined;
      return new NextResponse(JSON.stringify({ error: "Failed to create Meld session", detail }), { status: 502, headers });
    }

    const data = await res.json() as { widgetUrl?: string };
    if (!data.widgetUrl) {
      return new NextResponse(JSON.stringify({ error: "Meld returned no widget URL" }), { status: 502, headers });
    }
    return new NextResponse(JSON.stringify({ widgetUrl: data.widgetUrl }), { status: 200, headers });
  } catch (err: unknown) {
    console.error(`${LOG} Error:`, err instanceof Error ? err.message : String(err));
    return new NextResponse(JSON.stringify({ error: "Internal error" }), { status: 500, headers });
  }
}
