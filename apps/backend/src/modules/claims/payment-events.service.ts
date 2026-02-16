import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';

export type PaymentEventType =
  | 'claim_created'
  | 'quote_requested'
  | 'deposit_issued'
  | 'payment_detected'
  | 'attestation_submitted'
  | 'attestation_failed'
  | 'quote_failed'
  | 'execution_failed';

@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Log a payment/claim event for audit (table + structured log). No PII.
   */
  async log(params: {
    claimId: string | null;
    eventType: PaymentEventType;
    success: boolean;
    refOrHash?: string | null;
    errorMessage?: string | null;
  }): Promise<void> {
    const { claimId, eventType, success, refOrHash, errorMessage } = params;
    this.logger.log(
      `[payment_event] claim_id=${claimId ?? 'n/a'} event_type=${eventType} success=${success}${refOrHash ? ` ref=${refOrHash}` : ''}${errorMessage ? ` error=${errorMessage}` : ''}`,
    );
    try {
      await this.supabaseService.getClient().from('payment_events').insert({
        claim_id: claimId ?? null,
        event_type: eventType,
        ref_or_hash: refOrHash ?? null,
        success,
        error_message: errorMessage ?? null,
      });
    } catch (e) {
      this.logger.warn('Failed to write payment_events row:', (e as Error).message);
    }
  }
}
