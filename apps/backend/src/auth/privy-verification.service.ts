import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import { RedisService } from '@/redis/redis.service';

const PRIVY_USER_EXISTS_TTL = 300; // 5 min — user IDs don't change
const PRIVY_USER_DATA_TTL = 300;   // 5 min — wallet list rarely changes
const PRIVY_USER_NEGATIVE_TTL = 60; // 1 min — cache negative to limit burst

@Injectable()
export class PrivyVerificationService {
  private readonly logger = new Logger(PrivyVerificationService.name);
  private privyClient: PrivyClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {
    const appId = this.configService.get<string>('PRIVY_APP_ID');
    const appSecret = this.configService.get<string>('PRIVY_APP_SECRET');
    if (appId && appSecret) {
      this.privyClient = new PrivyClient(appId, appSecret);
      this.logger.log('PrivyClient initialized — JWT verification active');
    } else {
      this.logger.warn(
        'PRIVY_APP_ID / PRIVY_APP_SECRET not configured — ' +
        'token verification is DISABLED (only use in local dev)',
      );
    }
  }

  private readonly identityCache = new Map<string, { ok: boolean; at: number }>();

  /**
   * True if the Privy account has at least one non-wallet login method (email, phone, social).
   * A wallet-only account costs an attacker nothing to mint, so money-moving and sponsored
   * routes require more than a bare wallet (2026-11-20: throwaway Phantom-only accounts drained
   * the fee payer). Fails open if Privy itself is unreachable, so an outage never locks users out.
   */
  async hasVerifiedIdentity(userId: string): Promise<boolean> {
    if (!this.privyClient) return true;
    const hit = this.identityCache.get(userId);
    if (hit && Date.now() - hit.at < (hit.ok ? 300_000 : 30_000)) return hit.ok;
    try {
      const user = await this.privyClient.getUser(userId);
      const ok = (user.linkedAccounts ?? []).some((a) => /^(email|phone|custom_auth|telegram)$|_oauth$/.test(String((a as { type?: string }).type)));
      this.identityCache.set(userId, { ok, at: Date.now() });
      return ok;
    } catch (e: any) {
      this.logger.warn(`[hasVerifiedIdentity] Privy lookup failed for ${userId}: ${e?.message}`);
      return true;
    }
  }

  get isConfigured(): boolean {
    return this.privyClient !== null;
  }

  /**
   * Verify a Privy access token from Authorization: Bearer.
   * Fast: local JWT signature check using Privy's cached public keys.
   * Returns the verified userId or null if invalid/expired.
   */
  async verifyAccessToken(token: string): Promise<string | null> {
    if (!this.privyClient) {
      this.logger.warn('[verifyAccessToken] Privy not configured — cannot verify JWT');
      return null;
    }
    try {
      const claims = await this.privyClient.verifyAuthToken(token);
      return claims.userId;
    } catch (e: any) {
      this.logger.debug(`[verifyAccessToken] Invalid token: ${e?.message}`);
      return null;
    }
  }

  /**
   * Legacy path: confirm that a raw user ID header maps to a real Privy user.
   * Network call to Privy API, Redis-cached for 5 min.
   * Use ONLY as a backward-compat fallback — migrate callers to JWT.
   * Returns true if the user exists, false otherwise.
   */
  async verifyUserId(userId: string): Promise<boolean> {
    if (!userId?.includes('did:privy:')) return false;

    // When Privy is not configured (local dev), trust the header.
    if (!this.privyClient) return true;

    const cacheKey = `privy:user:exists:${userId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) return cached === '1';

    try {
      await this.privyClient.getUser(userId);
      await this.redis.set(cacheKey, '1', PRIVY_USER_EXISTS_TTL);
      return true;
    } catch {
      await this.redis.set(cacheKey, '0', PRIVY_USER_NEGATIVE_TTL);
      return false;
    }
  }

  /**
   * Fetch full Privy user object (linked_accounts etc.) with Redis caching.
   * Replaces direct Privy API calls in UsersService.
   * Pass `skipCache: true` for any lookup that resolves a fund destination
   * (deposits/top-ups) — a stale cache hit here can hand out an address
   * Privy has since archived during a wallet rotation.
   */
  async getPrivyUser(userId: string, opts?: { skipCache?: boolean }): Promise<{ linked_accounts: any[] } | null> {
    if (!userId?.includes('did:privy:')) return null;

    const cacheKey = `privy:user:data:${userId}`;
    if (!opts?.skipCache) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          // corrupt cache entry — fall through to API
        }
      }
    }

    if (!this.privyClient) {
      // Fallback: use raw HTTP call when SDK not fully configured
      return this.fetchPrivyUserHttp(userId);
    }

    try {
      const privyUser = await this.privyClient.getUser(userId);
      const linked_accounts: any[] = (privyUser as any)?.linkedAccounts ?? (privyUser as any)?.linked_accounts ?? [];
      const result = { linked_accounts };
      await this.redis.set(cacheKey, JSON.stringify(result), PRIVY_USER_DATA_TTL);
      return result;
    } catch (e: any) {
      this.logger.warn(`[getPrivyUser] Failed for ${userId}: ${e?.message}`);
      return null;
    }
  }

  /**
   * Bust the cached Privy user record (linked_accounts etc). Call this right after
   * a client links a new account (email/X/etc) so identity-gated reads — e.g. claim
   * recipient checks — see the new linked account immediately instead of waiting out
   * the 5-minute TTL.
   */
  async invalidatePrivyUserCache(userId: string): Promise<void> {
    if (!userId?.includes('did:privy:')) return;
    await this.redis.del(`privy:user:data:${userId}`);
  }

  /**
   * Raw HTTP fallback used when SDK is not initialized (e.g. during module init).
   */
  private async fetchPrivyUserHttp(userId: string): Promise<{ linked_accounts: any[] } | null> {
    const appId = this.configService.get<string>('PRIVY_APP_ID');
    const appSecret = this.configService.get<string>('PRIVY_APP_SECRET');
    if (!appId || !appSecret) return null;
    try {
      const res = await fetch(`https://api.privy.io/v1/users/${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'privy-app-id': appId,
          Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const linked_accounts = data?.linked_accounts ?? data?.linkedAccounts ?? [];
      return { linked_accounts };
    } catch {
      return null;
    }
  }
}
