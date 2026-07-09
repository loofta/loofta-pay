import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BeamService } from '../beam/beam.service';

@Injectable()
export class BeamProcessorService {
  private readonly logger = new Logger(BeamProcessorService.name);

  constructor(private readonly beam: BeamService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleBeamFulfilment() {
    try {
      await this.beam.processActiveBeams();
    } catch (err: any) {
      this.logger.warn('processActiveBeams failed:', err.message);
    }
  }
}
