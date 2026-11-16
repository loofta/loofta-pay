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

  @Get('thread/:id')
  @Throttle({ short: { ttl: 10000, limit: 15 } })
  @ApiOperation({ summary: 'One take with its replies. Replies by the take\'s author are updates.' })
  thread(@Param('id') id: string) {
    return this.chat.thread(id);
  }

  @Get('event/:eventId')
  @Throttle({ short: { ttl: 10000, limit: 10 } })
  @ApiOperation({ summary: 'Takes on a prediction event, with what each poster has on it' })
  listEvent(@Param('eventId') eventId: string, @Query('before') before?: string) {
    return this.chat.listEvent(eventId, before);
  }

  @Post('event/:eventId')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 10000, limit: 3 } })
  @ApiOperation({ summary: 'Post a take on an event. Needs at least $2 placed on it.' })
  postEvent(@PrivyUser() user: { id: string }, @Param('eventId') eventId: string, @Body() body: { text?: string }) {
    if (typeof body?.text !== 'string') throw new BadRequestException('text is required');
    return this.chat.postEvent(user.id, eventId, body.text);
  }

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
  post(@PrivyUser() user: { id: string }, @Param('mint') mint: string, @Body() body: { text?: string; parentId?: string }) {
    if (typeof body?.text !== 'string') throw new BadRequestException('text is required');
    return this.chat.post(user.id, mint, body.text, typeof body.parentId === 'string' ? body.parentId : undefined);
  }
}
