import { Module } from '@nestjs/common';
import { JupiterController } from './jupiter.controller';
import { JupiterService } from './jupiter.service';

@Module({
  controllers: [JupiterController],
  providers: [JupiterService],
  exports: [JupiterService],
})
export class JupiterModule {}
