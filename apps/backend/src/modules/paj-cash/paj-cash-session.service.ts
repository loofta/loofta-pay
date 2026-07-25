import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { PajCashService } from './paj-cash.service';
import type { PajCashSessionRow } from './entities/paj-session.entity';

/** Thrown when a user has no active PAJ session — caller must re-run the OTP link flow. */
export class PajLinkRequiredError extends Error {
  constructor(message = 'PAJ Cash account not linked or session expired') {
    super(message);
    this.name = 'PajLinkRequiredError';
  }
}

@Injectable()
export class PajCashSessionService {
  private readonly logger = new Logger(PajCashSessionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: SendPaymentEncryptionService,
    private readonly pajCash: PajCashService,
  ) {}

  private table() {
    return this.supabase.getClient().from('paj_cash_sessions');
  }

  async initiate(recipient: string): Promise<void> {
    await this.pajCash.initiate(recipient);
  }

  async verify(
    userId: string,
    recipient: string,
    otp: string,
    device: { uuid: string; device: string; os?: string; browser?: string },
  ): Promise<{ expiresAt: string }> {
    const verified = await this.pajCash.verify(recipient, otp, device);
    const recipientType: 'email' | 'phone' = Number.isNaN(Number(recipient)) ? 'email' : 'phone';
    const tokenEnc = this.encryption.encrypt(Buffer.from(verified.token, 'utf8'), userId);

    const { error } = await this.table().upsert(
      {
        user_id: userId,
        recipient,
        recipient_type: recipientType,
        session_token_enc: tokenEnc,
        expires_at: verified.expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      this.logger.error(`Failed to persist PAJ session for ${userId}: ${error.message}`);
      throw new Error('Failed to save PAJ Cash session');
    }
    return { expiresAt: verified.expiresAt };
  }

  async getRow(userId: string): Promise<PajCashSessionRow | null> {
    const { data } = await this.table().select('*').eq('user_id', userId).maybeSingle();
    return (data as PajCashSessionRow | null) ?? null;
  }

  async getStatus(userId: string): Promise<{ linked: boolean; expiresAt: string | null; kycStatus: string }> {
    const row = await this.getRow(userId);
    if (!row) return { linked: false, expiresAt: null, kycStatus: 'unknown' };
    const linked = new Date(row.expires_at).getTime() > Date.now();
    return { linked, expiresAt: row.expires_at, kycStatus: row.kyc_status };
  }

  /** Returns the decrypted, still-valid session token, or throws PajLinkRequiredError. */
  async getValidSessionToken(userId: string): Promise<string> {
    const row = await this.getRow(userId);
    if (!row) throw new PajLinkRequiredError();
    if (new Date(row.expires_at).getTime() <= Date.now()) throw new PajLinkRequiredError('PAJ Cash session expired — please re-link');
    return this.encryption.decrypt(row.session_token_enc, userId).toString('utf8');
  }

  async setKycStatus(userId: string, status: PajCashSessionRow['kyc_status'], idType?: 'BVN' | 'NIN'): Promise<void> {
    await this.table()
      .update({ kyc_status: status, ...(idType ? { kyc_id_type: idType } : {}), updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }
}
