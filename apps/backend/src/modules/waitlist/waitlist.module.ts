import { Module } from '@nestjs/common';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [AdminWaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
