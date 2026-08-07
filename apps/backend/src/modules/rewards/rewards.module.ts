import { Module } from '@nestjs/common';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { BlinkCampaignService } from './blink-campaign.service';
import { MegapotCampaignService } from './megapot-campaign.service';
import { GetPaidCampaignService } from './getpaid-campaign.service';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [RewardsController],
  providers: [RewardsService, BlinkCampaignService, MegapotCampaignService, GetPaidCampaignService],
  exports: [RewardsService, BlinkCampaignService, MegapotCampaignService, GetPaidCampaignService],
})
export class RewardsModule {}
