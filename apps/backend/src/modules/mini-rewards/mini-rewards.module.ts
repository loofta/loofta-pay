import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { UsersModule } from '@/modules/users/users.module';
import { MiniRewardsController } from './mini-rewards.controller';
import { MiniRewardsService } from './mini-rewards.service';

/** Referrals, badges, the weekly leaderboard and the referral fee discount. Does not depend on the swap modules, they depend on it. */
@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [MiniRewardsController],
  providers: [MiniRewardsService],
  exports: [MiniRewardsService],
})
export class MiniRewardsModule {}
