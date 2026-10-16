import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { ConfigService } from '@nestjs/config';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { MAINNET_WALLET_UPDATE_ID } from '@/common/force-update';
import { RedisService } from '@/redis/redis.service';
import { Connection } from '@solana/web3.js';
import { TldParser } from '@onsol/tldparser';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';

const FORCE_UPDATE_TTL = 60 * 60 * 24 * 7; // 7 days — completed state is permanent
function forceUpdateKey(privyUserId: string, updateId: string) {
  return `force-update:${privyUserId}:${updateId}`;
}

const SEARCH_CACHE_TTL_MS = 60 * 1000; // 1 min

/** Platforms backed by the normalized social_accounts table (see findSocialHandle/findBySocialHandle). */
export type SocialPlatform = 'discord' | 'github' | 'telegram';
export type RecipientType = 'email' | 'twitter' | 'username' | SocialPlatform;

const TIER_THRESHOLDS: [number, string][] = [
  [1000000, 'legend'],
  [100000,  'mogul'],
  [50000,   'whale'],
  [1000,    'hustler'],
  [0,       'peon'],
];

function computeTierKey(volumeUsd: number): string {
  for (const [min, key] of TIER_THRESHOLDS) {
    if (volumeUsd >= min) return key;
  }
  return 'noob';
}

function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(Math.random() * 10);
  return out;
}

