import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { ConfigService } from '@nestjs/config';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { GiveawayBurnerSweepService } from './giveaway-burner-sweep.service';
import { GiveawayGiphyService } from './giveaway-giphy.service';
import { GiveawaysService } from './giveaways.service';
import { Giveaway, GiveawayStatus, GiveawayEntry } from './entities/giveaway.entity';
import { randomBytes } from 'crypto';

// Same generator as ClaimsService/SendPaymentService — duplicated rather than shared per this
// codebase's existing convention (see claims.service.ts, send-payment.service.ts).
const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHORT_ID_MAX_VALID = Math.floor(256 / SHORT_ID_ALPHABET.length) * SHORT_ID_ALPHABET.length;
function generateShortId(length = 8): string {
  let result = '';
  while (result.length < length) {
    const bytes = randomBytes(length - result.length + 4);
    for (const byte of bytes) {
      if (byte < SHORT_ID_MAX_VALID && result.length < length) {
        result += SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length];
      }
    }
  }
  return result;
}

@Injectable()
export class GiveawayPayoutService {
  private readonly logger = new Logger(GiveawayPayoutService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly usersService: UsersService,
    private readonly giveawaysService: GiveawaysService,
    private readonly burnerSweep: GiveawayBurnerSweepService,
    private readonly giphy: GiveawayGiphyService,
    private readonly emailService: EmailService,
  ) {
    this.baseUrl = this.configService.get<string>('NEXT_PUBLIC_BASE_URL', 'https://pay.loofta.xyz');
  }

  private cluster(giveaway: Giveaway): 'devnet' | 'mainnet' {
    return giveaway.is_devnet ? 'devnet' : 'mainnet';
  }

  private async logEvent(giveawayId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabaseService.giveawayEvents.insert({ giveaway_id: giveawayId, type, payload: payload ?? null });
    if (error) this.logger.warn(`[GiveawayPayout] ${giveawayId} ${type}: failed to log event (non-fatal): ${error.message}`);
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
      (w) => w.payout_status !== 'succeeded' && !w.claim_payment_id,
    ) as GiveawayEntry[];

    if (ready.length && giveaway.status === GiveawayStatus.WINNERS_SELECTED) {
      await this.supabaseService.giveaways.update({ status: GiveawayStatus.PAYOUT_IN_PROGRESS }).eq('id', giveaway.id);
      await this.logEvent(giveaway.id, 'payout_started', { winner_count: winners?.length ?? 0 });
    }

    const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
    const mint = new PublicKey(giveaway.mint);
    const burnerKeypair = this.burnerSweep.decryptBurner(giveaway.burner_address, giveaway.burner_encrypted_secret);
    const amountBaseUnits = BigInt(Math.round(Number(giveaway.prize_amount_usd) * 1_000_000));

    // Winners no longer choose a payout destination upfront — each gets a normal /c/[id] claim
    // link (same mechanism as multi-send: a fresh dedicated burner, funded from this giveaway's
    // burner, backing a `payments` row) and picks public or private claiming on that page, same as
    // any other Loofta payment.
    const gifUrl = await this.giphy.getFirstGifUrl('winning');
    const description = `Congrats on winning "${giveaway.title}"!${gifUrl ? ` ${gifUrl}` : ''}`;

    for (const entry of ready) {
      await this.supabaseService.giveawayEntries.update({ payout_status: 'in_progress' }).eq('id', entry.id);
      try {
        const winnerWallet = await this.usersService.getSolanaWalletAddress(entry.user_id);
        const { burner, txHash } = await this.burnerSweep.fundNewClaimBurner({
          conn,
          giveawayBurnerKeypair: burnerKeypair,
          mint,
          amountBaseUnits,
        });

        const shortId = generateShortId();
        const { data: payment, error: paymentError } = await this.supabaseService.payments
          .insert({
            amount: giveaway.prize_amount_usd,
            direction: 'from_sender',
            recipient_address: winnerWallet,
            recipient_user_id: entry.user_id,
            recipient_was_unregistered: false,
            created_by: giveaway.created_by,
            sender_user_id: giveaway.created_by,
            status: 'PRIVATE_TRANSFER_PENDING',
            paid_at: new Date().toISOString(),
            sender_tx_hash: txHash,
            description,
            from_chain: 'solana',
            from_token: 'USDC',
            to_chain: 'solana',
            to_token: 'USDC',
            is_devnet: giveaway.is_devnet,
            short_id: shortId,
            burner_address: burner.address,
            burner_encrypted_secret: burner.encryptedSecret,
            is_multi_send: true,
            is_private: false,
            multi_send_batch_id: giveaway.id,
          })
          .select('id')
          .single();
        if (paymentError || !payment) throw new Error(paymentError?.message ?? 'Failed to create claim payment');

        await this.supabaseService.giveawayEntries
          .update({
            payout_status: 'succeeded',
            payout_tx_hash: txHash,
            payout_amount_usd: giveaway.prize_amount_usd,
            claim_payment_id: payment.id as string,
          })
          .eq('id', entry.id);
        const claimUrl = `${this.baseUrl}/c/${payment.id}`;
        await this.logEvent(giveaway.id, 'payout_succeeded', {
          entry_id: entry.id,
          tx_hash: txHash,
          claim_payment_id: payment.id,
          claim_url: claimUrl,
        });

        // Fire-and-forget, only if they've actually linked an email — never blocks/fails the
        // payout itself (matches send-payment.service.ts's multi-send email convention).
        const winnerEmail = await this.usersService.getEmailByPrivyId(entry.user_id).catch(() => null);
        if (winnerEmail) {
          this.emailService
            .sendGiveawayWonEmail({ recipientEmail: winnerEmail, title: giveaway.title, amountUsd: giveaway.prize_amount_usd, claimUrl })
            .catch((e: unknown) => this.logger.warn(`[GiveawayPayout] sendGiveawayWonEmail failed for ${winnerEmail}: ${String(e)}`));
        }
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
      const creatorWallet = await this.usersService.getSolanaWalletAddress(giveaway.created_by, { skipCache: true });
      const platformFeeBaseUnits = BigInt(Math.round(Number(giveaway.platform_fee_usd) * 1_000_000));
      const refund = await this.burnerSweep.refundRemainingToCreator({
        conn,
        burnerKeypair,
        creatorWallet,
        mint,
        context: `giveaway:${giveaway.id}:refund`,
        callerUserId: giveaway.created_by,
        platformFeeBaseUnits,
      });
      if (refund) {
        await this.logEvent(giveaway.id, 'refund_issued', { tx_hash: refund.sweepTxHash });
        if (refund.platformFeeBaseUnits > 0n) {
          await this.logEvent(giveaway.id, 'platform_fee_collected', {
            tx_hash: refund.sweepTxHash,
            amount_usd: Number(refund.platformFeeBaseUnits) / 1_000_000,
          });
        }
      }
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
