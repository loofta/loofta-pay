import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { MiniRewardsModule } from '@/modules/mini-rewards/mini-rewards.module';
import { JupiterController } from './jupiter.controller';
import { JupiterService } from './jupiter.service';

@Module({
  imports: [UsersModule, MiniRewardsModule],
  controllers: [JupiterController],
  providers: [JupiterService],
  exports: [JupiterService],
})
export class JupiterModule {}
