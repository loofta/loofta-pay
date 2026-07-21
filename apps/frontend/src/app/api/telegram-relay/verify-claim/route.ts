import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { redisGet, redisSet } from "@/lib/redis-cache";
import { verifyTelegramAuth, type TelegramAuthPayload } from "@/lib/telegramAuth";

/** Must match ClaimsService.PENDING_SOCIAL_PREFIX (backend claims.service.ts). Format: PENDING_SOCIAL:<platform>:<handle> */
const PENDING_SOCIAL_PREFIX = "PENDING_SOCIAL:";
const VERIFIED_TTL_SECONDS = 10 * 60;

function verifiedKey(claimId: string) {
  return `telegram-relay-claim-verified:${claimId}`;
}

/**
 * Lets an unauthenticated visitor prove they own the Telegram handle a claim was sent to,
 * BEFORE they have any Loofta account to attach it to (see telegram-relay/page.tsx's
 * `claimId` mode, used from the claim page's pre-auth "Sign in with Telegram" button — unlike
 * the token-based /complete flow, which requires an existing session). Stores a short-lived,
 * claim-scoped "verified" flag rather than writing to social_accounts directly, since there's no
 * account yet to write it to; /telegram-relay/attach-verified redeems it once one exists.
 * This endpoint is reachable with NO Loofta session at all (that's the point — there's no
 * account yet), which makes verifyTelegramAuth here non-negotiable: without it, anyone could
 * POST an arbitrary handle for any claimId, get back verified:true, and later redeem someone
 * else's payment via attach-verified without ever touching Telegram.
 * POST /api/telegram-relay/verify-claim { claimId, telegramAuth: TelegramAuthPayload }
 */
export async function POST(request: NextRequest) {
  try {
    const { claimId, telegramAuth } = (await request.json()) as { claimId?: string; telegramAuth?: TelegramAuthPayload };
    if (!claimId || !telegramAuth) {
      return NextResponse.json({ error: "claimId and telegramAuth are required" }, { status: 400 });
    }

    const verification = verifyTelegramAuth(telegramAuth);
    if (!verification.valid) {
      return NextResponse.json({ error: verification.reason || "Could not verify Telegram login." }, { status: 400 });
    }

    const cleanHandle = (telegramAuth.username || "").replace(/^@/, "").toLowerCase().trim();
    if (!cleanHandle) {
      return NextResponse.json({ error: "This Telegram account has no public username set." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: payment } = await supabase
      .from("payments")
      .select("recipient_address, status")
      .eq("id", claimId)
      .maybeSingle();

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    if (String(payment.status || "").toUpperCase() === "CANCELLED") {
      return NextResponse.json({ error: "This payment was cancelled." }, { status: 400 });
    }

    const ra = String(payment.recipient_address || "");
    if (!ra.startsWith(`${PENDING_SOCIAL_PREFIX}telegram:`)) {
      return NextResponse.json({ error: "This payment wasn't sent to a Telegram username." }, { status: 400 });
    }
    const expectedHandle = ra.slice(`${PENDING_SOCIAL_PREFIX}telegram:`.length).trim().toLowerCase();
    if (expectedHandle !== cleanHandle) {
      return NextResponse.json({ success: false, error: "This Telegram account isn't the one this payment was sent to." });
    }

    await redisSet(verifiedKey(claimId), cleanHandle, VERIFIED_TTL_SECONDS);
    return NextResponse.json({ success: true, handle: cleanHandle });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Polled by the original claim-page tab after the relay popup closes, to learn whether
 * verification actually succeeded — reveals only a boolean, never the handle, since the caller
 * is still unauthenticated at this point.
 * GET /api/telegram-relay/verify-claim?claimId=...
 */
export async function GET(request: NextRequest) {
  const claimId = request.nextUrl.searchParams.get("claimId");
  if (!claimId) {
    return NextResponse.json({ error: "claimId is required" }, { status: 400 });
  }
  const verified = await redisGet(verifiedKey(claimId));
  return NextResponse.json({ verified: !!verified });
}
