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
      .select('id, title, description, logo_url, winner_count, selection_mode, prize_amount_usd, entries_close_at, status')
      .eq('status', 'OPEN')
      .order('entries_close_at', { ascending: true });
    if (error) throw new NotFoundException(error.message);
    return { giveaways: data ?? [] };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public giveaway page data — rules, live funding status, draw proof once available. No auth required.' })
  async findOne(@Param('id') id: string) {
    const { data: giveaway, error } = await this.supabaseService.giveawaysSafe.select('*').eq('id', id).maybeSingle();
    if (error) throw new NotFoundException(error.message);
    if (!giveaway) throw new NotFoundException('Giveaway not found');

    const tasks = await this.giveawaysService.getTasks(id);

    const { count: entryCount } = await this.supabaseService.giveawayEntries
      .select('id', { count: 'exact', head: true })
      .eq('giveaway_id', id);

    return {
      id: giveaway.id,
      title: giveaway.title,
      description: giveaway.description,
      logo_url: giveaway.logo_url,
      winner_count: giveaway.winner_count,
      selection_mode: giveaway.selection_mode,
      prize_amount_usd: giveaway.prize_amount_usd,
      entries_close_at: giveaway.entries_close_at,
      eligibility: giveaway.eligibility,
      status: giveaway.status,
      burner_address: giveaway.burner_address,
      mint: giveaway.mint,
      is_devnet: giveaway.is_devnet,
      funding_required_usd: giveaway.funding_required_usd,
      funding_confirmed_usd: giveaway.funding_confirmed_usd,
      entry_count: entryCount ?? 0,
      // Draw proof — present once the draw has run, null before that.
      entry_snapshot_hash: giveaway.entry_snapshot_hash,
      vrf_randomness: giveaway.vrf_randomness,
      vrf_fulfilled_at: giveaway.vrf_fulfilled_at,
      tasks: tasks.map((t) => ({ id: t.id, task_type: t.task_type, config: t.config, order_index: t.order_index })),
    };
  }
}
