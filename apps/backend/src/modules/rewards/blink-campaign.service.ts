import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'node:crypto';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';

export type BlinkTaskKey = 'setup_passkeys' | 'two_deposits' | 'two_private_payments';

export interface BlinkTaskStatus {
  key: BlinkTaskKey;
  label: string;
  description: string;
  completed: boolean;
  progress?: number;
  total?: number;
}

export interface BlinkCampaignData {
  tasks: BlinkTaskStatus[];
  qualified: boolean;
}

const CAMPAIGN_START = new Date('2026-07-02T12:00:00.000Z');
// Aug 15, 5pm CEST (Central Europe is on daylight time in August, UTC+2) = 15:00 UTC.
const CAMPAIGN_END = new Date('2026-08-15T15:00:00.000Z');

export interface BlinkAdminUserStatus {
  privyUserId: string;
  username: string | null;
  email: string | null;
  solanaAddress: string | null;
  hasPasskeys: boolean;
  depositCount: number;
  privatePaymentsCount: number;
  qualified: boolean;
  /** Set when the Blink merchant-API lookup failed — depositCount is unreliable (likely understated), not a genuine zero. */
  depositLookupError: string | null;
}

interface BlinkDepositLookup {
  count: number;
  error: string | null;
}

@Injectable()
export class BlinkCampaignService {
  private readonly logger = new Logger(BlinkCampaignService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async getBlinkCampaign(privyUserId: string): Promise<BlinkCampaignData> {
    // Resolve the wallet address server-side (same cached lookup UsersService uses everywhere
    // else in the app) rather than trusting a client-supplied address. This intentionally allows
    // the 5-min Redis cache: a transient Privy hiccup should fall back to the last-known address
    // instead of zeroing out a user's deposit count for that request.
    const solanaAddress = await this.getPrivySolanaAddress(privyUserId);
    const [blinkLookup, privatePaymentsCount] = await Promise.all([
      this.getBlinkDepositsCount(solanaAddress ?? undefined),
      this.getMainnetPrivatePaymentsCount(privyUserId),
    ]);
    const blinkDeposits = blinkLookup.count;

    // Quest 1: setup passkeys — inferred from having at least 1 Blink deposit
    // (you can't deposit without setting up passkeys first)
    const hasPasskeys = blinkDeposits >= 1;

    // Quest 2: at least 2 completed deposits with Blink
    const hasTwoDeposits = blinkDeposits >= 2;

    // Quest 3: at least 2 mainnet private payments on Loofta
    const hasTwoPrivatePayments = privatePaymentsCount >= 2;

    const tasks: BlinkTaskStatus[] = [
      {
        key: 'setup_passkeys',
        label: 'Set up Blink with passkeys',
        description: 'Go to your balance, tap Top up, and deposit with Blink — this creates your Blink account and passkeys.',
        completed: hasPasskeys,
      },
      {
        key: 'two_deposits',
        label: 'Make at least 2 deposits with Blink',
        description: 'Deposit funds into your Blink wallet twice during the campaign (min $5 each). Make sure you have enough to cover private payments.',
        completed: hasTwoDeposits,
        progress: Math.min(blinkDeposits, 2),
        total: 2,
      },
      {
        key: 'two_private_payments',
        label: 'Send 2 mainnet private payments',
        description: 'Send at least 2 private payments on Loofta mainnet during the campaign (min $5 each).',
        completed: hasTwoPrivatePayments,
        progress: Math.min(privatePaymentsCount, 2),
        total: 2,
      },
    ];

    const qualified = tasks.every((t) => t.completed);

    return { tasks, qualified };
  }

  /**
   * Returns the number of completed Blink deposits since BLINK_CAMPAIGN_START.
   * Step 1: GET /v1/merchant-users?embeddedWalletAddress={address} → get Blink userId(s)
   * Step 2: GET /v1/merchant-deposits?userId={id}&status=completed&createdAfter={start}&limit=2 → count items
   * Using limit=2 per userId is enough since we only need to know if count is 0, 1, or ≥2.
   *
   * The same embedded wallet address can resolve to MORE THAN ONE Blink merchant-user record
   * (e.g. an abandoned/never-confirmed signup followed by a real one) — sum completed deposits
   * across every userId returned rather than trusting users[0], which may be the stale one with
   * zero completed deposits while a later userId for the same wallet has the real ones.
   */
  private async getBlinkDepositsCount(solanaAddress?: string): Promise<BlinkDepositLookup> {
    if (!solanaAddress) {
      return { count: 0, error: null };
    }

    const merchantId = this.config.get<string>('BLINK_MERCHANT_ID');
    const privateKeyRaw = this.config.get<string>('BLINK_MERCHANT_PRIVATE_KEY');

    if (!merchantId || !privateKeyRaw) {
      this.logger.warn('BLINK_MERCHANT_ID or BLINK_MERCHANT_PRIVATE_KEY not set — Blink quests return 0');
      return { count: 0, error: 'merchant_not_configured' };
    }

    try {
      // Step 1: resolve Blink userId(s) from wallet address
      const authHeader1 = this.buildMerchantAuthHeader(merchantId, privateKeyRaw);
      const usersUrl = `https://api.blink.cash/v1/merchant-users?embeddedWalletAddress=${encodeURIComponent(solanaAddress)}&chainId=792703809`;
      const usersRes = await fetch(usersUrl, {
        headers: { 'X-Merchant-Authorization': authHeader1, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!usersRes.ok) {
        const errText = await usersRes.text().catch(() => '');
        this.logger.warn(`Blink merchant-users API error for ${solanaAddress}: ${usersRes.status} — ${errText}`);
        return { count: 0, error: `merchant-users ${usersRes.status}` };
      }

      const usersBody = await usersRes.json();
      const users: Array<{ userId?: string }> =
        Array.isArray(usersBody) ? usersBody : (usersBody.items ?? usersBody.data ?? []);

      const blinkUserIds = users.map((u) => u.userId).filter((id): id is string => !!id);
      if (!blinkUserIds.length) {
        this.logger.debug(`No Blink merchant user found for wallet ${solanaAddress}`);
        return { count: 0, error: null };
      }

      // Step 2: count completed deposits since campaign start, summed across every userId tied
      // to this wallet. Stop early once we've confirmed ≥2 — that's all the campaign needs.
      let total = 0;
      for (const blinkUserId of blinkUserIds) {
        const authHeader2 = this.buildMerchantAuthHeader(merchantId, privateKeyRaw);
        const depositsUrl = `https://api.blink.cash/v1/merchant-deposits?userId=${encodeURIComponent(blinkUserId)}&status=completed&createdAfter=${encodeURIComponent(CAMPAIGN_START.toISOString())}&limit=2`;
        const depositsRes = await fetch(depositsUrl, {
          headers: { 'X-Merchant-Authorization': authHeader2, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000),
        });

        if (!depositsRes.ok) {
          const errText = await depositsRes.text().catch(() => '');
          this.logger.warn(`Blink merchant-deposits API error for user ${blinkUserId}: ${depositsRes.status} — ${errText}`);
          return { count: 0, error: `merchant-deposits ${depositsRes.status}` };
        }

        const depositsBody = await depositsRes.json();
        const deposits: unknown[] =
          Array.isArray(depositsBody) ? depositsBody : (depositsBody.items ?? depositsBody.data ?? []);

        total += deposits.length;
        if (total >= 2) break;
      }

      return { count: total, error: null };
    } catch (e) {
      this.logger.warn(`Blink merchant API fetch failed for ${solanaAddress}: ${(e as Error)?.message}`);
      return { count: 0, error: (e as Error)?.message ?? 'fetch_failed' };
    }
  }

  async getAllBlinkCampaignStatus(): Promise<BlinkAdminUserStatus[]> {
    const users = await this.supabase.getAllAppUsersWithPrivyId();
    if (!users.length) return [];

    const CONCURRENCY = 20;
    const results: BlinkAdminUserStatus[] = [];

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (u: any) => {
          const solanaAddress = await this.getPrivySolanaAddress(u.privy_user_id);
          const [blinkLookup, privatePaymentsCount] = await Promise.all([
            this.getBlinkDepositsCount(solanaAddress ?? undefined),
            this.getMainnetPrivatePaymentsCount(u.privy_user_id),
          ]);
          const depositCount = blinkLookup.count;
          return {
            privyUserId: u.privy_user_id,
            username: u.username ?? null,
            email: u.email ?? null,
            solanaAddress,
            hasPasskeys: depositCount >= 1,
            depositCount,
            privatePaymentsCount,
            qualified: depositCount >= 2 && privatePaymentsCount >= 2,
            depositLookupError: blinkLookup.error,
          };
        }),
      );
      results.push(...batchResults);
    }

    return results.sort((a, b) => {
      if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
      const aScore = (a.hasPasskeys ? 1 : 0) + (a.depositCount >= 2 ? 1 : 0) + (a.privatePaymentsCount >= 2 ? 1 : 0);
      const bScore = (b.hasPasskeys ? 1 : 0) + (b.depositCount >= 2 ? 1 : 0) + (b.privatePaymentsCount >= 2 ? 1 : 0);
      return bScore - aScore;
    });
  }

