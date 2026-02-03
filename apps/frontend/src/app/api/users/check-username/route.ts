import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

/**
 * Check if username is available
 * POST /api/users/check-username
 */
export async function POST(request: NextRequest) {
  try {
    const { username, privyUserId } = await request.json();

    if (!username) {
      return NextResponse.json(
        { error: "username is required" },
        { status: 400 }
      );
    }

    // Validate username format
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { available: false, error: "Username must be 3-20 characters, alphanumeric and underscores only" },
        { status: 200 } // Return 200 but with error message
      );
    }

    const supabase = getSupabaseAdmin();

    // Check if username is already taken (excluding current user if privyUserId provided)
    let query = supabase
      .from("app_users")
      .select("id, privy_user_id")
      .eq("username", username.toLowerCase())
      .limit(1);

    // If privyUserId is provided, exclude current user from check
    if (privyUserId) {
      query = query.neq("privy_user_id", privyUserId);
    }

    const { data: existingUser, error: checkError } = await query.single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = no rows found (username is available)
      console.error("[users/check-username] Error checking username:", checkError);
      return NextResponse.json(
        { available: false, error: "Failed to check username availability" },
        { status: 500 }
      );
    }

    // If existingUser exists, username is taken
    if (existingUser) {
      return NextResponse.json({
        available: false,
        error: "Username is already taken",
      });
    }

    return NextResponse.json({
      available: true,
    });
  } catch (error: any) {
    console.error("[users/check-username] Unexpected error:", error);
    return NextResponse.json(
      { available: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
