import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId, getPrivyUser } from "@/lib/serverAuth";
import { generateUniqueLooUsername, getTwitterHandleFromLinkedAccounts } from "@/lib/looUsername";

/**
 * Check if user exists and return user data
 * POST /api/users/check
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { email } = await request.json();

    const supabase = getSupabaseAdmin();

    const { data: user, error } = await supabase
      .from("app_users")
      .select("id, privy_user_id, email, username, loo_username, twitter_username, skip_onboarding, ata_migrated_mainnet, ata_migrated_devnet, created_at")
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
          looUsername: user.loo_username ?? null,
          twitterUsername: user.twitter_username ?? null,
          skipOnboarding: user.skip_onboarding ?? false,
          ataMigratedMainnet: user.ata_migrated_mainnet ?? false,
          ataMigratedDevnet: user.ata_migrated_devnet ?? false,
          createdAt: user.created_at,
        },
        needsUsername: !user.username,
      });
    }

    // User doesn't exist — detect Twitter handle via Privy so we can set all three columns upfront
    const privyUserObj = await getPrivyUser(privyUserId);
    const twitterHandle = getTwitterHandleFromLinkedAccounts(
      privyUserObj?.linkedAccounts as Array<{ type: string; username?: string | null; name?: string | null }> | undefined
    );

    const insertPayload: Record<string, string | boolean | null> = {
      privy_user_id: privyUserId,
      email: email || null,
      // New users are born on mainnet — no ATA migration needed
      ata_migrated_mainnet: true,
      ata_migrated_devnet: true,
    };

    let initialTwitterUsername: string | null = null;

    // Derive the handle to base the loo- username on:
    // - Twitter users  → use their handle (also set as active username + twitter_username)
    // - Email-only     → use the part before @ (sanitised)
    const looHandle = twitterHandle
      ?? (email ? email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) : null)
      ?? "user";

    const initialLooUsername = await generateUniqueLooUsername(looHandle, privyUserId, supabase);

    if (twitterHandle) {
      initialTwitterUsername = twitterHandle;
      insertPayload.username = twitterHandle;
      insertPayload.twitter_username = initialTwitterUsername;
    } else {
      // Email-only: active username starts as the loo- username
      insertPayload.username = initialLooUsername;
    }
    insertPayload.loo_username = initialLooUsername;

    const { data: newUser, error: createError } = await supabase
      .from("app_users")
      .insert(insertPayload)
      .select("id, privy_user_id, email, username, loo_username, twitter_username, created_at")
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
        username: newUser.username ?? null,
        looUsername: newUser.loo_username ?? null,
        twitterUsername: newUser.twitter_username ?? null,
        skipOnboarding: false,
        ataMigratedMainnet: true,
        ataMigratedDevnet: true,
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
