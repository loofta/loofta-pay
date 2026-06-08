import { Module } from '@nestjs/common';
import { AdminWaitlistController } from './admin-waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { EmailModule } from '../email/email.module';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [EmailModule, AuthModule],
  controllers: [AdminWaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
