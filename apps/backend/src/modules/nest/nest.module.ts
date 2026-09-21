import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { NestController } from './nest.controller';
import { NestService } from './nest.service';
import { NestDepositService } from './nest-deposit.service';
import { NestRebalanceService } from './nest-rebalance.service';
import { NestCronService } from './nest-cron.service';
import { XStocksService } from './xstocks.service';
import { ElfaService } from './elfa.service';
import { NestSocialService } from './nest-social.service';

@Module({
  imports: [DatabaseModule],
  controllers: [NestController],
  providers: [NestService, NestDepositService, NestRebalanceService, NestCronService, XStocksService, ElfaService, NestSocialService],
  exports: [NestService, XStocksService],
})
export class NestModule {}
