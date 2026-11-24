import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type KycStatus = 'requested' | 'in_progress' | 'passed' | 'failed';

/** What the check costs per person. Shown in the portal and stored on the recipient when it is requested. */
export const KYC_FEE_USD = 0.8;

const TOKEN_URL = 'https://nest-api.zk.me/api/token/get';
const QUERY_URL = 'https://agw.zk.me/zkseradmin/openapi/queryKycInfoByAddress';

/** Maps zkMe's own status words to ours. Anything unknown stays "in progress", never "passed". */
export function mapZkmeStatus(raw: unknown): KycStatus {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'kyc passed') return 'passed';
  if (s === 'verification failed') return 'failed';
  if (s === '' || s === 'not started') return 'requested';
  return 'in_progress';
}

/** Thin client for zkMe. Only the two calls the portal and the withdraw flow need. */
@Injectable()
export class ZkmeService {
  private readonly logger = new Logger(ZkmeService.name);
  constructor(private readonly config: ConfigService) {}

  private get appId() { return this.config.get<string>('ZKME_APP_ID') ?? ''; }
  private get apiKey() { return this.config.get<string>('ZKME_API_KEY') ?? ''; }
  /** Optional: the zkMe program the checks belong to. zkMe uses the first active program when omitted. */
  private get programNo() { return this.config.get<string>('ZKME_PROGRAM_NO') ?? ''; }
  private get chainId() { return this.config.get<string>('ZKME_CHAIN_ID') ?? 'solana'; }

  isConfigured(): boolean {
    return Boolean(this.appId && this.apiKey);
  }

  private async post(url: string, body: unknown): Promise<any> {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`zkMe ${res.status}`);
    return res.json();
  }

  /**
   * Short-lived token the zkMe widget needs on the recipient's side. The API key never leaves the server.
   * Email login mode (apiModePermission 0), zkKYC level (lv 1).
   */
  async getAccessToken(): Promise<string> {
    if (!this.isConfigured()) throw new ServiceUnavailableException('Identity checks are not available right now.');
    try {
      const r = await this.post(TOKEN_URL, { appId: this.appId, apiKey: this.apiKey, apiModePermission: 0, lv: 1 });
      const token = r?.data?.accessToken;
      if (!token) throw new Error(`code ${r?.code}`);
      return token as string;
    } catch (e) {
      this.logger.error(`zkMe token failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Identity checks are not available right now.');
    }
  }

  /** What the widget on the recipient's page needs besides the token. Nothing secret. */
  widgetConfig() {
    return { app_id: this.appId, program_no: this.programNo || null, chain_id: this.chainId };
  }

  /** The check result for one person, found by the email they signed in with. Null when zkMe has no record or could not be reached. */
  async getStatusByEmail(email: string): Promise<KycStatus | null> {
    if (!this.isConfigured()) return null;
    try {
      const r = await this.post(QUERY_URL, {
        mchNo: this.appId,
        apiKey: this.apiKey,
        ...(this.programNo ? { programNo: this.programNo } : {}),
        account: email.trim().toLowerCase(),
        chainId: this.chainId,
      });
      if (!r || typeof r !== 'object' || !('kycStatus' in r)) return null;
      return mapZkmeStatus((r as { kycStatus?: unknown }).kycStatus);
    } catch (e) {
      this.logger.warn(`zkMe status failed: ${(e as Error).message}`);
      return null;
    }
  }
}
