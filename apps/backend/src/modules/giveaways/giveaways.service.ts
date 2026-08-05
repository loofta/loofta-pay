import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { MAGICBLOCK_VOLUME_FEE_BPS, MAGICBLOCK_GAS_USDC } from '@/common/magicblock-private-transfer';
import { GiveawayBurnerSweepService } from './giveaway-burner-sweep.service';
import { GiveawayFundingService } from './giveaway-funding.service';
import { EmailService } from '../email/email.service';
import { CreateGiveawayDto } from './dto/create-giveaway.dto';
import { AdminReviewGiveawayDto } from './dto/admin-review-giveaway.dto';
import { AdminEditGiveawayDto } from './dto/admin-edit-giveaway.dto';
import {
  Giveaway,
  GiveawayTask,
  GiveawayStatus,
  GIVEAWAY_TASK_VERIFICATION_MODE,
} from './entities/giveaway.entity';

@Injectable()
export class GiveawaysService {
  private readonly logger = new Logger(GiveawaysService.name);
  private readonly usdcMint: string;
  private readonly isDevnet: boolean;
  private readonly baseUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly burnerSweep: GiveawayBurnerSweepService,
    private readonly fundingService: GiveawayFundingService,
    private readonly emailService: EmailService,
    private readonly privy: PrivyVerificationService,
  ) {
    this.isDevnet = isSolanaDevnetFromConfig(this.configService);
    const defaultUsdcMint = this.isDevnet
      ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
      : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    this.usdcMint =
      this.configService.get<string>('SOLANA_USDC_MINT') ||
      this.configService.get<string>('NEXT_PUBLIC_SOLANA_USDC_MINT') ||
      defaultUsdcMint;
    this.baseUrl = this.configService.get<string>('NEXT_PUBLIC_BASE_URL', 'https://pay.loofta.xyz');
  }

  /** Sized so the burner never runs short even if every winner picks private payout — see
   *  project memory `project_magicblock_fee_structure`: fee = 10bps USDC + 0.002 SOL-equivalent. */
  private computeFundingRequiredUsd(prizeAmountUsd: number, winnerCount: number): number {
    const perWinnerFee = (prizeAmountUsd * MAGICBLOCK_VOLUME_FEE_BPS) / 10_000 + MAGICBLOCK_GAS_USDC;
    return prizeAmountUsd * winnerCount + perWinnerFee * winnerCount;
  }

  private async logEvent(giveawayId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabaseService.giveawayEvents.insert({ giveaway_id: giveawayId, type, payload: payload ?? null });
    if (error) this.logger.warn(`[GiveawayEvent] ${giveawayId} ${type}: failed to log (non-fatal): ${error.message}`);
  }

  /** No stored email column — resolved live from the creator's linked Privy account, if any, only
   *  at send time. Creators who never linked an email simply don't get this notification. */
  private async resolveLinkedEmail(userId: string): Promise<string | null> {
    const privyUser = await this.privy.getPrivyUser(userId).catch(() => null);
    const emailAccount = privyUser?.linked_accounts?.find((a: any) => (a.type ?? '').toLowerCase() === 'email');
    return (emailAccount?.address as string | undefined) ?? null;
  }

  async create(userId: string, dto: CreateGiveawayDto): Promise<Giveaway> {
    const closeAt = new Date(dto.entries_close_at);
    if (Number.isNaN(closeAt.getTime()) || closeAt.getTime() <= Date.now()) {
      throw new BadRequestException('entries_close_at must be a valid future date');
    }

    const funding_required_usd = this.computeFundingRequiredUsd(dto.prize_amount_usd, dto.winner_count);

    const { data: giveaway, error } = await this.supabaseService.giveaways
      .insert({
        created_by: userId,
        title: dto.title,
        description: dto.description ?? null,
        logo_url: dto.logo_url ?? null,
        winner_count: dto.winner_count,
        selection_mode: dto.selection_mode,
        prize_amount_usd: dto.prize_amount_usd,
        entries_close_at: closeAt.toISOString(),
        eligibility: dto.eligibility ?? {},
        funding_required_usd,
        is_devnet: this.isDevnet,
        mint: this.usdcMint,
        status: GiveawayStatus.PENDING_APPROVAL,
      })
      .select()
      .single();
    if (error || !giveaway) {
      throw new BadRequestException(`Failed to create giveaway: ${error?.message ?? 'unknown error'}`);
    }

    const taskRows = dto.tasks.map((t, index) => ({
      giveaway_id: giveaway.id,
      order_index: index,
      task_type: t.task_type,
      config: t.config ?? {},
      // Fixed per-task-type, never client-supplied — see GIVEAWAY_TASK_VERIFICATION_MODE.
      verification_mode: GIVEAWAY_TASK_VERIFICATION_MODE[t.task_type],
    }));
    const { error: tasksError } = await this.supabaseService.giveawayTasks.insert(taskRows);
    if (tasksError) {
      // Roll back the giveaway row rather than leave a task-less giveaway stuck in PENDING_APPROVAL.
      await this.supabaseService.giveaways.delete().eq('id', giveaway.id);
      throw new BadRequestException(`Failed to create giveaway tasks: ${tasksError.message}`);
    }

    await this.logEvent(giveaway.id, 'submitted', { winner_count: dto.winner_count, task_count: dto.tasks.length });
    return giveaway as Giveaway;
  }

  async findMine(userId: string): Promise<Giveaway[]> {
    // Cancelled giveaways are dropped by self-service delete — the creator's own list should
    // read as "gone", not linger with a Cancelled card forever. Still visible to admins.
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .eq('created_by', userId)
      .neq('status', GiveawayStatus.CANCELLED)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }

  async findOneForCreator(id: string, userId: string): Promise<Giveaway & { tasks: GiveawayTask[] }> {
    const giveaway = await this.findOneOrThrow(id);
    if (giveaway.created_by !== userId) throw new ForbiddenException('Not your giveaway');
    const tasks = await this.getTasks(id);
    return { ...giveaway, tasks };
  }

  async findOneOrThrow(id: string): Promise<Giveaway> {
    const { data, error } = await this.supabaseService.giveaways.select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Giveaway not found');
    return data as Giveaway;
  }

  async getTasks(giveawayId: string): Promise<GiveawayTask[]> {
    const { data, error } = await this.supabaseService.giveawayTasks
      .select('*')
      .eq('giveaway_id', giveawayId)
      .order('order_index', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as GiveawayTask[];
  }

  /**
   * Creator self-service delete/cancel — only while it's still safe to do without moving money or
   * touching entries: before approval (nothing exists yet, hard-delete) or while awaiting funding
   * AND the burner has never received anything (soft-cancel, no refund needed). Once any USDC has
   * actually landed in the burner, self-service delete is refused — cancelling with real funds
   * already moved needs a human, not a button. Once OPEN or later, entries/tasks are in progress
   * too, same refusal.
   */
  async cancelOrDelete(id: string, userId: string): Promise<{ deleted: boolean; cancelled: boolean }> {
    const giveaway = await this.findOneOrThrow(id);
    if (giveaway.created_by !== userId) throw new ForbiddenException('Not your giveaway');

    if (giveaway.status === GiveawayStatus.DRAFT || giveaway.status === GiveawayStatus.PENDING_APPROVAL) {
      const { error } = await this.supabaseService.giveaways.delete().eq('id', id);
      if (error) throw new BadRequestException(error.message);
      return { deleted: true, cancelled: false };
    }

    if (giveaway.status === GiveawayStatus.PENDING_FUNDING) {
      // Re-check on-chain rather than trusting the DB's (possibly stale) confirmed amount.
      const { fundingConfirmedUsd } = await this.fundingService.checkAndUpdateFundingStatus(giveaway);
      if (fundingConfirmedUsd > 0) {
        throw new BadRequestException(
          'This giveaway already has funds in its burner, so it can\'t be deleted automatically. ' +
          'Contact support to cancel it: hello@loofta.xyz or t.me/looftapay.',
        );
      }
      const { error } = await this.supabaseService.giveaways
        .update({ status: GiveawayStatus.CANCELLED, cancel_reason: 'Cancelled by creator (no funds received)' })
        .eq('id', id);
      if (error) throw new BadRequestException(error.message);
      await this.logEvent(id, 'cancelled', { by: 'creator' });
      return { deleted: false, cancelled: true };
    }

    throw new BadRequestException(
      `Cannot delete a giveaway that is ${giveaway.status} — contact support to cancel it: hello@loofta.xyz or t.me/looftapay.`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Cron support
  // ─────────────────────────────────────────────────────────────────

  /** Giveaways whose status can still change on its own (open for entries, closed and about to
   *  freeze, or mid-draw) — the draw cron's per-tick worklist. */
  async findAdvanceable(): Promise<Giveaway[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .in('status', [GiveawayStatus.OPEN, GiveawayStatus.ENTRIES_CLOSED, GiveawayStatus.DRAWING])
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }

  /** Terminal giveaways whose burner still needs its GC reclaim pass (rent/dust recovery
   *  backstop) — mirrors claims.service.ts's cronReclaimFinishedClaimBurners. */
  async findTerminalUnreclaimedBurners(): Promise<Giveaway[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .in('status', [GiveawayStatus.COMPLETED, GiveawayStatus.CANCELLED, GiveawayStatus.REFUNDED, GiveawayStatus.UNDERFUNDED_EXPIRED])
      .not('burner_address', 'is', null)
      .is('burner_reclaimed_at', null)
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }

  async markBurnerReclaimed(giveawayId: string): Promise<void> {
    const { error } = await this.supabaseService.giveaways.update({ burner_reclaimed_at: new Date().toISOString() }).eq('id', giveawayId);
    if (error) this.logger.warn(`[Giveaway] ${giveawayId}: failed to mark burner_reclaimed_at: ${error.message}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Admin
  // ─────────────────────────────────────────────────────────────────

  async findPendingApproval(): Promise<(Giveaway & { created_by_email: string | null })[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .eq('status', GiveawayStatus.PENDING_APPROVAL)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const giveaways = (data ?? []) as Giveaway[];
    return Promise.all(
      giveaways.map(async (g) => ({ ...g, created_by_email: await this.resolveLinkedEmail(g.created_by) })),
    );
  }

  /** Cancelled giveaways are hidden from the creator's own "mine" list (findMine) once cancelled —
   *  this is the one place they're still visible, for admin audit/support context. */
  async findCancelled(): Promise<(Giveaway & { created_by_email: string | null })[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .eq('status', GiveawayStatus.CANCELLED)
      .order('updated_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const giveaways = (data ?? []) as Giveaway[];
    return Promise.all(
      giveaways.map(async (g) => ({ ...g, created_by_email: await this.resolveLinkedEmail(g.created_by) })),
    );
  }

  /** Admin lookup across every giveaway regardless of status — the only way an admin can find a
   *  giveaway that isn't PENDING_APPROVAL/CANCELLED (e.g. one that's already OPEN) in order to
   *  edit it. Optional title search since there's no other index for an admin to browse by. */
  async findAllForAdmin(search?: string): Promise<(Giveaway & { created_by_email: string | null })[]> {
    let query = this.supabaseService.giveaways.select('*').order('created_at', { ascending: false }).limit(100);
    if (search?.trim()) query = query.ilike('title', `%${search.trim()}%`);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const giveaways = (data ?? []) as Giveaway[];
    return Promise.all(
      giveaways.map(async (g) => ({ ...g, created_by_email: await this.resolveLinkedEmail(g.created_by) })),
    );
  }

  /** Admin, support-mediated edit — see AdminEditGiveawayDto for why prize/winner-count/selection
   *  fields are deliberately not editable here. Works at any point except the terminal statuses,
   *  where there's nothing left to usefully change. */
  async adminEdit(id: string, adminUserId: string, dto: AdminEditGiveawayDto): Promise<Giveaway> {
    const giveaway = await this.findOneOrThrow(id);
    const TERMINAL = [
      GiveawayStatus.COMPLETED,
      GiveawayStatus.CANCELLED,
      GiveawayStatus.REJECTED,
      GiveawayStatus.REFUNDED,
      GiveawayStatus.UNDERFUNDED_EXPIRED,
    ];
    if (TERMINAL.includes(giveaway.status)) {
      throw new BadRequestException(`Cannot edit a giveaway that is ${giveaway.status}`);
    }

    const update: Record<string, unknown> = {};
    if (dto.title !== undefined) update.title = dto.title;
    if (dto.description !== undefined) update.description = dto.description;
    if (dto.entries_close_at !== undefined) {
      const closeAt = new Date(dto.entries_close_at);
      if (Number.isNaN(closeAt.getTime())) throw new BadRequestException('entries_close_at must be a valid date');
      update.entries_close_at = closeAt.toISOString();
    }
    if (dto.min_followers !== undefined || dto.min_account_age_days !== undefined) {
      update.eligibility = {
        ...giveaway.eligibility,
        ...(dto.min_followers !== undefined ? { min_followers: dto.min_followers } : {}),
        ...(dto.min_account_age_days !== undefined ? { min_account_age_days: dto.min_account_age_days } : {}),
      };
    }
    if (Object.keys(update).length === 0) {
      throw new BadRequestException('No editable fields provided');
    }

    const { data, error } = await this.supabaseService.giveaways
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to update giveaway');
    await this.logEvent(id, 'admin_edited', { admin: adminUserId, fields: Object.keys(update) });
    return data as Giveaway;
  }

  /** Approve -> mints the burner and moves to PENDING_FUNDING; reject -> REJECTED with a reason.
   *  Mirrors the `organizations` self-serve pending -> active/inactive shape — a plain admin
   *  status update, no dedicated approve/reject routes. */
  async adminReview(id: string, adminUserId: string, dto: AdminReviewGiveawayDto): Promise<Giveaway> {
    const giveaway = await this.findOneOrThrow(id);
    if (giveaway.status !== GiveawayStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, not PENDING_APPROVAL`);
    }

    if (dto.decision === 'reject') {
      if (!dto.rejection_reason) throw new BadRequestException('rejection_reason is required to reject a giveaway');
      const { data, error } = await this.supabaseService.giveaways
        .update({
          status: GiveawayStatus.REJECTED,
          admin_reviewed_by: adminUserId,
          admin_reviewed_at: new Date().toISOString(),
          rejection_reason: dto.rejection_reason,
        })
        .eq('id', id)
        .select()
        .single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to reject giveaway');
      await this.logEvent(id, 'rejected', { reason: dto.rejection_reason, admin: adminUserId });
      return data as Giveaway;
    }

    const burner = this.burnerSweep.createBurner();
    if (!burner) {
      throw new BadRequestException('Giveaway burner minting is not configured (SEND_PAYMENT_ENC_KEY missing). Contact an engineer before approving giveaways.');
    }

    const { data, error } = await this.supabaseService.giveaways
      .update({
        status: GiveawayStatus.PENDING_FUNDING,
        admin_reviewed_by: adminUserId,
        admin_reviewed_at: new Date().toISOString(),
        burner_address: burner.address,
        burner_encrypted_secret: burner.encryptedSecret,
      })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to approve giveaway');
    await this.logEvent(id, 'approved', { admin: adminUserId, burner_address: burner.address });

    this.resolveLinkedEmail(data.created_by).then((recipientEmail) => {
      if (!recipientEmail) return;
      this.emailService
        .sendGiveawayApprovedEmail({
          recipientEmail,
          title: data.title,
          giveawayUrl: `${this.baseUrl}/rewards/giveaways/${id}/manage`,
        })
        .catch((e) => this.logger.warn(`[Giveaway] ${id}: failed to send approval email (non-fatal): ${e?.message ?? e}`));
    });

    return data as Giveaway;
  }
}
