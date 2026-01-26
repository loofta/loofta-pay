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

    // Check if user exists
    // Try to select username and skip_onboarding, but handle gracefully if columns don't exist yet
    let selectFields = "id, privy_user_id, email, created_at";
    try {
      // Try to include username and skip_onboarding - if columns don't exist, we'll catch it
      const { data: testUser } = await supabase
        .from("app_users")
        .select("username, skip_onboarding")
        .limit(1);
      if (testUser !== null) {
        selectFields = "id, privy_user_id, email, username, skip_onboarding, created_at";
      }
    } catch (e) {
      // Columns don't exist - use fields without them
      console.log("[users/check] Some columns not found, using fallback fields");
    }

    const { data: user, error } = await supabase
      .from("app_users")
      .select(selectFields)
      .eq("privy_user_id", privyUserId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows returned, which is fine
      // 42703 = column does not exist (username column)
      if (error.code === "42703" && error.message?.includes("username")) {
        // Username column doesn't exist - return user without username
        console.warn("[users/check] Username column not found. Please run migration: supabase migration up");
        return NextResponse.json({
          exists: true,
          user: {
            id: user?.id,
            privyUserId: user?.privy_user_id,
            email: user?.email,
            username: null,
            createdAt: user?.created_at,
          },
          needsUsername: false, // Can't set username until migration is run
          migrationNeeded: true,
        });
      }
      console.error("[users/check] Error checking user:", error);
      return NextResponse.json(
        { error: "Failed to check user" },
        { status: 500 }
      );
    }

    // User exists
    if (user) {
      return NextResponse.json({
        exists: true,
        user: {
          id: user.id,
          privyUserId: user.privy_user_id,
          email: user.email,
          username: user.username,
          skipOnboarding: user.skip_onboarding || false,
          createdAt: user.created_at,
        },
        needsUsername: !user.username,
      });
    }

    // User doesn't exist - create them with auto-generated username
    // Generate username from email or random number
    let autoUsername: string;
    if (email) {
      // Extract part before @ and add random number
      const emailPrefix = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
      const randomNum = Math.floor(Math.random() * 1000000);
      autoUsername = `${emailPrefix}${randomNum}`;
    } else {
      // Fallback to user + random number
      const randomNum = Math.floor(Math.random() * 100000000);
      autoUsername = `user${randomNum}`;
    }

    // Check if username column exists before trying to use it
    let insertData: any = {
      privy_user_id: privyUserId,
      email: email || null,
    };

    // Try to include username if column exists
    try {
      // Test if username column exists
      const { error: testError } = await supabase
        .from("app_users")
        .select("username")
        .limit(0);
      
      if (!testError || testError.code !== "42703") {
        // Username column exists - ensure uniqueness
        let finalUsername = autoUsername;
        let attempts = 0;
        while (attempts < 5) {
          const { data: existing } = await supabase
            .from("app_users")
            .select("id")
            .eq("username", finalUsername)
            .single();
          
          if (!existing) break; // Username is available
          
          // Try again with different random number
          const randomNum = Math.floor(Math.random() * 100000000);
          finalUsername = email 
            ? `${email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "")}${randomNum}`
            : `user${randomNum}`;
          attempts++;
        }
        insertData.username = finalUsername;
      }
    } catch (e) {
      // Username column doesn't exist - skip it
      console.log("[users/check] Username column not found, creating user without username");
    }

    const { data: newUser, error: createError } = await supabase
      .from("app_users")
      .insert(insertData)
      .select("id, privy_user_id, email, username, created_at")
      .single();

    if (createError) {
      console.error("[users/check] Error creating user:", createError);
      // Log the insertData to debug
      console.error("[users/check] Insert data was:", JSON.stringify(insertData, null, 2));
      return NextResponse.json(
        { error: "Failed to create user", details: createError.message },
        { status: 500 }
      );
    }

    // Ensure username is included in response
    const responseUser = {
      id: newUser.id,
      privyUserId: newUser.privy_user_id,
      email: newUser.email,
      username: newUser.username || insertData.username || null, // Fallback to insertData if select didn't return it
      createdAt: newUser.created_at,
    };

    console.log("[users/check] Created new user:", {
      id: responseUser.id,
      privyUserId: responseUser.privyUserId,
      username: responseUser.username,
      insertDataUsername: insertData.username,
    });

    return NextResponse.json({
      exists: false,
      user: {
        ...responseUser,
        skipOnboarding: false, // New users haven't skipped onboarding
      },
      needsUsername: false, // Auto-generated, but user can change it
    });
  } catch (error: any) {
    console.error("[users/check] Unexpected error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
