import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { PrivyVerificationService } from '@/auth/privy-verification.service';

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 min

export type TaskKey =
  | 'connect_email'
  | 'connect_twitter'
  | 'first_payment'
  | 'payment_to_unregistered'
  | 'payment_link_paid'
  | 'ten_payments';

export interface TaskStatus {
  key: TaskKey;
  label: string;
  description: string;
  sparks: number;
  completed: boolean;
  progress?: number;
  total?: number;
}

export interface RewardsData {
  totalSparks: number;
  tasks: TaskStatus[];
}

export interface UserRewardsSummary {
  privyUserId: string;
  username: string | null;
  email: string | null;
  totalSparks: number;
  tasks: TaskStatus[];
}

const TASK_SPARKS: Record<TaskKey, number> = {
  connect_email: 250,
  connect_twitter: 250,
  first_payment: 500,
  payment_to_unregistered: 2000,
  payment_link_paid: 2000,
  ten_payments: 5000,
};

const TWITTER_TYPES = ['twitter_oauth', 'twitter', 'x'];
const PENDING_PREFIXES = ['PENDING_EMAIL:', 'PENDING_USERNAME:'];

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);
  private readonly cache = new Map<string, { data: RewardsData; ts: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly privyVerification: PrivyVerificationService,
  ) {}

  async getRewards(privyUserId: string, isDevnet = true): Promise<RewardsData> {
    const cacheKey = `${privyUserId}:${isDevnet ? 'devnet' : 'mainnet'}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return hit.data;
    }
    const data = await this.computeRewards(privyUserId, isDevnet);
    this.cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  }

  async getAllUsersRewards(): Promise<UserRewardsSummary[]> {
    const { data: users, error } = await this.supabase.appUsers
      .select('privy_user_id, username, email')
      .not('privy_user_id', 'is', null);

    if (error || !users?.length) return [];

    const results = await Promise.all(
      users.map(async (u: any) => {
        const rewards = await this.getRewards(u.privy_user_id);
        return {
          privyUserId: u.privy_user_id,
          username: u.username ?? null,
          email: u.email ?? null,
          totalSparks: rewards.totalSparks,
          tasks: rewards.tasks,
        };
      }),
    );

    return results.sort((a, b) => b.totalSparks - a.totalSparks);
  }

  invalidate(privyUserId: string) {
    this.cache.delete(privyUserId);
  }

  private async computeRewards(privyUserId: string, isDevnet: boolean): Promise<RewardsData> {
    const [linkedAccounts, paymentStats] = await Promise.all([
      this.getLinkedAccounts(privyUserId),
      this.getPaymentStats(privyUserId, isDevnet),
    ]);

    const hasEmail = linkedAccounts.some(
      (a: any) => a.type === 'email' || a.type === 'google' || a.type === 'apple',
    );
    const hasTwitter = linkedAccounts.some((a: any) =>
      TWITTER_TYPES.includes((a.type || '').toLowerCase()),
    );

    const { successfulSentCount, hasPaymentToUnregistered, hasLinkPaid } = paymentStats;

    const tasks: TaskStatus[] = [
      {
        key: 'connect_email',
        label: 'Connect your email',
        description: 'Link an email address to your account',
        sparks: TASK_SPARKS.connect_email,
        completed: hasEmail,
      },
      {
        key: 'connect_twitter',
        label: 'Connect your X',
        description: 'Link your X (Twitter) account',
        sparks: TASK_SPARKS.connect_twitter,
        completed: hasTwitter,
      },
      {
        key: 'first_payment',
        label: 'Make your first payment',
        description: 'Send a payment to anyone',
        sparks: TASK_SPARKS.first_payment,
        completed: successfulSentCount >= 1,
      },
      {
        key: 'payment_to_unregistered',
        label: 'Pay someone not yet on Loofta',
        description: 'Send a payment to someone who has not signed up yet',
        sparks: TASK_SPARKS.payment_to_unregistered,
        completed: hasPaymentToUnregistered,
      },
      {
        key: 'payment_link_paid',
        label: 'Create a link and get paid',
        description: 'Share your payment link and receive a payment through it',
        sparks: TASK_SPARKS.payment_link_paid,
        completed: hasLinkPaid,
      },
      {
        key: 'ten_payments',
        label: 'Make 10 payments',
        description: 'Send a total of 10 successful payments',
        sparks: TASK_SPARKS.ten_payments,
        completed: successfulSentCount >= 10,
        progress: Math.min(successfulSentCount, 10),
        total: 10,
      },
    ];

    const totalSparks = tasks
      .filter((t) => t.completed)
      .reduce((sum, t) => sum + t.sparks, 0);

    return { totalSparks, tasks };
  }

  private async getLinkedAccounts(privyUserId: string): Promise<any[]> {
    try {
      const user = await this.privyVerification.getPrivyUser(privyUserId);
      return user?.linked_accounts ?? [];
    } catch (e) {
      this.logger.warn(`Failed to fetch Privy linked accounts for ${privyUserId}: ${(e as Error)?.message}`);
      return [];
    }
  }

  /**
   * Mirrors exactly what the history page counts as "sent" payments:
   * 1. sender_user_id = user (canonical)
   * 2. Legacy: created_by = user AND sender_user_id IS NULL AND direction != from_recipient
   */
  private async getPaymentStats(privyUserId: string, isDevnet: boolean): Promise<{
    successfulSentCount: number;
    hasPaymentToUnregistered: boolean;
    hasLinkPaid: boolean;
  }> {
    try {
      const db = this.supabase.getClient();

      // Primary: sender_user_id column (new rows)
      const { data: bysender } = await db
        .from('payments')
        .select('id, recipient_user_id, recipient_address')
        .eq('sender_user_id', privyUserId)
        .eq('status', 'SUCCESS')
        .eq('is_devnet', isDevnet)
        .neq('direction', 'from_recipient');

      // Legacy fallback: created_by without sender_user_id
      const { data: byCreator } = await db
        .from('payments')
        .select('id, recipient_user_id, recipient_address')
        .eq('created_by', privyUserId)
        .is('sender_user_id', null)
        .eq('status', 'SUCCESS')
        .eq('is_devnet', isDevnet)
        .neq('direction', 'from_recipient');

      const sentByIdSet = new Set((byCreator ?? []).map((r: any) => r.id));
      const allSent = [
        ...(byCreator ?? []),
        ...(bysender ?? []).filter((r: any) => !sentByIdSet.has(r.id)),
      ];

      const hasPaymentToUnregistered = allSent.some((r: any) => {
        if (!r.recipient_user_id) return true;
        const addr = String(r.recipient_address || '');
        return PENDING_PREFIXES.some((p) => addr.startsWith(p));
      });

      // Payment request link created by user and paid by someone else
      const { data: linkRows } = await db
        .from('payments')
        .select('id')
        .eq('created_by', privyUserId)
        .eq('direction', 'from_recipient')
        .eq('status', 'SUCCESS')
        .eq('is_devnet', isDevnet)
        .limit(1);

      return {
        successfulSentCount: allSent.length,
        hasPaymentToUnregistered,
        hasLinkPaid: (linkRows ?? []).length > 0,
      };
    } catch (e) {
      this.logger.warn(`getPaymentStats error: ${(e as Error)?.message}`);
      return { successfulSentCount: 0, hasPaymentToUnregistered: false, hasLinkPaid: false };
    }
  }
}
