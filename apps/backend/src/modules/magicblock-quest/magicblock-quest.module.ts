import { Module } from '@nestjs/common';
import { MagicblockQuestController } from './magicblock-quest.controller';
import { MagicblockQuestService } from './magicblock-quest.service';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [MagicblockQuestController],
  providers: [MagicblockQuestService],
  exports: [MagicblockQuestService],
})
export class MagicblockQuestModule {}
