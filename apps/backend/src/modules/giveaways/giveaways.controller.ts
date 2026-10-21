import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { GiveawaysService } from './giveaways.service';
import { GiveawayFundingService } from './giveaway-funding.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { GiveawayDrawService } from './giveaway-draw.service';
import { QuickGiveawayService } from './quick-giveaway.service';
import { QuickRulesParserService } from './quick-rules-parser.service';
import { CreateGiveawayDto } from './dto/create-giveaway.dto';
import { SubmitTaskCompletionDto } from './dto/submit-task-completion.dto';
import { ReviewTaskCompletionDto } from './dto/review-task-completion.dto';
import { SelectWinnersDto } from './dto/select-winners.dto';
import { BuildFundingPrivateTransferDto, ConfirmDirectTokenFundingDto } from './dto/build-funding-private-transfer.dto';
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
    private readonly quick: QuickGiveawayService,
    private readonly quickRules: QuickRulesParserService,
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

  @Put(':id')
  @ApiOperation({ summary: 'Edit a giveaway you created — any time before it is FUNDED. Once funded, budget/scope changes go through support/admin instead.' })
  async update(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: CreateGiveawayDto,
  ): Promise<{ giveaway: Giveaway }> {
    const giveaway = await this.giveawaysService.updateBeforeFunded(id, req.user!.id, dto);
    return { giveaway };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete (before approval) or cancel-and-refund (while awaiting funding) a giveaway you created' })
  async remove(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    return this.giveawaysService.cancelOrDelete(id, req.user!.id);
  }

  @Get(':id/funding')
  @ApiOperation({ summary: 'Check (and refresh) funding status — reads the burner balance on-chain' })
  async funding(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    const giveaway = await this.giveawaysService.findOneForCreator(id, req.user!.id);
    const status = await this.fundingService.checkAndUpdateFundingStatus(giveaway);
    const tokenQuote = await this.fundingService.quoteDirectTokenFunding(giveaway).catch(() => null);
    return {
      burner_address: giveaway.burner_address,
      mint: giveaway.mint,
      funding_required_usd: giveaway.funding_required_usd,
      tokenQuote,
      ...status,
    };
  }

  @Post(':id/funding/token')
  @ApiOperation({ summary: 'Build one transaction that sends the prize token to the burner and the USDC platform fee to Loofta' })
  async buildDirectTokenFunding(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: BuildFundingPrivateTransferDto,
  ) {
    const giveaway = await this.giveawaysService.findOneOrThrow(id);
    return this.fundingService.buildDirectTokenFunding(giveaway, req.user!.id, dto.sender_wallet);
  }

  @Post(':id/funding/token/confirm')
  @ApiOperation({ summary: 'Open the giveaway once the token-plus-fee transaction is confirmed' })
  async confirmDirectTokenFunding(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Body() dto: ConfirmDirectTokenFundingDto,
  ) {
    const giveaway = await this.giveawaysService.findOneOrThrow(id);
    return this.fundingService.confirmDirectTokenFunding(giveaway, req.user!.id, dto.signature);
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

  // ─────────────────────────────────────────────────────────────────
  // Creator-facing (ownership-checked via findOneForCreator)
  // ─────────────────────────────────────────────────────────────────

  @Get(':id/entries')
  @ApiOperation({ summary: 'List entries for a giveaway you created' })
  async listEntries(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    await this.giveawaysService.findOneForCreator(id, req.user!.id);
    const entries = await this.entriesService.listEntriesWithClaimStatus(id);
    return { entries };
  }

  @Get(':id/eligible-count')
  @ApiOperation({ summary: 'How many currently-entered entrants have every task verified (eligible to win right now) vs. total entries, for a giveaway you created' })
  async eligibleCount(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    await this.giveawaysService.findOneForCreator(id, req.user!.id);
    const [entries, eligible] = await Promise.all([
      this.entriesService.listEntries(id),
      this.entriesService.getEligibleVerifiedEntries(id),
    ]);
    return { eligible: eligible.length, total: entries.length };
  }

  @Get(':id/entries/:entryId/completions')
  @ApiOperation({ summary: 'Every task completion for one entry (any status), for a giveaway you created' })
  async entryCompletions(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Param('entryId') entryId: string) {
    await this.giveawaysService.findOneForCreator(id, req.user!.id);
    const completions = await this.entriesService.listEntryCompletions(id, entryId);
    return { completions };
  }

  @Get(':id/review-queue')
  @ApiOperation({ summary: 'Paginated self-report task completions awaiting a human decision, for a giveaway you created — AUTO_API tasks resolve programmatically and never appear here' })
  async reviewQueue(
    @Req() req: { user?: { id: string } },
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    await this.giveawaysService.findOneForCreator(id, req.user!.id);
    return this.entriesService.listReviewQueue(id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post(':id/review-link')
  @ApiOperation({ summary: 'Generate (or regenerate) a password-protected public review link for this giveaway — invalidates any previous link/password' })
  async generateReviewLink(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    return this.giveawaysService.generateReviewLink(id, req.user!.id);
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
    const completion = await this.entriesService.reviewCompletion(id, completionId, req.user!.id, dto.decision);
    return { completion };
  }

  @Put(':id/select-winners')
  @ApiOperation({ summary: 'Manually pick winners (manual selection mode only, after entries close)' })
  async selectWinners(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Body() dto: SelectWinnersDto) {
    await this.drawService.selectWinnersManually(id, req.user!.id, dto.entry_ids);
    return { ok: true };
  }

  @Put(':id/force-run-draw')
  @ApiOperation({ summary: 'Creator-only: force-close entries and run the draw immediately instead of waiting for entries_close_at' })
  async forceRunDraw(@Req() req: { user?: { id: string } }, @Param('id') id: string): Promise<{ giveaway: Giveaway }> {
    const giveaway = await this.drawService.forceRunDrawNow(id, req.user!.id);
    return { giveaway };
  }

  @Post(':id/posts/refresh')
  @ApiOperation({ summary: 'Quick X giveaway, creator only: look for new qualifying posts now (throttled to once per 30s)' })
  async refreshPosts(@Req() req: { user?: { id: string } }, @Param('id') id: string) {
    return this.quick.refresh(id, req.user!.id);
  }

  @Put(':id/posts/:entryId/exclude')
  @ApiOperation({ summary: 'Quick X giveaway, creator only: hide a post from the pool (spam / off-topic)' })
  async excludePost(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Param('entryId') entryId: string) {
    await this.quick.setExcluded(id, entryId, req.user!.id, true);
    return { ok: true };
  }

  @Put(':id/posts/:entryId/restore')
  @ApiOperation({ summary: 'Quick X giveaway, creator only: put a hidden post back in the pool' })
  async restorePost(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Param('entryId') entryId: string) {
    await this.quick.setExcluded(id, entryId, req.user!.id, false);
    return { ok: true };
  }

  @Post('quick/parse')
  @ApiOperation({ summary: 'Read a pasted X announcement and return the giveaway rules (AI when configured, patterns otherwise)' })
  async parseQuickRules(@Req() req: { user?: { id: string } }, @Body() body: { text?: string; url?: string }) {
    if (body?.url?.trim()) return this.quickRules.parseFromUrl(req.user!.id, body.url);
    return this.quickRules.parse(req.user!.id, body?.text ?? '');
  }

  @Put(':id/posts/:entryId/shortlist')
  @ApiOperation({ summary: 'Quick X giveaway, creator only: star a post so the draw can pick it' })
  async shortlistPost(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Param('entryId') entryId: string) {
    await this.quick.setShortlisted(id, entryId, req.user!.id, true);
    return { ok: true };
  }

  @Put(':id/posts/:entryId/unshortlist')
  @ApiOperation({ summary: 'Quick X giveaway, creator only: remove a post from the shortlist' })
  async unshortlistPost(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Param('entryId') entryId: string) {
    await this.quick.setShortlisted(id, entryId, req.user!.id, false);
    return { ok: true };
  }

  @Put(':id/draw-pool')
  @ApiOperation({ summary: 'Quick X giveaway, creator only: draw from every qualifying post or only the shortlist' })
  async setDrawPool(@Req() req: { user?: { id: string } }, @Param('id') id: string, @Body() body: { pool?: string }) {
    await this.quick.setDrawPool(id, req.user!.id, body?.pool === 'shortlist' ? 'shortlist' : 'all');
    return { ok: true };
  }
}
