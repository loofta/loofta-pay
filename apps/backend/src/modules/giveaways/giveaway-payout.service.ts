import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { UsersService } from '../users/users.service';
import { isValidSolanaAddress } from '@/common/solana-address';
import { GiveawayBurnerSweepService } from './giveaway-burner-sweep.service';
import { GiveawaysService } from './giveaways.service';
import { Giveaway, GiveawayStatus, GiveawayEntry } from './entities/giveaway.entity';

@Injectable()
export class GiveawayPayoutService {
  private readonly logger = new Logger(GiveawayPayoutService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly usersService: UsersService,
    private readonly giveawaysService: GiveawaysService,
    private readonly burnerSweep: GiveawayBurnerSweepService,
  ) {}

  private cluster(giveaway: Giveaway): 'devnet' | 'mainnet' {
    return giveaway.is_devnet ? 'devnet' : 'mainnet';
  }

  private async logEvent(giveawayId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabaseService.giveawayEvents.insert({ giveaway_id: giveawayId, type, payload: payload ?? null });
    if (error) this.logger.warn(`[GiveawayPayout] ${giveawayId} ${type}: failed to log event (non-fatal): ${error.message}`);
  }

  /** Winner picks how they want to be paid — must own the entry and still be pending payout. */
  async setPayoutChoice(
    giveawayId: string,
    userId: string,
    choice: 'public' | 'private',
    destination: string,
  ): Promise<GiveawayEntry> {
    if (!isValidSolanaAddress(destination)) throw new BadRequestException('Invalid Solana destination address');

    const { data: entry, error } = await this.supabaseService.giveawayEntries
      .select('*')
      .eq('giveaway_id', giveawayId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!entry) throw new ForbiddenException('You did not enter this giveaway');
    if (entry.status !== 'winner') throw new BadRequestException('You are not a winner of this giveaway');
    if (entry.payout_status !== 'pending') throw new BadRequestException(`Payout is already ${entry.payout_status}`);

    const { data: updated, error: updateError } = await this.supabaseService.giveawayEntries
      .update({ payout_choice: choice, payout_destination: destination.trim() })
      .eq('id', entry.id)
      .select()
      .single();
    if (updateError || !updated) throw new BadRequestException(updateError?.message ?? 'Failed to set payout choice');
    return updated as GiveawayEntry;
  }

  /** Every winner entry still waiting on a payout, across giveaways in WINNERS_SELECTED /
   *  PAYOUT_IN_PROGRESS — the cron's processing queue. Rows without a payout_choice/destination
   *  yet are included but simply skipped (winner hasn't decided) rather than filtered out, so the
   *  cron log makes it visible that something is genuinely waiting on the winner, not lost. */
  async findGiveawaysAwaitingPayout(): Promise<Giveaway[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .in('status', [GiveawayStatus.WINNERS_SELECTED, GiveawayStatus.PAYOUT_IN_PROGRESS])
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }

