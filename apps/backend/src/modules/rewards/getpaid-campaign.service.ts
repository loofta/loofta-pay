import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';

const CAMPAIGN_START = new Date('2026-07-09T00:00:00.000Z');
const CAMPAIGN_END = new Date('2026-07-23T00:00:00.000Z'); // 2 weeks

const MIN_PAYMENT_USD = 5;
const WINNERS_COUNT = 3;
const PRIZE_USD = 20;

export interface GetPaidCampaignData {
  paymentsReceived: number;
  qualified: boolean;
  minPaymentUsd: number;
  prizeUsd: number;
  winnersCount: number;
  campaignEndsAt: string;
}

export interface GetPaidAdminUserStatus {
  privyUserId: string;
  username: string | null;
  email: string | null;
  paymentsReceived: number;
  qualified: boolean;
}

@Injectable()
export class GetPaidCampaignService {
  private readonly logger = new Logger(GetPaidCampaignService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getGetPaidCampaign(privyUserId: string): Promise<GetPaidCampaignData> {
    const paymentsReceived = await this.getQualifyingPaymentsReceived(privyUserId);
    return {
      paymentsReceived,
      qualified: paymentsReceived >= 1,
      minPaymentUsd: MIN_PAYMENT_USD,
      prizeUsd: PRIZE_USD,
      winnersCount: WINNERS_COUNT,
      campaignEndsAt: CAMPAIGN_END.toISOString(),
    };
  }

  /**
   * Successful mainnet payments received through a payment request link (direction =
   * 'from_recipient') created by this user, at or above the minimum qualifying amount, during
   * the campaign window. Mirrors the existing Sparks 'payment_link_paid' detection in
   * rewards.service.ts, but scoped to this campaign's window/minimum and mainnet-only since a
   * real cash prize is at stake here.
   */
  private async getQualifyingPaymentsReceived(privyUserId: string): Promise<number> {
    try {
      const db = this.supabase.getClient();
      const { data, error } = await db
        .from('payments')
        .select('id')
        .eq('created_by', privyUserId)
        .eq('direction', 'from_recipient')
        .eq('status', 'SUCCESS')
        .eq('is_devnet', false)
        .gte('amount', MIN_PAYMENT_USD)
        .gte('created_at', CAMPAIGN_START.toISOString())
        .lte('created_at', CAMPAIGN_END.toISOString());

      if (error) throw error;
      return (data ?? []).length;
    } catch (e) {
      this.logger.warn(`getQualifyingPaymentsReceived error: ${(e as Error)?.message}`);
      return 0;
    }
  }

  /** Admin: eligible-participant list for running the $50 x 3 lucky draw. */
  async getAllGetPaidCampaignStatus(): Promise<GetPaidAdminUserStatus[]> {
    const { data: users, error } = await this.supabase.appUsers
      .select('privy_user_id, username, email')
      .not('privy_user_id', 'is', null);

    if (error || !users?.length) return [];

    const CONCURRENCY = 5;
    const results: GetPaidAdminUserStatus[] = [];

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (u: any) => {
          const paymentsReceived = await this.getQualifyingPaymentsReceived(u.privy_user_id);
          return {
            privyUserId: u.privy_user_id,
            username: u.username ?? null,
            email: u.email ?? null,
            paymentsReceived,
            qualified: paymentsReceived >= 1,
          };
        }),
      );
      results.push(...batchResults);
    }

    return results
      .filter((r) => r.paymentsReceived > 0)
      .sort((a, b) => b.paymentsReceived - a.paymentsReceived);
  }
}
