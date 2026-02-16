import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ClaimAttestationService } from '../claims/claim-attestation.service';

/**
 * Retries attestation recording for SUCCESS claims that don't have attestation_tx_hash yet.
 * Idempotent; runs every 10 minutes.
 */
@Injectable()
export class AttestationRetryService {
  private readonly logger = new Logger(AttestationRetryService.name);

  constructor(private readonly claimAttestationService: ClaimAttestationService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    try {
      const { attempted, recorded } = await this.claimAttestationService.retryMissingAttestations();
      if (attempted > 0) {
        this.logger.log(`Attestation retry: attempted=${attempted} recorded=${recorded}`);
      }
    } catch (e) {
      this.logger.warn('Attestation retry cron failed:', (e as Error).message);
    }
  }
}
