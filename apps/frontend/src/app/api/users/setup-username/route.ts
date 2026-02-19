import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

/**
 * Set username for user
 * POST /api/users/setup-username
 */
export async function POST(request: NextRequest) {
  try {
    const { privyUserId, username } = await request.json();

    if (!privyUserId || !username) {
      return NextResponse.json(
        { error: "privyUserId and username are required" },
        { status: 400 }
      );
    }

    // Validate username format: 3-20 alphanumeric + underscore, or loo- + 1-16 chars (for email-only users)
    const usernameRegex = /^(?:[a-zA-Z0-9_]{3,20}|loo-[a-zA-Z0-9_]{1,16})$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { error: "Username must be 3-20 characters (or loo- plus 1-16 letters/numbers/underscores)" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Check if username is already taken (or already set for this user)
    const { data: existingUser, error: checkError } = await supabase
      .from("app_users")
      .select("id, privy_user_id")
      .eq("username", username.toLowerCase())
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("[users/setup-username] Error checking username:", checkError);
      return NextResponse.json(
        { error: "Failed to check username availability" },
        { status: 500 }
      );
    }

    if (existingUser) {
      if (existingUser.privy_user_id === privyUserId) {
        // Same user already has this username — idempotent success
        const { data: user } = await supabase
          .from("app_users")
          .select("id, privy_user_id, email, username, created_at")
          .eq("privy_user_id", privyUserId)
          .single();
        return NextResponse.json({
          success: true,
          user: user
            ? {
                id: user.id,
                privyUserId: user.privy_user_id,
                email: user.email,
                username: user.username,
                createdAt: user.created_at,
              }
            : { id: existingUser.id, privyUserId, email: null, username: username.toLowerCase(), createdAt: null },
        });
      }
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 409 }
      );
    }

    // Update user with username
    const { data: updatedUser, error: updateError } = await supabase
      .from("app_users")
      .update({ username: username.toLowerCase() })
      .eq("privy_user_id", privyUserId)
      .select("id, privy_user_id, email, username, created_at")
      .single();

    if (updateError) {
      console.error("[users/setup-username] Error updating username:", updateError);
      return NextResponse.json(
        { error: "Failed to set username" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        privyUserId: updatedUser.privy_user_id,
        email: updatedUser.email,
        username: updatedUser.username,
        createdAt: updatedUser.created_at,
      },
    });
  } catch (error: any) {
    console.error("[users/setup-username] Unexpected error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
