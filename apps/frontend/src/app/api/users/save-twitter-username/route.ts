import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

/**
 * Save (or update) the twitter_username column for the authenticated user.
 * Called when a user links their Twitter/X account via Privy.
 * POST /api/users/save-twitter-username
 * Body: { twitterUsername: string }
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { twitterUsername } = await request.json() as { twitterUsername: string };
    if (!twitterUsername || typeof twitterUsername !== "string") {
      return NextResponse.json({ error: "twitterUsername is required" }, { status: 400 });
    }
    const handle = twitterUsername.replace(/^@/, "").toLowerCase().trim();
    if (!handle || handle.length < 1) {
      return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("app_users")
      .update({ twitter_username: handle })
      .eq("privy_user_id", privyUserId)
      .select("id, username, twitter_username")
      .single();

    if (error) {
      console.error("[save-twitter-username] error:", error);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      twitterUsername: data.twitter_username,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
