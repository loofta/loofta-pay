import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RewardsService } from './rewards.service';
import { BlinkCampaignService } from './blink-campaign.service';
import { MegapotCampaignService } from './megapot-campaign.service';
import { GetPaidCampaignService } from './getpaid-campaign.service';
import { PrivyAuthGuard } from '@/auth/privy-auth.guard';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { AdminGuard } from '@/common/guards';

@ApiTags('rewards')
@Controller('rewards')
export class RewardsController {
  constructor(
    private readonly rewardsService: RewardsService,
    private readonly blinkCampaign: BlinkCampaignService,
    private readonly megapotCampaign: MegapotCampaignService,
    private readonly getPaidCampaign: GetPaidCampaignService,
  ) {}

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

  @Get('blink/me')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Blink campaign quest status for current user' })
  async getMyBlinkCampaign(
    @PrivyUser() user: { id: string },
    @Query('address') solanaAddress?: string,
  ) {
    if (solanaAddress && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaAddress)) {
      throw new BadRequestException('Invalid Solana address');
    }
    return this.blinkCampaign.getBlinkCampaign(user.id, solanaAddress);
  }

  @Get('megapot/me')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Megapot campaign quest status for current user' })
  async getMyMegapotCampaign(@PrivyUser() user: { id: string }) {
    return this.megapotCampaign.getMegapotCampaign(user.id);
  }

  @Get('admin/all')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: all users Sparks leaderboard' })
  async getAllRewards() {
    return this.rewardsService.getAllUsersRewards();
  }

  @Get('admin/blink')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Blink campaign quest completion per user' })
  async getBlinkCampaignAdmin() {
    return this.blinkCampaign.getAllBlinkCampaignStatus();
  }

  @Get('admin/megapot')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Megapot campaign eligible participants for the lucky draw' })
  async getMegapotCampaignAdmin() {
    return this.megapotCampaign.getAllMegapotCampaignStatus();
  }

  @Get('getpaid/me')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Paid campaign quest status for current user' })
  async getMyGetPaidCampaign(@PrivyUser() user: { id: string }) {
    return this.getPaidCampaign.getGetPaidCampaign(user.id);
  }

  @Get('admin/getpaid')
  @UseGuards(AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin: Get Paid campaign eligible participants for the $50 x 3 draw' })
  async getGetPaidCampaignAdmin() {
    return this.getPaidCampaign.getAllGetPaidCampaignStatus();
  }
}
