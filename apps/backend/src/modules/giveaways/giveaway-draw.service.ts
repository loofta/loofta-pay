import { randomBytes } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { GiveawaysService } from './giveaways.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { GiveawayVrfService } from './giveaway-vrf.service';
import { Giveaway, GiveawayStatus, GiveawaySelectionMode, GiveawayEntryStatus } from './entities/giveaway.entity';
import { hashEntrySnapshot, selectRandomWinners, selectFirstComeWinners } from './giveaway-draw-selection';

const DEFAULT_VRF_STALL_MINUTES = 15;

// runFinalXVerificationSweep hits the real X API. It's meant to run exactly once, right as entries
// close — but advanceDraws ticks every minute, and a giveaway sits in ENTRIES_CLOSED for as long as
// anything is pending (e.g. one entrant who never clicked "Verify", or a self-report task the
// creator hasn't reviewed yet), so without a run-once guard the sweep re-fired on every single tick,
// forever — this is what actually burned ~4.4k X API calls for one stuck giveaway on 2026-08-11
// (confirmed via giveaway_events; the 3-min per-target fetch cache in XVerificationService only
// dampened it, it didn't stop it). After the one sweep, anything still pending just sits in the
// review queue / waits on the entrant — the draw stays deferred (see countPendingCompletions below)
// without spending another API call on every subsequent tick.

@Injectable()
export class GiveawayDrawService {
  private readonly logger = new Logger(GiveawayDrawService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly giveawaysService: GiveawaysService,
    private readonly entriesService: GiveawayEntriesService,
    private readonly vrf: GiveawayVrfService,
    private readonly config: ConfigService,
  ) {}

  private get vrfStallMs(): number {
    const minutes = Number(this.config.get<string>('GIVEAWAY_VRF_STALL_MINUTES')) || DEFAULT_VRF_STALL_MINUTES;
    return minutes * 60_000;
  }

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

