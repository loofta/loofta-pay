import { Module } from '@nestjs/common';
import { GachaController } from './gacha.controller';
import { AdminGachaController } from './admin-gacha.controller';
import { GachaService } from './gacha.service';
import { GachaCronService } from './gacha-cron.service';
import { GachaGateway } from './gacha.gateway';
import { CollectorCryptClient } from './collectorcrypt.client';
import { UsersModule } from '../users/users.module';
import { DatabaseModule } from '@/database/database.module';

@Module({
  imports: [UsersModule, DatabaseModule],
  controllers: [GachaController, AdminGachaController],
  providers: [GachaService, GachaCronService, GachaGateway, CollectorCryptClient],
  exports: [GachaService],
})
export class GachaModule {}
