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

// Fee-payer signing is real money moving out of our wallet — restrict it to requests that
// actually came from our own site, not just anyone holding a valid Privy access token (which,
// unlike the internal secret, the token's own owner obviously has). A stolen/self-issued token
// plus a direct script call to this route would otherwise pass the auth check above just fine.
const ALLOWED_ORIGINS = (
  process.env.NODE_ENV === "production"
    ? ["https://pay.loofta.xyz", "https://loofta.xyz", "https://pay.loofta.com", "https://loofta.com"]
    : ["https://pay.loofta.xyz", "https://loofta.xyz", "https://pay.loofta.com", "https://loofta.com", "http://localhost:3000"]
);

/**
 * Origin/Referer are just headers — any non-browser script (curl, a Node fetch, a stolen-token
 * replay) can set them to whatever string it wants, so on their own they're closer to "polite
 * hint" than a real control. Sec-Fetch-Site is the actually strong signal: it's stamped by the
 * browser's own networking stack based on the real page the request came from, and page-level
 * JavaScript cannot set or override it — a script running outside a real pay.loofta.xyz tab has
 * no way to make this header say "same-origin". Checked first and treated as authoritative when
 * present; Origin/Referer remain as a fallback only for the shrinking set of browsers/requests
 * that omit it, not as the primary gate.
 */
function isAllowedRequest(req: NextRequest): { allowed: boolean; via: string } {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite) {
    // "same-origin": page and request share an origin. "none": the browser typed the URL /
    // opened it directly (e.g. a bookmark) — not something a fee-payer-signing fetch() call
    // does. Anything else (cross-site, same-site) means some other origin initiated this.
    return { allowed: secFetchSite === "same-origin", via: `sec-fetch-site=${secFetchSite}` };
  }
  const origin = req.headers.get("origin");
  if (origin) return { allowed: ALLOWED_ORIGINS.includes(origin), via: `origin=${origin}` };
  const referer = req.headers.get("referer");
  if (referer) {
    return { allowed: ALLOWED_ORIGINS.some((o) => referer.startsWith(o)), via: `referer=${referer}` };
  }
  return { allowed: false, via: "no origin signal present" };
}

export async function POST(req: NextRequest) {
  if (!INTERNAL_SECRET) {
    console.error("[solana-sign-broadcast] LOOFTA_INTERNAL_SECRET is not configured");
    return NextResponse.json({ error: "Service configuration error" }, { status: 503 });
  }

  const { allowed, via } = isAllowedRequest(req);
  if (!allowed) {
    console.warn(`[solana-sign-broadcast] blocked — ${via}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
