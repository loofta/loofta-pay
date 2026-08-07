import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupabaseService } from '@/database/supabase.service';
import { GiveawaysService } from './giveaways.service';
import { GiveawayVrfService } from './giveaway-vrf.service';
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
// visitor to have seen or entered, so there's nothing to show as "ended." Everything else that was
// once live gets listed, even CANCELLED/REFUNDED/UNDERFUNDED_EXPIRED — someone who saw it open
// should still be able to find out what happened to it.
const ENDED_STATUSES: readonly string[] = [
  GiveawayStatus.ENTRIES_CLOSED,
  GiveawayStatus.DRAWING,
  GiveawayStatus.WINNERS_SELECTED,
  GiveawayStatus.PAYOUT_IN_PROGRESS,
  GiveawayStatus.COMPLETED,
  GiveawayStatus.CANCELLED,
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
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly giveawaysService: GiveawaysService,
    private readonly vrf: GiveawayVrfService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Browse open giveaways. No auth required.' })
  async findOpen() {
    const { data, error } = await this.supabaseService.giveawaysSafe
      .select('id, title, description, logo_url, project_name, short_id, winner_count, selection_mode, prize_amount_usd, entries_close_at, status, is_official')
      // Official Loofta giveaways pin to the top, then soonest-closing first within each group.
      .eq('status', 'OPEN')
      .order('is_official', { ascending: false })
      .order('entries_close_at', { ascending: true });
    if (error) throw new NotFoundException(error.message);
    return { giveaways: data ?? [] };
  }

  @Get('ended')
  @ApiOperation({ summary: 'Browse past (no longer open) giveaways — most recently closed first. No auth required.' })
  async findEnded() {
    const { data, error } = await this.supabaseService.giveawaysSafe
      .select('id, title, description, logo_url, project_name, short_id, winner_count, selection_mode, prize_amount_usd, entries_close_at, status, is_official')
      .in('status', ENDED_STATUSES as string[])
      .order('entries_close_at', { ascending: false });
    if (error) throw new NotFoundException(error.message);
    return { giveaways: data ?? [] };
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
    let drawRequestPda: string | null = null;
    if (giveaway.vrf_fulfilled_at && giveaway.vrf_randomness) {
      const onChainRandomness = await this.vrf.pollFulfillment({ id: realId, is_devnet: giveaway.is_devnet } as Giveaway);
      if (onChainRandomness && onChainRandomness === giveaway.vrf_randomness) {
        drawRequestPda = this.vrf.derivePda(realId)[0].toBase58();
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

    return {
      visible: true,
      entries: (data ?? []).map((e) => ({ id: e.id, x_handle: e.x_handle, status: e.status })),
    };
  }
}
