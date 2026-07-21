import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { redisGet, redisDel } from "@/lib/redis-cache";
import { verifyTelegramAuth, type TelegramAuthPayload } from "@/lib/telegramAuth";

function relayTokenKey(token: string) {
  return `telegram-relay:${token}`;
}

/**
 * Called from telegram-relay/page.tsx after Telegram's own Login Widget returns a signed auth
 * payload — verified here via verifyTelegramAuth (HMAC-SHA256 against our bot token) before any
 * of it is trusted. The `username` used below comes from THAT verified payload, never from a
 * bare client-supplied string — accepting an unverified handle would let anyone assert ownership
 * of any Telegram username with no proof at all.
 * The one-time relay token (minted by /api/users/telegram-relay-token) identifies which
 * pay.loofta.xyz account this verified handle belongs to.
 * POST /api/telegram-relay/complete { token, telegramAuth: TelegramAuthPayload }
 */
export async function POST(request: NextRequest) {
  try {
    const { token, telegramAuth } = (await request.json()) as { token?: string; telegramAuth?: TelegramAuthPayload };
    if (!token || !telegramAuth) {
      return NextResponse.json({ error: "token and telegramAuth are required" }, { status: 400 });
    }

    const verification = verifyTelegramAuth(telegramAuth);
    if (!verification.valid) {
      return NextResponse.json({ error: verification.reason || "Could not verify Telegram login." }, { status: 400 });
    }

    const privyUserId = await redisGet(relayTokenKey(token));
    if (!privyUserId) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
    }
    await redisDel(relayTokenKey(token));

    const cleanHandle = (telegramAuth.username || "").replace(/^@/, "").toLowerCase().trim();
    if (!cleanHandle) {
      return NextResponse.json({ error: "This Telegram account has no public username set." }, { status: 400 });
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
