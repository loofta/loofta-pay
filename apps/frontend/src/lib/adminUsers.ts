import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getPrivyUser } from "@/lib/serverAuth";

export type AdminUserInfo = { username: string | null; email: string | null };

const PRIVY_FALLBACK_LIMIT = 25;

/** Username/email straight from Privy, for users with no usable app_users row. */
async function lookupPrivy(privyUserId: string): Promise<AdminUserInfo | null> {
  const user = await getPrivyUser(privyUserId);
  if (!user) return null;
  let username: string | null = null;
  let email: string | null = null;
  for (const a of (user.linkedAccounts || []) as Array<{ type?: string; username?: string | null; address?: string | null }>) {
    const type = (a.type || "").toLowerCase();
    if (!username && (type === "twitter_oauth" || type === "telegram" || type === "discord_oauth" || type === "github_oauth") && a.username) {
      username = a.username;
    }
    if (!email && type === "email" && a.address) email = a.address;
  }
  return username || email ? { username, email } : null;
}

/** Attach `user: { username, email }` to rows that carry a Privy `user_id`. */
export async function attachUsers<T extends { user_id?: string | null }>(
  rows: T[]
): Promise<(T & { user: AdminUserInfo | null })[]> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const map: Record<string, AdminUserInfo> = {};
  if (ids.length > 0) {
    const { data: users } = await getSupabaseAdmin()
      .from("app_users")
      .select("privy_user_id, username, email")
      .in("privy_user_id", ids);
    for (const u of users ?? []) {
      map[(u as any).privy_user_id] = { username: (u as any).username, email: (u as any).email };
    }
    // Anyone without a username in our DB: ask Privy (bounded, so a big page can't fan out).
    const missing = ids.filter((id) => !map[id]?.username).slice(0, PRIVY_FALLBACK_LIMIT);
    await Promise.all(
      missing.map(async (id) => {
        const found = await lookupPrivy(id);
        if (found) map[id] = { username: found.username ?? map[id]?.username ?? null, email: map[id]?.email ?? found.email };
      })
    );
  }
  return rows.map((r) => ({ ...r, user: (r.user_id && map[r.user_id]) || null }));
}
