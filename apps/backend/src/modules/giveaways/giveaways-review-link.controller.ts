import { Controller, Get, Put, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { GiveawaysService } from './giveaways.service';
import { GiveawayEntriesService } from './giveaway-entries.service';
import { ReviewLinkAuthDto } from './dto/review-link-auth.dto';
import { ReviewTaskCompletionDto } from './dto/review-task-completion.dto';
import { ReviewLinkGuard } from './review-link.guard';

/** Password-protected public review queue — no Privy auth, deliberately. A creator shares
 *  /rewards/giveaways/review/:token + a password with someone (a mod, a teammate) who doesn't have
 *  a Loofta account, so they can clear the self-report review queue without one. Every route here
 *  is scoped to exactly the one giveaway the token was generated for — see ReviewLinkGuard and
 *  GiveawayEntriesService.reviewCompletionScoped for how that's enforced. */
@ApiTags('giveaways-review-link')
@Controller('giveaways/review-link')
export class GiveawaysReviewLinkController {
  constructor(
    private readonly giveawaysService: GiveawaysService,
    private readonly entriesService: GiveawayEntriesService,
  ) {}

  @Post(':token/auth')
  @ApiOperation({ summary: 'Exchange the review link password for a short-lived session token' })
  async auth(@Param('token') token: string, @Body() dto: ReviewLinkAuthDto) {
    return this.giveawaysService.authenticateReviewLink(token, dto.password);
  }

  @UseGuards(ReviewLinkGuard)
  @Get(':token/queue')
  @ApiOperation({ summary: 'Paginated self-report task completions awaiting review, for this review link\'s giveaway only' })
  async queue(
    @Req() req: { reviewGiveawayId: string },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.entriesService.listReviewQueue(req.reviewGiveawayId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @UseGuards(ReviewLinkGuard)
  @Put(':token/completions/:completionId/review')
  @ApiOperation({ summary: 'Approve or reject a self-report task completion belonging to this review link\'s giveaway' })
  async review(
    @Req() req: { reviewGiveawayId: string },
    @Param('completionId') completionId: string,
    @Body() dto: ReviewTaskCompletionDto,
  ) {
    const completion = await this.entriesService.reviewCompletionScoped(req.reviewGiveawayId, completionId, dto.decision);
    return { completion };
  }
}
