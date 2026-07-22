import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { redisGet, redisDel } from "@/lib/redis-cache";

function verifiedKey(claimId: string) {
  return `telegram-relay-claim-verified:${claimId}`;
}

/**
 * Redeems a claim-scoped Telegram verification (see /telegram-relay/verify-claim) once the
 * visitor who proved ownership of the handle has finished signing in to a real Loofta account —
 * called automatically right after sign-in completes (see the claim page's post-verify effect).
 * The handle itself is never trusted from the client here — it's read back from the server-side
 * record verify-claim wrote, one-time-use (deleted on redemption).
 * POST /api/telegram-relay/attach-verified { claimId }
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { claimId } = (await request.json().catch(() => ({}))) as { claimId?: string };
  if (!claimId) {
    return NextResponse.json({ error: "claimId is required" }, { status: 400 });
  }

  const handle = await redisGet(verifiedKey(claimId));
  if (!handle) {
    return NextResponse.json({ error: "Verification expired — please connect Telegram again." }, { status: 400 });
  }
  await redisDel(verifiedKey(claimId));

  const supabase = getSupabaseAdmin();

  // Same guard as telegram-relay/complete — see its comment. The DB's unique index on
  // (platform, handle) is the actual source of truth; this is only a friendlier message.
  const { data: claimedByOther } = await supabase
    .from("social_accounts")
    .select("user_id")
    .eq("platform", "telegram")
    .eq("handle", handle)
    .neq("user_id", privyUserId)
    .maybeSingle();
  if (claimedByOther) {
    return NextResponse.json({ error: "This Telegram account is already connected to another Loofta account." }, { status: 409 });
  }

  const { error } = await supabase
    .from("social_accounts")
    .upsert({ user_id: privyUserId, platform: "telegram", handle }, { onConflict: "user_id,platform" });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This Telegram account is already connected to another Loofta account." }, { status: 409 });
    }
    console.error("[telegram-relay/attach-verified] upsert error:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  return NextResponse.json({ success: true, handle });
}
