import { Module } from '@nestjs/common';
import { UsersModule } from '@/modules/users/users.module';
import { JupiterController } from './jupiter.controller';
import { JupiterService } from './jupiter.service';

@Module({
  imports: [UsersModule],
  controllers: [JupiterController],
  providers: [JupiterService],
  exports: [JupiterService],
})
export class JupiterModule {}
