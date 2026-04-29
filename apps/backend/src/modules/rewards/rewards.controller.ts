import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RewardsService } from './rewards.service';
import { PrivyAuthGuard } from '@/auth/privy-auth.guard';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { AdminGuard } from '@/common/guards';

@ApiTags('rewards')
@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get('me')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user Sparks and task completion status' })
  async getMyRewards(
    @PrivyUser() user: { id: string },
    @Query('network') network?: string,
  ) {
    const isDevnet = network !== 'mainnet';
    return this.rewardsService.getRewards(user.id, isDevnet);
  }

  @Get('admin/all')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: all users Sparks leaderboard' })
  async getAllRewards() {
    return this.rewardsService.getAllUsersRewards();
  }
}
