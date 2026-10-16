import { NextResponse } from "next/server";
import { createCheckout } from "@zkp2p/pay-sdk";
import { getVerifiedUserId } from "@/lib/serverAuth";

const LOG = "[peer-pay/checkout]";

// Peer Pay ("Peer") — hosted checkout (Venmo/Cash App/Zelle/PayPal/Revolut/etc) that settles
// USDC on Base only (destinationChainId 8453; see docs.pay.peer.xyz). We never bridge that
// ourselves here — `destinationAddress` is a one-time Near Intents deposit address the client
// already obtained for (USDC on Base -> USDC on Solana), so once Peer settles funds there the
// existing Near Intents deposit pipeline (services/nearIntents.ts + BalanceModal's bridge-status
// polling) picks it up exactly like any other cross-chain top-up.

// Specific origins only — never wildcard
const ALLOWED_ORIGINS = [
  "https://pay.loofta.xyz",
  "https://loofta.xyz",
  "https://pay.loofta.com",
  "https://loofta.com",
  ...(process.env.NODE_ENV === "development"
    ? ["http://localhost:3000", "http://localhost:3001"]
    : []),
];

function corsOrigin(requestOrigin: string | null): string | null {
  if (!requestOrigin) return null;
  return ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : null;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = corsOrigin(origin);
  return {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin) };

  // 1. Authenticate — only verified Loofta users may request a checkout.
  // In development the NestJS backend may not be running, so skip the check (same as coinbase/session).
  const isDev = process.env.NODE_ENV === "development";
  let userId: string | null = null;
  if (!isDev) {
    userId = await getVerifiedUserId(request);
    if (!userId) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
  }

  // 2. Parse body
  let amountUsdc: number | undefined;
  let destinationAddress: string | undefined;
  try {
    const body = await request.json();
    amountUsdc = Number(body.amountUsdc);
    destinationAddress = body.destinationAddress;
  } catch {
    return new NextResponse(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
  }
  if (!destinationAddress || typeof destinationAddress !== "string") {
    return new NextResponse(JSON.stringify({ error: "destinationAddress is required" }), { status: 400, headers });
  }
  if (!Number.isFinite(amountUsdc) || amountUsdc! <= 0) {
    return new NextResponse(JSON.stringify({ error: "amountUsdc must be greater than 0" }), { status: 400, headers });
  }

  // 3. Validate Peer Pay credentials. PEER_PAY_LIVE must be explicitly set to "true" to use the
  // live key — absent/false always falls back to sandbox, so go-live is a deliberate opt-in
  // rather than something that happens automatically once the var exists in a deployed env.
  const isLive = process.env.PEER_PAY_LIVE === "true";
  const apiKey = isLive ? process.env.PEER_PAY_API_KEY_LIVE : process.env.PEER_PAY_API_KEY_SANDBOX;
  if (!apiKey) {
    console.error(`${LOG} Missing ${isLive ? "PEER_PAY_API_KEY_LIVE" : "PEER_PAY_API_KEY_SANDBOX"}`);
    return new NextResponse(JSON.stringify({ error: "Peer deposit not configured" }), { status: 503, headers });
  }

  // 4. Create the hosted checkout — settles USDC on Base (8453) to destinationAddress
  try {
    const appOrigin = origin && corsOrigin(origin) ? origin : (process.env.NEXT_PUBLIC_APP_URL || "https://pay.loofta.com");
    const result = await createCheckout(
      {
        requestedUsdcAmount: amountUsdc!.toFixed(2),
        destinationChainId: 8453,
        destinationToken: "USDC",
        destinationAddress,
        successUrl: `${appOrigin}/app`,
        cancelUrl: `${appOrigin}/app`,
        notes: userId ? { customerId: userId } : null,
      },
      {
        apiBaseUrl: "https://api.pay.peer.xyz",
        checkoutBaseUrl: "https://pay.peer.xyz",
        apiKey,
      },
    );

    return new NextResponse(JSON.stringify({ checkoutUrl: result.checkoutUrl, orderId: result.order.id }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} Error:`, msg);
    // Per-order destinationAddress ("recipient override") is a gated Peer Pay capability, off by
    // default — this whole flow depends on it (a fresh Near Intents bridge address per checkout),
    // so until Peer's team enables it for this merchant, every order will fail exactly this way.
    if (/recipient override/i.test(msg)) {
      return new NextResponse(JSON.stringify({ error: "Peer deposit isn't available yet — recipient overrides aren't enabled for this merchant account." }), { status: 503, headers });
    }
    return new NextResponse(JSON.stringify({ error: "Failed to create Peer checkout" }), { status: 502, headers });
  }
}
