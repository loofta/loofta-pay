import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '@/common/guards';
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

  /** Public, used for the link preview of a shared call too. Only what the poster chose to show. */
  @Get('call/:id')
  @Throttle({ short: { ttl: 10000, limit: 20 } })
  @ApiOperation({ summary: 'One shared call: who, which coin, what they said' })
  call(@Param('id') id: string) {
    return this.feed.callPreview(id);
  }

  @Get('user/:handle')
  @Throttle({ short: { ttl: 10000, limit: 20 } })
  @ApiOperation({ summary: 'Public profile: volume traded, trades, top coins and takes, as far as the person shares' })
  user(@Param('handle') handle: string) {
    return this.feed.publicProfile(handle);
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
  setProfile(@PrivyUser() user: { id: string }, @Body() body: { avatar?: string; color?: string; showPnl?: boolean; hideName?: boolean; shareActivity?: boolean; handle?: string; shuffleHandle?: boolean; useTelegramName?: boolean }) {
    return this.profiles.setProfile(user.id, body ?? {});
  }

  /** Upload a picture. The app sends it already cut to a small square. */
  @Post('profile/avatar')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 6 } })
  @ApiOperation({ summary: 'Use an uploaded picture as your feed picture' })
  uploadAvatar(@PrivyUser() user: { id: string }, @Body() body: { image?: string }) {
    return this.profiles.uploadAvatar(user.id, body?.image);
  }

  /** The picture itself, public like any avatar. The token is random and changes with each upload. */
  @Public()
  @Get('avatar/:token')
  async avatar(@Param('token') token: string, @Res() res: Response) {
    const { type, bytes } = await this.profiles.avatarBytes(token);
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(bytes);
  }
}
