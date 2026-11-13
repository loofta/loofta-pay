import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrivyAuthGuard } from '../../auth/privy-auth.guard';
import { PrivyUser } from '../../auth/privy-user.decorator';
import { MiniPayService } from './mini-pay.service';

/** Pay by username in the Telegram mini app. Everything here is scoped to the signed in person. */
@ApiTags('mini-pay')
@ApiBearerAuth()
@UseGuards(PrivyAuthGuard)
@Controller('mini/pay')
export class MiniPayController {
  constructor(private readonly pay: MiniPayService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Your username and personal pay link' })
  profile(@PrivyUser() user: { id: string }) {
    return this.pay.profile(user.id);
  }

  @Post('username')
  @Throttle({ short: { ttl: 60_000, limit: 6 } })
  @ApiOperation({ summary: 'Pick your first username (a loo- name)' })
  setUsername(@PrivyUser() user: { id: string }, @Body() body: { username?: string }) {
    return this.pay.setUsername(user.id, body?.username);
  }

  @Get('history')
  @ApiOperation({ summary: 'Sent, received and deposits, newest first' })
  history(@PrivyUser() user: { id: string }) {
    return this.pay.history(user.id);
  }
}
