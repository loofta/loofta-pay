import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { redisGet, redisDel } from "@/lib/redis-cache";

function relayTokenKey(token: string) {
  return `telegram-relay:${token}`;
}

/**
 * Called from telegram-relay/page.tsx after the user logs in with Telegram via Privy on
 * loofta.com (a Privy-registered domain, unlike pay.loofta.xyz which Telegram's widget blocks
 * for being a .xyz TLD). That Privy login happens in a separate session/domain from the user's
 * real pay.loofta.xyz account, so it's authenticated here by the one-time relay token instead of
 * a Privy access token — the token (minted by /api/users/telegram-relay-token) is what proves
 * which Loofta account this handle belongs to.
 * POST /api/telegram-relay/complete { token, handle }
 */
export async function POST(request: NextRequest) {
  try {
    const { token, handle } = (await request.json()) as { token?: string; handle?: string };
    if (!token || !handle) {
      return NextResponse.json({ error: "token and handle are required" }, { status: 400 });
    }

    const privyUserId = await redisGet(relayTokenKey(token));
    if (!privyUserId) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
    }
    await redisDel(relayTokenKey(token));

    const cleanHandle = handle.replace(/^@/, "").toLowerCase().trim();
    if (!cleanHandle) {
      return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("social_accounts")
      .upsert(
        { user_id: privyUserId, platform: "telegram", handle: cleanHandle },
        { onConflict: "user_id,platform" },
      );

    if (error) {
      console.error("[telegram-relay/complete] upsert error:", error);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({ success: true, handle: cleanHandle });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
