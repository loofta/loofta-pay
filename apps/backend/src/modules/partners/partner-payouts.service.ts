import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import { ClaimsService, runWithPartnerBatchAllowance } from '@/modules/claims/claims.service';
import { RedisService } from '@/redis/redis.service';
import { isValidSolanaAddress } from '@/common/solana-address';
import { EmailService } from '@/modules/email/email.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Partner, PartnersService } from './partners.service';
import { ApproveBatchDto, ConfirmBatchDto, CreatePartnerBatchDto, PrepareBatchDto } from './dto/partner-batch.dto';

type BatchRow = {
  id: string;
  partner_id: string;
  status: string;
  idempotency_key: string;
  label: string | null;
  total_amount: number | string;
  item_count: number;
  failed_count: number;
  rows_hash: string | null;
  created_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  sender_wallet: string | null;
  scheduled_for: string | null;
  scheduled_run_at: string | null;
  scheduled_error: string | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  row_index: number;
  recipient_type: string;
  recipient_identifier: string;
  amount: number | string;
  external_ref: string | null;
  message: string | null;
  status: string;
  error: string | null;
  payment_id: string | null;
  funding_tx: string | null;
};

const BATCH_COLUMNS =
  'id, partner_id, status, idempotency_key, label, total_amount, item_count, failed_count, rows_hash, created_by_user_id, approved_by_user_id, approved_at, sender_wallet, scheduled_for, scheduled_run_at, scheduled_error, created_at';
const ITEM_COLUMNS = 'id, row_index, recipient_type, recipient_identifier, amount, external_ref, message, status, error, payment_id, funding_tx';

