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

    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { error: "Username must be 3-20 characters, alphanumeric and underscores only" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    // Check if username is already taken
    const { data: existingUser, error: checkError } = await supabase
      .from("app_users")
      .select("id")
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
