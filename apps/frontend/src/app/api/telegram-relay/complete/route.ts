import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedTelegramHandleFromAccessToken } from "@/lib/serverAuth";
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
 * which Loofta account this handle belongs to. The handle itself is never trusted from the
 * client — relayAccessToken (the throwaway session's own Privy access token) is independently
 * verified server-side via getVerifiedTelegramHandleFromAccessToken, since a client-supplied
 * handle string would let anyone bind an arbitrary Telegram handle to their account.
 * POST /api/telegram-relay/complete { token, relayAccessToken }
 */
export async function POST(request: NextRequest) {
  try {
    const { token, relayAccessToken } = (await request.json()) as { token?: string; relayAccessToken?: string };
    if (!token || !relayAccessToken) {
      return NextResponse.json({ error: "token and relayAccessToken are required" }, { status: 400 });
    }

    const privyUserId = await redisGet(relayTokenKey(token));
    if (!privyUserId) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
    }
    await redisDel(relayTokenKey(token));

    const cleanHandle = await getVerifiedTelegramHandleFromAccessToken(relayAccessToken);
    if (!cleanHandle) {
      return NextResponse.json({ error: "Could not verify Telegram login" }, { status: 400 });
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
