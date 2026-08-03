import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { GiveawaysService } from './giveaways.service';
import { GiveawayFundingService } from './giveaway-funding.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { GiveawayDrawService } from './giveaway-draw.service';
import { GiveawayPayoutService } from './giveaway-payout.service';
import { CreateGiveawayDto } from './dto/create-giveaway.dto';
import { SubmitTaskCompletionDto } from './dto/submit-task-completion.dto';
import { ReviewTaskCompletionDto } from './dto/review-task-completion.dto';
import { SelectWinnersDto } from './dto/select-winners.dto';
import { SetPayoutChoiceDto } from './dto/set-payout-choice.dto';
import { BuildFundingPrivateTransferDto } from './dto/build-funding-private-transfer.dto';
import { Giveaway } from './entities/giveaway.entity';

@ApiTags('giveaways')
@Controller('giveaways')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class GiveawaysController {
  constructor(
    private readonly giveawaysService: GiveawaysService,
    private readonly fundingService: GiveawayFundingService,
    private readonly entriesService: GiveawayEntriesService,
    private readonly drawService: GiveawayDrawService,
    private readonly payoutService: GiveawayPayoutService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a giveaway (submits directly for Loofta admin approval)' })
  async create(@Req() req: { user?: { id: string } }, @Body() dto: CreateGiveawayDto): Promise<{ giveaway: Giveaway }> {
    const giveaway = await this.giveawaysService.create(req.user!.id, dto);
    return { giveaway };
  }

  @Get('mine')
  @ApiOperation({ summary: "List the calling user's giveaways" })
  async findMine(@Req() req: { user?: { id: string } }): Promise<{ giveaways: Giveaway[] }> {
    const giveaways = await this.giveawaysService.findMine(req.user!.id);
    return { giveaways };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a giveaway you created, including its tasks' })
  async findOne(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    return this.giveawaysService.findOneForCreator(id, req.user!.id);
  }

  @Get(':id/funding')
  @ApiOperation({ summary: 'Check (and refresh) funding status — reads the burner balance on-chain' })
  async funding(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    const giveaway = await this.giveawaysService.findOneForCreator(id, req.user!.id);
    const status = await this.fundingService.checkAndUpdateFundingStatus(giveaway);
    return {
      burner_address: giveaway.burner_address,
      mint: giveaway.mint,
      funding_required_usd: giveaway.funding_required_usd,
      ...status,
    };
  }

  @Post(':id/funding/private-transfer')
  @ApiOperation({ summary: 'Build an unsigned MagicBlock private transfer to fund this giveaway\'s burner (creator only, destination never leaves the backend)' })
  async buildFundingPrivateTransfer(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: BuildFundingPrivateTransferDto,
  ) {
    const giveaway = await this.giveawaysService.findOneOrThrow(id);
    return this.fundingService.buildFundingPrivateTransfer(
      giveaway,
      req.user!.id,
      dto.sender_wallet,
      dto.cluster,
      dto.gasless ?? true,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Entrant-facing (any authenticated user, not just the creator)
  // ─────────────────────────────────────────────────────────────────

  @Post(':id/entries')
  @ApiOperation({ summary: 'Enter an open giveaway — checks X-linked eligibility and creates a task checklist' })
  async enter(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    const entry = await this.entriesService.enter(id, req.user!.id);
    return { entry };
  }

  @Get(':id/my-entry')
  @ApiOperation({ summary: 'Get your own entry + task checklist for a giveaway, if you entered' })
  async myEntry(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    const entry = await this.entriesService.findMyEntry(id, req.user!.id);
    return { entry };
  }

  @Post(':id/tasks/:taskId/submit')
  @ApiOperation({ summary: 'Mark a task done / submit self-report proof (link, text, screenshot url)' })
  async submitTask(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: SubmitTaskCompletionDto,
  ) {
    const completion = await this.entriesService.submitTaskCompletion(id, req.user!.id, taskId, dto.submission_data);
    return { completion };
  }

  @Put(':id/payout-choice')
  @ApiOperation({ summary: 'Winner: choose public or private payout and a destination wallet' })
  async setPayoutChoice(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Body() dto: SetPayoutChoiceDto) {
    const entry = await this.payoutService.setPayoutChoice(id, req.user!.id, dto.choice, dto.destination);
    return { entry };
  }

  // ─────────────────────────────────────────────────────────────────
  // Creator-facing (ownership-checked via findOneForCreator)
  // ─────────────────────────────────────────────────────────────────

  @Get(':id/entries')
  @ApiOperation({ summary: 'List entries for a giveaway you created' })
  async listEntries(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    await this.giveawaysService.findOneForCreator(id, req.user!.id);
    const entries = await this.entriesService.listEntries(id);
    return { entries };
  }

  @Get(':id/review-queue')
  @ApiOperation({ summary: 'Task completions awaiting a human decision (self-report + api_error) for a giveaway you created' })
  async reviewQueue(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    await this.giveawaysService.findOneForCreator(id, req.user!.id);
    const items = await this.entriesService.listReviewQueue(id);
    return { items };
  }

  @Put(':id/completions/:completionId/review')
  @ApiOperation({ summary: 'Approve or reject a task completion for a giveaway you created' })
  async reviewCompletion(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Param('completionId') completionId: string,
    @Body() dto: ReviewTaskCompletionDto,
  ) {
    await this.giveawaysService.findOneForCreator(id, req.user!.id);
    const completion = await this.entriesService.reviewCompletion(completionId, req.user!.id, dto.decision);
    return { completion };
  }

  @Put(':id/select-winners')
  @ApiOperation({ summary: 'Manually pick winners (manual selection mode only, after entries close)' })
  async selectWinners(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Body() dto: SelectWinnersDto) {
    await this.drawService.selectWinnersManually(id, req.user!.id, dto.entry_ids);
    return { ok: true };
  }
}
