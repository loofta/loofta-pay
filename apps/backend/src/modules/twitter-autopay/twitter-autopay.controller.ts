import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard, IntegratorGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { TwitterAutopayService } from './twitter-autopay.service';

/**
 * No class-level guard — status/enroll/unenroll are user-session routes (AuthGuard) while
 * enrolled-handles is a bot-facing route (IntegratorGuard); mixing both at class level would
 * require every request to pass both guards, which doesn't make sense for either caller.
 */
@ApiTags('twitter-autopay')
@Controller('twitter-autopay')
export class TwitterAutopayController {
  constructor(private readonly autopay: TwitterAutopayService) {}

  @Get('status')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Current user\'s Twitter auto-pay enrollment status + whether they can see the settings at all' })
  async status(@PrivyUser() user: { id: string }) {
    return this.autopay.getStatus(user.id);
  }

  @Post('enroll')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Enable auto-pay after granting the Privy authorization key' })
  async enroll(@PrivyUser() user: { id: string }, @Body() body: { accepted_terms?: boolean }) {
    return this.autopay.enroll(user.id, body?.accepted_terms === true);
  }

  @Post('unenroll')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Disable Twitter auto-pay' })
  async unenroll(@PrivyUser() user: { id: string }) {
    return this.autopay.unenroll(user.id);
  }

  @Post('limits')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 3600, 'twitter-autopay:limits')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Owner: set per-payment and daily spend limits for bot payments from their wallet' })
  async limits(@PrivyUser() user: { id: string }, @Body() body: { per_payment_cap_usd: number; daily_cap_usd: number }) {
    return this.autopay.updateLimits(user.id, {
      perPaymentCapUsd: Number(body?.per_payment_cap_usd),
      dailyCapUsd: Number(body?.daily_cap_usd),
    });
  }

  @Post('approvers')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(30, 3600, 'twitter-autopay:approvers-add')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Owner: let a teammate\'s X handle command the bot to pay from this wallet' })
  async addApprover(@PrivyUser() user: { id: string }, @Body() body: { handle: string }) {
    return this.autopay.addApprover(user.id, String(body?.handle ?? ''));
  }

  @Post('approvers/remove')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(30, 3600, 'twitter-autopay:approvers-remove')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Owner: remove a teammate approver' })
  async removeApprover(@PrivyUser() user: { id: string }, @Body() body: { handle: string }) {
    return this.autopay.removeApprover(user.id, String(body?.handle ?? ''));
  }

  @Post('request-access')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(3, 3600, 'twitter-autopay:request-access')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Email hello@loofta.xyz an access request with the caller\'s identity on file' })
  async requestAccess(@PrivyUser() user: { id: string }) {
    return this.autopay.requestAccess(user.id);
  }

  /**
   * Bot-facing: lets the bot pre-filter mentions to enrolled senders only, before it even tries
   * to parse a tweet's text, instead of parsing every mention and only finding out a sender
   * wasn't authorized after a matching command hits create() and gets rejected there.
   */
  @Get('enrolled-handles')
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RateLimit(30, 60, 'twitter-autopay:enrolled-handles', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Integrator (bot) fetches the current list of enrolled Twitter handles' })
  async enrolledHandles() {
    return { handles: await this.autopay.listEnrolledHandles() };
  }

  @Get('poll-cursor')
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RateLimit(30, 60, 'twitter-autopay:poll-cursor-get', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Integrator (bot) fetches its persisted mention-timeline since_id cursor' })
  async getPollCursor(@Query('bot_handle') botHandle: string) {
    return { last_seen_tweet_id: await this.autopay.getPollCursor(botHandle) };
  }

  @Post('poll-cursor')
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RateLimit(30, 60, 'twitter-autopay:poll-cursor-set', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Integrator (bot) persists its mention-timeline since_id cursor' })
  async setPollCursor(@Body() body: { bot_handle: string; last_seen_tweet_id: string }) {
    await this.autopay.setPollCursor(body.bot_handle, body.last_seen_tweet_id);
    return { ok: true };
  }
}
