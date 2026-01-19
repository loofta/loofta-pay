/**
 * Admin utilities
 * Server-side only - never expose to client
 */

import { getSupabaseAdmin } from "./supabaseServer";

/**
 * Check if a user is an admin based on their Privy user ID
 * This is a server-side only function
 */
export async function isAdmin(privyUserId: string | null | undefined): Promise<boolean> {
  if (!privyUserId) {
    return false;
  }

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
      return false;
    }

    return !!data;
  } catch (error) {
    console.error("[Admin] Error checking admin status:", error);
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

