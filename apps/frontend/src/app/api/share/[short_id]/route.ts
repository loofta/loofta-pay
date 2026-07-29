'use server'

import { NextResponse } from "next/server";
import { getSharePreview } from "@/lib/sharePreview";
import { getVerifiedUserId } from "@/lib/serverAuth";

const ALLOWED_ORIGINS = [
  "https://pay.loofta.xyz",
  "https://loofta.xyz",
  ...(process.env.NODE_ENV === "development"
    ? ["http://localhost:3000", "http://localhost:3001"]
    : []),
];

/** True if neither the Origin nor Referer header point at an allowed Loofta origin. This route
 *  is called by the /share page's own client-side fetch (same-origin), so a legitimate browser
 *  load always sends one of the two — bare curl/script hits with neither get rejected. Origin is
 *  checked first since it's unambiguous; Referer is the fallback because some browsers omit
 *  Origin on same-origin GET fetches. */
function isDisallowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) return !ALLOWED_ORIGINS.includes(origin);
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return !ALLOWED_ORIGINS.includes(new URL(referer).origin);
    } catch {
      return true;
    }
  }
  return true;
}

// In-memory per-IP fixed-window limiter — a deterrent against short_id scraping, not a hard
// security boundary (each server instance keeps its own counters, so it's weaker under a
// multi-instance deploy). Good enough for this read-only public preview endpoint.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const requestCounts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = requestCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

/**
 * Public, unauthenticated preview of a payment by its short link code — backs `/share/:short_id`.
 * Mirrors `/api/twitter-payments/[short_id]` (public preview, no auth) but reads the real
 * `payments` row and resolves Loofta usernames instead of Twitter handles. Never returns the
 * recipient's email or wallet address — only what's already shown on a public share card.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ short_id: string }> },
) {
  if (isDisallowedOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { short_id } = await params;
  // Optional — an anonymous/unauthenticated viewer still gets the public preview, just with
  // is_viewer_sender/is_viewer_recipient both false.
  const viewerUserId = await getVerifiedUserId(req);
  const preview = await getSharePreview(short_id, viewerUserId);
  if (!preview) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(preview);
}
