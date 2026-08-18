import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId } from "@/lib/serverAuth";
import { redisDel } from "@/lib/redis-cache";

function userPrefsKey(privyUserId: string) { return `user:prefs:${privyUserId}`; }

/**
 * Set onboarding preference for user
 * POST /api/users/set-onboarding-preference
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { skipOnboarding } = await request.json();

    if (typeof skipOnboarding !== "boolean") {
      return NextResponse.json(
        { error: "skipOnboarding (boolean) is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Update user with onboarding preference
    const { data: updatedUser, error: updateError } = await supabase
      .from("app_users")
      .update({ skip_onboarding: skipOnboarding })
      .eq("privy_user_id", privyUserId)
      .select("id, privy_user_id, email, username, skip_onboarding, created_at")
      .single();

    if (updateError) {
      console.error("[users/set-onboarding-preference] Error updating preference:", updateError);
      return NextResponse.json(
        { error: "Failed to set onboarding preference" },
        { status: 500 }
      );
    }

    // Bust the cache so the next /check from any device reads fresh data from DB
    await redisDel(userPrefsKey(privyUserId));

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        privyUserId: updatedUser.privy_user_id,
        email: updatedUser.email,
        username: updatedUser.username,
        skipOnboarding: updatedUser.skip_onboarding,
        createdAt: updatedUser.created_at,
      },
    });
  } catch (error: any) {
    console.error("[users/set-onboarding-preference] Unexpected error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
