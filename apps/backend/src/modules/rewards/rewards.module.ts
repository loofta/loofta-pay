import { Module } from '@nestjs/common';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { BlinkCampaignService } from './blink-campaign.service';

@Module({
  controllers: [RewardsController],
  providers: [RewardsService, BlinkCampaignService],
  exports: [RewardsService, BlinkCampaignService],
})
export class RewardsModule {}
