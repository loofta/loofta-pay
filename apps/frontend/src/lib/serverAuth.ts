import { PrivyClient } from "@privy-io/server-auth";

let _privyClient: PrivyClient | null = null;
function getClient() {
  if (!_privyClient) {
    _privyClient = new PrivyClient(
      process.env.NEXT_PUBLIC_PRIVY_APP_ID!,
      process.env.PRIVY_APP_SECRET!
    );
  }
  return _privyClient;
}

// Cache verified tokens for 30s to avoid re-verifying the same JWT on every API call
const tokenCache = new Map<string, { userId: string; exp: number }>();
const TOKEN_TTL_MS = 30_000;

/** Returns the full Privy user object (with linkedAccounts) for the given privy user ID. */
export async function getPrivyUser(privyUserId: string) {
  try {
    return await getClient().getUser(privyUserId);
  } catch {
    return null;
  }
}

export async function getVerifiedUserId(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  const hit = tokenCache.get(token);
  if (hit && Date.now() < hit.exp) return hit.userId;

  try {
    const claims = await getClient().verifyAuthToken(token);
    if (!claims.userId) return null;
    // Evict expired entries before inserting to keep Map bounded
    if (tokenCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of tokenCache) if (now > v.exp) tokenCache.delete(k);
    }
    tokenCache.set(token, { userId: claims.userId, exp: Date.now() + TOKEN_TTL_MS });
    return claims.userId;
  } catch {
    return null;
  }
}
