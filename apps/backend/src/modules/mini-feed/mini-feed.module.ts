import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { UsersModule } from '@/modules/users/users.module';
import { MiniFeedController } from './mini-feed.controller';
import { MiniFeedService } from './mini-feed.service';
import { MiniProfileService } from './mini-profile.service';

/** The mini app's social feed: posts across coins, profile pictures and names. Coin chat is the source of the posts. */
@Module({
  imports: [DatabaseModule, UsersModule],
  controllers: [MiniFeedController],
  providers: [MiniFeedService, MiniProfileService],
  exports: [MiniProfileService],
})
export class MiniFeedModule {}
