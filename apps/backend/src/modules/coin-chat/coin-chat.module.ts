import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { UsersModule } from '../users/users.module';
import { MiniFeedModule } from '../mini-feed/mini-feed.module';
import { CoinChatController } from './coin-chat.controller';
import { CoinChatService } from './coin-chat.service';

@Module({
  imports: [DatabaseModule, UsersModule, MiniFeedModule],
  controllers: [CoinChatController],
  providers: [CoinChatService],
})
export class CoinChatModule {}
