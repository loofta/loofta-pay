import { Module } from '@nestjs/common';
import { SupportChatController } from './support-chat.controller';
import { SupportBotController } from './support-bot.controller';
import { SupportChatService } from './support-chat.service';
import { SupportBotService } from './support-bot.service';
import { SupportLlmService } from './support-llm.service';

@Module({
  controllers: [SupportChatController, SupportBotController],
  providers: [SupportChatService, SupportBotService, SupportLlmService],
})
export class SupportChatModule {}
