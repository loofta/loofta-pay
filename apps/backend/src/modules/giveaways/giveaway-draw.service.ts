import { randomBytes } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { GiveawaysService } from './giveaways.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { Giveaway, GiveawayStatus, GiveawaySelectionMode, GiveawayEntryStatus } from './entities/giveaway.entity';
import { hashEntrySnapshot, selectRandomWinners, selectFirstComeWinners } from './giveaway-draw-selection';

@Injectable()
export class GiveawayDrawService {
  private readonly logger = new Logger(GiveawayDrawService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly giveawaysService: GiveawaysService,
    private readonly entriesService: GiveawayEntriesService,
  ) {}

  private async logEvent(giveawayId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabaseService.giveawayEvents.insert({ giveaway_id: giveawayId, type, payload: payload ?? null });
    if (error) this.logger.warn(`[GiveawayDraw] ${giveawayId} ${type}: failed to log event (non-fatal): ${error.message}`);
  }

  /** Cron entry point — advances a giveaway exactly one step per call, based on its current
   *  status. Idempotent: calling it again when there's nothing to do is a no-op. */
  async advance(giveawayId: string): Promise<void> {
    const giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    switch (giveaway.status) {
      case GiveawayStatus.OPEN:
        if (Date.now() >= new Date(giveaway.entries_close_at).getTime()) {
          await this.closeEntries(giveaway);
        }
        break;
      case GiveawayStatus.ENTRIES_CLOSED:
        await this.freezeSnapshotAndStartDrawing(giveaway);
        break;
      case GiveawayStatus.DRAWING:
        if (giveaway.selection_mode !== GiveawaySelectionMode.MANUAL) {
          await this.runAutoDraw(giveaway);
        }
        break;
      default:
        break; // nothing to advance
    }
  }

  private async closeEntries(giveaway: Giveaway): Promise<void> {
    const { error } = await this.supabaseService.giveaways.update({ status: GiveawayStatus.ENTRIES_CLOSED }).eq('id', giveaway.id);
    if (error) {
      this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to close entries: ${error.message}`);
      return;
    }
    await this.logEvent(giveaway.id, 'entries_closed');
    this.logger.log(`[GiveawayDraw] ${giveaway.id}: entries closed`);
  }

  private async getFrozenEntryIds(giveawayId: string): Promise<string[]> {
    const { data, error } = await this.supabaseService.giveawayEvents
      .select('payload')
      .eq('giveaway_id', giveawayId)
      .eq('type', 'draw_snapshot_frozen')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return [];
    return ((data.payload as { entry_ids?: string[] } | null)?.entry_ids ?? []) as string[];
  }

  private async freezeSnapshotAndStartDrawing(giveaway: Giveaway): Promise<void> {
    // One last chance for anyone who did the X task for real but never clicked "Verify" in-app —
    // see runFinalXVerificationSweep's doc comment for why this replaced the old scheduled cron.
    await this.entriesService.runFinalXVerificationSweep(giveaway);
    const eligible = await this.entriesService.getEligibleVerifiedEntries(giveaway.id);
    const entryIds = eligible.map((e) => e.id);

    if (entryIds.length === 0) {
      const { error } = await this.supabaseService.giveaways
        .update({ status: GiveawayStatus.CANCELLED, cancel_reason: 'No eligible, verified entries at close' })
        .eq('id', giveaway.id);
      if (error) this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to cancel: ${error.message}`);
      await this.logEvent(giveaway.id, 'cancelled', { reason: 'no_eligible_entries' });
      this.logger.warn(`[GiveawayDraw] ${giveaway.id}: cancelled — zero eligible verified entries at close`);
      return;
    }

