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

const TASK_SPARKS: Record<TaskKey, number> = {
  connect_email: 250,
  connect_twitter: 250,
  first_payment: 500,
  payment_to_unregistered: 2500,
  payment_link_paid: 2000,
  ten_payments: 5000,
};

const TWITTER_TYPES = ['twitter_oauth', 'twitter', 'x'];

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);
  private readonly cache = new Map<string, { data: RewardsData; ts: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly privyVerification: PrivyVerificationService,
  ) {}

  async getRewards(privyUserId: string): Promise<RewardsData> {
    const hit = this.cache.get(privyUserId);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return hit.data;
    }
    const data = await this.computeRewards(privyUserId);
    this.cache.set(privyUserId, { data, ts: Date.now() });
    return data;
  }

  /** Invalidate cache for a user (call after task-completing events). */
  invalidate(privyUserId: string) {
    this.cache.delete(privyUserId);
  }

  private async computeRewards(privyUserId: string): Promise<RewardsData> {
    const [linkedAccounts, sendStats, claimStats] = await Promise.all([
      this.getLinkedAccounts(privyUserId),
      this.getSendPaymentStats(privyUserId),
      this.getClaimStats(privyUserId),
    ]);

    const hasEmail = linkedAccounts.some(
      (a: any) =>
        a.type === 'email' || a.type === 'google' || a.type === 'apple',
    );
    const hasTwitter = linkedAccounts.some((a: any) =>
      TWITTER_TYPES.includes((a.type || '').toLowerCase()),
    );

    const completedSendPayments = sendStats.claimedCount;
    const hasPaymentToUnregistered = sendStats.hasUnregisteredPayment;

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
        completed: completedSendPayments >= 1,
      },
      {
        key: 'payment_to_unregistered',
        label: 'Pay someone not yet on Loofta',
        description: 'Send a payment to an email or X handle not yet registered',
        sparks: TASK_SPARKS.payment_to_unregistered,
        completed: hasPaymentToUnregistered,
      },
      {
        key: 'payment_link_paid',
        label: 'Create a link and get paid',
        description: 'Share your payment link and receive a payment through it',
        sparks: TASK_SPARKS.payment_link_paid,
        completed: claimStats.hasPaidClaim,
      },
      {
        key: 'ten_payments',
        label: 'Make 10 payments',
        description: 'Send a total of 10 payments',
        sparks: TASK_SPARKS.ten_payments,
        completed: completedSendPayments >= 10,
        progress: Math.min(completedSendPayments, 10),
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

  private async getSendPaymentStats(
    privyUserId: string,
  ): Promise<{ claimedCount: number; hasUnregisteredPayment: boolean }> {
    try {
      const { data, error } = await this.supabase
        .getClient()
        .from('send_payment_links')
        .select('id, recipient_type, status')
        .eq('sender_user_id', privyUserId)
        .eq('status', 'CLAIMED');

      if (error) {
        this.logger.warn(`Error querying send_payment_links: ${error.message}`);
        return { claimedCount: 0, hasUnregisteredPayment: false };
      }

      const rows = data ?? [];
      const hasUnregisteredPayment = rows.some(
        (r: any) => r.recipient_type === 'email' || r.recipient_type === 'twitter',
      );

      return { claimedCount: rows.length, hasUnregisteredPayment };
    } catch (e) {
      this.logger.warn(`getSendPaymentStats error: ${(e as Error)?.message}`);
      return { claimedCount: 0, hasUnregisteredPayment: false };
    }
  }

  private async getClaimStats(
    privyUserId: string,
  ): Promise<{ hasPaidClaim: boolean }> {
    try {
      const { data, error } = await this.supabase
        .getClient()
        .from('claims')
        .select('id')
        .eq('created_by', privyUserId)
        .eq('status', 'SUCCESS')
        .limit(1);

      if (error) {
        this.logger.warn(`Error querying claims: ${error.message}`);
        return { hasPaidClaim: false };
      }

      return { hasPaidClaim: (data ?? []).length > 0 };
    } catch (e) {
      this.logger.warn(`getClaimStats error: ${(e as Error)?.message}`);
      return { hasPaidClaim: false };
    }
  }
}
