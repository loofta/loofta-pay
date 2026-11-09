import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { AmpleController } from './ample.controller';
import { AmpleService } from './ample.service';

@Module({
  imports: [UsersModule],
  controllers: [AmpleController],
  providers: [AmpleService],
})
export class AmpleModule {}
