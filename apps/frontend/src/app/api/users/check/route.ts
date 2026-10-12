import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId, getPrivyUser, getVerifiedLiveTwitterProfile } from "@/lib/serverAuth";
import { generateUniqueLooUsername, getTwitterHandleFromLinkedAccounts } from "@/lib/looUsername";
import { redisGet, redisSet } from "@/lib/redis-cache";

const USER_PREFS_TTL = 60 * 60 * 24; // 24h
function userPrefsKey(privyUserId: string) { return `user:prefs:${privyUserId}`; }

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

    // Fast path: Redis cache with full user object (avoids DB hit on every page load, cross-device)
    const cached = await redisGet(userPrefsKey(privyUserId));
    if (cached) {
      try {
        const u = JSON.parse(cached) as {
          id: string; privyUserId: string; email: string | null;
          username: string | null; looUsername: string | null; twitterUsername: string | null;
          avatarUrl: string | null;
          skipOnboarding: boolean;
          ataMigratedMainnet: boolean; ataMigratedDevnet: boolean; createdAt: string;
        };
        // Only serve from cache when onboarding is definitively done.
        // A Twitter account cached before we stored the profile photo would keep the
        // header on the letter fallback for the whole TTL — refetch those once.
        const missingTwitterAvatar = !!u.twitterUsername && !u.avatarUrl;
        if ((u.skipOnboarding || u.username) && !missingTwitterAvatar) {
          return NextResponse.json({ exists: true, user: u, needsUsername: !u.username });
        }
      } catch {
        /* corrupt cache — fall through to DB */
      }
    }

    const supabase = getSupabaseAdmin();

    const { data: user, error } = await supabase
      .from("app_users")
      .select("id, privy_user_id, email, username, loo_username, twitter_username, avatar_url, skip_onboarding, ata_migrated_mainnet, ata_migrated_devnet, created_at")
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
      let avatarUrl = user.avatar_url ?? null;
      let twitterUsername = user.twitter_username ?? null;
      // Accounts created before avatars were stored still have a Twitter login on Privy.
      // Persist the photo once so the header (and every other surface) can show it.
      if (!avatarUrl && twitterUsername) {
        const profile = await getVerifiedLiveTwitterProfile(privyUserId);
        if (profile?.avatarUrl) {
          avatarUrl = profile.avatarUrl;
          const { error: avatarError } = await supabase
            .from("app_users")
            .update({ avatar_url: avatarUrl })
            .eq("privy_user_id", privyUserId);
          if (avatarError) {
            console.error("[users/check] avatar backfill failed:", avatarError);
          }
        }
      }

      const userPayload = {
        id: user.id,
        privyUserId: user.privy_user_id,
        email: user.email,
        username: user.username ?? null,
        looUsername: user.loo_username ?? null,
        twitterUsername,
        avatarUrl,
        skipOnboarding: user.skip_onboarding ?? false,
        ataMigratedMainnet: user.ata_migrated_mainnet ?? false,
        ataMigratedDevnet: user.ata_migrated_devnet ?? false,
        createdAt: user.created_at,
      };
      // Populate cache so future requests (from any device) skip the DB
      if (userPayload.skipOnboarding || userPayload.username) {
        void redisSet(userPrefsKey(privyUserId), JSON.stringify(userPayload), USER_PREFS_TTL);
      }
      return NextResponse.json({ exists: true, user: userPayload, needsUsername: !user.username });
    }

    // User doesn't exist — detect Twitter handle via Privy so we can set all three columns upfront
    const privyUserObj = await getPrivyUser(privyUserId);
    const linkedAccounts = privyUserObj?.linkedAccounts as Array<{ type: string; username?: string | null; name?: string | null; profilePictureUrl?: string | null }> | undefined;
    const twitterHandle = getTwitterHandleFromLinkedAccounts(linkedAccounts);
    const twitterAvatarUrl = twitterHandle
      ? (linkedAccounts ?? []).find((a) => a.type === "twitter_oauth" || a.type === "twitter" || a.type === "x")?.profilePictureUrl?.trim() || null
      : null;

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
      insertPayload.avatar_url = twitterAvatarUrl;
    } else {
      // Email-only: active username starts as the loo- username
      insertPayload.username = initialLooUsername;
    }
    insertPayload.loo_username = initialLooUsername;

    const { data: newUser, error: createError } = await supabase
      .from("app_users")
      .insert(insertPayload)
      .select("id, privy_user_id, email, username, loo_username, twitter_username, avatar_url, created_at")
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
        avatarUrl: newUser.avatar_url ?? null,
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
