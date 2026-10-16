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

/** The caller's own linked Solana wallet addresses, per Privy's live record (not client-supplied). */
export async function getVerifiedSolanaWallets(privyUserId: string): Promise<string[]> {
  const user = await getPrivyUser(privyUserId);
  if (!user) return [];
  const wallets: string[] = [];
  for (const account of (user.linkedAccounts || []) as Array<{ type?: string; chainType?: string; chainId?: string; address?: string }>) {
    const type = (account.type || "").toLowerCase();
    const chainType = (account.chainType || "").toLowerCase();
    const chainId = (account.chainId || "").toString().toLowerCase();
    const isSolana =
      type === "wallet" || type === "solana" || type === "solana_embedded_wallet" ||
      chainType === "solana" || chainId.startsWith("solana:");
    if (!isSolana) continue;
    const addr = (account.address || "").toString().trim();
    if (addr) wallets.push(addr);
  }
  return wallets;
}

/**
 * The caller's own LIVE, Privy-verified handle for an OAuth-linked platform — the only trusted
 * source for anything that persists a social handle onto a user's identity (e.g.
 * save-twitter-username, save-social-handle). Never persist a client-supplied handle string
 * directly: without an independent check like this, any authenticated user could POST an
 * arbitrary handle onto their own account and pass every downstream recipient-identity check
 * (verifyRecipientIdentityForSendPayment, backend) for a payment that was never sent to them.
 */
export async function getVerifiedLiveHandle(
  privyUserId: string,
  platform: "twitter" | "discord" | "github" | "instagram" | "telegram",
): Promise<string | null> {
  const user = await getPrivyUser(privyUserId);
  if (!user) return null;
  const oauthTypes =
    platform === "twitter" ? ["twitter", "x", "twitter_oauth"]
    : platform === "discord" ? ["discord", "discord_oauth"]
    : platform === "github" ? ["github", "github_oauth"]
    : platform === "telegram" ? ["telegram", "telegram_oauth"]
    : ["instagram", "instagram_oauth"];
  for (const account of (user.linkedAccounts || []) as Array<{ type?: string; username?: string | null; name?: string | null; address?: string | null }>) {
    const type = (account.type || "").toLowerCase();
    if (!oauthTypes.includes(type)) continue;
    // Discord's legacy discriminator (e.g. "username#0") still shows up in some OAuth responses
    // even though Discord itself dropped discriminators for migrated accounts — strip it so we
    // never persist a handle senders can't type without knowing the discriminator.
    const handle = (account.username || account.name || account.address || "")
      .toString()
      .replace(/^@/, "")
      .replace(/#\d+$/, "")
      .toLowerCase()
      .trim();
    if (handle) return handle;
  }
  return null;
}

/**
 * Same trust model as getVerifiedLiveHandle, but for X/Twitter specifically returns the profile
 * picture too — Privy's Twitter linked-account object carries `profilePictureUrl` right next to
 * `username`/`name` (confirmed in @privy-io/server-auth's own types), so no extra API call is
 * needed. Used to persist a real avatar (save-twitter-username) instead of only the handle.
 */
export async function getVerifiedLiveTwitterProfile(
  privyUserId: string,
): Promise<{ handle: string; avatarUrl: string | null } | null> {
  const user = await getPrivyUser(privyUserId);
  if (!user) return null;
  for (const account of (user.linkedAccounts || []) as Array<{ type?: string; username?: string | null; name?: string | null; address?: string | null; profilePictureUrl?: string | null }>) {
    const type = (account.type || "").toLowerCase();
    if (!["twitter", "x", "twitter_oauth"].includes(type)) continue;
    const handle = (account.username || account.name || account.address || "")
      .toString()
      .replace(/^@/, "")
      .replace(/#\d+$/, "")
      .toLowerCase()
      .trim();
    if (!handle) continue;
    return { handle, avatarUrl: account.profilePictureUrl?.trim() || null };
  }
  return null;
}

/**
 * The caller's own LIVE Telegram handle, verified against Privy's record for the Privy access
 * token supplied — never trust a client-supplied `handle` string for Telegram. Unlike
 * getVerifiedLiveHandle, this takes a raw access token rather than a privyUserId: the Telegram
 * relay flow (telegram-relay/page.tsx) logs in via a throwaway Privy session scoped to the
 * loofta.com domain, distinct from the caller's real pay.loofta.com account session, so there is
 * no already-authenticated privyUserId to look up — the token itself is the only proof that a
 * Telegram OAuth login actually happened. Without this, both /api/telegram-relay/complete and
 * /api/telegram-relay/verify-claim would have no way to confirm a POSTed handle was ever actually
 * verified via Telegram, letting anyone bind or claim an arbitrary handle they simply typed.
 */
export async function getVerifiedTelegramHandleFromAccessToken(accessToken: string): Promise<string | null> {
  try {
    const claims = await getClient().verifyAuthToken(accessToken);
    if (!claims.userId) return null;
    const user = await getPrivyUser(claims.userId);
    if (!user) return null;
    for (const account of (user.linkedAccounts || []) as Array<{ type?: string; username?: string | null }>) {
      const type = (account.type || "").toLowerCase();
      if (type !== "telegram" && type !== "telegram_oauth") continue;
      const handle = (account.username || "").toString().replace(/^@/, "").toLowerCase().trim();
      if (handle) return handle;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True if `address` is already linked to a registered Loofta (Privy) account. Used to stop
 * senders from disabling privacy on a payment link by passing off a Loofta wallet as "external"
 * — see /api/claims/create. Fails closed (treated as registered) on lookup errors so a Privy
 * outage can never be used to smuggle a non-private payment to a real Loofta wallet.
 */
export async function isWalletAddressRegisteredOnLoofta(address: string): Promise<boolean> {
  try {
    const user = await getClient().getUserByWalletAddress(address);
    return !!user;
  } catch {
    return true;
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
