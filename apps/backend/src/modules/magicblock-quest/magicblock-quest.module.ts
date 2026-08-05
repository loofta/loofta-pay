import { Module } from '@nestjs/common';
import { MagicblockQuestController } from './magicblock-quest.controller';
import { MagicblockQuestService } from './magicblock-quest.service';
import { MagicblockQuestCronService } from './magicblock-quest-cron.service';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [MagicblockQuestController],
  providers: [MagicblockQuestService, MagicblockQuestCronService],
  exports: [MagicblockQuestService],
})
export class MagicblockQuestModule {}
