import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getVerifiedUserId, getPrivyUser } from "@/lib/serverAuth";
import { generateUniqueLooUsername } from "@/lib/looUsername";
import { redisDel } from "@/lib/redis-cache";

function userPrefsKey(uid: string) { return `user:prefs:${uid}`; }

/**
 * Set username for user.
 * POST /api/users/setup-username
 *
 * Also fills loo_username and twitter_username so new users have all three set from day 1:
 *   - loo-* username  → loo_username = username (same value)
 *   - Twitter handle  → twitter_username = username, loo_username = loo-{handle} (generated, unique)
 */
export async function POST(request: NextRequest) {
  const privyUserId = await getVerifiedUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { username } = await request.json();

    if (!username) {
      return NextResponse.json({ error: "username is required" }, { status: 400 });
    }

    // Validate: 3-20 alphanumeric+underscore OR loo- + 1-16 chars
    const usernameRegex = /^(?:[a-zA-Z0-9_]{3,20}|loo-[a-zA-Z0-9_]{1,16})$/;
    if (!usernameRegex.test(username)) {
      return NextResponse.json(
        { error: "Username must be 3-20 characters (or loo- plus 1-16 letters/numbers/underscores)" },
        { status: 400 }
      );
    }

    const normalized = username.toLowerCase();
    const isLoo = normalized.startsWith("loo-");

    // loo-skr- is auto-generated for genuine Seeker mobile-wallet logins (see
    // UsersService.ensureAppUser) — reserved so no one can self-claim it and impersonate one.
    if (normalized.startsWith("loo-skr-")) {
      return NextResponse.json(
        { error: "This username prefix is reserved for Seeker device logins." },
        { status: 403 }
      );
    }

    // Non-loo usernames must match the user's actual linked Twitter/X handle.
    // Prevents anyone from claiming a Twitter username they don't own.
    if (!isLoo) {
      const privyUser = await getPrivyUser(privyUserId);
      if (!privyUser) {
        return NextResponse.json({ error: "Could not verify your account" }, { status: 500 });
      }
      const twitterAccount = privyUser.linkedAccounts.find(
        (a: { type: string }) => a.type === "twitter_oauth" || a.type === "twitter" || a.type === "x"
      ) as { type: string; username?: string | null; name?: string | null } | undefined;

      const twitterHandle = (twitterAccount?.username ?? twitterAccount?.name ?? "")
        .replace(/^@/, "")
        .toLowerCase()
        .trim();

      if (!twitterHandle || twitterHandle !== normalized) {
        return NextResponse.json(
          {
            error: twitterHandle
              ? `This username is reserved. Connect the @${normalized} X account to use it.`
              : "Connect your X account to use a non-loo username.",
          },
          { status: 403 }
        );
      }
    }

    const supabase = getSupabaseAdmin();

    // Check if username is already taken by another user
    const { data: existingUser, error: checkError } = await supabase
      .from("app_users")
      .select("id, privy_user_id, loo_username, twitter_username")
      .eq("username", normalized)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("[users/setup-username] Error checking username:", checkError);
      return NextResponse.json({ error: "Failed to check username availability" }, { status: 500 });
    }

    if (existingUser && existingUser.privy_user_id !== privyUserId) {
      return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
    }

    // Fetch current user to see if loo_username is already set
    const { data: currentUser } = await supabase
      .from("app_users")
      .select("id, loo_username, twitter_username")
      .eq("privy_user_id", privyUserId)
      .single();

    // Determine what to set for loo_username and twitter_username
    let looUsername: string | null = currentUser?.loo_username ?? null;
    let twitterUsername: string | null = currentUser?.twitter_username ?? null;

    if (isLoo) {
      // loo-username IS the permanent backup — use it directly
      looUsername = normalized;
    } else {
      // Twitter handle: save as twitter_username, generate a loo_username if not already set
      twitterUsername = normalized;
      if (!looUsername) {
        looUsername = await generateUniqueLooUsername(normalized, privyUserId, supabase);
      }
    }

    // Build the update payload
    const updatePayload: Record<string, string | null> = { username: normalized };
    if (looUsername) updatePayload.loo_username = looUsername;
    if (twitterUsername) updatePayload.twitter_username = twitterUsername;

    const { data: updatedUser, error: updateError } = await supabase
      .from("app_users")
      .update(updatePayload)
      .eq("privy_user_id", privyUserId)
      .select("id, privy_user_id, email, username, loo_username, twitter_username, created_at")
      .single();

    if (updateError) {
      console.error("[users/setup-username] Error updating username:", updateError);
      if (updateError.code === "23505") {
        return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
      }
      return NextResponse.json({ error: "Failed to set username" }, { status: 500 });
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
        looUsername: updatedUser.loo_username,
        twitterUsername: updatedUser.twitter_username,
        createdAt: updatedUser.created_at,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    console.error("[users/setup-username] Unexpected error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

