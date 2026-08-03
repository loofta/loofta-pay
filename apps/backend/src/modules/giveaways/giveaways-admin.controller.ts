import { Controller, Get, Put, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AdminGuard } from '@/common/guards';
import { GiveawaysService } from './giveaways.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { AdminReviewGiveawayDto } from './dto/admin-review-giveaway.dto';
import { ReviewTaskCompletionDto } from './dto/review-task-completion.dto';
import { Giveaway } from './entities/giveaway.entity';

@ApiTags('giveaways-admin')
@Controller('giveaways/admin')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class GiveawaysAdminController {
  constructor(
    private readonly giveawaysService: GiveawaysService,
    private readonly entriesService: GiveawayEntriesService,
  ) {}

  @Get('pending')
  @ApiOperation({ summary: 'List giveaways awaiting admin approval' })
  async findPending(): Promise<{ giveaways: (Giveaway & { created_by_email: string | null })[] }> {
    const giveaways = await this.giveawaysService.findPendingApproval();
    return { giveaways };
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

  @Get('review-queue')
  @ApiOperation({ summary: 'Cross-giveaway escalation queue — X-API verification failures (api_error) any admin can unblock' })
  async reviewQueue() {
    const items = await this.entriesService.listApiErrorEscalations();
    return { items };
  }

  @Put('completions/:completionId/review')
  @ApiOperation({ summary: 'Admin override — approve or reject any task completion, any giveaway' })
  async reviewCompletion(
    @Req() req: { user?: { id: string } },
    @Param('completionId') completionId: string,
    @Body() dto: ReviewTaskCompletionDto,
  ) {
    const completion = await this.entriesService.reviewCompletion(completionId, req.user!.id, dto.decision);
    return { completion };
  }
}
