import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { isCronEnabled } from '@/common/cron-gate';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { LightCompressionService, chunkTargets, COMPRESS_PER_TX } from '@/common/light-compression.service';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '@/redis/redis.service';
import { ClaimsService } from '@/modules/claims/claims.service';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { PartnerTreasuryService } from './partner-treasury.service';
import { PartnerPayoutsService } from './partner-payouts.service';
import { Partner } from './partners.service';

const MAX_ATTEMPTS = 20;

type ProposalRow = { id: string; partner_id: string; batch_id: string | null; payment_ids: string[]; created_by_user_id: string; compress_attempts: number | null };
type PaymentRow = { id: string; compress_sig: string | null; compress_last_valid_block_height: number | string | null };

/**
 * Compressed funding, step two. After a partner's proposal has executed, their USDC is sitting in our staging account
 * (the fee payer's USDC account). This job moves it into one compressed balance per burner and only then marks each
 * payout funded. See docs/proposals/PARTNER_COMPRESSED_PAYOUTS.md.
 *
 * Money safety, in order of importance:
 *  1. A burner is never funded twice. The transaction's signature is saved on the payments BEFORE it is sent. A later
 *     run asks the chain what happened to a saved signature and only builds a new transaction when it can never land.
 *  2. Nothing is compressed unless the proposal really executed on chain and staging holds enough.
 *  3. A payout is marked funded only after its compress transaction confirmed.
 */
