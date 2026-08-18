import { Controller, Get, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AdminGuard } from '@/common/guards';
import { GiveawaysService } from './giveaways.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { GiveawayDrawService } from './giveaway-draw.service';
import { AdminReviewGiveawayDto } from './dto/admin-review-giveaway.dto';
import { AdminEditGiveawayDto } from './dto/admin-edit-giveaway.dto';
import { ExpireGiveawayDto } from './dto/expire-giveaway.dto';
import { CancelGiveawayDto } from './dto/cancel-giveaway.dto';
import { ReviewTaskCompletionDto } from './dto/review-task-completion.dto';
import { VrfManualFallbackDto } from './dto/vrf-manual-fallback.dto';
import { Giveaway } from './entities/giveaway.entity';

@ApiTags('giveaways-admin')
@Controller('giveaways/admin')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class GiveawaysAdminController {
  constructor(
    private readonly giveawaysService: GiveawaysService,
    private readonly entriesService: GiveawayEntriesService,
    private readonly drawService: GiveawayDrawService,
  ) {}

  @Get('pending')
  @ApiOperation({ summary: 'List giveaways awaiting admin approval' })
  async findPending(): Promise<{ giveaways: (Giveaway & { created_by_email: string | null })[] }> {
    const giveaways = await this.giveawaysService.findPendingApproval();
    return { giveaways };
  }

  @Get('cancelled')
  @ApiOperation({ summary: 'List cancelled giveaways — hidden from the creator\'s own list once cancelled, still visible here for audit/support' })
  async findCancelled(): Promise<{ giveaways: (Giveaway & { created_by_email: string | null })[] }> {
    const giveaways = await this.giveawaysService.findCancelled();
    return { giveaways };
  }

  @Get('all')
  @ApiOperation({ summary: 'Look up any giveaway regardless of status (optional ?search= by title) — the only way to find one to edit once it\'s past PENDING_APPROVAL' })
  async findAll(@Query('search') search?: string): Promise<{ giveaways: (Giveaway & { created_by_email: string | null })[] }> {
    const giveaways = await this.giveawaysService.findAllForAdmin(search);
    return { giveaways };
  }

  @Put(':id/edit')
  @ApiOperation({ summary: 'Support-mediated edit (title/description/close date/eligibility only — never prize/winner-count/selection, those need a funding recompute). Blocked once terminal (completed/cancelled/rejected/refunded/expired).' })
  async edit(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: AdminEditGiveawayDto,
  ): Promise<{ giveaway: Giveaway }> {
    const giveaway = await this.giveawaysService.adminEdit(id, req.user!.id, dto);
    return { giveaway };
  }

  @Put(':id/review')
  @ApiOperation({ summary: 'Approve or reject a pending giveaway. No self-service edits after this — a budget/scope change goes through support, not a client-facing endpoint.' })
  async review(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: AdminReviewGiveawayDto,
  ): Promise<{ giveaway: Giveaway }> {
    const giveaway = await this.giveawaysService.adminReview(id, req.user!.id, dto);
    return { giveaway };
  }

  @Put(':id/expire')
  @ApiOperation({ summary: 'Admin manual expiry for a giveaway that was approved (PENDING_FUNDING) but the creator never funded — moves it to UNDERFUNDED_EXPIRED and emails the creator. Refused if the burner already has funds.' })
  async expire(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: ExpireGiveawayDto,
  ): Promise<{ giveaway: Giveaway }> {
    const giveaway = await this.giveawaysService.adminExpireUnfunded(id, req.user!.id, dto.reason);
    return { giveaway };
  }

  @Put(':id/cancel')
  @ApiOperation({
    summary:
      'Cancel a giveaway that\'s already past approval (PENDING_FUNDING/FUNDED/OPEN/ENTRIES_CLOSED) — refunds any burner balance to the creator, moves it to CANCELLED, and emails the creator. Not for a still-pending giveaway (use reject) or one already mid-draw/finished (contact support).',
  })
  async cancel(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: CancelGiveawayDto,
  ): Promise<{ giveaway: Giveaway }> {
    const giveaway = await this.giveawaysService.adminCancel(id, req.user!.id, dto.reason);
    return { giveaway };
  }

  @Get('review-queue')
  @ApiOperation({ summary: 'Cross-giveaway escalation queue — X-API verification failures (api_error) any admin can unblock' })
  async reviewQueue() {
    const items = await this.entriesService.listApiErrorEscalations();
    return { items };
  }

  @Put(':id/vrf-manual-fallback')
  @ApiOperation({
    summary:
      'Audited last resort when an on-chain VRF request has genuinely stalled — bypasses it with server-generated randomness, explicitly tagged as non-VRF in giveaway_events. Prefer clearing vrf_requested_at (a plain retry) unless the oracle is confirmed down.',
  })
  async vrfManualFallback(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: VrfManualFallbackDto,
  ): Promise<{ ok: true }> {
    await this.drawService.manualVrfFallback(id, req.user!.id, dto.reason);
    return { ok: true };
  }

  @Put('completions/:completionId/review')
  @ApiOperation({ summary: 'Admin override — approve or reject any task completion, any giveaway' })
  async reviewCompletion(
    @Req() req: { user?: { id: string } },
    @Param('completionId') completionId: string,
    @Body() dto: ReviewTaskCompletionDto,
  ) {
    const completion = await this.entriesService.reviewCompletionAdmin(completionId, req.user!.id, dto.decision);
    return { completion };
  }
}
