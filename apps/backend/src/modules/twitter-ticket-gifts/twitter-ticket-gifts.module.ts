import { Module } from '@nestjs/common';
import { TwitterTicketGiftsController } from './twitter-ticket-gifts.controller';
import { TwitterTicketGiftsService } from './twitter-ticket-gifts.service';
import { UsersModule } from '../users/users.module';
import { LotteryModule } from '../lottery/lottery.module';
import { IntegratorsModule } from '../integrators/integrators.module';
import { TwitterAutopayModule } from '../twitter-autopay/twitter-autopay.module';

@Module({
  imports: [UsersModule, LotteryModule, IntegratorsModule, TwitterAutopayModule],
  controllers: [TwitterTicketGiftsController],
  providers: [TwitterTicketGiftsService],
})
export class TwitterTicketGiftsModule {}
