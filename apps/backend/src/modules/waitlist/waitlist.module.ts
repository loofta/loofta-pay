import { Module } from '@nestjs/common';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { WaitlistService } from './waitlist.service';

@Module({
  controllers: [AdminWaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
