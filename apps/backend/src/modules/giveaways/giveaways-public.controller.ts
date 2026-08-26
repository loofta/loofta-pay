import { Controller, Get, Logger, NotFoundException, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupabaseService } from '@/database/supabase.service';
import { GiveawaysService } from './giveaways.service';
import { GiveawayVrfService } from './giveaway-vrf.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { Giveaway, GiveawayStatus } from './entities/giveaway.entity';

// Entries (and who won) go public once the pool is frozen — before that, revealing who's in the
// running would leak the live entrant list while people can still act on it. This is also
// precisely the set of statuses that have a real entry_snapshot_hash to check the returned list
// against, so "visible" and "checkable" turn on at the same moment.
const ENTRIES_VISIBLE_STATUSES: readonly string[] = [
  GiveawayStatus.ENTRIES_CLOSED,
  GiveawayStatus.DRAWING,
  GiveawayStatus.WINNERS_SELECTED,
  GiveawayStatus.PAYOUT_IN_PROGRESS,
  GiveawayStatus.COMPLETED,
];

// Giveaways that have gone past OPEN but never made it public in the first place
// (DRAFT/PENDING_APPROVAL/PENDING_FUNDING/REJECTED) are excluded — there was never anything for a
// visitor to have seen or entered, so there's nothing to show as "ended." CANCELLED is excluded
// too — a cancelled giveaway (whether pulled by the creator before funding, or by an admin after
// it went live) should disappear from every user-facing list, not linger as a "Cancelled" card;
// its direct /rewards/giveaways/[id] page still works for anyone who already had the link.
// Everything else that was once live still gets listed, e.g. UNDERFUNDED_EXPIRED/REFUNDED —
// someone who saw it open should still be able to find out what happened to it.
const ENDED_STATUSES: readonly string[] = [
  GiveawayStatus.ENTRIES_CLOSED,
  GiveawayStatus.DRAWING,
  GiveawayStatus.WINNERS_SELECTED,
  GiveawayStatus.PAYOUT_IN_PROGRESS,
  GiveawayStatus.COMPLETED,
  GiveawayStatus.UNDERFUNDED_EXPIRED,
  GiveawayStatus.REFUNDED,
];

/**
 * No-auth verifiability surface — mirrors twitter-payments.controller.ts's narrow public
 * pattern. Deliberately reads from `giveaways_safe` (never `giveaways` directly), which already
 * drops `burner_encrypted_secret` at the view level, so there's no risk of a future column
 * addition leaking here by accident.
 */