  /**
   * Same wallet-resolution UsersService uses everywhere else in the app (Header balance,
   * offramp, etc) — cached via PrivyVerificationService's 5-min Redis TTL, so a transient
   * Privy error falls back to the last-known address instead of resolving to "no wallet".
   */
  private async getPrivySolanaAddress(privyUserId: string): Promise<string | null> {
    try {
      // Bulk admin sweep hits this for ~1900 users — bound the wait so one slow
      // Privy lookup can't stall its whole concurrency batch.
      return await Promise.race([
        this.users.getSolanaWalletAddress(privyUserId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
    } catch {
      return null;
    }
  }

  /**
   * Count successful mainnet private payments sent by this user during the campaign window.
   * Private payments are identified by from_chain IS NOT NULL (set only on MagicBlock transfers).
   */
  private buildMerchantAuthHeader(merchantId: string, privateKeyRaw: string): string {
    const privateKeyPem = privateKeyRaw.replace(/\\n/g, '\n');
    const payloadObject = { version: 'v1', signatureTimestamp: new Date().toISOString() };
    const payload = Buffer.from(JSON.stringify(payloadObject), 'utf8').toString('base64url');
    const signer = createSign('SHA256');
    signer.update(payload);
    signer.end();
    const signature = signer.sign(privateKeyPem).toString('base64url');
    const envelope = JSON.stringify({ merchantId, payload, signature });
    return Buffer.from(envelope, 'utf8').toString('base64');
  }

  private async getMainnetPrivatePaymentsCount(privyUserId: string): Promise<number> {
    try {
      const db = this.supabase.getClient();

      // Primary: sender_user_id column
      const { data: bySender } = await db
        .from('payments')
        .select('id')
        .eq('sender_user_id', privyUserId)
        .eq('status', 'SUCCESS')
        .eq('is_devnet', false)
        .not('from_chain', 'is', null)
        .neq('direction', 'from_recipient')
        .gte('created_at', CAMPAIGN_START.toISOString())
        .lte('created_at', CAMPAIGN_END.toISOString());

      // Legacy: created_by without sender_user_id
      const { data: byCreator } = await db
        .from('payments')
        .select('id')
        .eq('created_by', privyUserId)
        .is('sender_user_id', null)
        .eq('status', 'SUCCESS')
        .eq('is_devnet', false)
        .not('from_chain', 'is', null)
        .neq('direction', 'from_recipient')
        .gte('created_at', CAMPAIGN_START.toISOString())
        .lte('created_at', CAMPAIGN_END.toISOString());

      const byCreatorIds = new Set((byCreator ?? []).map((r: any) => r.id));
      const total = [
        ...(byCreator ?? []),
        ...(bySender ?? []).filter((r: any) => !byCreatorIds.has(r.id)),
      ].length;

      return total;
    } catch (e) {
      this.logger.warn(`getMainnetPrivatePaymentsCount error: ${(e as Error)?.message}`);
      return 0;
    }
  }
}
