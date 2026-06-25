import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

/**
 * Check if user exists and return user data
 * POST /api/users/check
 */
export async function POST(request: NextRequest) {
  try {
    const { privyUserId, email } = await request.json();

    if (!privyUserId) {
      return NextResponse.json(
        { error: "privyUserId is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    const { data: user, error } = await supabase
      .from("app_users")
      .select("id, privy_user_id, email, username, skip_onboarding, ata_migrated_mainnet, ata_migrated_devnet, created_at")
      .eq("privy_user_id", privyUserId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("[users/check] Error checking user:", error);
      return NextResponse.json(
        { error: "Failed to check user" },
        { status: 500 }
      );
    }

    if (user) {
      return NextResponse.json({
        exists: true,
        user: {
          id: user.id,
          privyUserId: user.privy_user_id,
          email: user.email,
          username: user.username ?? null,
          skipOnboarding: user.skip_onboarding ?? false,
          ataMigratedMainnet: user.ata_migrated_mainnet ?? false,
          ataMigratedDevnet: user.ata_migrated_devnet ?? false,
          createdAt: user.created_at,
        },
        needsUsername: !user.username,
      });
    }

    // User doesn't exist — create with auto-generated username
    const prefix = email
      ? email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "")
      : "user";
    const autoUsername = `${prefix}${Math.floor(Math.random() * 100000000)}`;

    const { data: newUser, error: createError } = await supabase
      .from("app_users")
      .insert({ privy_user_id: privyUserId, email: email || null, username: autoUsername })
      .select("id, privy_user_id, email, username, created_at")
      .single();

    if (createError) {
      console.error("[users/check] Error creating user:", createError);
      return NextResponse.json(
        { error: "Failed to create user", details: createError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      exists: false,
      user: {
        id: newUser.id,
        privyUserId: newUser.privy_user_id,
        email: newUser.email,
        username: newUser.username ?? autoUsername,
        skipOnboarding: false,
        ataMigratedMainnet: false,
        ataMigratedDevnet: false,
        createdAt: newUser.created_at,
      },
      needsUsername: false,
    });
  } catch (error: any) {
    console.error("[users/check] Unexpected error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