@ApiTags('giveaways-public')
@Controller('giveaways/public')
export class GiveawaysPublicController {
  private readonly logger = new Logger(GiveawaysPublicController.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly giveawaysService: GiveawaysService,
    private readonly vrf: GiveawayVrfService,
    private readonly entriesService: GiveawayEntriesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Browse open giveaways. No auth required.' })
  async findOpen() {
    const { data, error } = await this.supabaseService.giveawaysSafe
      .select(
        'id, title, description, logo_url, project_name, short_id, winner_count, selection_mode, prize_amount_usd, reward_type, entries_close_at, status, is_official, admin_reviewed_at',
      )
      // Official Loofta giveaways pin to the top, then soonest-closing first within each group.
      .eq('status', 'OPEN')
      .order('is_official', { ascending: false })
      .order('entries_close_at', { ascending: true });
    if (error) throw new NotFoundException(error.message);
    const giveaways = await Promise.all((data ?? []).map((g) => this.attachEntryStats(g)));
    return { giveaways };
  }

  /** Entry count, last-hour delta, and a handful of the most recent entrants' avatars — real
   *  aggregate numbers, not the entry list itself (no handles/identities), so this doesn't run
   *  into the "entries stay hidden while a giveaway is still open" rule above; per-giveaway
   *  entrant volume is small enough that a few queries per row (not batched into one) is fine. */
  private async attachEntryStats<T extends { id: string }>(
    g: T,
  ): Promise<T & { entries_count: number; entries_last_hour: number; entry_avatars: string[] }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [{ count: entriesCount }, { count: lastHourCount }, { data: avatarRows }] = await Promise.all([
      this.supabaseService.giveawayEntries.select('id', { count: 'exact', head: true }).eq('giveaway_id', g.id),
      this.supabaseService.giveawayEntries
        .select('id', { count: 'exact', head: true })
        .eq('giveaway_id', g.id)
        .gte('entered_at', oneHourAgo),
      this.supabaseService.giveawayEntries
        .select('avatar_url')
        .eq('giveaway_id', g.id)
        .not('avatar_url', 'is', null)
        .order('entered_at', { ascending: false })
        .limit(4),
    ]);
    return {
      ...g,
      entries_count: entriesCount ?? 0,
      entries_last_hour: lastHourCount ?? 0,
      entry_avatars: (avatarRows ?? []).map((r: { avatar_url: string }) => r.avatar_url),
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Aggregate stats for the giveaways list page header (winners this month, avg approval time). No auth required.' })
  async stats() {
    const startOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

    const { data: winnerEvents } = await this.supabaseService.giveawayEvents
      .select('payload')
      .eq('type', 'winners_selected')
      .gte('created_at', startOfMonth);
    const winnersThisMonth = (winnerEvents ?? []).reduce((sum, e: { payload: { winner_entry_ids?: unknown[] } | null }) => {
      const ids = e.payload?.winner_entry_ids;
      return sum + (Array.isArray(ids) ? ids.length : 0);
    }, 0);

    // Excludes is_official rows — those get admin_reviewed_at auto-stamped at creation (see
    // giveaways.service.ts's create()), which would report a fake ~0h approval time and skew the
    // average down. Excludes rejected ones too — this stat is specifically "how long until your
    // giveaway went live," not "how long until we responded."
    const { data: reviewed } = await this.supabaseService.giveawaysSafe
      .select('created_at, admin_reviewed_at')
      .not('admin_reviewed_at', 'is', null)
      .is('rejection_reason', null)
      .eq('is_official', false)
      .order('admin_reviewed_at', { ascending: false })
      .limit(200);
    const approvalHours = (reviewed ?? [])
      .map((g: { created_at: string; admin_reviewed_at: string }) => (new Date(g.admin_reviewed_at).getTime() - new Date(g.created_at).getTime()) / 3_600_000)
      .filter((h) => Number.isFinite(h) && h >= 0);
    const avgApprovalHours = approvalHours.length ? approvalHours.reduce((a, b) => a + b, 0) / approvalHours.length : null;

    return { winners_this_month: winnersThisMonth, avg_approval_hours: avgApprovalHours };
  }

  @Get('ended')
  @ApiOperation({ summary: 'Browse past (no longer open) giveaways that actually received funding — most recently closed first. No auth required.' })
  async findEnded() {
    const { data, error } = await this.supabaseService.giveawaysSafe
      .select('id, title, description, logo_url, project_name, short_id, winner_count, selection_mode, prize_amount_usd, reward_type, entries_close_at, status, is_official')
      .in('status', ENDED_STATUSES as string[])
      // UNDERFUNDED_EXPIRED always has zero confirmed funding by definition, and CANCELLED can
      // mean either "creator cancelled before ever funding it" or "funded, closed, but nobody
      // qualified" — this single check separates real giveaways from ones that never actually ran,
      // regardless of which status they landed in.
      .gt('funding_confirmed_usd', 0)
      .order('entries_close_at', { ascending: false });
    if (error) throw new NotFoundException(error.message);
    const giveaways = await Promise.all((data ?? []).map((g) => this.attachEntryStats(g)));
    return { giveaways };
  }

  /** Accepts either the giveaway's UUID or its 8-char short_id — same dual-lookup convention as
   *  claims.service.ts's fetchRawRow (tries id first, falls back to short_id; a short_id never
   *  collides with UUID format so there's no ambiguity). Lets a shared /rewards/giveaways/{short}
   *  link work exactly like the full-uuid one. */
  private async fetchGiveawayByIdOrShortId(id: string) {
    const { data: byId } = await this.supabaseService.giveawaysSafe.select('*').eq('id', id).maybeSingle();
    if (byId) return byId;
    const { data: byShortId } = await this.supabaseService.giveawaysSafe.select('*').eq('short_id', id).maybeSingle();
    return byShortId;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public giveaway page data — rules, live funding status, draw proof once available. Accepts the UUID or short_id. No auth required.' })
  async findOne(@Param('id') id: string) {
    const giveaway = await this.fetchGiveawayByIdOrShortId(id);
    if (!giveaway) throw new NotFoundException('Giveaway not found');

    // Always the real UUID from here on — `id` (the route param) may have been the short_id, and
    // giveaway_tasks/giveaway_entries are keyed on the real giveaway id, not the short code.
    const realId = giveaway.id as string;
    const tasks = await this.giveawaysService.getTasks(realId);

    const { count: entryCount } = await this.supabaseService.giveawayEntries
      .select('id', { count: 'exact', head: true })
      .eq('giveaway_id', realId);

    // Never claim on-chain proof without actually confirming it on-chain — the stored
    // vrf_fulfilled_at/vrf_randomness alone don't prove a real oracle request ever happened
    // (e.g. a giveaway that got raced and finished by legacy non-VRF code would still have these
    // columns populated). Fetch the real DrawRequest account and require its randomness to match
    // what's stored before exposing an Explorer link a visitor could click and find nothing at.
    // This whole check is a best-effort on-chain verification for the "Draw proof" panel — it must
    // never take down the entire public giveaway page (winners, claim status, everything else) if
    // it fails, whether that's a misconfigured VRF program id, a flaky RPC call, or anything else.
    // A failure here degrades to "can't verify this draw" (drawRequestPda stays null), exactly what
    // the frontend already treats absence as — it must not surface as a 500 (2026-08-25 incident:
    // LOOFTA_VRF_PROGRAM_ID_MAINNET was misconfigured and took down every visitor's page load for a
    // completed giveaway).
    let drawRequestPda: string | null = null;
    if (giveaway.vrf_fulfilled_at && giveaway.vrf_randomness) {
      try {
        const onChainRandomness = await this.vrf.pollFulfillment({ id: realId, is_devnet: giveaway.is_devnet } as Giveaway);
        if (onChainRandomness && onChainRandomness === giveaway.vrf_randomness) {
          drawRequestPda = this.vrf.derivePda(realId, giveaway.is_devnet ? 'devnet' : 'mainnet')[0].toBase58();
        }
      } catch (e: any) {
        this.logger.warn(`[GiveawaysPublic] ${realId}: VRF draw-proof check failed (non-fatal, page still loads): ${e?.message ?? e}`);
      }
    }

    return {
      id: giveaway.id,
      title: giveaway.title,
      description: giveaway.description,
      logo_url: giveaway.logo_url,
      project_name: giveaway.project_name,
      short_id: giveaway.short_id,
      winner_count: giveaway.winner_count,
      selection_mode: giveaway.selection_mode,
      prize_amount_usd: giveaway.prize_amount_usd,
      reward_type: giveaway.reward_type,
      entries_close_at: giveaway.entries_close_at,
      eligibility: giveaway.eligibility,
      status: giveaway.status,
      is_official: giveaway.is_official,
      burner_address: giveaway.burner_address,
      mint: giveaway.mint,
      is_devnet: giveaway.is_devnet,
      funding_required_usd: giveaway.funding_required_usd,
      funding_confirmed_usd: giveaway.funding_confirmed_usd,
      platform_fee_usd: giveaway.platform_fee_usd,
      entry_count: entryCount ?? 0,
      // Draw proof — present once the draw has run, null before that. draw_request_pda is only
      // set once independently confirmed on-chain (see above) — the frontend treats its absence
      // as "can't verify this draw," not just "link unavailable."
      entry_snapshot_hash: giveaway.entry_snapshot_hash,
      vrf_randomness: giveaway.vrf_randomness,
      vrf_fulfilled_at: giveaway.vrf_fulfilled_at,
      vrf_request_slot: drawRequestPda ? giveaway.vrf_request_slot : null,
      draw_request_pda: drawRequestPda,
      tasks: tasks.map((t) => ({ id: t.id, task_type: t.task_type, config: t.config, order_index: t.order_index, verification_mode: t.verification_mode })),
    };
  }

  /** Full entry list (X handle + status per entry) — the other half of the "provably fair" claim
   *  alongside vrf_randomness/entry_snapshot_hash on the giveaway itself: with this list, anyone
   *  can hash the returned `id`s the same way hashEntrySnapshot() does and confirm it matches the
   *  published entry_snapshot_hash (nothing was added/removed after the snapshot froze), and feed
   *  the same ids + vrf_randomness into selectRandomWinners() to independently reproduce the exact
   *  winners. Only x_handle is returned — no wallet address is ever part of this data (payouts go
   *  through a private /c/[id] claim link, never published here) — X handles are already public
   *  information tied to whatever public X action the task required in the first place. Gated to
   *  ENTRIES_VISIBLE_STATUSES so the live entrant pool isn't exposed while entries are still open. */
  @Get(':id/entries')
  @ApiOperation({ summary: 'Public entry list (X handle + status) once entries have closed — lets anyone independently verify the snapshot hash and recompute the winners. No auth required.' })
  async findEntries(@Param('id') id: string) {
    const giveaway = await this.fetchGiveawayByIdOrShortId(id);
    if (!giveaway) throw new NotFoundException('Giveaway not found');
    if (!ENTRIES_VISIBLE_STATUSES.includes(giveaway.status as string)) {
      return { visible: false, entries: [] };
    }

    const { data, error } = await this.supabaseService.giveawayEntries
      .select('id, x_handle, status, entry_index')
      .eq('giveaway_id', giveaway.id as string)
      .order('entry_index', { ascending: true });
    if (error) throw new NotFoundException(error.message);

    const rankMap = await this.entriesService.getWinnerRankMap(giveaway.id as string);
    return {
      visible: true,
      entries: (data ?? []).map((e) => ({ id: e.id, x_handle: e.x_handle, status: e.status, rank: rankMap.get(e.id) ?? null })),
    };
  }
}
