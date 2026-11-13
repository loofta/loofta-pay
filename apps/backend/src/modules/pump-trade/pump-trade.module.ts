import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { JupiterModule } from '@/modules/jupiter/jupiter.module';
import { MiniRewardsModule } from '@/modules/mini-rewards/mini-rewards.module';
import { PumpTradeController } from './pump-trade.controller';
import { PumpTradeService } from './pump-trade.service';

@Module({
  imports: [UsersModule, JupiterModule, MiniRewardsModule],
  controllers: [PumpTradeController],
  providers: [PumpTradeService],
})
export class PumpTradeModule {}