@Injectable()
export class PartnerCompressionService {
  private readonly logger = new Logger(PartnerCompressionService.name);
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly claims: ClaimsService,
    private readonly sponsor: SolanaSponsorService,
    private readonly light: LightCompressionService,
    private readonly treasury: PartnerTreasuryService,
    private readonly payouts: PartnerPayoutsService,
  ) {}

  /** Every 20 seconds: push executed proposals along. Does nothing until the migration is run and a proposal exists. */
  @Cron('*/20 * * * * *')
  async cronCompressStaged(): Promise<void> {
    if (!isCronEnabled(this.config) || this.running) return;
    this.running = true;
    try {
      const { data: rows, error } = await this.supabase.partnerTreasuryProposals
        .select('id, partner_id, batch_id, payment_ids, created_by_user_id, compress_attempts')
        .in('compress_status', ['pending', 'running'])
        .order('created_at', { ascending: true })
        .limit(5);
      if (error) {
        if (error.code !== '42703') this.logger.warn(`Compressed funding skipped: ${error.message}`); // 42703: migration not run yet, nothing to do
        return;
      }
      for (const row of (rows ?? []) as ProposalRow[]) await this.processProposal(row);
    } finally {
      this.running = false;
    }
  }

  /** One proposal, under a lock so two machines never work on it at once. Exposed for tests. */
  async processProposal(p: ProposalRow): Promise<void> {
    const ran = await this.redis.withLock(`partner-compress:${p.id}`, async () => {
      try {
        await this.step(p);
      } catch (e) {
        const attempts = (p.compress_attempts ?? 0) + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        const msg = ((e as Error).message ?? 'unknown error').slice(0, 500);
        if (giveUp) this.logger.error(`CRITICAL compressed funding for proposal ${p.id} failed ${attempts} times and stopped: ${msg}. The partner's USDC is in staging; fix and reset compress_status to 'running'.`);
        else this.logger.warn(`Compressed funding for proposal ${p.id}, attempt ${attempts}: ${msg}`);
        await this.supabase.partnerTreasuryProposals.update({ compress_attempts: attempts, compress_error: msg, compress_status: giveUp ? 'failed' : 'running' }).eq('id', p.id);
      }
    }, 120_000);
    if (ran === null) return; // someone else has it
  }

  private async step(p: ProposalRow): Promise<void> {
    if (!p.batch_id || !p.payment_ids?.length) {
      await this.supabase.partnerTreasuryProposals.update({ compress_status: 'skipped' }).eq('id', p.id);
      return;
    }
    const status = await this.treasury.refreshProposalStatus(p.id);
    if (status === null) return;
    if (['rejected', 'cancelled', 'stale'].includes(status)) {
      // Nothing was staged for this proposal.
      await this.supabase.partnerTreasuryProposals.update({ compress_status: 'skipped' }).eq('id', p.id);
      return;
    }
    if (status !== 'executed') return; // still waiting for the team's approvals

    const { data: partnerRow } = await this.supabase.partners.select('*').eq('id', p.partner_id).maybeSingle();
    if (!partnerRow) throw new Error('partner not found');
    const partner = partnerRow as Partner;

    const { data: items } = await this.supabase.payoutBatchItems.select('payment_id, status').eq('batch_id', p.batch_id).in('payment_id', p.payment_ids);
    const open = new Set((items ?? []).filter((i) => i.status === 'created').map((i) => i.payment_id as string));
    const { data: pays } = await this.supabase.payments.select('id, compress_sig, compress_last_valid_block_height').in('id', p.payment_ids);
    const todo = ((pays ?? []) as PaymentRow[]).filter((r) => open.has(r.id));

    // 1. Anything already sent: ask the chain before doing anything else.
    const bySig = new Map<string, PaymentRow[]>();
    for (const r of todo) if (r.compress_sig) bySig.set(r.compress_sig, [...(bySig.get(r.compress_sig) ?? []), r]);
    const cluster = this.cluster();
    let waiting = false;
    for (const [sig, group] of bySig) {
      const last = group[0].compress_last_valid_block_height;
      const outcome = await this.light.signatureOutcome(cluster, sig, last === null || last === undefined ? undefined : Number(last));
      if (outcome === 'landed') {
        for (const r of group) await this.payouts.recordFunded(p.batch_id, r.id, sig);
      } else if (outcome === 'failed' || outcome === 'expired') {
        await this.supabase.payments.update({ compress_sig: null, compress_last_valid_block_height: null }).in('id', group.map((r) => r.id)).eq('compress_sig', sig);
      } else {
        waiting = true; // might still land: never build a second transaction for these
      }
    }
    if (waiting) return;

    // 2. Everything not yet sent, 15 payouts per transaction.
    const { data: again } = await this.supabase.payments.select('id, compress_sig, compress_last_valid_block_height').in('id', p.payment_ids);
    const stillOpenItems = await this.supabase.payoutBatchItems.select('payment_id').eq('batch_id', p.batch_id).eq('status', 'created').in('payment_id', p.payment_ids);
    const openNow = new Set((stillOpenItems.data ?? []).map((i) => i.payment_id as string));
    const fresh = ((again ?? []) as PaymentRow[]).filter((r) => openNow.has(r.id) && !r.compress_sig).map((r) => r.id);
    if (fresh.length) {
      const sponsorKp = this.sponsor.getFeePayerKeypair();
      if (!sponsorKp) throw new Error('fee payer is not available');
      const targets = await this.claims.getPartnerPayoutTargets(fresh, partner.id);
      const mint = new PublicKey(targets[0].mint);
      const stagingAta = await getAssociatedTokenAddress(mint, sponsorKp.publicKey);
      const staged = await this.sponsor.getConnectionForCluster(cluster).getTokenAccountBalance(stagingAta, 'confirmed').then((r) => BigInt(r.value.amount));
      const needed = targets.reduce((a, t) => a + BigInt(t.baseUnits), BigInt(0));
      if (staged < needed) throw new Error(`staging holds ${staged} but ${needed} is needed to fund these payouts`);

      for (const chunk of chunkTargets(targets, COMPRESS_PER_TX)) {
        const ids = chunk.map((t) => t.claimId);
        const signature = await this.light.compressChunk(
          cluster,
          mint,
          sponsorKp,
          stagingAta,
          chunk.map((t) => ({ burner: t.burner, baseUnits: t.baseUnits })),
          async (sig, lastValid) => {
            // Saved BEFORE sending. Only rows that have no signature yet may take this one, and all of them must.
            const { data: saved } = await this.supabase.payments
              .update({ compress_sig: sig, compress_last_valid_block_height: lastValid })
              .in('id', ids)
              .is('compress_sig', null)
              .select('id');
            if (saved?.length !== ids.length) {
              await this.supabase.payments.update({ compress_sig: null, compress_last_valid_block_height: null }).in('id', ids).eq('compress_sig', sig);
              throw new Error('could not reserve these payouts for a compress transaction');
            }
          },
        );
        for (const id of ids) await this.payouts.recordFunded(p.batch_id, id, signature);
      }
    }

    // 3. Done when nothing is left open.
    const left = await this.supabase.payoutBatchItems.select('payment_id').eq('batch_id', p.batch_id).eq('status', 'created').in('payment_id', p.payment_ids);
    if (!(left.data ?? []).length) {
      await this.supabase.partnerTreasuryProposals.update({ compress_status: 'done', compressed_at: new Date().toISOString(), compress_error: null }).eq('id', p.id);
      await this.payouts.closeBatchIfFunded(partner, p.batch_id, p.created_by_user_id);
    }
  }

  private cluster(): 'mainnet' | 'devnet' {
    return isSolanaDevnetFromConfig(this.config) ? 'devnet' : 'mainnet';
  }
}
