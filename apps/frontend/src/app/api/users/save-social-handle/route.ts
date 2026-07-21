import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId, getVerifiedLiveHandle } from "@/lib/serverAuth";
import { redisDel } from "@/lib/redis-cache";

function userPrefsKey(uid: string) { return `user:prefs:${uid}`; }

// Telegram is deliberately excluded — it isn't a Privy-linked OAuth account (see
// telegram-relay/page.tsx), so there's nothing for getVerifiedLiveHandle to check here. Telegram
// handles may only be written via the HMAC-verified /api/telegram-relay/* endpoints, which prove
// ownership against Telegram's own signed widget payload instead.
const PLATFORMS = ["discord", "github"] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * Save, update, or clear a Discord/GitHub handle in social_accounts for the authenticated user.
 * Called when a user links one of these accounts via Privy (set), or disconnects it (clear).
 * The client-supplied `handle` in the body is only ever used to decide set-vs-clear — the value
 * actually written always comes from getVerifiedLiveHandle's own live Privy lookup, so a caller
 * can never assert a handle they don't actually have linked (that would let anyone claim any
 * Discord/GitHub-pending payment by just POSTing the victim's handle onto their own account).
 * POST /api/users/save-social-handle
 * Body: { platform: 'discord'|'github', handle: string | null } — null clears it.
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { platform, handle: rawHandle } = await request.json() as { platform: Platform; handle: string | null };

    if (!PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (rawHandle === null) {
      const { error } = await supabase
        .from("social_accounts")
        .delete()
        .eq("user_id", privyUserId)
        .eq("platform", platform);
      if (error) {
        console.error("[save-social-handle] delete error:", error);
        return NextResponse.json({ error: "Failed to save" }, { status: 500 });
      }
      await redisDel(userPrefsKey(privyUserId));
      return NextResponse.json({ success: true, platform, handle: null });
    }

    const cleanHandle = await getVerifiedLiveHandle(privyUserId, platform);
    if (!cleanHandle) {
      return NextResponse.json({ error: `No verified ${platform} account linked to this Loofta account.` }, { status: 400 });
    }

    const { error } = await supabase
      .from("social_accounts")
      .upsert(
        { user_id: privyUserId, platform, handle: cleanHandle },
        { onConflict: "user_id,platform" },
      );

    if (error) {
      console.error("[save-social-handle] upsert error:", error);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    await redisDel(userPrefsKey(privyUserId));

    return NextResponse.json({ success: true, platform, handle: cleanHandle });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
