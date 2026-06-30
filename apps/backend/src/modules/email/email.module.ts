import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { BroadcastController } from './broadcast.controller';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BroadcastController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
