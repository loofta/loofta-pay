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
    // Fire-and-forget: retries any previously-failed push before answering, so a page
    // load/poll can self-heal a quest that failed due to transient config or timing issues.
    void this.magicblockQuest.retryFailedPushes(user.id);
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
