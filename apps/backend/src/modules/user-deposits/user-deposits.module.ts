import { Module } from '@nestjs/common';
import { UserDepositsProcessorService } from './user-deposits-processor.service';
import { IntentsModule } from '../intents/intents.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [IntentsModule, DatabaseModule],
  providers: [UserDepositsProcessorService],
})
export class UserDepositsModule {}