  /** Processes every ready winner payout for one giveaway, then refunds the burner's leftover
   *  buffer to the creator and marks the giveaway COMPLETED once every winner is paid. */
  async processGiveaway(giveaway: Giveaway): Promise<void> {
    if (!giveaway.burner_address || !giveaway.burner_encrypted_secret || !giveaway.mint) return;
    if (!this.burnerSweep.isAvailable()) return;

    const { data: winners, error } = await this.supabaseService.giveawayEntries
      .select('*')
      .eq('giveaway_id', giveaway.id)
      .eq('status', 'winner');
    if (error) {
      this.logger.warn(`[GiveawayPayout] ${giveaway.id}: failed to list winners: ${error.message}`);
      return;
    }

    const ready = (winners ?? []).filter(
      (w) => w.payout_status !== 'succeeded' && w.payout_choice && w.payout_destination,
    ) as GiveawayEntry[];

    if (ready.length && giveaway.status === GiveawayStatus.WINNERS_SELECTED) {
      await this.supabaseService.giveaways.update({ status: GiveawayStatus.PAYOUT_IN_PROGRESS }).eq('id', giveaway.id);
      await this.logEvent(giveaway.id, 'payout_started', { winner_count: winners?.length ?? 0 });
    }

    const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
    const mint = new PublicKey(giveaway.mint);
    const burnerKeypair = this.burnerSweep.decryptBurner(giveaway.burner_address, giveaway.burner_encrypted_secret);
    const amountBaseUnits = BigInt(Math.round(Number(giveaway.prize_amount_usd) * 1_000_000));

    for (const entry of ready) {
      await this.supabaseService.giveawayEntries.update({ payout_status: 'in_progress' }).eq('id', entry.id);
      try {
        const result =
          entry.payout_choice === 'private'
            ? await this.burnerSweep.sweepPrivate({
                conn,
                burnerKeypair,
                destination: entry.payout_destination!,
                mint,
                amountBaseUnits: Number(amountBaseUnits),
                cluster: this.cluster(giveaway),
              })
            : await this.burnerSweep.sweepPublic({
                conn,
                burnerKeypair,
                destination: entry.payout_destination!,
                mint,
                amountBaseUnits,
                context: `giveaway:${giveaway.id}:entry:${entry.id}`,
              });
        await this.supabaseService.giveawayEntries
          .update({
            payout_status: 'succeeded',
            payout_tx_hash: result.sweepTxHash,
            payout_amount_usd: giveaway.prize_amount_usd,
          })
          .eq('id', entry.id);
        await this.logEvent(giveaway.id, 'payout_succeeded', { entry_id: entry.id, tx_hash: result.sweepTxHash, choice: entry.payout_choice });
      } catch (e) {
        this.logger.warn(`[GiveawayPayout] ${giveaway.id} entry ${entry.id}: payout failed (will retry next cron): ${String(e)}`);
        await this.supabaseService.giveawayEntries.update({ payout_status: 'failed' }).eq('id', entry.id);
        await this.logEvent(giveaway.id, 'payout_failed', { entry_id: entry.id, error: String(e) });
      }
    }

    await this.finalizeIfComplete(giveaway);
  }

  private async finalizeIfComplete(giveaway: Giveaway): Promise<void> {
    const { count: unpaidWinners, error } = await this.supabaseService.giveawayEntries
      .select('id', { count: 'exact', head: true })
      .eq('giveaway_id', giveaway.id)
      .eq('status', 'winner')
      .neq('payout_status', 'succeeded');
    if (error) {
      this.logger.warn(`[GiveawayPayout] ${giveaway.id}: failed to check completion: ${error.message}`);
      return;
    }
    if ((unpaidWinners ?? 0) > 0) return; // still waiting on at least one winner (payout in flight, retry, or their own choice)

    if (!giveaway.burner_address || !giveaway.burner_encrypted_secret || !giveaway.mint) return;
    try {
      const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
      const mint = new PublicKey(giveaway.mint);
      const burnerKeypair = this.burnerSweep.decryptBurner(giveaway.burner_address, giveaway.burner_encrypted_secret);
      const creatorWallet = await this.usersService.getSolanaWalletAddress(giveaway.created_by);
      const refund = await this.burnerSweep.refundRemainingToCreator({
        conn,
        burnerKeypair,
        creatorWallet,
        mint,
        context: `giveaway:${giveaway.id}:refund`,
      });
      if (refund) await this.logEvent(giveaway.id, 'refund_issued', { tx_hash: refund.sweepTxHash });
    } catch (e) {
      this.logger.warn(`[GiveawayPayout] ${giveaway.id}: buffer refund failed (non-fatal, GC cron will catch remaining dust): ${String(e)}`);
    }

    const { error: completeError } = await this.supabaseService.giveaways
      .update({ status: GiveawayStatus.COMPLETED, burner_reclaimed_at: new Date().toISOString() })
      .eq('id', giveaway.id);
    if (completeError) this.logger.warn(`[GiveawayPayout] ${giveaway.id}: failed to mark COMPLETED: ${completeError.message}`);
    else {
      await this.logEvent(giveaway.id, 'completed');
      this.logger.log(`[GiveawayPayout] ${giveaway.id}: all winners paid, buffer refunded, COMPLETED`);
    }
  }
}
