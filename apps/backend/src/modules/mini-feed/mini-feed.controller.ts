import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrivyAuthGuard } from '../../auth/privy-auth.guard';
import { PrivyUser } from '../../auth/privy-user.decorator';
import { MiniFeedService } from './mini-feed.service';
import { MiniProfileService } from './mini-profile.service';

@ApiTags('mini-feed')
@Controller('mini/feed')
export class MiniFeedController {
  constructor(
    private readonly feed: MiniFeedService,
    private readonly profiles: MiniProfileService,
  ) {}

  /** Public read, like coin chat. Never returns wallet addresses or Privy ids. */
  @Get()
  @Throttle({ short: { ttl: 10000, limit: 10 } })
  @ApiOperation({ summary: 'Newest posts across every coin, with the poster, their position and PnL' })
  list(@Query('before') before?: string) {
    this.feed.validateBefore(before);
    return this.feed.feed(before);
  }

  @Get('profile')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Your feed name, picture and what you show' })
  profile(@PrivyUser() user: { id: string }) {
    return this.profiles.getProfile(user.id);
  }

  @Post('profile')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Pick your picture (Telegram, X or a colour) and what you show' })
  setProfile(@PrivyUser() user: { id: string }, @Body() body: { avatar?: string; color?: string; showPnl?: boolean; hideName?: boolean }) {
    return this.profiles.setProfile(user.id, body ?? {});
  }
}
