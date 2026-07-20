import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { redisDel } from "@/lib/redis-cache";

function userPrefsKey(uid: string) { return `user:prefs:${uid}`; }

const PLATFORMS = ["discord", "github", "telegram"] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * Save, update, or clear a Discord/GitHub/Telegram handle in social_accounts for the
 * authenticated user. Called when a user links one of these accounts via Privy (set), or
 * disconnects it (clear). Generalized version of save-twitter-username for the platforms
 * backed by the normalized social_accounts table instead of an app_users column.
 * POST /api/users/save-social-handle
 * Body: { platform: 'discord'|'github'|'telegram', handle: string | null } — null clears it.
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { platform, handle } = await request.json() as { platform: Platform; handle: string | null };

    if (!PLATFORMS.includes(platform)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (handle === null) {
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

    if (typeof handle !== "string") {
      return NextResponse.json({ error: "handle is required" }, { status: 400 });
    }
    const cleanHandle = handle.replace(/^@/, "").toLowerCase().trim();
    if (!cleanHandle) {
      return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
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
