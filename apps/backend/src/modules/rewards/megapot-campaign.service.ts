import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';

const CAMPAIGN_START = new Date('2026-07-07T15:00:00.000Z'); // Jul 7 2026, 5pm CET
const CAMPAIGN_END = new Date('2026-08-31T00:00:00.000Z'); // through Aug 30 2026

const REQUIRED_TICKETS = 5;
const PRIZE_POOL_USD = 1000;

export interface MegapotCampaignData {
  ticketsPurchased: number;
  required: number;
  qualified: boolean;
  prizePoolUsd: number;
}

export interface MegapotAdminUserStatus {
  privyUserId: string;
  username: string | null;
  email: string | null;
  ticketsPurchased: number;
  qualified: boolean;
}

@Injectable()
export class MegapotCampaignService {
  private readonly logger = new Logger(MegapotCampaignService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getMegapotCampaign(privyUserId: string): Promise<MegapotCampaignData> {
    const ticketsPurchased = await this.getPrivateTicketsPurchased(privyUserId);
    return {
      ticketsPurchased,
      required: REQUIRED_TICKETS,
      qualified: ticketsPurchased >= REQUIRED_TICKETS,
      prizePoolUsd: PRIZE_POOL_USD,
    };
  }

  /**
   * Sum of num_tickets across the user's *private* Megapot purchases (burner_sol_address set —
   * see lottery.service.ts's initiatePurchase vs initiatePublicPurchase) that actually completed
   * (status active/won/lost — pending/failed purchases never delivered tickets), during the
   * campaign window.
   */
  private async getPrivateTicketsPurchased(privyUserId: string): Promise<number> {
    try {
      const db = this.supabase.getClient();
      const { data, error } = await db
        .from('lottery_tickets')
        .select('num_tickets')
        .eq('user_id', privyUserId)
        .not('burner_sol_address', 'is', null)
        .in('status', ['active', 'won', 'lost'])
        .gte('created_at', CAMPAIGN_START.toISOString())
        .lte('created_at', CAMPAIGN_END.toISOString());

      if (error) throw error;
      return (data ?? []).reduce((sum: number, row: any) => sum + (row.num_tickets ?? 0), 0);
    } catch (e) {
      this.logger.warn(`getPrivateTicketsPurchased error: ${(e as Error)?.message}`);
      return 0;
    }
  }

  /** Admin: eligible-participant list for running the lucky draw. */
  async getAllMegapotCampaignStatus(): Promise<MegapotAdminUserStatus[]> {
    const { data: users, error } = await this.supabase.appUsers
      .select('privy_user_id, username, email')
      .not('privy_user_id', 'is', null);

    if (error || !users?.length) return [];

    const CONCURRENCY = 5;
    const results: MegapotAdminUserStatus[] = [];

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (u: any) => {
          const ticketsPurchased = await this.getPrivateTicketsPurchased(u.privy_user_id);
          return {
            privyUserId: u.privy_user_id,
            username: u.username ?? null,
            email: u.email ?? null,
            ticketsPurchased,
            qualified: ticketsPurchased >= REQUIRED_TICKETS,
          };
        }),
      );
      results.push(...batchResults);
    }

    return results
      .filter((r) => r.ticketsPurchased > 0)
      .sort((a, b) => {
        if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
        return b.ticketsPurchased - a.ticketsPurchased;
      });
  }
}
