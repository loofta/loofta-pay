/**
 * BFF proxy for Solana sign-and-broadcast.
 *
 * The browser calls this Next.js route (same origin = no CORS issues).
 * We verify the Privy JWT here, then forward to the backend with
 * X-Loofta-Internal so the backend knows the request came through our server —
 * not from an attacker hitting the backend URL directly.
 *
 * LOOFTA_INTERNAL_SECRET must be the same value in both Railway services.
 * Generate with: openssl rand -hex 32
 */

import { NextRequest, NextResponse } from "next/server";
import { getVerifiedUserId } from "@/lib/serverAuth";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:3001";

const INTERNAL_SECRET = process.env.LOOFTA_INTERNAL_SECRET;

export async function POST(req: NextRequest) {
  if (!INTERNAL_SECRET) {
    console.error("[solana-sign-broadcast] LOOFTA_INTERNAL_SECRET is not configured");
    return NextResponse.json({ error: "Service configuration error" }, { status: 503 });
  }

  const userId = await getVerifiedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const authHeader = req.headers.get("Authorization") ?? "";

  let backendRes: Response;
  try {
    backendRes = await fetch(
      `${BACKEND_URL}/claims/solana-sponsor/sign-and-broadcast`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader,
          "X-Loofta-Internal": INTERNAL_SECRET,
        },
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    console.error("[solana-sign-broadcast] backend fetch failed:", err);
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }

  const data = await backendRes.json().catch(() => ({}));
  return NextResponse.json(data, { status: backendRes.status });
}
