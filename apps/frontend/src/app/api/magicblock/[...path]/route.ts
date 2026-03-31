/**
 * Server-side proxy for MagicBlock TEE auth endpoints.
 *
 * The browser cannot call *.magicblock.app directly because those hosts either
 * have CORS policies that block browser fetch calls or are not in the app CSP.
 * This route is same-origin from the browser and runs on the Next.js server,
 * which has no such restrictions.
 *
 * Routes:
 *   GET  /api/magicblock/auth/challenge?pubkey=…  →  upstream /auth/challenge?pubkey=…
 *   POST /api/magicblock/auth/login               →  upstream /auth/login
 *   (any other path is forwarded as-is)
 *
 * Upstream is ALWAYS the TEE host (tee.magicblock.app / mainnet-tee.magicblock.app).
 * devnet.magicblock.app is JSON-RPC only and does NOT serve /auth/challenge.
 */

import { type NextRequest, NextResponse } from "next/server";

function resolveUpstreamBase(): string {
  const explicit = process.env.NEXT_PUBLIC_MAGICBLOCK_URL?.replace(/\?.*$/, "").replace(/\/$/, "").trim();
  if (explicit) return explicit;
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() ?? "";
  if (cluster === "mainnet-beta") return "https://mainnet-tee.magicblock.app";
  return "https://tee.magicblock.app";
}

async function proxyRequest(req: NextRequest, path: string[]): Promise<NextResponse> {
  const upstreamBase = resolveUpstreamBase();
  const subpath = path.join("/");
  const originalUrl = new URL(req.url);
  const upstreamUrl = new URL(`${upstreamBase}/${subpath}`);
  // Forward query parameters (e.g. ?pubkey=…).
  originalUrl.searchParams.forEach((value, key) => upstreamUrl.searchParams.set(key, value));

  const headers = new Headers();
  headers.set("Content-Type", req.headers.get("Content-Type") ?? "application/json");
  headers.set("Accept", req.headers.get("Accept") ?? "application/json");

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try { body = await req.text(); } catch { /* no body */ }
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl.toString(), {
      method: req.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `MagicBlock proxy: upstream unreachable (${upstreamUrl.origin}): ${e?.message ?? String(e)}` },
      { status: 502 },
    );
  }

  const responseBody = await upstreamRes.text();
  return new NextResponse(responseBody, {
    status: upstreamRes.status,
    headers: {
      "Content-Type": upstreamRes.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxyRequest(req, path);
}
