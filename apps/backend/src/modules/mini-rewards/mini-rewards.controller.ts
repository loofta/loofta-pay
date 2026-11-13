import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrivyAuthGuard } from '../../auth/privy-auth.guard';
import { PrivyUser } from '../../auth/privy-user.decorator';
import { MiniRewardsService } from './mini-rewards.service';
import { MiniCalloutsService } from './mini-callouts.service';

/** Rewards in the Telegram mini app. Everything here is scoped to the signed in person. */
@ApiTags('mini-rewards')
@ApiBearerAuth()
@UseGuards(PrivyAuthGuard)
@Controller('mini/rewards')
export class MiniRewardsController {
  constructor(
    private readonly rewards: MiniRewardsService,
    private readonly callouts: MiniCalloutsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Invite link, badges, fee discount and this week\'s rank' })
  summary(@PrivyUser() user: { id: string }) {
    return this.rewards.summary(user.id);
  }

  @Get('leaderboard')
  @ApiOperation({ summary: 'Weekly volume leaderboard' })
  leaderboard(@PrivyUser() user: { id: string }) {
    return this.rewards.leaderboard(user.id);
  }

  @Post('referral')
  @Throttle({ short: { ttl: 60_000, limit: 6 } })
  @ApiOperation({ summary: 'Save who invited you (once)' })
  referral(@PrivyUser() user: { id: string }, @Body() body: { code?: string }) {
    return this.rewards.claimReferral(user.id, body?.code);
  }

  @Post('trade')
  @Throttle({ short: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Report the signature of a trade the backend built, so it counts' })
  trade(@PrivyUser() user: { id: string }, @Body() body: { tradeId?: string; signature?: string }) {
    return this.rewards.confirmTrade(user.id, String(body?.tradeId ?? ''), String(body?.signature ?? ''));
  }

  @Post('predict')
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Report a prediction you placed, for the Predictor badge' })
  predict(@PrivyUser() user: { id: string }, @Body() body: { signature?: string; picks?: Array<{ marketId?: string; side?: string }> }) {
    return this.rewards.confirmPrediction(user.id, String(body?.signature ?? ''), Array.isArray(body?.picks) ? body.picks : []);
  }

  @Get('callouts')
  @ApiOperation({ summary: 'What you have earned from people who tailed your posts' })
  calloutSummary(@PrivyUser() user: { id: string }) {
    return this.callouts.summary(user.id);
  }

  @Post('tail')
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Tail a holder post: buys of that coin for the next 24 hours earn the poster a share' })
  async tail(@PrivyUser() user: { id: string }, @Body() body: { postId?: string }) {
    const r = await this.callouts.tail(user.id, String(body?.postId ?? ''));
    return { ok: true, mint: r.mint, expiresAt: r.expiresAt };
  }
}
