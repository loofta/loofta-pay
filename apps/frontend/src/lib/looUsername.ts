import { getSupabaseAdmin } from "@/lib/supabaseServer";

/**
 * Generate a unique loo-{handle} that doesn't conflict with any existing
 * username or loo_username in the table. Appends a counter when needed.
 *
 * loo-username max = "loo-" (4) + 16 suffix chars = 20 chars total.
 * Counter is appended after truncating the handle so the total suffix is always ≤ 16 chars.
 */
export async function generateUniqueLooUsername(
  handle: string,
  privyUserId: string,
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<string> {
  let counter = 0;

  while (true) {
    const counterStr = counter === 0 ? "" : String(counter);
    const suffix = handle.slice(0, 16 - counterStr.length) + counterStr;
    const candidate = "loo-" + suffix;

    // Two separate queries to avoid PostgREST quoting issues with hyphens in .or() values
    const [{ data: byUsername }, { data: byLoo }] = await Promise.all([
      supabase
        .from("app_users")
        .select("privy_user_id")
        .eq("username", candidate)
        .neq("privy_user_id", privyUserId)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("app_users")
        .select("privy_user_id")
        .eq("loo_username", candidate)
        .neq("privy_user_id", privyUserId)
        .limit(1)
        .maybeSingle(),
    ]);

    if (!byUsername && !byLoo) return candidate;

    counter = counter === 0 ? 2 : counter + 1;
  }
}

/** Extract a Twitter handle from a Privy linkedAccounts array (server-side shape). */
export function getTwitterHandleFromLinkedAccounts(
  linkedAccounts: Array<{ type: string; username?: string | null; name?: string | null }> | undefined
): string | null {
  const tw = (linkedAccounts ?? []).find(
    (a) => a.type === "twitter_oauth" || a.type === "twitter" || a.type === "x"
  );
  if (!tw) return null;
  const raw = (tw.username ?? tw.name ?? "").replace(/^@/, "").toLowerCase().trim();
  return raw.length >= 3 ? raw : null;
}
