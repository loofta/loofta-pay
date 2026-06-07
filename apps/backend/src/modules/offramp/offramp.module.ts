import { Module } from '@nestjs/common';
import { OfframpController } from './offramp.controller';
import { OfframpService } from './offramp.service';
import { IntentsModule } from '../intents/intents.module';

@Module({
  imports: [IntentsModule],
  controllers: [OfframpController],
  providers: [OfframpService],
  exports: [OfframpService],
})
export class OfframpModule {}