  /** Creator-triggered early close: force entries shut and run the draw immediately instead of
   *  waiting for entries_close_at + the cron. Unlike advance() (one step per call, meant for a
   *  cron tick), this drives every step synchronously within the request — including polling the
   *  VRF oracle to fulfillment (bounded to ~15s; observed real fulfillment latency is ~2-4s) — so
   *  a creator clicking "Run draw now" sees the real final state, not an intermediate one, whether
   *  or not any cron is running against this instance. Manual-selection giveaways stop at DRAWING
   *  same as always; the creator still picks winners separately via select-winners. */
  async forceRunDrawNow(giveawayId: string, creatorId: string): Promise<Giveaway> {
    let giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    if (giveaway.created_by !== creatorId) throw new ForbiddenException('Not your giveaway');
    if (giveaway.status !== GiveawayStatus.OPEN) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, can only force-run the draw from OPEN`);
    }

    await this.closeEntries(giveaway);
    giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    await this.freezeSnapshotAndStartDrawing(giveaway, { throwIfPending: true });
    giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);

    if (giveaway.status === GiveawayStatus.DRAWING && giveaway.selection_mode !== GiveawaySelectionMode.MANUAL) {
      for (let i = 0; i < 15; i++) {
        await this.runAutoDraw(giveaway);
        giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
        if (giveaway.status !== GiveawayStatus.DRAWING) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    return giveaway;
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

  /** Whether the final X-verification sweep has already run for this giveaway — it's meant to fire
   *  exactly once (see comment above), not on every cron tick while the giveaway sits stuck in
   *  ENTRIES_CLOSED. */
  private async hasSweptAlready(giveawayId: string): Promise<boolean> {
    const { data } = await this.supabaseService.giveawayEvents
      .select('id')
      .eq('giveaway_id', giveawayId)
      .eq('type', 'final_sweep_ran')
      .limit(1)
      .maybeSingle();
    return !!data;
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

  private async freezeSnapshotAndStartDrawing(giveaway: Giveaway, opts: { throwIfPending?: boolean } = {}): Promise<void> {
    // Never freeze the pool while real work is still outstanding — a self-report task the
    // creator hasn't reviewed yet (or an X-verification that's still pending for some other
    // reason) must not silently exclude that entrant. The cron path just defers and retries next
    // tick; forceRunDrawNow surfaces this to the creator instead, since it's an explicit action
    // expecting an immediate result.
    let pendingCount = await this.entriesService.countPendingCompletions(giveaway.id);

    // Only pay for a real X API sweep if there's something to sweep AND it hasn't already run for
    // this giveaway. Previously forceRunDrawNow (opts.throwIfPending) was exempted from this guard
    // on the assumption a creator forcing a draw is "rare, human-paced, not a cost driver" — false
    // in practice during active testing/iteration, where the same giveaway gets force-closed
    // repeatedly and each call re-paid for a full live X sweep (confirmed cost driver, 2026-08-16).
    // The guard now applies unconditionally; a giveaway that still has pending completions after its
    // one sweep just surfaces to the creator via the throwIfPending error path below, same as ever.
    if (pendingCount > 0 && !(await this.hasSweptAlready(giveaway.id))) {
      await this.entriesService.runFinalXVerificationSweep(giveaway);
      await this.logEvent(giveaway.id, 'final_sweep_ran');
      pendingCount = await this.entriesService.countPendingCompletions(giveaway.id);
    }

    if (pendingCount > 0) {
      if (opts.throwIfPending) {
        throw new BadRequestException(
          `${pendingCount} task submission${pendingCount === 1 ? '' : 's'} still need${pendingCount === 1 ? 's' : ''} review before the draw can run — check the review queue.`,
        );
      }
      this.logger.log(`[GiveawayDraw] ${giveaway.id}: ${pendingCount} completion(s) still pending — deferring draw until reviewed`);
      return;
    }

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

    if (giveaway.selection_mode === GiveawaySelectionMode.RANDOM) {
      const randomnessHex = await this.advanceVrf(giveaway);
      if (!randomnessHex) return; // still waiting on-chain — next cron tick continues it
      const winnerIds = selectRandomWinners(entryIds, randomnessHex, giveaway.winner_count);
      await this.finalizeWinners(giveaway, entryIds, winnerIds, randomnessHex);
      return;
    }

    const entries = await this.entriesService.listEntries(giveaway.id);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const frozenEntries = entryIds.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
    const winnerIds = selectFirstComeWinners(frozenEntries, giveaway.winner_count);
    await this.finalizeWinners(giveaway, entryIds, winnerIds);
  }

  /** Ticks the on-chain VRF request forward exactly one step, using `vrf_requested_at`/
   *  `vrf_randomness` nullability as an implicit sub-state within DRAWING — no new
   *  GiveawayStatus value needed. Returns the real randomness hex once fulfilled, or null while
   *  still in flight (the next cron tick will pick up where this one left off). Never falls back
   *  to non-VRF randomness silently — a stalled request is logged and left for manual recovery,
   *  since the public "Draw proof" panel can't otherwise distinguish real VRF from a fallback. */
  private async advanceVrf(giveaway: Giveaway): Promise<string | null> {
    if (giveaway.vrf_randomness) return giveaway.vrf_randomness;

    if (!giveaway.vrf_requested_at) {
      try {
        const { slot } = await this.vrf.requestRandomness(giveaway);
        const { error } = await this.supabaseService.giveaways
          .update({ vrf_requested_at: new Date().toISOString(), vrf_request_slot: slot })
          .eq('id', giveaway.id);
        if (error) this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to persist vrf_requested_at: ${error.message}`);
        await this.logEvent(giveaway.id, 'vrf_requested', { slot });
        this.logger.log(`[GiveawayDraw] ${giveaway.id}: VRF randomness requested (slot=${slot})`);
      } catch (e: any) {
        this.logger.error(`[GiveawayDraw] ${giveaway.id}: VRF request failed: ${e?.message ?? e} (will retry next tick)`);
      }
      return null;
    }

    const randomnessHex = await this.vrf.pollFulfillment(giveaway);
    if (!randomnessHex) {
      const requestedAgeMs = Date.now() - new Date(giveaway.vrf_requested_at).getTime();
      if (requestedAgeMs >= this.vrfStallMs) {
        await this.flagVrfStallOnce(giveaway.id);
      }
      return null;
    }

    const { error } = await this.supabaseService.giveaways
      .update({ vrf_randomness: randomnessHex, vrf_fulfilled_at: new Date().toISOString() })
      .eq('id', giveaway.id);
    if (error) this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to persist vrf_randomness: ${error.message}`);
    await this.logEvent(giveaway.id, 'vrf_fulfilled', {});
    this.logger.log(`[GiveawayDraw] ${giveaway.id}: VRF randomness fulfilled`);
    return randomnessHex;
  }

  /** Alert-only — never auto-falls-back to non-VRF randomness. Logged once per giveaway (checked
   *  via giveaway_events) so a slow oracle doesn't spam logs every cron tick. Manual recovery: an
   *  operator clears vrf_requested_at (safe retry) or, only as an audited last resort, uses a
   *  separate manual-override path that explicitly tags the randomness as non-VRF. */
  private async flagVrfStallOnce(giveawayId: string): Promise<void> {
    const { data: existing } = await this.supabaseService.giveawayEvents
      .select('id')
      .eq('giveaway_id', giveawayId)
      .eq('type', 'vrf_stalled')
      .limit(1)
      .maybeSingle();
    if (existing) return;
    this.logger.error(`[GiveawayDraw] ${giveawayId}: VRF request has been pending longer than the stall threshold — needs manual attention`);
    await this.logEvent(giveawayId, 'vrf_stalled', {});
  }

  /** Audited last-resort escape hatch when a VRF request has genuinely stalled (oracle down,
   *  program bug) and a giveaway can't be left hanging forever. Deliberately NOT the same code
   *  path as a real VRF fulfillment — the `vrf_manual_fallback` event with `reason`/`admin_id`
   *  is the only place this is distinguished from a genuine oracle callback, since the public
   *  "Draw proof" panel renders `vrf_randomness` the same way either way. Prefer clearing
   *  `vrf_requested_at` (a plain retry) over this whenever the oracle might still come through. */
  async manualVrfFallback(giveawayId: string, adminId: string, reason: string): Promise<void> {
    const giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    if (giveaway.status !== GiveawayStatus.DRAWING || giveaway.selection_mode !== GiveawaySelectionMode.RANDOM) {
      throw new BadRequestException('Only applicable to a random-selection giveaway currently DRAWING');
    }
    if (giveaway.vrf_randomness) {
      throw new BadRequestException('This giveaway already has randomness — nothing to fall back on');
    }

    const randomnessHex = randomBytes(32).toString('hex');
    const { error } = await this.supabaseService.giveaways
      .update({ vrf_randomness: randomnessHex, vrf_fulfilled_at: new Date().toISOString() })
      .eq('id', giveaway.id);
    if (error) this.logger.warn(`[GiveawayDraw] ${giveaway.id}: failed to persist manual fallback randomness: ${error.message}`);
    await this.logEvent(giveaway.id, 'vrf_manual_fallback', { source: 'manual_fallback_non_vrf', admin_id: adminId, reason });
    this.logger.warn(`[GiveawayDraw] ${giveaway.id}: VRF manually bypassed by admin ${adminId} — reason: ${reason}`);
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

    // vrf_randomness/vrf_requested_at/vrf_fulfilled_at are already persisted by advanceVrf() at
    // the real moments they happened — this only flips the status, never re-stamps those fields.
    const { error } = await this.supabaseService.giveaways
      .update({ status: GiveawayStatus.WINNERS_SELECTED })
      .eq('id', giveaway.id);
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
