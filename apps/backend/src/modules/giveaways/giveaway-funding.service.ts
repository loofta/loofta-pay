import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { Giveaway, GiveawayStatus } from './entities/giveaway.entity';

/**
 * Watches a giveaway's burner balance and flips PENDING_FUNDING -> FUNDED -> OPEN once it's
 * fully funded. Funding itself can arrive two ways — a direct USDC-on-Solana send to the burner,
 * or any-chain via near-intents with `recipient = burner_address` — but both land in the same
 * USDC ATA, so this service only ever needs to check one thing: the burner's on-chain balance.
 */
@Injectable()
export class GiveawayFundingService {
  private readonly logger = new Logger(GiveawayFundingService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly nearIntents: NearIntentsService,
  ) {}

  private cluster(giveaway: Giveaway): 'devnet' | 'mainnet' {
    return giveaway.is_devnet ? 'devnet' : 'mainnet';
  }

  /**
   * Any-chain funding quote — the deposit lands directly in the burner's USDC ATA on Solana,
   * same as a direct send, so no separate confirmation path is needed beyond the balance poll.
   */
  async createFundingQuote(
    giveaway: Giveaway,
    fromToken: { tokenId: string; chain: string; symbol: string; decimals: number },
  ) {
    if (!giveaway.burner_address) {
      throw new BadRequestException('Giveaway has no burner yet — it must be admin-approved first.');
    }
    const toToken = {
      tokenId: giveaway.mint ?? '',
      chain: 'sol',
      symbol: 'USDC',
      decimals: 6,
    };
    return this.nearIntents.getDepositQuote({
      fromToken,
      toToken,
      amountOut: giveaway.funding_required_usd ?? undefined,
      recipient: giveaway.burner_address,
      useExactOutput: true,
    });
  }

  /** Reads the burner's on-chain USDC balance and, if it now covers funding_required_usd, moves
   *  the giveaway PENDING_FUNDING -> FUNDED -> OPEN. Safe to call repeatedly (idempotent no-op
   *  once already FUNDED/OPEN or beyond). Returns the up-to-date confirmed amount for display. */
  async checkAndUpdateFundingStatus(giveaway: Giveaway): Promise<{ fundingConfirmedUsd: number; justFunded: boolean }> {
    if (giveaway.status !== GiveawayStatus.PENDING_FUNDING) {
      return { fundingConfirmedUsd: Number(giveaway.funding_confirmed_usd), justFunded: false };
    }
    if (!giveaway.burner_address || !giveaway.mint) {
      return { fundingConfirmedUsd: 0, justFunded: false };
    }

    const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
    const mint = new PublicKey(giveaway.mint);
    const burnerAta = await getAssociatedTokenAddress(mint, new PublicKey(giveaway.burner_address));

    let baseUnits = 0n;
    try {
      baseUnits = (await getAccount(conn, burnerAta)).amount;
    } catch {
      // ATA doesn't exist yet — no deposit has landed
    }
    const confirmedUsd = Number(baseUnits) / 1_000_000;

    const requiredUsd = Number(giveaway.funding_required_usd ?? 0);
    const justFunded = confirmedUsd >= requiredUsd && requiredUsd > 0;

    const { error } = await this.supabaseService.giveaways
      .update({
        funding_confirmed_usd: confirmedUsd,
        ...(justFunded ? { status: GiveawayStatus.OPEN } : {}),
      })
      .eq('id', giveaway.id);
    if (error) {
      this.logger.warn(`[GiveawayFunding] ${giveaway.id}: failed to persist funding status: ${error.message}`);
      return { fundingConfirmedUsd: confirmedUsd, justFunded: false };
    }

    if (justFunded) {
      this.logger.log(`[GiveawayFunding] ${giveaway.id}: funded (${confirmedUsd} >= ${requiredUsd}) — now OPEN`);
      const { error: eventError } = await this.supabaseService.giveawayEvents.insert([
        { giveaway_id: giveaway.id, type: 'funding_confirmed', payload: { confirmed_usd: confirmedUsd } },
        { giveaway_id: giveaway.id, type: 'entries_opened', payload: null },
      ]);
      if (eventError) this.logger.warn(`[GiveawayFunding] ${giveaway.id}: failed to log funding events: ${eventError.message}`);
    }

    return { fundingConfirmedUsd: confirmedUsd, justFunded };
  }

  /** Poll target for the funding cron — every giveaway still waiting on a deposit. */
  async findAwaitingFunding(): Promise<Giveaway[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .eq('status', GiveawayStatus.PENDING_FUNDING)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }
}
