import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId, getVerifiedLiveHandle } from "@/lib/serverAuth";
import { redisDel } from "@/lib/redis-cache";

function userPrefsKey(uid: string) { return `user:prefs:${uid}`; }

// Mirror of social_accounts on app_users (telegram_username, discord_username, ...), so the user row
// shows every connected handle. social_accounts stays the source of truth for lookups.
async function mirrorToAppUsers(supabase: ReturnType<typeof getSupabaseAdmin>, uid: string, platform: string, handle: string | null) {
  const { error } = await supabase
    .from("app_users")
    .update({ [`${platform}_username`]: handle })
    .eq("privy_user_id", uid);
  if (error) console.error(`[save-social-handle] app_users ${platform}_username update error:`, error);
}

// Telegram is Privy-linked now (signing in with Telegram), so getVerifiedLiveHandle can verify it
// like the other platforms. The HMAC-verified /api/telegram-relay/* endpoints still attach it too.
const WRITABLE_PLATFORMS = ["discord", "github", "instagram", "telegram"] as const;
const DELETABLE_PLATFORMS = ["discord", "github", "instagram", "telegram"] as const;
type Platform = (typeof DELETABLE_PLATFORMS)[number];

/**
 * Save, update, or clear a Discord/GitHub/Instagram/Telegram handle in social_accounts for the
 * authenticated user. Called when a user links Discord/GitHub/Instagram via Privy (set), or
 * disconnects any of the four (clear) — Telegram can only ever be cleared here, never set (see
 * WRITABLE_PLATFORMS above). The client-supplied `handle` in the body is only ever used to decide
 * set-vs-clear — the value actually written always comes from getVerifiedLiveHandle's own live
 * Privy lookup, so a caller can never assert a handle they don't actually have linked (that would
 * let anyone claim any Discord/GitHub/Instagram-pending payment by just POSTing the victim's
 * handle onto their own account).
 * POST /api/users/save-social-handle
 * Body: { platform: 'discord'|'github'|'instagram'|'telegram', handle: string | null } — null clears it.
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { platform, handle: rawHandle } = await request.json() as { platform: Platform; handle: string | null };

    if (rawHandle === null) {
      if (!DELETABLE_PLATFORMS.includes(platform)) {
        return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
      }
      const supabase = getSupabaseAdmin();
      const { error } = await supabase
        .from("social_accounts")
        .delete()
        .eq("user_id", privyUserId)
        .eq("platform", platform);
      if (error) {
        console.error("[save-social-handle] delete error:", error);
        return NextResponse.json({ error: "Failed to save" }, { status: 500 });
      }
      await mirrorToAppUsers(supabase, privyUserId, platform, null);
      await redisDel(userPrefsKey(privyUserId));
      return NextResponse.json({ success: true, platform, handle: null });
    }

    if (!WRITABLE_PLATFORMS.includes(platform as typeof WRITABLE_PLATFORMS[number])) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const cleanHandle = await getVerifiedLiveHandle(privyUserId, platform as typeof WRITABLE_PLATFORMS[number]);
    if (!cleanHandle) {
      return NextResponse.json({ error: `No verified ${platform} account linked to this Loofta account.` }, { status: 400 });
    }

    // Belt-and-suspenders alongside Privy's own linked-account uniqueness: covers the case where
    // a stale row was left behind after a user unlinked this account in Privy without ever
    // clearing it here first, then a different Loofta account linked that now-available account.
    // The DB's unique index on (platform, handle) is the actual source of truth.
    const { data: claimedByOther } = await supabase
      .from("social_accounts")
      .select("user_id")
      .eq("platform", platform)
      .eq("handle", cleanHandle)
      .neq("user_id", privyUserId)
      .maybeSingle();
    if (claimedByOther) {
      // A deleted or unlinked Privy account leaves its row behind. Only block if the other
      // account still really has this handle; otherwise free it for the real owner.
      const otherLive = await getVerifiedLiveHandle(claimedByOther.user_id, platform as typeof WRITABLE_PLATFORMS[number]);
      if (otherLive !== cleanHandle) {
        await supabase.from("social_accounts").delete()
          .eq("platform", platform).eq("handle", cleanHandle).eq("user_id", claimedByOther.user_id);
      }
    }
    const stillClaimed = claimedByOther ? (await supabase.from("social_accounts").select("user_id")
      .eq("platform", platform).eq("handle", cleanHandle).neq("user_id", privyUserId).maybeSingle()).data : null;
    if (stillClaimed) {
      return NextResponse.json({ error: `This ${platform} account is already connected to another Loofta account.` }, { status: 409 });
    }

    const { error } = await supabase
      .from("social_accounts")
      .upsert(
        { user_id: privyUserId, platform, handle: cleanHandle },
        { onConflict: "user_id,platform" },
      );

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: `This ${platform} account is already connected to another Loofta account.` }, { status: 409 });
      }
      console.error("[save-social-handle] upsert error:", error);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    await mirrorToAppUsers(supabase, privyUserId, platform, cleanHandle);
    await redisDel(userPrefsKey(privyUserId));

    return NextResponse.json({ success: true, platform, handle: cleanHandle });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
