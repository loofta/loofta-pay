import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";

/**
 * Switch active username between loo_username and twitter_username.
 * POST /api/users/switch-username
 * Body: { use: "loo" | "twitter" }
 *
 * Sets username = loo_username or twitter_username depending on choice.
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { use } = await request.json() as { use: "loo" | "twitter" };
    if (use !== "loo" && use !== "twitter") {
      return NextResponse.json({ error: "use must be 'loo' or 'twitter'" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: user, error: fetchError } = await supabase
      .from("app_users")
      .select("id, username, loo_username, twitter_username")
      .eq("privy_user_id", privyUserId)
      .single();

    if (fetchError || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const target = use === "loo" ? user.loo_username : user.twitter_username;
    if (!target) {
      return NextResponse.json(
        { error: use === "loo" ? "No loo-username set up yet" : "No Twitter username saved" },
        { status: 400 }
      );
    }

    // Check target isn't already the active username
    if (user.username === target) {
      return NextResponse.json({ success: true, username: target });
    }

    const { data: updated, error: updateError } = await supabase
      .from("app_users")
      .update({ username: target })
      .eq("privy_user_id", privyUserId)
      .select("id, username, loo_username, twitter_username")
      .single();

    if (updateError) {
      console.error("[switch-username] update error:", updateError);
      if (updateError.code === "23505") {
        return NextResponse.json({ error: "Username already taken by another account" }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to switch username" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      username: updated.username,
      looUsername: updated.loo_username,
      twitterUsername: updated.twitter_username,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    console.error("[switch-username] unexpected error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