/** Hash of exactly what an approver reviewed. Identifier case and amount precision are normalised. */
export function hashBatchRows(rows: Array<{ type: string; identifier: string; amount: number | string; message?: string | null }>): string {
  const canonical = rows.map((r) => [r.type, r.identifier.trim().toLowerCase(), Number(r.amount).toFixed(6), (r.message ?? '').trim()]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Partner batch payouts, driven by signed-in team members.
 *
 *   draft    -> rows only. No claim, no burner, no money. Stored with a hash of the rows.
 *   approve  -> a DIFFERENT member signs off when the total is over the partner's threshold,
 *               and only if the rows still hash to what they were shown.
 *   prepare  -> creates the claims (always burner-routed and tagged with partner_id, so they can
 *               only be withdrawn with the partner fee) and returns funding transactions that the
 *               member's own wallet signs.
 *   confirm  -> marks a payout funded only after the transaction is read back from the chain and
 *               the burner really holds the money.
 *
 * Loofta never holds the partner's funds: the partner's wallet signs every transfer.
 */
@Injectable()
export class PartnerPayoutsService {
  private readonly logger = new Logger(PartnerPayoutsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly partners: PartnersService,
    private readonly claims: ClaimsService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  // ------------------------------------------------------------------ events

  /**
   * Queues a batch-level webhook event for the partner's integrator account (it holds the webhook URL).
   * Never throws: a missed event must not block the batch. One row per (batch, event).
   */
  private async emitBatchEvent(partner: Partner, batchId: string, eventType: string, extra: Record<string, unknown> = {}): Promise<void> {
    if (!partner.integrator_id) return;
    try {
      const { error } = await this.supabase.payoutWebhookEvents.insert({
        integrator_id: partner.integrator_id,
        batch_id: batchId,
        payment_id: null,
        event_type: eventType,
        payload: { event: eventType, batch_id: batchId, ...extra },
      });
      if (error && error.code !== '23505') this.logger.warn(`Partner event ${eventType} for batch ${batchId} not queued: ${error.message}`);
    } catch (e) {
      this.logger.warn(`Partner event ${eventType} for batch ${batchId} failed: ${(e as Error).message}`);
    }
  }

  /** The time a batch should run, or null. Between 5 minutes and 90 days ahead. */
  private parseSchedule(value: string | undefined): string | null {
    if (!value) return null;
    const at = new Date(value).getTime();
    if (!Number.isFinite(at)) throw new BadRequestException('scheduled_for is not a valid date.');
    if (at < Date.now() + 5 * 60_000) throw new BadRequestException('scheduled_for must be at least 5 minutes from now.');
    if (at > Date.now() + 90 * 24 * 3_600_000) throw new BadRequestException('scheduled_for can be at most 90 days from now.');
    return new Date(at).toISOString();
  }

  /** Optional hard caps (USD), enforced when a batch is drafted and again when it is prepared. Never at withdrawal. */
  private caps() {
    const n = (k: string) => {
      const v = Number(this.config.get<string>(k));
      return Number.isFinite(v) && v > 0 ? v : null;
    };
    return { perRow: n('PARTNER_PAYOUT_MAX_ROW_USD'), perBatch: n('PARTNER_PAYOUT_MAX_BATCH_USD') };
  }

  private assertWithinCaps(amounts: number[]) {
    const { perRow, perBatch } = this.caps();
    if (perRow && amounts.some((a) => a > perRow)) throw new BadRequestException(`A single payout cannot exceed $${perRow} right now.`);
    const total = amounts.reduce((a, b) => a + b, 0);
    if (perBatch && total > perBatch) throw new BadRequestException(`A batch cannot exceed $${perBatch} in total right now.`);
  }

  private async getOwnedBatch(partnerId: string, batchId: string): Promise<BatchRow> {
    const { data } = await this.supabase.payoutBatches.select(BATCH_COLUMNS).eq('id', batchId).eq('partner_id', partnerId).maybeSingle();
    if (!data) throw new NotFoundException('Batch not found.');
    return data as unknown as BatchRow;
  }

  private async getItems(batchId: string): Promise<ItemRow[]> {
    const { data } = await this.supabase.payoutBatchItems.select(ITEM_COLUMNS).eq('batch_id', batchId).order('row_index', { ascending: true });
    return (data ?? []) as unknown as ItemRow[];
  }

  // ------------------------------------------------------------------ draft

  async createDraft(orgId: string, userId: string, dto: CreatePartnerBatchDto) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'payout.create');
    return this.insertDraft(partner, userId, dto);
  }

  /**
   * A batch drafted by the partner's own server with an API key. It can never approve itself: it always
   * waits for a signed-in owner or admin, and money only moves when the company wallet's signers sign.
   */
  async createDraftViaApi(integratorId: string, dto: CreatePartnerBatchDto) {
    const partner = await this.partnerForIntegrator(integratorId);
    return this.insertDraft(partner, null, dto);
  }

  async getViaApi(integratorId: string, batchId: string) {
    const partner = await this.partnerForIntegrator(integratorId);
    return this.view(partner.id, batchId);
  }

  private async partnerForIntegrator(integratorId: string): Promise<Partner> {
    const { data } = await this.supabase.partners.select('*').eq('integrator_id', integratorId).maybeSingle();
    if (!data) throw new ForbiddenException('This API key is not linked to a partner account.');
    if ((data as Partner).status !== 'active') throw new ForbiddenException('This partner account is suspended.');
    return data as Partner;
  }

  /** `userId` is null for a batch drafted through the API. */
  private async insertDraft(partner: Partner, userId: string | null, dto: CreatePartnerBatchDto) {
    const { data: existing } = await this.supabase.payoutBatches
      .select('id')
      .eq('partner_id', partner.id)
      .eq('idempotency_key', dto.idempotency_key)
      .maybeSingle();
    if (existing) return this.view(partner.id, existing.id);

    const scheduledFor = this.parseSchedule(dto.scheduled_for);
    const rows = dto.rows.map((r) => ({
      type: r.recipient_type,
      identifier: r.recipient_identifier.trim(),
      amount: Number(r.amount),
      message: r.message?.trim() || null,
      external_ref: r.external_ref ?? null,
    }));
    if (rows.some((r) => !r.identifier)) throw new BadRequestException('Every row needs a recipient.');
    // Partner payouts go to an email address: the recipient gets a branded email and signs in with that same email.
    const notEmail = rows.find((r) => r.type !== 'email' || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(r.identifier));
    if (notEmail) throw new BadRequestException(`Payouts can only be sent to email addresses. "${notEmail.identifier.slice(0, 60)}" is not one.`);
    if (rows.some((r) => !Number.isFinite(r.amount) || r.amount < 1)) throw new BadRequestException('The minimum payout is $1.00.');
    this.assertWithinCaps(rows.map((r) => r.amount));

    const total = Math.round(rows.reduce((a, r) => a + r.amount, 0) * 1e6) / 1e6;
    const needsApproval = userId === null || (partner.approval_threshold_usd > 0 && total > Number(partner.approval_threshold_usd));
    const rowsHash = hashBatchRows(rows);

    const { data: batch, error } = await this.supabase.payoutBatches
      .insert({
        partner_id: partner.id,
        idempotency_key: dto.idempotency_key,
        label: dto.label ?? null,
        item_count: rows.length,
        total_amount: total,
        status: needsApproval ? 'pending_approval' : 'approved',
        rows_hash: rowsHash,
        scheduled_for: scheduledFor,
        created_by_user_id: userId,
        ...(needsApproval || !userId ? {} : { approved_by_user_id: userId, approved_at: new Date().toISOString() }),
      })
      .select('id')
      .single();
    if (error || !batch) {
      // Lost a race with a retry of the same key: return the winner.
      const { data: again } = await this.supabase.payoutBatches.select('id').eq('partner_id', partner.id).eq('idempotency_key', dto.idempotency_key).maybeSingle();
      if (again) return this.view(partner.id, again.id);
      throw new BadRequestException('Could not create the batch.');
    }

    const { error: itemsErr } = await this.supabase.payoutBatchItems.insert(
      rows.map((r, i) => ({
        batch_id: batch.id,
        row_index: i,
        recipient_type: r.type,
        recipient_identifier: r.identifier,
        amount: r.amount,
        external_ref: r.external_ref,
        message: r.message,
        status: 'queued',
      })),
    );
    if (itemsErr) {
      // A batch with no rows must not exist: it could never match its hash.
      await this.supabase.payoutBatches.delete().eq('id', batch.id);
      throw new BadRequestException('Could not save the batch rows.');
    }

    await this.partners.audit(partner.id, userId, 'batch.created', { type: 'batch', id: batch.id }, { total, rows: rows.length, needsApproval, ...(scheduledFor ? { scheduledFor } : {}), ...(userId ? {} : { via: 'api' }) });
    await this.emitBatchEvent(partner, batch.id, 'batch.created', { status: needsApproval ? 'pending_approval' : 'approved', total_amount: total, item_count: rows.length, scheduled_for: scheduledFor });
    if (!needsApproval) await this.emitBatchEvent(partner, batch.id, 'batch.approved', { total_amount: total, scheduled_for: scheduledFor });
    return this.view(partner.id, batch.id);
  }

  // ---------------------------------------------------------------- approval

  async approve(orgId: string, userId: string, batchId: string, dto: ApproveBatchDto) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'payout.approve');
    const batch = await this.getOwnedBatch(partner.id, batchId);
    if (batch.status !== 'pending_approval') throw new ConflictException('This batch is not waiting for approval.');
    if (batch.created_by_user_id === userId) throw new ForbiddenException('A batch needs a second member to approve it.');

    const items = await this.getItems(batchId);
    const currentHash = hashBatchRows(items.map((i) => ({ type: i.recipient_type, identifier: i.recipient_identifier, amount: i.amount, message: i.message })));
    // Both must match: what the approver was shown, and what is stored right now.
    if (dto.rows_hash !== batch.rows_hash || currentHash !== batch.rows_hash) {
      throw new ConflictException('The batch changed since you reviewed it. Reload and review it again.');
    }

    const { data: won } = await this.supabase.payoutBatches
      .update({ status: 'approved', approved_by_user_id: userId, approved_at: new Date().toISOString() })
      .eq('id', batchId)
      .eq('partner_id', partner.id)
      .eq('status', 'pending_approval')
      .select('id');
    if (!won?.length) throw new ConflictException('This batch was already handled.');

    await this.partners.audit(partner.id, userId, 'batch.approved', { type: 'batch', id: batchId }, { rows_hash: batch.rows_hash });
    await this.emitBatchEvent(partner, batchId, 'batch.approved', { total_amount: Number(batch.total_amount), scheduled_for: batch.scheduled_for });
    return this.view(partner.id, batchId);
  }

  /** Reject a batch waiting for approval, or cancel one that was approved but not prepared yet. No claim exists in either state. */
  async cancel(orgId: string, userId: string, batchId: string) {
    const { partner, member } = await this.partners.requireMembership(orgId, userId, 'payout.create');
    const batch = await this.getOwnedBatch(partner.id, batchId);
    const isReviewer = member.role === 'owner' || member.role === 'admin';
    if (batch.created_by_user_id !== userId && !isReviewer) throw new ForbiddenException('Only the creator or an admin can cancel this batch.');
    const { data: won } = await this.supabase.payoutBatches
      .update({ status: 'cancelled' })
      .eq('id', batchId)
      .eq('partner_id', partner.id)
      .in('status', ['pending_approval', 'approved'])
      .select('id');
    if (!won?.length) throw new ConflictException('This batch can no longer be cancelled.');
    await this.partners.audit(partner.id, userId, 'batch.cancelled', { type: 'batch', id: batchId });
    await this.emitBatchEvent(partner, batchId, 'batch.cancelled');
    return this.view(partner.id, batchId);
  }

  // ----------------------------------------------------------------- prepare

  async prepare(orgId: string, userId: string, batchId: string, dto: PrepareBatchDto, opts: { scheduled?: boolean } = {}) {
    const { partner, member } = await this.partners.requireMembership(orgId, userId, 'payout.create');
    // Payouts are funded from the partner's company wallet (their own multisig). A personal wallet is
    // only a fallback for deployments that explicitly allow it.
    const treasury = !!partner.treasury_multisig && !!partner.treasury_vault;
    if (!treasury && this.config.get<string>('PARTNER_ALLOW_PERSONAL_FUNDING') !== 'true') {
      throw new BadRequestException('Create your company wallet first. Payouts are funded from it.');
    }
    const wallet = treasury ? (partner.treasury_vault as string) : (dto.sender_wallet ?? '').trim();
    if (!isValidSolanaAddress(wallet)) throw new BadRequestException('Invalid wallet address.');
    // Fees default to the wallet that funds payouts, only while none is set.
    await this.partners.adoptFundingWalletAsFeeWallet(partner, member.role, userId, wallet);

    // One prepare at a time per batch: two concurrent runs would each create a burner per row.
    let firstPrepare = false;
    const result = await this.redis.withLock(`partner-batch-prepare:${batchId}`, async () => {
      let batch = await this.getOwnedBatch(partner.id, batchId);
      if (!['approved', 'awaiting_funding'].includes(batch.status)) throw new ConflictException(`This batch is ${batch.status.replace('_', ' ')}.`);
      // A scheduled batch waits for its time. Cancel it to change plans; it cannot be run early by accident.
      if (!opts.scheduled && batch.status === 'approved' && batch.scheduled_for && new Date(batch.scheduled_for).getTime() > Date.now()) {
        throw new ConflictException(`This batch is scheduled for ${batch.scheduled_for}. It is prepared automatically then.`);
      }
      if (batch.sender_wallet && batch.sender_wallet !== wallet) {
        throw new ConflictException('This batch was prepared for a different wallet.');
      }

      const items = await this.getItems(batchId);
      const currentHash = hashBatchRows(items.map((i) => ({ type: i.recipient_type, identifier: i.recipient_identifier, amount: i.amount, message: i.message })));
      if (currentHash !== batch.rows_hash) throw new ConflictException('The batch rows no longer match what was approved.');
      this.assertWithinCaps(items.map((i) => Number(i.amount)));

      if (batch.status === 'approved') {
        const { data: won } = await this.supabase.payoutBatches
          .update({ status: 'awaiting_funding', sender_wallet: wallet, prepared_at: new Date().toISOString() })
          .eq('id', batchId)
          .eq('partner_id', partner.id)
          .eq('status', 'approved')
          .select('id');
        if (!won?.length) throw new ConflictException('This batch was already prepared.');
        firstPrepare = true;
      }

      const queued = items.filter((i) => i.status === 'queued');
      if (queued.length) {
        await runWithPartnerBatchAllowance(queued.length, async () => {
          for (const item of queued) await this.createClaimForItem(partner.id, userId, batchId, item);
        });
      }

      const created = (await this.getItems(batchId)).filter((i) => i.status === 'created' && i.payment_id);
      if (!created.length) throw new BadRequestException('No payouts could be created. Check the rows for errors.');

      if (treasury) {
        // The company wallet funds them: the team approves proposals, built one chunk at a time.
        const failedCount = (await this.getItems(batchId)).filter((i) => i.status === 'failed').length;
        await this.supabase.payoutBatches.update({ failed_count: failedCount }).eq('id', batchId);
        batch = await this.getOwnedBatch(partner.id, batchId);
        return { batch_id: batchId, treasury: true as const, payouts: created.length, failed_count: failedCount, status: batch.status };
      }

      // Gas is paid in USDC by default: the Loofta fee payer fronts the network fee and the partner
      // sends the matching USDC. PARTNER_GAS_IN_SOL=true switches back to the wallet paying SOL.
      const packed = await this.claims.buildPackedPublicTransfersForPayer(
        created.map((i) => i.payment_id as string),
        userId,
        wallet,
        8,
        { sponsorGas: this.config.get<string>('PARTNER_GAS_IN_SOL') !== 'true' },
      );

      const failed = (await this.getItems(batchId)).filter((i) => i.status === 'failed').length;
      await this.supabase.payoutBatches.update({ failed_count: failed }).eq('id', batchId);
      batch = await this.getOwnedBatch(partner.id, batchId);
      return {
        batch_id: batchId,
        transactions: packed.map((p) => ({ payment_ids: p.claimIds, unsigned_transaction: p.transactionBase64, transaction_version: p.version })),
        gas_usdc: Math.round(packed.reduce((a, p) => a + (p.gasUsdc ?? 0), 0) * 1e6) / 1e6,
        failed_count: failed,
        status: batch.status,
      };
    }, 120_000);

    if (!result) throw new ConflictException('This batch is being prepared by someone else. Try again in a moment.');
    await this.partners.audit(partner.id, userId, 'batch.prepared', { type: 'batch', id: batchId }, { wallet, ...(opts.scheduled ? { scheduled: true } : {}) });
    if (firstPrepare) await this.announceReady(partner, batchId, !!opts.scheduled);
    return result;
  }

  /** Tells the partner's server (webhook) and its owners and admins (email) that a batch now waits for the signers. */
  private async announceReady(partner: Partner, batchId: string, scheduled: boolean): Promise<void> {
    const batch = await this.getOwnedBatch(partner.id, batchId);
    await this.emitBatchEvent(partner, batchId, 'batch.ready_to_fund', {
      total_amount: Number(batch.total_amount), item_count: batch.item_count, failed_count: batch.failed_count, scheduled,
    });
    try {
      const { data: members } = await this.supabase.partnerMembers
        .select('email, role, status').eq('partner_id', partner.id).in('role', ['owner', 'admin']).eq('status', 'active');
      const base = (this.config.get<string>('PAY_APP_URL') || 'https://pay.loofta.com').replace(/\/$/, '');
      const url = `${base}/app/partner?org=${encodeURIComponent(partner.org_id)}&tab=payouts&batch=${encodeURIComponent(batchId)}`;
      const to = new Set<string>();
      for (const m of members ?? []) if (m.email) to.add((m.email as string).trim().toLowerCase());
      if (partner.contact_email) to.add(partner.contact_email.trim().toLowerCase());
      for (const recipientEmail of to) {
        await this.email.sendPartnerBatchReadyEmail({
          recipientEmail, partnerName: partner.name, label: batch.label, total: Number(batch.total_amount),
          count: batch.item_count, url, scheduled,
        });
      }
    } catch (e) {
      this.logger.warn(`Batch ${batchId} ready emails failed: ${(e as Error).message}`);
    }
  }

  // --------------------------------------------------------------- scheduling

  /**
   * Every minute: runs approved batches whose time has come. "Run" means prepare: the payouts are created and
   * the company wallet's signers are asked to approve the funding. Loofta holds no keys, so the money itself
   * only moves when they sign. Acts as the person who approved the batch, so it has exactly their permissions.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async runScheduledBatches(): Promise<void> {
    if (process.env.NODE_ENV !== 'production') return;
    const { data: due } = await this.supabase.payoutBatches
      .select('id, partner_id, approved_by_user_id, created_by_user_id')
      .eq('status', 'approved')
      .is('scheduled_run_at', null)
      .not('scheduled_for', 'is', null)
      .lte('scheduled_for', new Date().toISOString())
      .order('scheduled_for', { ascending: true })
      .limit(10);
    for (const b of due ?? []) await this.runScheduledBatch(b as { id: string; partner_id: string; approved_by_user_id: string | null; created_by_user_id: string | null });
  }

  async runScheduledBatch(b: { id: string; partner_id: string; approved_by_user_id: string | null; created_by_user_id: string | null }): Promise<'ran' | 'skipped' | 'failed'> {
    // Claim it first, so two instances (or two ticks) can never run the same batch twice.
    const { data: won } = await this.supabase.payoutBatches
      .update({ scheduled_run_at: new Date().toISOString() })
      .eq('id', b.id).eq('status', 'approved').is('scheduled_run_at', null).select('id');
    if (!won?.length) return 'skipped';

    const actor = b.approved_by_user_id ?? b.created_by_user_id;
    const { data: partnerRow } = await this.supabase.partners.select('org_id, status').eq('id', b.partner_id).maybeSingle();
    try {
      if (!actor || !partnerRow) throw new Error('No approver on record.');
      if ((partnerRow as { status: string }).status !== 'active') throw new Error('The partner account is not active.');
      await this.prepare((partnerRow as { org_id: string }).org_id, actor, b.id, {}, { scheduled: true });
      return 'ran';
    } catch (e) {
      const message = (e as Error).message.slice(0, 300);
      this.logger.warn(`Scheduled batch ${b.id} could not be prepared: ${message}`);
      await this.supabase.payoutBatches.update({ scheduled_error: message }).eq('id', b.id);
      const { data: full } = await this.supabase.partners.select('*').eq('id', b.partner_id).maybeSingle();
      if (full) await this.emitBatchEvent(full as Partner, b.id, 'batch.schedule_failed', { error: message });
      return 'failed';
    }
  }

  /** Creates one burner-routed, partner-tagged payout. A row that fails is recorded and skipped, never blocking the others. */
  private async createClaimForItem(partnerId: string, userId: string, batchId: string, item: ItemRow) {
    const fail = async (message: string) => {
      await this.supabase.payoutBatchItems.update({ status: 'failed', error: message.slice(0, 500) }).eq('id', item.id).eq('status', 'queued');
    };
    try {
      // forceBurner: even a registered Loofta user's payout waits in a burner, so it can only be
      // withdrawn through the partner's withdraw page with the partner fee applied.
      const shared = {
        amount: Number(item.amount),
        userId,
        isPrivate: false,
        description: item.message ?? undefined,
        forceBurner: true,
      };
      let created: { id: string };
      switch (item.recipient_type) {
        case 'email':
          created = await this.claims.createFromEmail({ ...shared, email: item.recipient_identifier });
          break;
        case 'username':
          created = await this.claims.createFromUsername({ ...shared, username: item.recipient_identifier });
          break;
        case 'twitter':
          created = await this.claims.createFromUsername({ ...shared, username: item.recipient_identifier, treatUnregisteredAsTwitter: true });
          break;
        case 'discord':
        case 'github':
        case 'telegram':
          created = await this.claims.createFromSocial({ ...shared, platform: item.recipient_type, handle: item.recipient_identifier });
          break;
        default:
          await fail(`Unsupported recipient type: ${item.recipient_type}`);
          return;
      }

      // Tag it immediately. An untagged burner payout would be claimable the ordinary way, without
      // the partner fee, so a payout that cannot be tagged is never funded.
      const { data: tagged } = await this.supabase.payments.update({ partner_id: partnerId }).eq('id', created.id).is('partner_id', null).select('id');
      if (!tagged?.length) {
        this.logger.error(`Partner payout ${created.id} could not be tagged with partner ${partnerId}; leaving it unfunded.`);
        await fail('Could not attach this payout to the partner.');
        return;
      }
      await this.supabase.payoutBatchItems.update({ status: 'created', payment_id: created.id, error: null }).eq('id', item.id).eq('status', 'queued');
    } catch (err) {
      const message = (err as Error).message || 'Could not create this payout.';
      this.logger.warn(`Partner batch ${batchId} row ${item.row_index} failed: ${message}`);
      await fail(message);
    }
  }

  // ----------------------------------------------------------------- confirm

  async confirm(orgId: string, userId: string, batchId: string, dto: ConfirmBatchDto) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'payout.create');
    const batch = await this.getOwnedBatch(partner.id, batchId);
    if (batch.status === 'executed') return this.view(partner.id, batchId);
    if (batch.status !== 'awaiting_funding' || !batch.sender_wallet) throw new ConflictException('This batch is not waiting for funding.');

    const items = await this.getItems(batchId);
    const pending = items.filter((i) => i.status === 'created' && i.payment_id);
    const targets = await this.claims.getPartnerPayoutTargets(pending.map((i) => i.payment_id as string), partner.id);

    let remaining = targets;
    for (const signature of dto.signatures) {
      if (!remaining.length) break;
      const funded = await this.claims.verifyPartnerFundingTx(
        remaining,
        signature.trim(),
        partner.treasury_multisig ? { multisig: partner.treasury_multisig } : batch.sender_wallet,
      );
      for (const paymentId of funded) await this.recordFunded(batchId, paymentId, signature.trim());
      remaining = remaining.filter((t) => !funded.has(t.claimId));
    }

    await this.closeBatchIfFunded(partner, batchId, userId);
    return this.view(partner.id, batchId);
  }

  /**
   * Marks one payout funded once its money is really in the burner. Shared by confirm() and the compressed funding job.
   * Returns false when another run already counted it.
   */
  async recordFunded(batchId: string, paymentId: string, signature: string): Promise<boolean> {
    const { data: won } = await this.supabase.payoutBatchItems
      .update({ status: 'funded', funding_tx: signature })
      .eq('batch_id', batchId)
      .eq('payment_id', paymentId)
      .eq('status', 'created')
      .select('id');
    if (!won?.length) return false; // another run already counted this one
    try {
      await this.claims.updateStatus(paymentId, 'SUCCESS', { txHash: signature, paidWithToken: 'USDC', paidWithChain: 'solana' });
      this.claims.notifyRecipientAfterPayment(paymentId);
    } catch (err) {
      // Put it back so a retry can finish the job instead of leaving a funded burner unrecorded.
      await this.supabase.payoutBatchItems.update({ status: 'created', funding_tx: null }).eq('batch_id', batchId).eq('payment_id', paymentId).eq('status', 'funded');
      this.logger.error(`Partner payout ${paymentId} funded on-chain but status update failed: ${(err as Error).message}`);
      throw new BadRequestException('Funding was seen on-chain but could not be recorded yet. Retry in a moment.');
    }
    return true;
  }

  /** When nothing in the batch is left to fund, the batch is done: status, audit entry and the webhook event. */
  async closeBatchIfFunded(partner: Partner, batchId: string, actorUserId: string): Promise<void> {
    const stillOpen = (await this.getItems(batchId)).some((i) => i.status === 'created');
    if (stillOpen) return;
    const batch = await this.getOwnedBatch(partner.id, batchId);
    await this.supabase.payoutBatches.update({ status: 'executed' }).eq('id', batchId).eq('partner_id', partner.id).eq('status', 'awaiting_funding');
    await this.partners.audit(partner.id, actorUserId, 'batch.funded', { type: 'batch', id: batchId });
    await this.emitBatchEvent(partner, batchId, 'batch.executed', { total_amount: Number(batch.total_amount), item_count: batch.item_count });
  }

  // ---------------------------------------------------------------- overview

  private static readonly FUNDED = new Set(['PRIVATE_TRANSFER_PENDING', 'SUCCESS']);

  /** Who a payout was addressed to, readable but never a raw internal address. */
  private static recipientLabel(r: { recipient_email: string | null; recipient_address: string | null }): string | null {
    if (r.recipient_email) return r.recipient_email;
    const a = r.recipient_address ?? '';
    if (a.startsWith('PENDING_SOCIAL:')) return a.slice('PENDING_SOCIAL:'.length);
    if (a.startsWith('PENDING_USERNAME:')) return `@${a.slice('PENDING_USERNAME:'.length)}`;
    if (a.startsWith('PENDING_EMAIL:')) return a.slice('PENDING_EMAIL:'.length);
    return null;
  }

  /** created: not funded yet. funded: money is in, recipient has not acted. claimed: recipient started withdrawing. withdrawn: done. */
  private static stage(r: { status: string; partner_withdrawn_at: string | null; claim_requested_at?: string | null }): 'created' | 'funded' | 'claimed' | 'withdrawn' {
    if (r.partner_withdrawn_at) return 'withdrawn';
    if (!PartnerPayoutsService.FUNDED.has((r.status || '').toUpperCase())) return 'created';
    return r.claim_requested_at ? 'claimed' : 'funded';
  }

  private async loadPayments(partnerId: string, limit = 2000) {
    const { data } = await this.supabase.payments
      .select('id, amount, status, partner_fee_usdc, partner_withdrawn_at, recipient_email, recipient_address, paid_at, created_at, claim_requested_at')
      .eq('partner_id', partnerId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data ?? []) as unknown as Array<{
      id: string; amount: number | string; status: string; partner_fee_usdc: number | string | null;
      partner_withdrawn_at: string | null; recipient_email: string | null; recipient_address: string | null; paid_at: string | null; created_at: string; claim_requested_at: string | null;
    }>;
  }

  /** Dashboard numbers: what was paid, what is unclaimed, what was withdrawn, fees earned, a 30-day trend and claim speed. */
  async overview(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    const rows = await this.loadPayments(partner.id);
    let paid = 0, unclaimed = 0, withdrawn = 0, fees = 0, unfunded = 0;
    let paidCount = 0, unclaimedCount = 0, withdrawnCount = 0, claimedCount = 0;
    let monthPaid = 0, monthCount = 0;
    const monthKey = new Date().toISOString().slice(0, 7);
    const waitHours: number[] = [];
    const byRecipient = new Map<string, number>();
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      const st = PartnerPayoutsService.stage(r);
      if (st === 'withdrawn') {
        withdrawn += amt; withdrawnCount++; paid += amt; paidCount++;
        fees += Number(r.partner_fee_usdc) || 0;
        if (r.paid_at && r.partner_withdrawn_at) {
          const h = (new Date(r.partner_withdrawn_at).getTime() - new Date(r.paid_at).getTime()) / 3_600_000;
          if (Number.isFinite(h) && h >= 0) waitHours.push(h);
        }
      } else if (st === 'funded' || st === 'claimed') {
        unclaimed += amt; unclaimedCount++; paid += amt; paidCount++;
        if (st === 'claimed') claimedCount++;
      } else unfunded += amt;
      if (st !== 'created' && (r.paid_at ?? r.created_at).slice(0, 7) === monthKey) { monthPaid += amt; monthCount++; }
      if (st !== 'created') {
        const who = PartnerPayoutsService.recipientLabel(r) ?? 'Wallet recipient';
        byRecipient.set(who, (byRecipient.get(who) ?? 0) + amt);
      }
    }

    // Last 30 days, one bucket per UTC day: money paid in (by funding time) and money withdrawn.
    const day = (iso: string) => iso.slice(0, 10);
    const series: Array<{ date: string; paid_usd: number; withdrawn_usd: number }> = [];
    const idx = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      idx.set(d, series.length);
      series.push({ date: d, paid_usd: 0, withdrawn_usd: 0 });
    }
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      const paidAt = r.paid_at && PartnerPayoutsService.stage(r) !== 'created' ? idx.get(day(r.paid_at)) : undefined;
      if (paidAt !== undefined) series[paidAt].paid_usd += amt;
      const wd = r.partner_withdrawn_at ? idx.get(day(r.partner_withdrawn_at)) : undefined;
      if (wd !== undefined) series[wd].withdrawn_usd += amt;
    }

    const recentWithdrawals = rows
      .filter((r) => r.partner_withdrawn_at)
      .sort((a, b) => (b.partner_withdrawn_at! > a.partner_withdrawn_at! ? 1 : -1))
      .slice(0, 20)
      .map((r) => ({
        payment_id: r.id,
        recipient: PartnerPayoutsService.recipientLabel(r),
        amount: Number(r.amount) || 0,
        fee_usdc: Number(r.partner_fee_usdc) || 0,
        withdrawn_at: r.partner_withdrawn_at,
      }));
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      paid_usd: r2(paid), paid_count: paidCount,
      unclaimed_usd: r2(unclaimed), unclaimed_count: unclaimedCount,
      withdrawn_usd: r2(withdrawn), withdrawn_count: withdrawnCount,
      recipient_count: byRecipient.size,
      fees_earned_usd: r2(fees),
      awaiting_funding_usd: r2(unfunded),
      claim_rate_pct: paidCount ? Math.round(((withdrawnCount + claimedCount) / paidCount) * 100) : 0,
      paid_month_usd: r2(monthPaid),
      paid_month_count: monthCount,
      avg_hours_to_withdraw: waitHours.length ? r2(waitHours.reduce((a, b) => a + b, 0) / waitHours.length) : null,
      series: series.map((x) => ({ ...x, paid_usd: r2(x.paid_usd), withdrawn_usd: r2(x.withdrawn_usd) })),
      top_recipients: [...byRecipient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([recipient, amount]) => ({ recipient, amount: r2(amount) })),
      recent_withdrawals: recentWithdrawals,
    };
  }

  /** Every payout with where it is in the claim flow: not funded, waiting for the recipient, or withdrawn. */
  async payouts(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    const rows = await this.loadPayments(partner.id, 500);
    const ids = rows.map((r) => r.id);
    const batchOf = new Map<string, string>();
    if (ids.length) {
      const { data: items } = await this.supabase.payoutBatchItems.select('payment_id, batch_id').in('payment_id', ids);
      const batchIds = [...new Set((items ?? []).map((i) => i.batch_id as string))];
      const labels = new Map<string, string>();
      if (batchIds.length) {
        const { data: bs } = await this.supabase.payoutBatches.select('id, label, created_at').eq('partner_id', partner.id).in('id', batchIds);
        for (const b of bs ?? []) labels.set(b.id as string, (b.label as string | null) || new Date(b.created_at as string).toLocaleDateString('en-US'));
      }
      for (const i of items ?? []) batchOf.set(i.payment_id as string, labels.get(i.batch_id as string) ?? '');
    }
    const names = await this.recipientNames(partner.id);
    return rows.map((r) => {
      const label = PartnerPayoutsService.recipientLabel(r);
      return {
        payment_id: r.id,
        recipient: label,
        name: (label && names.get(label.toLowerCase())) || null,
        amount: Number(r.amount) || 0,
        stage: PartnerPayoutsService.stage(r),
        batch: batchOf.get(r.id) || null,
        created_at: r.created_at,
        funded_at: r.paid_at,
        withdrawn_at: r.partner_withdrawn_at,
        updated_at: r.partner_withdrawn_at ?? r.claim_requested_at ?? r.paid_at ?? r.created_at,
        partner_fee_usdc: Number(r.partner_fee_usdc) || 0,
      };
    });
  }

  /** Display names from the partner's imported recipients, keyed by email or platform:handle (lowercase). */
  private async recipientNames(partnerId: string): Promise<Map<string, string>> {
    const { data } = await this.supabase.partnerRecipients
      .select('display_name, email, handle_platform, handle')
      .eq('partner_id', partnerId)
      .limit(2000);
    const map = new Map<string, string>();
    for (const r of data ?? []) {
      if (!r.display_name) continue;
      if (r.email) map.set(String(r.email).toLowerCase(), r.display_name as string);
      if (r.handle_platform && r.handle) map.set(`${r.handle_platform}:${String(r.handle).toLowerCase()}`, r.display_name as string);
    }
    return map;
  }

  /** Small numbers for the sidebar badges. */
  async counts(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    const n = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
    const [batches, payouts, recipients, members] = await Promise.all([
      n(this.supabase.payoutBatches.select('id', { count: 'exact', head: true }).eq('partner_id', partner.id)),
      n(this.supabase.payments.select('id', { count: 'exact', head: true }).eq('partner_id', partner.id)),
      n(this.supabase.partnerRecipients.select('id', { count: 'exact', head: true }).eq('partner_id', partner.id)),
      n(this.supabase.partnerMembers.select('id', { count: 'exact', head: true }).eq('partner_id', partner.id).neq('status', 'removed')),
    ]);
    return { batches, payouts, recipients, members };
  }

  // -------------------------------------------------------------------- read

  async list(orgId: string, userId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    const { data } = await this.supabase.payoutBatches
      .select(BATCH_COLUMNS)
      .eq('partner_id', partner.id)
      .order('created_at', { ascending: false })
      .limit(50);
    return data ?? [];
  }

  async listViaApi(integratorId: string, limit = 25) {
    const partner = await this.partnerForIntegrator(integratorId);
    const { data } = await this.supabase.payoutBatches
      .select(BATCH_COLUMNS)
      .eq('partner_id', partner.id)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Math.floor(limit) || 25, 1), 100));
    return data ?? [];
  }

  /**
   * An API key may call off a batch that has not been prepared yet. Cancelling can only ever stop money from
   * moving, so it needs no approval. Once payouts exist (awaiting funding or later) it is refused.
   */
  async cancelViaApi(integratorId: string, batchId: string) {
    const partner = await this.partnerForIntegrator(integratorId);
    await this.getOwnedBatch(partner.id, batchId);
    const { data: won } = await this.supabase.payoutBatches
      .update({ status: 'cancelled' })
      .eq('id', batchId)
      .eq('partner_id', partner.id)
      .in('status', ['pending_approval', 'approved'])
      .select('id');
    if (!won?.length) throw new ConflictException('This batch can no longer be cancelled.');
    await this.partners.audit(partner.id, null, 'batch.cancelled', { type: 'batch', id: batchId }, { via: 'api' });
    await this.emitBatchEvent(partner, batchId, 'batch.cancelled');
    return this.view(partner.id, batchId);
  }

  async get(orgId: string, userId: string, batchId: string) {
    const { partner } = await this.partners.requireMembership(orgId, userId, 'view');
    return this.view(partner.id, batchId);
  }

  private async view(partnerId: string, batchId: string) {
    const batch = await this.getOwnedBatch(partnerId, batchId);
    const items = await this.getItems(batchId);
    const paymentIds = items.map((i) => i.payment_id).filter((id): id is string => !!id);
    const byId = new Map<string, { status: string; partner_fee_usdc: number | null; partner_withdrawn_at: string | null }>();
    if (paymentIds.length) {
      const { data } = await this.supabase.payments.select('id, status, partner_fee_usdc, partner_withdrawn_at').in('id', paymentIds).eq('partner_id', partnerId);
      for (const p of data ?? []) byId.set(p.id as string, p as never);
    }
    return {
      ...batch,
      items: items.map((i) => {
        const p = i.payment_id ? byId.get(i.payment_id) : undefined;
        return {
          row_index: i.row_index,
          recipient_type: i.recipient_type,
          recipient_identifier: i.recipient_identifier,
          amount: Number(i.amount),
          external_ref: i.external_ref,
          status: i.status,
          error: i.error,
          payment_id: i.payment_id,
          payment_status: p?.status ?? null,
          withdrawn: !!p?.partner_withdrawn_at,
          partner_fee_usdc: p?.partner_fee_usdc ?? null,
        };
      }),
    };
  }
}
