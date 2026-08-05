import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SupabaseService } from '@/database/supabase.service';
import { GiveawaysService } from './giveaways.service';

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
      // Draw proof — present once the draw has run, null before that.
      entry_snapshot_hash: giveaway.entry_snapshot_hash,
      vrf_randomness: giveaway.vrf_randomness,
      vrf_fulfilled_at: giveaway.vrf_fulfilled_at,
      tasks: tasks.map((t) => ({ id: t.id, task_type: t.task_type, config: t.config, order_index: t.order_index, verification_mode: t.verification_mode })),
    };
  }
}