const _WALLET_CACHE_TTL = 120; // 2 min — wallet address rarely changes

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly searchCache = new Map<string, { usernames: string[]; ts: number }>();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    @Optional() private readonly privyVerification: PrivyVerificationService | null,
    @Optional() private readonly redisService: RedisService | null,
  ) {}

  /**
   * Get creator display info by Privy user ID (for claim display: username only, no email)
   */
  async findByPrivyId(privyUserId: string): Promise<{ username: string | null } | null> {
    if (!privyUserId || !privyUserId.includes('did:privy:')) {
      return null;
    }
    const { data: user, error } = await this.supabaseService.appUsers
      .select('username')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();

    if (error || !user) {
      return null;
    }
    return { username: user.username ?? null };
  }

  /**
   * Fast-path identity columns from our own DB — populated immediately (no external round-trip)
   * whenever the frontend links/sets an account (see save-twitter-username, setup-username).
   * Used by verifyRecipientIdentityForSendPayment as a first check before falling back to a
   * live Privy API call, which can lag behind Privy's own eventual consistency right after a
   * user links a new account.
   */
  async findIdentityByPrivyId(
    privyUserId: string,
  ): Promise<{ email: string | null; twitterUsername: string | null } | null> {
    if (!privyUserId || !privyUserId.includes('did:privy:')) {
      return null;
    }
    const { data: user, error } = await this.supabaseService.appUsers
      .select('email, twitter_username')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();

    if (error || !user) {
      return null;
    }
    return { email: user.email ?? null, twitterUsername: user.twitter_username ?? null };
  }

  /**
   * Fast-path lookup for a Discord/GitHub/Telegram handle connected via the normalized
   * social_accounts table — same "our own DB first" pattern as findIdentityByPrivyId, since
   * these platforms aren't mirrored onto app_users columns.
   */
  async findSocialHandle(privyUserId: string, platform: SocialPlatform): Promise<string | null> {
    if (!privyUserId || !privyUserId.includes('did:privy:')) return null;
    const { data, error } = await this.supabaseService.socialAccounts
      .select('handle')
      .eq('user_id', privyUserId)
      .eq('platform', platform)
      .maybeSingle();
    if (error || !data) return null;
    return data.handle ?? null;
  }

  /**
   * Reverse lookup: which Loofta user (if any) has this platform+handle connected. Used when
   * creating a claim addressed to a social handle, to pay a registered user's wallet directly
   * instead of falling back to a pending burner claim (mirrors findByUsername/findByEmail).
   */
  async findBySocialHandle(platform: SocialPlatform, handle: string): Promise<{
    id: string;
    privyUserId: string;
    email: string | null;
    username: string | null;
    requirePrivatePayments: boolean;
  }> {
    // Strip Discord's legacy "#0"-style discriminator suffix — see verifyRecipientIdentityForSendPayment.
    const cleanHandle = (handle || '').replace(/^@/, '').replace(/#\d+$/, '').toLowerCase().trim();
    if (!cleanHandle) throw new NotFoundException('Handle is required');

    const { data: social, error: socialError } = await this.supabaseService.socialAccounts
      .select('user_id')
      .eq('platform', platform)
      .eq('handle', cleanHandle)
      .maybeSingle();

    if (socialError || !social?.user_id) {
      throw new NotFoundException('User not found');
    }

    const { data: user, error } = await this.supabaseService.appUsers
      .select('id, privy_user_id, email, username, require_private_payments')
      .eq('privy_user_id', social.user_id)
      .maybeSingle();

    if (error || !user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      privyUserId: user.privy_user_id,
      email: user.email,
      username: user.username,
      requirePrivatePayments: user.require_private_payments === true,
    };
  }

  /**
   * Creates the app_users row for a Privy user on first login if one doesn't exist yet — ported
   * from the web app's POST /api/users/check (a Next.js route mobile can't reach: different
   * origin, coupled to the frontend's Redis cache). Every login method (email, Twitter, SIWS
   * wallet) lands here needing the same bootstrap: without this row, gift-claim identity
   * matching, usernames, and referrals have nothing to key off, even though the core ticket
   * buy/history/redeem flows don't need it (lottery_tickets.user_id is the raw Privy DID).
   *
   * Idempotent — safe to call on every login, not just the first.
   */
  async ensureAppUser(privyUserId: string): Promise<{ id: string; username: string | null }> {
    const { data: existing } = await this.supabaseService.appUsers
      .select('id, username')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();
    if (existing) return existing;

    const privyUser = await this.getPrivyUser(privyUserId);
    const accounts = privyUser?.linked_accounts ?? [];
    const twitterAccount = accounts.find((a: any) => ['twitter', 'x', 'twitter_oauth'].includes(a.type));
    const twitterHandle = twitterAccount
      ? (twitterAccount.username ?? twitterAccount.name ?? '').replace(/^@/, '').toLowerCase().trim() || null
      : null;
    const emailAccount = accounts.find((a: any) => a.type === 'email');
    const email = emailAccount?.address ?? null;

    // Mobile's Seeker login (useSeekerLogin.ts) is wallet-only — no email/Twitter — and passes
    // wallet_client_type: 'seed_vault' / connector_type: 'solana_mobile_wallet_adapter' to Privy
    // at SIWS login, which echoes them back on the linked wallet account. Persisted on
    // app_users.is_seeker_wallet (also still encoded into the loo-skr-xxxxxx username fallback
    // below, kept for display purposes).
    const walletAccount = accounts.find((a: any) => a.type === 'wallet');
    const isSeekerWallet = !!walletAccount && (
      walletAccount.wallet_client_type === 'seed_vault' || walletAccount.connector_type === 'solana_mobile_wallet_adapter'
    );

    const looHandle = twitterHandle
      ?? (email ? email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) : null)
      ?? (isSeekerWallet ? `skr-${randomDigits(6)}` : null)
      ?? 'user';
    const looUsername = await this.generateUniqueLooUsername(looHandle, privyUserId);

    const { data: created, error } = await this.supabaseService.appUsers
      .insert({
        privy_user_id: privyUserId,
        email,
        username: twitterHandle ?? looUsername,
        twitter_username: twitterHandle,
        loo_username: looUsername,
        is_seeker_wallet: isSeekerWallet,
        // New users are born on mainnet — no ATA migration needed.
        ata_migrated_mainnet: true,
        ata_migrated_devnet: true,
      })
      .select('id, username')
      .single();
    if (error || !created) throw new Error(`ensureAppUser: failed to create app_users row: ${error?.message}`);
    return created;
  }

  /**
   * Generates a unique loo-{handle} username, appending a counter on collision. Ported from
   * apps/frontend/src/lib/looUsername.ts — see ensureAppUser for why this now also lives here.
   */
  private async generateUniqueLooUsername(handle: string, privyUserId: string): Promise<string> {
    let counter = 0;
    for (;;) {
      const counterStr = counter === 0 ? '' : String(counter);
      const suffix = handle.slice(0, 16 - counterStr.length) + counterStr;
      const candidate = `loo-${suffix}`;

      const [{ data: byUsername }, { data: byLoo }] = await Promise.all([
        this.supabaseService.appUsers.select('privy_user_id').eq('username', candidate).neq('privy_user_id', privyUserId).limit(1).maybeSingle(),
        this.supabaseService.appUsers.select('privy_user_id').eq('loo_username', candidate).neq('privy_user_id', privyUserId).limit(1).maybeSingle(),
      ]);
      if (!byUsername && !byLoo) return candidate;
      counter = counter === 0 ? 2 : counter + 1;
    }
  }

  /**
   * Get current user's email by Privy user ID (for recipient-check: compare to PENDING_EMAIL claim,
   * and as the recipient address for every notification email sent across the app).
   *
   * app_users.email is only ever written once, at row-creation time (see ensureAppUser / the
   * frontend's /api/users/check) — nothing re-syncs it afterward. A user who first signs up via
   * X and only later links an email through Privy (e.g. useAddEmailToast) ends up with a
   * permanently null column even though Privy has a real email on file, silently skipping every
   * notification. Falls back to a live Privy lookup when the column is null, and opportunistically
   * backfills it so subsequent calls hit the DB again.
   */
  async getEmailByPrivyId(privyUserId: string): Promise<string | null> {
    if (!privyUserId || !privyUserId.includes('did:privy:')) {
      return null;
    }
    const { data: user, error } = await this.supabaseService.appUsers
      .select('email')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();
    if (error) return null;
    if (user?.email) return (user.email as string).trim().toLowerCase();
    return this.resolveLiveEmailAndBackfill(privyUserId);
  }

  /**
   * Shared fallback for a DB-null email column: looks it up live from Privy and, if found,
   * fires off a best-effort backfill of app_users.email so subsequent DB reads (this one
   * included) don't have to hit Privy again. Used by getEmailByPrivyId and resolveGiftRecipient's
   * handle branch — both hit the same stale-null-email problem described on getEmailByPrivyId.
   */
  private async resolveLiveEmailAndBackfill(privyUserId: string): Promise<string | null> {
    const privyUser = await this.getPrivyUser(privyUserId).catch(() => null);
    const emailAccount = privyUser?.linked_accounts?.find((a: any) => (a.type ?? '').toLowerCase() === 'email');
    const liveEmail = (emailAccount?.address as string | undefined)?.trim().toLowerCase();
    if (!liveEmail) return null;

    this.supabaseService.appUsers
      .update({ email: liveEmail })
      .eq('privy_user_id', privyUserId)
      .then(({ error: updateError }: { error: any }) => {
        if (updateError) this.logger.warn(`resolveLiveEmailAndBackfill: failed to backfill email for ${privyUserId}: ${updateError.message}`);
      });
    return liveEmail;
  }

  /**
   * Get user by email (for Send flow: resolve email to username)
   * Returns same shape as findByUsername; used to redirect to /link/username
   */
  async findByEmail(email: string): Promise<{
    id: string;
    privyUserId: string;
    email: string | null;
    username: string | null;
    requirePrivatePayments: boolean;
  }> {
    const clean = (email || '').trim().toLowerCase();
    if (!clean) throw new NotFoundException('Email is required');
    const { data: user, error } = await this.supabaseService.appUsers
      .select('id, privy_user_id, email, username, require_private_payments')
      .eq('email', clean)
      .maybeSingle();
    if (error) {
      this.logger.error('Error querying user by email:', error);
      throw new NotFoundException('User not found');
    }
    // A Loofta account is registered once it has a Privy id — username is optional
    // (email-only signups, or users who haven't picked one yet). Requiring username
    // here made pay-target / createFromEmail treat them as unregistered and add the
    // $0.10 claim fee.
    if (!user?.privy_user_id) throw new NotFoundException('User not found');
    return {
      id: user.id,
      privyUserId: user.privy_user_id,
      email: user.email,
      username: user.username,
      requirePrivatePayments: user.require_private_payments === true,
    };
  }

  /**
   * Best-effort resolve an existing app_users row for an admin lottery gift's recipient — never
   * throws, returns null when nothing matches. Lets createGift auto-fund gifts to already-
   * registered accounts (no claim step needed) while falling back to the claim-link flow for
   * everyone else. 'handle' tries both a Loofta username and a linked Twitter handle in one
   * query, mirroring isGiftRecipient's claim-time check — the admin form doesn't ask which one it
   * is either.
   */
  async resolveGiftRecipient(
    recipientType: 'email' | 'handle',
    identifier: string,
  ): Promise<{ privyUserId: string; email: string | null } | null> {
    try {
      if (recipientType === 'email') {
        const clean = identifier.trim().toLowerCase();
        if (!clean) return null;
        const { data: user } = await this.supabaseService.appUsers
          .select('privy_user_id, email')
          .eq('email', clean)
          .maybeSingle();
        if (!user?.privy_user_id) return null;
        return { privyUserId: user.privy_user_id, email: user.email ?? null };
      }
      const clean = identifier.replace(/^@/, '').trim().toLowerCase();
      if (!clean) return null;
      const { data: user } = await this.supabaseService.appUsers
        .select('privy_user_id, email')
        .or(`username.ilike.${clean},twitter_username.ilike.${clean}`)
        .maybeSingle();
      if (!user?.privy_user_id) return null;
      // Gifting by handle commonly targets X-first users whose app_users.email is still null
      // even though they've since linked one (see getEmailByPrivyId) — fall back live so the
      // gift/free-spin notification actually reaches them instead of silently not sending.
      const email = user.email ?? (await this.resolveLiveEmailAndBackfill(user.privy_user_id));
      return { privyUserId: user.privy_user_id, email };
    } catch (e: any) {
      this.logger.warn(`resolveGiftRecipient(${recipientType}) failed: ${e?.message ?? e}`);
      return null;
    }
  }

  /**
   * Search usernames by prefix (for autocomplete). Cached 1 min; only selects username.
   */
  async searchUsernames(query: string, limit = 10): Promise<{ usernames: string[] }> {
    const clean = (query || '').replace(/^@/, '').trim().toLowerCase();
    if (clean.length < 2) {
      return { usernames: [] };
    }
    const cacheKey = `${clean}:${limit}`;
    const hit = this.searchCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL_MS) {
      return { usernames: hit.usernames };
    }
    const { data: users, error } = await this.supabaseService.appUsers
      .select('username')
      .not('username', 'is', null)
      .ilike('username', `${clean}%`)
      .limit(limit);

    if (error) {
      this.logger.error('Error searching usernames:', error);
      return { usernames: [] };
    }
    const usernames = (users || []).map((u: any) => u.username).filter(Boolean);
    this.searchCache.set(cacheKey, { usernames, ts: Date.now() });
    return { usernames };
  }

  /**
   * Get user by username (NO wallet address returned - privacy)
   */
  async findByUsername(username: string): Promise<{
    id: string;
    privyUserId: string;
    email: string | null;
    username: string | null;
    requirePrivatePayments: boolean;
  }> {
    // Remove @ prefix if present
    const cleanUsername = username.replace(/^@/, '').toLowerCase();

    this.logger.debug(`Looking up user with username: "${cleanUsername}"`);

    // Use maybeSingle() instead of single() to handle 0 rows gracefully.
    // ilike for case-insensitive exact match (DB may store "Lisa" while we query "lisa").
    const { data: user, error } = await this.supabaseService.appUsers
      .select('id, privy_user_id, email, username, require_private_payments')
      .ilike('username', cleanUsername)
      .maybeSingle();

    if (error) {
      this.logger.error(`Error querying user by username "${cleanUsername}":`, error);
      throw new NotFoundException(`User not found: ${error.message}`);
    }

    if (!user) {
      this.logger.warn(`No user found with username: "${cleanUsername}"`);
      throw new NotFoundException('User not found');
    }

    if (!user.privy_user_id) {
      this.logger.warn(`User found but has no Privy ID: ${user.id}`);
      throw new NotFoundException('User has no Privy ID');
    }

    this.logger.debug(`Found user: ${user.id} (${user.username})`);

    // Return only basic user info - NO wallet address (privacy)
    return {
      id: user.id,
      privyUserId: user.privy_user_id,
      email: user.email,
      username: user.username,
      requirePrivatePayments: user.require_private_payments === true,
    };
  }

  /**
   * Twitter send: a handle counts as registered when it matches username, twitter_username,
   * or a linked social_accounts twitter row.
   */
  async findByTwitterOrUsername(handle: string): Promise<{
    id: string;
    privyUserId: string;
    email: string | null;
    username: string | null;
    requirePrivatePayments: boolean;
  }> {
    const clean = (handle || '').replace(/^@/, '').toLowerCase().trim();
    if (!clean || !/^[a-z0-9_]{1,32}$/.test(clean)) throw new NotFoundException('User not found');
    const { data: user, error } = await this.supabaseService.appUsers
      .select('id, privy_user_id, email, username, require_private_payments')
      .or(`username.ilike.${clean},twitter_username.ilike.${clean}`)
      .maybeSingle();
    if (!error && user?.privy_user_id) {
      return {
        id: user.id,
        privyUserId: user.privy_user_id,
        email: user.email,
        username: user.username,
        requirePrivatePayments: user.require_private_payments === true,
      };
    }
    const { data: social } = await this.supabaseService.socialAccounts
      .select('user_id')
      .eq('platform', 'twitter')
      .eq('handle', clean)
      .maybeSingle();
    if (!social?.user_id) throw new NotFoundException('User not found');
    const { data: linked } = await this.supabaseService.appUsers
      .select('id, privy_user_id, email, username, require_private_payments')
      .eq('privy_user_id', social.user_id)
      .maybeSingle();
    if (!linked?.privy_user_id) throw new NotFoundException('User not found');
    return {
      id: linked.id,
      privyUserId: linked.privy_user_id,
      email: linked.email,
      username: linked.username,
      requirePrivatePayments: linked.require_private_payments === true,
    };
  }

  /** Public send-form lookup. No wallet, no email — only whether this person is on Loofta
   *  and whether they only accept private payments. */
  async lookupPayTarget(opts: {
    kind: 'email' | 'username' | 'twitter' | 'social';
    value: string;
    platform?: SocialPlatform;
  }): Promise<{ registered: boolean; requirePrivatePayments: boolean }> {
    try {
      const user = opts.kind === 'email'
        ? await this.findByEmail(opts.value)
        : opts.kind === 'twitter'
          ? await this.findByTwitterOrUsername(opts.value)
          : opts.kind === 'social' && opts.platform
            ? await this.findBySocialHandle(opts.platform, opts.value)
            : await this.findByUsername(opts.value);
      return { registered: true, requirePrivatePayments: user.requirePrivatePayments };
    } catch (err) {
      if (err instanceof NotFoundException) return { registered: false, requirePrivatePayments: false };
      throw err;
    }
  }

  async getRequirePrivatePayments(privyUserId: string): Promise<boolean> {
    const { data } = await this.supabaseService.appUsers
      .select('require_private_payments')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();
    return data?.require_private_payments === true;
  }

  async setRequirePrivatePayments(privyUserId: string, enabled: boolean): Promise<void> {
    const { error } = await this.supabaseService.appUsers
      .update({ require_private_payments: enabled })
      .eq('privy_user_id', privyUserId);
    if (error) throw new BadRequestException('Could not update this setting.');
  }

  /**
   * Get user's Solana wallet address from Privy (server-side only, Redis-cached 5 min by default).
   * Wallet address is never exposed to the frontend.
   *
   * Pass `skipCache: true` whenever the result will be used as a fund destination
   * (deposits/top-ups/payouts) — a stale cache hit can hand out a wallet Privy has
   * since archived during a wallet rotation, stranding funds. See PrivyVerificationService.getPrivyUser.
   */
  async getSolanaWalletAddress(privyUserId: string, opts?: { skipCache?: boolean }): Promise<string> {
    const privyUser = await this.getPrivyUser(privyUserId, opts);
    if (!privyUser) {
      throw new Error('Failed to fetch wallet from Privy');
    }

    const linkedAccounts: any[] = privyUser.linked_accounts || [];
    this.logger.debug(`Found ${linkedAccounts.length} linked accounts for ${privyUserId}`);

    const isSolanaAddress = (addr: string) => addr && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);

    // 1) Prefer wallet/smart_wallet with Solana address (matches frontend Header balance display)
    const walletOrSmart = linkedAccounts.find((account: any) => {
      if (account.type !== 'wallet' && account.type !== 'smart_wallet') return false;
      return isSolanaAddress(account.address);
    });
    if (walletOrSmart?.address) {
      this.logger.debug(`Using Solana wallet (type=${walletOrSmart.type}): ${walletOrSmart.address.slice(0, 8)}...`);
      return walletOrSmart.address;
    }

    // 2) Fallback: solana_embedded_wallet / solana type
    const embedded = linkedAccounts.find((account: any) =>
      (account.type === 'solana_embedded_wallet' || account.type === 'solana') && isSolanaAddress(account.address),
    );
    if (embedded?.address) {
      this.logger.debug(`Using Solana embedded wallet: ${embedded.address.slice(0, 8)}...`);
      return embedded.address;
    }

    // 3) Fallback: any account with a Solana address or chain
    const solanaWallet = linkedAccounts.find((account: any) => {
      const address = account?.address;
      if (isSolanaAddress(address)) return true;
      const chain =
        account?.chain_type === 'solana' || account?.chainType === 'solana' ||
        (String(account?.chain_id || account?.chainId || '').toLowerCase().includes('solana'));
      return !!chain && address;
    });

    if (!solanaWallet?.address) {
      throw new NotFoundException('User has no Solana embedded wallet');
    }
    return solanaWallet.address;
  }

  /**
   * Get Privy user ID for an app user (by internal user id).
   * Used to verify sender ownership via Privy linked accounts when wallet signature fails.
   */
  async getPrivyUserIdByAppUserId(appUserId: string): Promise<string | null> {
    const { data: user, error } = await this.supabaseService.appUsers
      .select('privy_user_id')
      .eq('id', appUserId)
      .maybeSingle();
    if (error || !user?.privy_user_id) return null;
    return user.privy_user_id;
  }

  /**
   * Return true if the given Solana address is one of the Privy user's linked Solana wallets.
   * Used as fallback when wallet message signature verification fails (e.g. Privy embedded wallet).
   */
  async isSolanaAddressInLinkedAccounts(privyUserId: string, solanaAddress: string): Promise<boolean> {
    const user = await this.getPrivyUser(privyUserId);
    if (!user?.linked_accounts?.length) return false;
    const normalized = solanaAddress.trim();
    for (const account of user.linked_accounts) {
      const type = (account.type || '').toLowerCase();
      const chainType = (account.chain_type || '').toLowerCase();
      const chainId = (account.chain_id || '').toString().toLowerCase();
      const isSolana =
        type === 'wallet' ||
        type === 'solana' ||
        type === 'solana_embedded_wallet' ||
        chainType === 'solana' ||
        chainId.startsWith('solana:');
      if (!isSolana) continue;
      const addr = (account.address || '').toString().trim();
      if (addr && addr === normalized) return true;
    }
    return false;
  }

  /**
   * Return true if the given EVM address (e.g. a Base wallet) is one of the Privy user's linked
   * accounts. EVM addresses are case-insensitive (mixed-case checksum), unlike Solana's base58.
   */
  async isEvmAddressInLinkedAccounts(privyUserId: string, evmAddress: string): Promise<boolean> {
    const user = await this.getPrivyUser(privyUserId);
    if (!user?.linked_accounts?.length) return false;
    const normalized = evmAddress.trim().toLowerCase();
    for (const account of user.linked_accounts) {
      const type = (account.type || '').toLowerCase();
      const chainType = (account.chain_type || account.chainType || '').toLowerCase();
      if (type.includes('solana') || chainType === 'solana') continue;
      const addr = (account.address || '').toString().trim().toLowerCase();
      // Any linked 0x address is an EVM wallet (embedded, smart wallet, or external).
      if (/^0x[0-9a-f]{40}$/.test(addr) && addr === normalized) return true;
    }
    return false;
  }

  /**
   * Fetch full Privy user (linked_accounts etc.) with Redis caching.
   * Delegates to PrivyVerificationService when available; falls back to raw HTTP.
   */
  async getPrivyUser(privyUserId: string, opts?: { skipCache?: boolean }): Promise<{ linked_accounts: any[] } | null> {
    if (this.privyVerification) {
      return this.privyVerification.getPrivyUser(privyUserId, opts);
    }
    // Fallback for when service is not yet injected (e.g. early boot) — always live, no cache involved.
    const privyAppId = this.configService.get<string>('PRIVY_APP_ID');
    const privyAppSecret = this.configService.get<string>('PRIVY_APP_SECRET');
    if (!privyAppId || !privyAppSecret) return null;
    const res = await fetch(`https://api.privy.io/v1/users/${privyUserId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'privy-app-id': privyAppId,
        Authorization: `Basic ${Buffer.from(`${privyAppId}:${privyAppSecret}`).toString('base64')}`,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const linked_accounts = data?.linked_accounts || data?.linkedAccounts || [];
    return { linked_accounts };
  }

  /**
   * Verify that the Privy user's linked accounts match the send-payment recipient identifier.
   * Used to authorize claim: only the designated email/twitter can claim.
   */
  async verifyRecipientIdentityForSendPayment(
    privyUserId: string,
    recipientType: RecipientType,
    recipientIdentifier: string,
  ): Promise<boolean> {
    const normalized = this.normalizeRecipientIdentifier(recipientType, recipientIdentifier);
    if (recipientType === 'username') {
      const row = await this.findByPrivyId(privyUserId);
      const uname = (row?.username || '').replace(/^@/, '').toLowerCase().trim();
      return Boolean(uname && uname === normalized);
    }

    // Discord/GitHub/Telegram: backed by the normalized social_accounts table, not app_users
    // columns or (for Telegram) Privy linked_accounts at all — see findSocialHandle.
    if (recipientType === 'discord' || recipientType === 'github' || recipientType === 'telegram') {
      const handle = await this.findSocialHandle(privyUserId, recipientType);
      if (handle && handle.replace(/^@/, '').replace(/#\d+$/, '').toLowerCase().trim() === normalized) return true;

      // Telegram is linked via a separate throwaway Privy login on the loofta.com relay domain
      // (Telegram's widget is blocked on pay.loofta.com's .xyz TLD), not the user's main Privy
      // identity — so it's stored directly in social_accounts with no live fallback to try here.
      if (recipientType === 'telegram') return false;

      // Discord/GitHub also go through Privy OAuth linking, so fall back to a live check the
      // same way email/twitter do below (in case social_accounts hasn't been written yet).
      const user = await this.getPrivyUser(privyUserId);
      if (!user) return false;
      const oauthTypes = recipientType === 'discord' ? ['discord', 'discord_oauth'] : ['github', 'github_oauth'];
      for (const account of user.linked_accounts) {
        const type = (account.type || '').toLowerCase();
        if (!oauthTypes.includes(type)) continue;
        // Discord's legacy discriminator (e.g. "username#0") can still show up in Privy's raw
        // linked_accounts even though Discord dropped it for migrated accounts — strip it so a
        // sender who typed the plain username still matches.
        const handle = (account.username || account.name || account.address || '')
          .toString()
          .replace(/^@/, '')
          .replace(/#\d+$/, '')
          .toLowerCase()
          .trim();
        if (handle && normalized === handle) return true;
      }
      return false;
    }

    // Fast path: our own DB, populated immediately (no external round-trip) whenever the
    // frontend links/sets an account. Checked first because the live Privy API call below can
    // briefly lag right after a user links a new account (Privy's own eventual consistency) —
    // this fast path is what actually fixes that, not another layer of client-side retrying.
    const identity = await this.findIdentityByPrivyId(privyUserId);
    if (recipientType === 'email' && identity?.email) {
      if (identity.email.toLowerCase().trim() === normalized) return true;
    }
    if (recipientType === 'twitter' && identity?.twitterUsername) {
      if (identity.twitterUsername.replace(/^@/, '').toLowerCase().trim() === normalized) return true;
    }

    const user = await this.getPrivyUser(privyUserId);
    if (!user) return false;

    for (const account of user.linked_accounts) {
      const type = (account.type || '').toLowerCase();
      if (recipientType === 'email' && (type === 'email' || type === 'google' || type === 'apple')) {
        const email = (account.address || account.email || '').toString().toLowerCase().trim();
        if (email && normalized === email) return true;
      }
      if (recipientType === 'twitter' && (type === 'twitter' || type === 'x' || type === 'twitter_oauth')) {
        const handle = (account.username || account.name || account.address || '')
          .toString()
          .replace(/^@/, '')
          .toLowerCase()
          .trim();
        if (handle && normalized === handle) return true;
      }
    }
    return false;
  }

  private normalizeRecipientIdentifier(type: RecipientType, value: string): string {
    const v = value.trim();
    if (type === 'email') return v.toLowerCase();
    // Strip a trailing Discord discriminator (e.g. "username#0") — senders no longer need to
    // type one, and this keeps old habits working against handles stored without it.
    return v.replace(/^@/, '').replace(/#\d+$/, '').toLowerCase();
  }

  /**
   * Debug method to list all usernames (for debugging)
   */
  async listAllUsernames(): Promise<{ usernames: string[] }> {
    const { data: users, error } = await this.supabaseService.appUsers
      .select('username')
      .not('username', 'is', null);

    if (error) {
      this.logger.error('Error listing usernames:', error);
      return { usernames: [] };
    }

    const usernames = (users || []).map((u: any) => u.username).filter(Boolean);
    this.logger.debug(`Found ${usernames.length} usernames`);
    return { usernames };
  }

  async getUserTier(privyUserId: string): Promise<{ totalVolumeUsd: number; tier: string }> {
    const { data, error } = await this.supabaseService.appUsers
      .select('total_volume_usd')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();

    const volume = error || !data ? 0 : (Number((data as Record<string, unknown>).total_volume_usd) || 0);
    return { totalVolumeUsd: volume, tier: computeTierKey(volume) };
  }

  /**
   * Get Solana embedded wallet balance in USD and address (same wallet Privy uses to sign).
   */
  async getSolanaWalletBalanceAndAddress(privyUserId: string): Promise<{ balanceUSD: number; walletAddress: string }> {
    const walletAddress = await this.getSolanaWalletAddress(privyUserId);
    const balanceUSD = await this.getSolanaWalletBalanceUSDInternal(walletAddress);
    return { balanceUSD, walletAddress };
  }

  /**
   * Get Solana wallet balance in USD (for checking if wallet can be regenerated)
   */
  async getSolanaWalletBalanceUSD(privyUserId: string): Promise<number> {
    const walletAddress = await this.getSolanaWalletAddress(privyUserId);
    return this.getSolanaWalletBalanceUSDInternal(walletAddress);
  }

  /**
   * Get native SOL + USDC balances for the mobile Seeker-wallet profile display. Same wallet
   * resolution as getSolanaWalletBalanceAndAddress (works for an MWA-linked external wallet too,
   * not just Privy's embedded one — getSolanaWalletAddress just picks the first Solana 'wallet'
   * linked_account either way), kept as a separate method/endpoint so this doesn't disturb the
   * existing USD-only balance check used for wallet-regeneration eligibility.
   */
  async getSolanaWalletBalances(
    privyUserId: string,
  ): Promise<{ walletAddress: string; solBalance: number; usdcBalance: number; skrDomain: string | null }> {
    const walletAddress = await this.getMobileWalletAddress(privyUserId);
    const [{ solBalance, usdcBalance }, skrDomain] = await Promise.all([
      this.getSolAndUsdcBalancesInternal(walletAddress),
      this.getSkrDomain(walletAddress),
    ]);
    return { walletAddress, solBalance, usdcBalance, skrDomain };
  }

  /**
   * Same resolution as getSolanaWalletAddress, but when a user has more than one 'wallet' linked
   * account — e.g. an old web-created embedded wallet alongside the mobile Seeker/MWA wallet on
   * the same Privy user — prefers the Seeker one. That's the wallet actually holding funds and
   * signing transactions in the mobile app; getSolanaWalletAddress's plain `.find()` would
   * otherwise silently return whichever wallet account happens to come first (often the older,
   * empty one), showing $0 balances even though the Seeker wallet is funded. Detection mirrors
   * ensureAppUser's wallet_client_type/connector_type check.
   */
  private async getMobileWalletAddress(privyUserId: string): Promise<string> {
    const privyUser = await this.getPrivyUser(privyUserId);
    const linkedAccounts: any[] = privyUser?.linked_accounts || [];
    const isSolanaAddress = (addr: string) => addr && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);

    const seeker = linkedAccounts.find(
      (account: any) =>
        account.type === 'wallet' &&
        isSolanaAddress(account.address) &&
        (account.wallet_client_type === 'seed_vault' || account.connector_type === 'solana_mobile_wallet_adapter'),
    );
    if (seeker?.address) {
      this.logger.debug(`Using Seeker wallet for balances: ${seeker.address.slice(0, 8)}...`);
      return seeker.address;
    }

    return this.getSolanaWalletAddress(privyUserId);
  }

  private getSolanaRpcUrl(): string {
    const cluster =
      process.env.SOLANA_CLUSTER?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() ||
      'mainnet-beta';
    const isDevnet = cluster === 'devnet' || cluster === 'testnet';
    if (isDevnet) {
      const heliusKey = process.env.HELIUS_API_KEY?.trim();
      return process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
        (heliusKey ? `https://devnet.helius-rpc.com/?api-key=${heliusKey}` : 'https://api.devnet.solana.com');
    }
    return getMainnetSolanaRpcUrl(this.configService);
  }

  /**
   * Reverse-resolves a wallet's Solana Mobile Seeker ID — the ".skr" domain claimed on-device
   * during Seeker setup, issued by AllDomains/ANS (not Bonfida's .sol SNS). Best-effort: not
   * every wallet has claimed one, and devnet has no .skr registry.
   */
  async getSkrDomain(walletAddress: string): Promise<string | null> {
    try {
      const connection = new Connection(this.getSolanaRpcUrl());
      const parser = new TldParser(connection);
      const domains = (await parser.getParsedAllUserDomainsFromTld(walletAddress, 'skr')) as { domain: string }[];
      return domains[0]?.domain ?? null;
    } catch (error) {
      this.logger.warn(`getSkrDomain failed for ${walletAddress.slice(0, 8)}...: ${error}`);
      return null;
    }
  }

  private async getSolanaWalletBalanceUSDInternal(walletAddress: string): Promise<number> {
    const cluster =
      process.env.SOLANA_CLUSTER?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() ||
      'mainnet-beta';
    const isDevnet = cluster === 'devnet' || cluster === 'testnet';

    const heliusKey = process.env.HELIUS_API_KEY?.trim();
    const solanaRpcUrl = isDevnet
      ? (process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
         (heliusKey ? `https://devnet.helius-rpc.com/?api-key=${heliusKey}` : 'https://api.devnet.solana.com'))
      : getMainnetSolanaRpcUrl(this.configService);

    const usdcMint = isDevnet
      ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
      : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    try {
      const response = await fetch(solanaRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            walletAddress,
            { mint: usdcMint },
            { encoding: 'jsonParsed' },
          ],
        }),
      });

      const data = await response.json();

      if (data.error || !data.result?.value || data.result.value.length === 0) {
        return 0;
      }

      const account = data.result.value[0];
      const balance = account.account.data.parsed.info.tokenAmount.uiAmount;

      return balance || 0;
    } catch (error) {
      this.logger.error('Error fetching Solana balance:', error);
      return 0;
    }
  }

  private async getSolAndUsdcBalancesInternal(
    walletAddress: string,
  ): Promise<{ solBalance: number; usdcBalance: number }> {
    const cluster =
      process.env.SOLANA_CLUSTER?.trim() ||
      process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim() ||
      'mainnet-beta';
    const isDevnet = cluster === 'devnet' || cluster === 'testnet';

    const heliusKey = process.env.HELIUS_API_KEY?.trim();
    const solanaRpcUrl = isDevnet
      ? (process.env.SOLANA_DEVNET_RPC_URL?.trim() ||
         (heliusKey ? `https://devnet.helius-rpc.com/?api-key=${heliusKey}` : 'https://api.devnet.solana.com'))
      : getMainnetSolanaRpcUrl(this.configService);

    const usdcMint = isDevnet
      ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
      : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    try {
      // Two individual requests, not a batched array — many RPC providers (e.g. Alchemy's free
      // tier) reject batch JSON-RPC with a 200 OK + error body ({"error":{"code":-32403,...}}),
      // which isn't an HTTP failure so fetch() doesn't throw; it silently fell through to the
      // catch-all $0 fallback below on every call.
      const post = (body: unknown) =>
        fetch(solanaRpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.json());

      const [tokenResult, balanceResult] = await Promise.all([
        post({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTokenAccountsByOwner',
          params: [walletAddress, { mint: usdcMint }, { encoding: 'jsonParsed' }],
        }),
        post({ jsonrpc: '2.0', id: 2, method: 'getBalance', params: [walletAddress] }),
      ]);

      if (tokenResult?.error || balanceResult?.error) {
        throw new Error(
          `RPC error: ${JSON.stringify(tokenResult?.error ?? balanceResult?.error).slice(0, 300)}`,
        );
      }

      const usdcAccount = tokenResult?.result?.value?.[0];
      const usdcBalance = usdcAccount?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;

      const lamports = balanceResult?.result?.value ?? 0;
      const solBalance = lamports / 1e9;

      return { solBalance, usdcBalance };
    } catch (error) {
      this.logger.error('Error fetching Solana/USDC balances:', error);
      return { solBalance: 0, usdcBalance: 0 };
    }
  }

  async getForceUpdateStatus(privyUserId: string, updateId: string): Promise<{ completed: boolean }> {
    const cacheKey = forceUpdateKey(privyUserId, updateId);
    if (this.redisService) {
      const cached = await this.redisService.get(cacheKey).catch(() => null);
      if (cached === '1') return { completed: true };
    }

    const { data } = await this.supabaseService.forceUpdate
      .select('user_id')
      .eq('user_id', privyUserId)
      .eq('update_id', updateId)
      .maybeSingle();
    const completed = !!data;
    if (completed && this.redisService) {
      await this.redisService.set(cacheKey, '1', FORCE_UPDATE_TTL).catch(() => {});
    }
    return { completed };
  }

  /** True once the recipient has completed the mandatory mainnet wallet-migration update.
   *  Users created after 2026-06-29 were born on mainnet and are always considered complete. */
  async hasCompletedMainnetWalletUpdate(privyUserId: string): Promise<boolean> {
    const { completed } = await this.getForceUpdateStatus(privyUserId, MAINNET_WALLET_UPDATE_ID);
    if (completed) return true;

    // New users (after the migration was shipped) never had old ATAs to migrate.
    const MIGRATION_CUTOFF = new Date('2026-06-28T00:00:00Z');
    const { data: user } = await this.supabaseService.appUsers
      .select('created_at')
      .eq('privy_user_id', privyUserId)
      .maybeSingle();
    if (user?.created_at && new Date(user.created_at) >= MIGRATION_CUTOFF) return true;

    return false;
  }

  async markForceUpdateComplete(privyUserId: string, updateId: string): Promise<void> {
    const { error } = await this.supabaseService.forceUpdate
      .upsert({ user_id: privyUserId, update_id: updateId }, { onConflict: 'user_id,update_id' });
    if (error) {
      this.logger.error('markForceUpdateComplete error:', error);
      throw new Error('Failed to mark update complete');
    }
    // Cache immediately so the next check from any device skips the DB
    if (this.redisService) {
      await this.redisService.set(forceUpdateKey(privyUserId, updateId), '1', FORCE_UPDATE_TTL).catch(() => {});
    }
  }
}
