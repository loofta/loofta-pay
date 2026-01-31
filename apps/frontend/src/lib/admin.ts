/**
 * Admin utilities
 * Server-side only - never expose to client
 */

import { getSupabaseAdmin } from "./supabaseServer";

/**
 * Check if a user is an admin based on their Privy user ID
 * This is a server-side only function
 * 
 * Checks:
 * 1. Environment variable ADMIN_PRIVY_USER_IDS (comma-separated)
 * 2. Database users table with role='admin'
 */
export async function isAdmin(privyUserId: string | null | undefined): Promise<boolean> {
  if (!privyUserId) {
    return false;
  }

  // First check environment variable (fastest, no DB query)
  const adminIdsFromEnv = getAdminUserIdsFromEnv();
  console.log(`[Admin] Checking admin status for user: ${privyUserId}`);
  console.log(`[Admin] Admin IDs from env: ${adminIdsFromEnv.join(', ')}`);
  if (adminIdsFromEnv.includes(privyUserId)) {
    console.log(`[Admin] ✓ User ${privyUserId} is admin (from env variable)`);
    return true;
  }
  console.log(`[Admin] User ${privyUserId} not found in env, checking database...`);

  // Fallback to database check (users table, not app_users)
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("users")
      .select("role")
      .eq("privy_user_id", privyUserId)
      .eq("role", "admin")
      .maybeSingle();

    if (error) {
      console.error("[Admin] Error checking admin status:", error);
      // If DB check fails, still return false (don't fall back to env if DB is accessible)
      return false;
    }

    if (data) {
      console.log(`[Admin] User ${privyUserId} is admin (from database)`);
      return true;
    }

    console.log(`[Admin] User ${privyUserId} is NOT admin`);
    return false;
  } catch (error) {
    console.error("[Admin] Error checking admin status:", error);
    // If database is unavailable, fall back to env check (already done above)
    return false;
  }
}

/**
 * Get admin user IDs from environment variable (fallback)
 * This should only be used as a fallback if database is unavailable
 */
export function getAdminUserIdsFromEnv(): string[] {
  const adminIds = process.env.ADMIN_PRIVY_USER_IDS;
  if (!adminIds) {
    return [];
  }
  return adminIds.split(",").map((id) => id.trim()).filter(Boolean);
}

