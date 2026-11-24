import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { isCronEnabled } from '@/common/cron-gate';
import { selectInChunks } from '@/common/in-chunks';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { CompressError, LightCompressionService, chunkTargets, COMPRESS_PER_TX } from '@/common/light-compression.service';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '@/redis/redis.service';
import { ClaimsService } from '@/modules/claims/claims.service';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { PartnerTreasuryService } from './partner-treasury.service';
import { PartnerPayoutsService } from './partner-payouts.service';
import { Partner } from './partners.service';

const MAX_ATTEMPTS = 20;
/** One run keeps compressing for at most this long (about 100 transactions, 1,500 payouts), then the next run carries on. Shorter than the lock below. */
const TICK_BUDGET_MS = 240_000;
const LOCK_MS = 300_000;
/** Compress transactions in flight at once. They all write the same staging account and token pool, so the network orders them; more than a few at once only queues. */
const COMPRESS_CONCURRENCY = 4;

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
    }, LOCK_MS);
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

    // A batch can hold 1,000 payouts: every read by id list goes in groups of 100 so the query stays short.
    const batchId = p.batch_id;
    const openIds = async (): Promise<Set<string>> => {
      const { data, error } = await selectInChunks<{ payment_id: string }>(p.payment_ids, (g) => this.supabase.payoutBatchItems.select('payment_id').eq('batch_id', batchId).eq('status', 'created').in('payment_id', g));
      if (error) throw new Error(`could not read the batch items: ${error.message}`);
      return new Set(data.map((i) => i.payment_id));
    };
    const payRows = async (): Promise<PaymentRow[]> => {
      const { data, error } = await selectInChunks<PaymentRow>(p.payment_ids, (g) => this.supabase.payments.select('id, compress_sig, compress_last_valid_block_height').in('id', g));
      if (error) throw new Error(`could not read the payouts: ${error.message}`);
      return data;
    };
    const open = await openIds();
    const todo = (await payRows()).filter((r) => open.has(r.id));

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
    const openNow = await openIds();
    const allFresh = (await payRows()).filter((r) => openNow.has(r.id) && !r.compress_sig).map((r) => r.id);
    // Everything still to send goes in a row, 15 payouts per transaction, within a time budget so one run never outlives its lock.
    // If the budget runs out the next tick carries on from where this one stopped.
    const fresh = allFresh;
    if (fresh.length) {
      const sponsorKp = this.sponsor.getFeePayerKeypair();
      if (!sponsorKp) throw new Error('fee payer is not available');
      const groups = chunkTargets(fresh, COMPRESS_PER_TX);
      const firstTargets = await this.claims.getPartnerPayoutTargets(groups[0], partner.id);
      const mint = new PublicKey(firstTargets[0].mint);
      const stagingAta = await getAssociatedTokenAddress(mint, sponsorKp.publicKey);
      const staged = await this.sponsor.getConnectionForCluster(cluster).getTokenAccountBalance(stagingAta, 'confirmed').then((r) => BigInt(r.value.amount));
      const { data: amounts, error: amountErr } = await selectInChunks<{ amount: string | number }>(fresh, (g) => this.supabase.payments.select('amount').in('id', g));
      if (amountErr) throw new Error(`could not read the amounts: ${amountErr.message}`);
      const needed = amounts.reduce((a, r) => a + BigInt(Math.round(Number(r.amount) * 1_000_000)), BigInt(0));
      if (staged < needed) throw new Error(`staging holds ${staged} but ${needed} is needed to fund these payouts`);

      const deadline = Date.now() + TICK_BUDGET_MS;
      const stuck: Array<{ id: string; reason: string }> = [];

      /**
       * Sends these payouts in one transaction. If it can never go through as it is (too big, too much compute, refused, or failed on
       * chain), the payouts are freed and each half is sent on its own, down to a single payout. So one bad payout, or a transaction that
       * is simply too large, only slows things down. A failure that might still land (not confirmed yet) is NOT retried here: the saved
       * signature is checked by the next run, which is what keeps a burner from ever being funded twice.
       */
      const send = async (group: string[], known?: Awaited<ReturnType<typeof this.claims.getPartnerPayoutTargets>>): Promise<void> => {
        const chunk = known ?? (await this.claims.getPartnerPayoutTargets(group, partner.id));
        const ids = chunk.map((t) => t.claimId);
        try {
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
          for (const id of ids) await this.payouts.recordFunded(p.batch_id as string, id, signature);
        } catch (e) {
          if (!(e instanceof CompressError) || !e.definite) throw e;
          if (e.signature) {
            await this.supabase.payments.update({ compress_sig: null, compress_last_valid_block_height: null }).in('id', ids).eq('compress_sig', e.signature);
          }
          if (ids.length === 1) {
            stuck.push({ id: ids[0], reason: e.message });
            this.logger.warn(`Payout ${ids[0]} could not be compressed even on its own: ${e.message}`);
            return;
          }
          const mid = Math.ceil(ids.length / 2);
          this.logger.warn(`Compressing ${ids.length} payouts failed (${e.message.slice(0, 120)}); trying ${mid} and ${ids.length - mid}`);
          await send(ids.slice(0, mid));
          await send(ids.slice(mid));
        }
      };

      // Several transactions at once. Every group is its own set of payouts with its own saved signature, so they cannot
      // overlap. If one hits a failure that might still land, nobody starts a new group, the others finish what they have
      // in flight, and the failure is raised afterwards.
      let nextGroup = 0;
      let halted: unknown = null;
      const worker = async () => {
        while (!halted && Date.now() <= deadline) {
          const gi = nextGroup++;
          if (gi >= groups.length) return;
          try {
            await send(groups[gi], gi === 0 ? firstTargets : undefined);
          } catch (e) {
            halted = halted ?? e;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(COMPRESS_CONCURRENCY, groups.length) }, worker));
      if (halted) throw halted;
      if (stuck.length) {
        throw new Error(`${stuck.length} payout${stuck.length === 1 ? '' : 's'} could not be compressed even on their own (${stuck.slice(0, 3).map((x) => x.id.slice(0, 8)).join(', ')}): ${stuck[0].reason}`.slice(0, 480));
      }
    }

    // 3. Done when nothing is left open.
    if (!(await openIds()).size) {
      await this.supabase.partnerTreasuryProposals.update({ compress_status: 'done', compressed_at: new Date().toISOString(), compress_error: null }).eq('id', p.id);
      await this.payouts.closeBatchIfFunded(partner, p.batch_id, p.created_by_user_id);
    }
  }

  private cluster(): 'mainnet' | 'devnet' {
    return isSolanaDevnetFromConfig(this.config) ? 'devnet' : 'mainnet';
  }
}
