import { Module } from '@nestjs/common';
import { OfframpController } from './offramp.controller';
import { OfframpService } from './offramp.service';
import { OfframpProcessorService } from './offramp-processor.service';
import { IntentsModule } from '../intents/intents.module';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [IntentsModule, UsersModule],
  controllers: [OfframpController],
  providers: [OfframpService, OfframpProcessorService],
  exports: [OfframpService],
})
export class OfframpModule {}
