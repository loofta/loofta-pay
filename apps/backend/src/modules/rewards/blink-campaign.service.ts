import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';

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

// TODO: restore CAMPAIGN_START to 2026-07-01T13:00:00.000Z before launch
const CAMPAIGN_START = new Date('2026-06-01T00:00:00.000Z'); // testing: catch all recent payments
const CAMPAIGN_END = new Date('2026-08-15T00:00:00.000Z');

@Injectable()
export class BlinkCampaignService {
  private readonly logger = new Logger(BlinkCampaignService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  async getBlinkCampaign(privyUserId: string): Promise<BlinkCampaignData> {
    const [blinkDeposits, privatePaymentsCount] = await Promise.all([
      this.getBlinkDepositsCount(privyUserId),
      this.getMainnetPrivatePaymentsCount(privyUserId),
    ]);

    // Quest 1: setup passkeys — inferred from having at least 1 Blink deposit
    // (you can't deposit without setting up passkeys first)
    const hasPasskeys = blinkDeposits >= 1;

    // Quest 2: at least 2 deposits with Blink
    const hasTwoDeposits = blinkDeposits >= 2;

    // Quest 3: at least 2 mainnet private payments on Loofta
    const hasTwoPrivatePayments = privatePaymentsCount >= 2;

    const tasks: BlinkTaskStatus[] = [
      {
        key: 'setup_passkeys',
        label: 'Set up Blink with passkeys',
        description: 'Create your Blink account and secure it with passkeys.',
        completed: hasPasskeys,
      },
      {
        key: 'two_deposits',
        label: 'Make at least 2 deposits with Blink',
        description: 'Deposit funds into your Blink wallet twice during the campaign.',
        completed: hasTwoDeposits,
        progress: Math.min(blinkDeposits, 2),
        total: 2,
      },
      {
        key: 'two_private_payments',
        label: 'Send 2 mainnet private payments',
        description: 'Send at least 2 private payments on Loofta mainnet during the campaign.',
        completed: hasTwoPrivatePayments,
        progress: Math.min(privatePaymentsCount, 2),
        total: 2,
      },
    ];

    const qualified = tasks.every((t) => t.completed);

    return { tasks, qualified };
  }

  /**
   * Queries Blink's Campaigns API for deposit count.
   * Requires BLINK_MERCHANT_KEY + BLINK_CAMPAIGN_ID env vars.
   * Returns 0 when not configured (quests show as incomplete until set up).
   */
  private async getBlinkDepositsCount(privyUserId: string): Promise<number> {
    const merchantKey = this.config.get<string>('BLINK_MERCHANT_KEY');
    const campaignId = this.config.get<string>('BLINK_CAMPAIGN_ID');

    if (!merchantKey || !campaignId) {
      this.logger.debug('BLINK_MERCHANT_KEY or BLINK_CAMPAIGN_ID not set — Blink quests return 0');
      return 0;
    }

    try {
      // Resolve the user's linked Blink wallet address from their profile
      // (stored as blink_wallet_address on users table, or retrieved via Privy linked accounts)
      const blinkWallet = await this.getUserBlinkWallet(privyUserId);
      if (!blinkWallet) return 0;

      // GET /v1/marketings/campaigns/{campaignId}/qualifiedWallets?wallet={address}
      const url = `https://api.blink.cash/v1/marketings/campaigns/${campaignId}/qualifiedWallets?wallet=${encodeURIComponent(blinkWallet)}`;
      const res = await fetch(url, {
        headers: {
          'X-Merchant-Authorization': merchantKey,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        this.logger.warn(`Blink qualifiedWallets API error: ${res.status}`);
        return 0;
      }

      const data = await res.json() as { depositCount?: number; count?: number; deposits?: unknown[] };
      // Return deposit count from however the API surfaces it
      return data.depositCount ?? data.count ?? (Array.isArray(data.deposits) ? data.deposits.length : 0);
    } catch (e) {
      this.logger.warn(`Blink API fetch failed: ${(e as Error)?.message}`);
      return 0;
    }
  }

  /**
   * Count successful mainnet private payments sent by this user during the campaign window.
   * Private payments are identified by from_chain IS NOT NULL (set only on MagicBlock transfers).
   */
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

  private async getUserBlinkWallet(privyUserId: string): Promise<string | null> {
    try {
      const { data } = await this.supabase.getClient()
        .from('app_users')
        .select('blink_wallet_address')
        .eq('privy_user_id', privyUserId)
        .single();
      return (data as any)?.blink_wallet_address ?? null;
    } catch {
      return null;
    }
  }
}
