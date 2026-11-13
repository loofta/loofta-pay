import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { UsersModule } from '../users/users.module';
import { CoinChatController } from './coin-chat.controller';
import { CoinChatService } from './coin-chat.service';

@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [CoinChatController],
  providers: [CoinChatService],
})
export class CoinChatModule {}
