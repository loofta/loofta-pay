import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MagicblockQuestService } from './magicblock-quest.service';
import { PrivyAuthGuard } from '@/auth/privy-auth.guard';
import { PrivyUser } from '@/auth/privy-user.decorator';

@ApiTags('rewards')
@Controller('rewards/magicblock')
export class MagicblockQuestController {
  constructor(private readonly magicblockQuest: MagicblockQuestService) {}

  @Get('me')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get connected MagicBlock wallet and repeatable quest completion status' })
  async getMe(@PrivyUser() user: { id: string }) {
    // Fire-and-forget: retries any previously-failed push, and separately re-runs the full
    // per-wallet backfill (catches a push that was never even attempted, not just one that
    // failed — see MagicblockQuestCronService's hourly sweep, which this makes redundant for
    // any user who actually opens this page instead of waiting for the next hourly run). Only
    // for users who've actually connected a wallet — otherwise every page view from someone who
    // never opted in would run two pointless queries against payments/lottery_tickets.
    void this.magicblockQuest.retryFailedPushes(user.id);
    void this.magicblockQuest.getWallet(user.id).then((wallet) => {
      if (wallet) return this.magicblockQuest.backfillQuestsForWallet(user.id);
    });
    return this.magicblockQuest.getQuestStatus(user.id);
  }

  @Post('wallet')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Connect the MagicBlock wallet used to auto-validate quests (write-once)' })
  async setWallet(@PrivyUser() user: { id: string }, @Body('wallet') wallet: string) {
    return this.magicblockQuest.setWallet(user.id, wallet ?? '');
  }
}
