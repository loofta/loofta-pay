import { NextResponse } from "next/server";
import { createPrivateKey, randomBytes, sign as cryptoSign } from "node:crypto";
import { getVerifiedUserId } from "@/lib/serverAuth";

const LOG = "[coinbase/offramp-session]";

const ALLOWED_ORIGINS = [
  "https://pay.loofta.xyz",
  "https://loofta.xyz",
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

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const ED25519_PKCS8_HEADER = Buffer.from("302e020100300506032b657004220420", "hex");

function makeCdpJwt(keyName: string, secretBase64: string, uri: string): string {
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");

  const headerB64 = base64url(Buffer.from(JSON.stringify({ alg: "EdDSA", kid: keyName, nonce })));
  const payloadB64 = base64url(Buffer.from(JSON.stringify({
    sub: keyName,
    iss: "cdp",
    nbf: now,
    exp: now + 120,
    uri,
  })));

  const signingInput = `${headerB64}.${payloadB64}`;
  const raw = Buffer.from(secretBase64, "base64");
  const seed = raw.subarray(0, 32);
  const pkcs8 = Buffer.concat([ED25519_PKCS8_HEADER, seed]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const signature = cryptoSign(null, Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

// POST — generate a Coinbase Offramp session token
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const headers = { "Content-Type": "application/json", ...corsHeaders(origin) };

  const isDev = process.env.NODE_ENV === "development";
  if (!isDev) {
    const userId = await getVerifiedUserId(request);
    if (!userId) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
  }

  let walletAddress: string | undefined;
  let blockchains: string[] = ["solana"];
  try {
    const body = await request.json();
    walletAddress = body.walletAddress;
    if (Array.isArray(body.blockchains)) blockchains = body.blockchains;
  } catch {
    return new NextResponse(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
  }

  if (!walletAddress) {
    return new NextResponse(JSON.stringify({ error: "walletAddress is required" }), { status: 400, headers });
  }

  const keyName = process.env.COINBASE_CDP_KEY_NAME;
  const apiSecret = process.env.COINBASE_CDP_API_SECRET;
  if (!keyName || !apiSecret) {
    console.error(`${LOG} Missing COINBASE_CDP_KEY_NAME or COINBASE_CDP_API_SECRET`);
    return new NextResponse(JSON.stringify({ error: "Offramp not configured" }), { status: 503, headers });
  }

  try {
    // Offramp uses the same token endpoint as onramp, but with source_wallets
    const uri = "POST api.developer.coinbase.com/onramp/v1/token";
    const cdpJwt = makeCdpJwt(keyName, apiSecret, uri);

    const coinbaseRes = await fetch("https://api.developer.coinbase.com/onramp/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cdpJwt}`,
      },
      body: JSON.stringify({
        addresses: [{ address: walletAddress, blockchains }],
      }),
    });

    if (!coinbaseRes.ok) {
      const text = await coinbaseRes.text();
      console.error(`${LOG} Coinbase API ${coinbaseRes.status}:`, text);
      const detail = process.env.NODE_ENV === "development" ? text : undefined;
      return new NextResponse(JSON.stringify({ error: "Failed to create Coinbase offramp session", detail }), {
        status: 502,
        headers,
      });
    }

    const data = await coinbaseRes.json();
    const token = data.token ?? data.session_token ?? data;
    return new NextResponse(JSON.stringify({ token }), { status: 200, headers });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG} Error:`, msg);
    return new NextResponse(JSON.stringify({ error: "Internal error" }), { status: 500, headers });
  }
}
