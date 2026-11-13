import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { UsersModule } from '../users/users.module';
import { MeldOnrampController } from './meld-onramp.controller';
import { MeldOnrampService } from './meld-onramp.service';

@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [MeldOnrampController],
  providers: [MeldOnrampService],
})
export class MeldOnrampModule {}
