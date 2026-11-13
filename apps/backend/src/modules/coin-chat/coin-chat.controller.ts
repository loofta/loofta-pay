import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrivyAuthGuard } from '../../auth/privy-auth.guard';
import { PrivyUser } from '../../auth/privy-user.decorator';
import { CoinChatService } from './coin-chat.service';

@ApiTags('coin-chat')
@Controller('coin-chat')
export class CoinChatController {
  constructor(private readonly chat: CoinChatService) {}

  /** Public read. Never returns wallet addresses or Privy ids. */
  @Get(':mint')
  @Throttle({ short: { ttl: 10000, limit: 10 } })
  @ApiOperation({ summary: 'Latest chat messages for a coin, with each poster\'s holding' })
  list(@Param('mint') mint: string, @Query('before') before?: string) {
    return this.chat.list(mint, before);
  }

  @Post(':mint')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 10000, limit: 3 } })
  @ApiOperation({ summary: 'Post a chat message. The poster\'s holding of the coin is recorded with it.' })
  post(@PrivyUser() user: { id: string }, @Param('mint') mint: string, @Body() body: { text?: string }) {
    if (typeof body?.text !== 'string') throw new BadRequestException('text is required');
    return this.chat.post(user.id, mint, body.text);
  }
}
