import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId, getVerifiedLiveTwitterProfile } from "@/lib/serverAuth";
import { redisDel } from "@/lib/redis-cache";

function userPrefsKey(uid: string) { return `user:prefs:${uid}`; }

/**
 * Save, update, or clear the twitter_username column for the authenticated user.
 * Called when a user links their Twitter/X account via Privy (set), or disconnects it (clear).
 * The client-supplied `twitterUsername` in the body is only ever used to decide set-vs-clear —
 * the value actually written always comes from getVerifiedLiveHandle's own live Privy lookup, so
 * a caller can never assert a handle they don't actually have linked (that would let anyone claim
 * any Twitter-pending payment by just POSTing the victim's handle onto their own account).
 * POST /api/users/save-twitter-username
 * Body: { twitterUsername: string | null } — null clears the column.
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { twitterUsername } = await request.json() as { twitterUsername: string | null };

    let handle: string | null = null;
    let avatarUrl: string | null = null;
    if (twitterUsername !== null) {
      const profile = await getVerifiedLiveTwitterProfile(privyUserId);
      if (!profile) {
        return NextResponse.json({ error: "No verified Twitter/X account linked to this Loofta account." }, { status: 400 });
      }
      handle = profile.handle;
      avatarUrl = profile.avatarUrl;
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("app_users")
      .update({ twitter_username: handle, avatar_url: avatarUrl })
      .eq("privy_user_id", privyUserId)
      .select("id, username, twitter_username, avatar_url")
      .single();

    if (error) {
      console.error("[save-twitter-username] error:", error);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    // Without this, /api/users/check keeps serving the pre-change cached twitter_username
    // (up to 24h) even though the DB is already correct.
    await redisDel(userPrefsKey(privyUserId));

    return NextResponse.json({
      success: true,
      twitterUsername: data.twitter_username,
      avatarUrl: data.avatar_url,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