    const hash = hashEntrySnapshot(entryIds);
    const { error } = await this.supabaseService.giveaways
      .update({ entry_snapshot_hash: hash, status: GiveawayStatus.DRAWING })
      .eq('id', giveaway.id);
    if (error) {
      this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to freeze snapshot: ${error.message}`);
      return;
    }
    await this.logEvent(giveaway.id, 'draw_snapshot_frozen', { entry_ids: entryIds, hash });
    if (entryIds.length < giveaway.winner_count) {
      this.logger.warn(
        `[GiveawayDraw] ${giveaway.id}: only ${entryIds.length} eligible entries for ${giveaway.winner_count} winners — all eligible entries will win`,
      );
      await this.logEvent(giveaway.id, 'winner_count_shortfall', { eligible_count: entryIds.length, winner_count: giveaway.winner_count });
    }
    this.logger.log(`[GiveawayDraw] ${giveaway.id}: snapshot frozen (${entryIds.length} eligible entries), drawing (${giveaway.selection_mode})`);
  }

  private async runAutoDraw(giveaway: Giveaway): Promise<void> {
    const entryIds = await this.getFrozenEntryIds(giveaway.id);
    if (!entryIds.length) {
      this.logger.warn(`[GiveawayDraw] ${giveaway.id}: DRAWING but no frozen snapshot found — skipping (will retry)`);
      return;
    }

    let winnerIds: string[];
    let randomnessHex: string | undefined;
    if (giveaway.selection_mode === GiveawaySelectionMode.RANDOM) {
      // TODO(vrf): replace with a MagicBlock VRF callback output — see giveaway-draw-selection.ts.
      randomnessHex = randomBytes(32).toString('hex');
      winnerIds = selectRandomWinners(entryIds, randomnessHex, giveaway.winner_count);
    } else {
      const entries = await this.entriesService.listEntries(giveaway.id);
      const byId = new Map(entries.map((e) => [e.id, e]));
      const frozenEntries = entryIds.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
      winnerIds = selectFirstComeWinners(frozenEntries, giveaway.winner_count);
    }

    await this.finalizeWinners(giveaway, entryIds, winnerIds, randomnessHex);
  }

  /** Creator's manual pick — only valid while DRAWING and selection_mode = manual. `entryIds`
   *  must be a subset of the frozen snapshot; anything outside it was never eligible. */
  async selectWinnersManually(giveawayId: string, creatorId: string, entryIds: string[]): Promise<void> {
    const giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    if (giveaway.created_by !== creatorId) throw new ForbiddenException('Not your giveaway');
    if (giveaway.status !== GiveawayStatus.DRAWING) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, not ready for winner selection`);
    }
    if (giveaway.selection_mode !== GiveawaySelectionMode.MANUAL) {
      throw new BadRequestException('This giveaway is not manual-selection mode');
    }

    const frozenIds = new Set(await this.getFrozenEntryIds(giveaway.id));
    const invalid = entryIds.filter((id) => !frozenIds.has(id));
    if (invalid.length) {
      throw new BadRequestException(`Some selected entries were not eligible at close: ${invalid.join(', ')}`);
    }
    if (entryIds.length > giveaway.winner_count) {
      throw new BadRequestException(`Cannot select more than ${giveaway.winner_count} winners`);
    }

    await this.finalizeWinners(giveaway, Array.from(frozenIds), entryIds, undefined, creatorId);
  }

  private async finalizeWinners(
    giveaway: Giveaway,
    frozenEntryIds: string[],
    winnerIds: string[],
    randomnessHex?: string,
    pickedBy?: string,
  ): Promise<void> {
    const notSelectedIds = frozenEntryIds.filter((id) => !winnerIds.includes(id));

    if (winnerIds.length) {
      const { error } = await this.supabaseService.giveawayEntries
        .update({ status: GiveawayEntryStatus.WINNER, payout_status: 'pending' })
        .in('id', winnerIds);
      if (error) this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to mark winners: ${error.message}`);
    }
    if (notSelectedIds.length) {
      const { error } = await this.supabaseService.giveawayEntries
        .update({ status: GiveawayEntryStatus.NOT_SELECTED, payout_status: 'not_applicable' })
        .in('id', notSelectedIds);
      if (error) this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to mark non-winners: ${error.message}`);
    }

    const updatePayload: Record<string, unknown> = { status: GiveawayStatus.WINNERS_SELECTED };
    if (randomnessHex) {
      updatePayload.vrf_randomness = randomnessHex;
      updatePayload.vrf_requested_at = new Date().toISOString();
      updatePayload.vrf_fulfilled_at = new Date().toISOString();
    }
    const { error } = await this.supabaseService.giveaways.update(updatePayload).eq('id', giveaway.id);
    if (error) this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to update status to WINNERS_SELECTED: ${error.message}`);

    await this.logEvent(giveaway.id, 'winners_selected', {
      winner_entry_ids: winnerIds,
      selection_mode: giveaway.selection_mode,
      randomness: randomnessHex,
      picked_by: pickedBy,
    });
    this.logger.log(`[GiveawayDraw] ${giveaway.id}: ${winnerIds.length} winner(s) selected (${giveaway.selection_mode})`);
  }
}
