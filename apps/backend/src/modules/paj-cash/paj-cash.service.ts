import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin fetch-based client for api.paj.cash — a Nigerian fiat on/off-ramp provider.
 * Hand-rolled rather than depending on the `paj_ramp` npm package: that package is ESM-only
 * against this backend's CommonJS build, ships test tooling (jest/ts-jest/tsx) as production
 * dependencies, and its bundled realtime socket helper hardcodes PAJ's staging URL even in
 * production use. We only need the raw HTTP surface, matching how RelayService/LifiService wrap
 * their providers.
 *
 * Two-tier auth: `apiKey` (business-level, header x-api-key) is used only for initiate/verify;
 * every other call uses a per-user `sessionToken` (Bearer) obtained from verify().
 */

export type PajRecipientType = 'email' | 'phone';
export type PajIdType = 'BVN' | 'NIN';
export type PajCountry = 'NG' | 'GH' | 'TZ' | 'KE' | 'ZA';
export type PajChain = 'SOLANA' | 'MONAD';
export type PajCurrency = 'NGN' | 'GHS' | 'TZS' | 'KES' | 'ZAR' | 'USD';
/** Documented values are INIT|PAID|COMPLETED; PAJ's own webhook example also references
 * FAILED/CANCELLED — treated as real but unconfirmed (see plan's open questions). */
export type PajTransactionStatus = 'INIT' | 'PAID' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string;
export type PajTransactionType = 'ON_RAMP' | 'OFF_RAMP';

export interface PajInitiateResponse {
  email?: string;
  phone?: string;
}

export interface PajVerifyResponse {
  recipient: string;
  isActive: string;
  expiresAt: string;
  token: string;
}

export interface PajBank {
  id: string;
  code: string;
  name: string;
  logo?: string;
  country: string;
}

export interface PajResolvedBankAccount {
  accountName: string;
  accountNumber: string;
  bank: { id: string; name: string; code: string; country: string };
}

export interface PajSavedBankAccount {
  id: string;
  accountName: string;
  accountNumber: string;
  bank: string;
  /** Abstracted Solana wallet address tied to this bank account — any USDC sent here is
   * automatically converted and paid out to the bank account on PAJ's side. */
  address?: string;
}

export interface PajRateInfo {
  baseCurrency: string;
  targetCurrency: string;
  isActive: boolean;
  rate: number;
  type: 'onRamp' | 'offRamp';
}

export interface PajRateResponse {
  onRampRate: PajRateInfo;
  offRampRate: PajRateInfo;
}

export interface PajValueQuote {
  amount: number;
  fiatAmount: number;
  mint: string;
  currency: string;
  rate: number;
  tokenRate?: number;
}

export interface PajOnrampOrder {
  id: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  fiatAmount: number;
  bank: string;
  rate: number;
  recipient: string;
  currency: string;
  mint: string;
  fee?: number;
}

export interface PajOfframpOrder {
  id: string;
  address: string;
  mint: string;
  currency: string;
  amount: number;
  fiatAmount: number;
  rate: number;
  fee?: number;
}

export interface PajTransaction {
  id: string;
  address?: string;
  signature?: string;
  mint: string;
  currency: string;
  amount: number;
  usdcAmount?: number;
  fiatAmount: number;
  recipient?: string;
  sender?: string;
  rate: number;
  status: PajTransactionStatus;
  transactionType: PajTransactionType;
  createdAt?: string;
  fee?: number;
}

/** Thrown when a PAJ call returns a non-2xx. Callers pattern-match `message`/`raw` for known cases
 * (e.g. KYC-required) since PAJ's API does not document a stable machine-readable error code. */
export class PajApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = 'PajApiError';
  }
}

const DEFAULT_BASE_URL = 'https://api.paj.cash';
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class PajCashService {
  private readonly logger = new Logger(PajCashService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('PAJ_CASH_BASE_URL', DEFAULT_BASE_URL);
  }

  private get apiKey(): string {
    const key = this.config.get<string>('PAJ_CASH_API_KEY', '');
    if (!key) this.logger.warn('PAJ_CASH_API_KEY not set — PAJ Cash calls will fail');
    return key;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try { json = JSON.parse(text); } catch { json = text; }
    }

    if (!res.ok) {
      const message = (json && typeof json === 'object' && 'message' in json)
        ? String((json as { message: unknown }).message)
        : `PAJ Cash request failed (${res.status})`;
      throw new PajApiError(message, res.status, json);
    }

    return json as T;
  }

  private bearer(sessionToken: string): Record<string, string> {
    return { Authorization: `Bearer ${sessionToken}` };
  }

  // ── Session ──────────────────────────────────────────────────────

  async initiate(recipient: string): Promise<PajInitiateResponse> {
    const isEmail = Number.isNaN(Number(recipient));
    return this.request<PajInitiateResponse>('POST', '/pub/initiate', {
      body: isEmail ? { email: recipient } : { phone: recipient },
      headers: { 'x-api-key': this.apiKey },
    });
  }

  async verify(
    recipient: string,
    otp: string,
    device: { uuid: string; device: string; os?: string; browser?: string; ip?: string },
  ): Promise<PajVerifyResponse> {
    const isEmail = Number.isNaN(Number(recipient));
    return this.request<PajVerifyResponse>('POST', '/pub/verify', {
      body: { ...(isEmail ? { email: recipient } : { phone: recipient }), otp, device },
      headers: { 'x-api-key': this.apiKey },
    });
  }

  // ── Rate / value ─────────────────────────────────────────────────

  /** v2: every call below authenticates with the business API key only (no per-user session). */
  private get keyHeaders(): Record<string, string> {
    return { 'x-api-key': this.apiKey };
  }

  async getRate(currency: PajCurrency = 'NGN'): Promise<PajRateResponse> {
    return this.request('GET', `/pub/v2/rate?currency=${currency}`, { headers: this.keyHeaders });
  }

  /** v2 has no quote endpoint; derive from the offramp rate (USDC ~ USD). */
  async getOfframpValue(_sessionToken: string | null, tokenAmount: number, mint: string, currency: string): Promise<PajValueQuote> {
    const { offRampRate } = await this.getRate(currency as PajCurrency);
    return {
      amount: tokenAmount,
      fiatAmount: Math.round(tokenAmount * offRampRate.rate * 100) / 100,
      mint,
      currency,
      rate: offRampRate.rate,
    };
  }

  // ── Banks ────────────────────────────────────────────────────────

  /** v2 register is idempotent and confirms the account with the provider, so it doubles as "confirm". */
  async registerBankAccount(bankCode: string, accountNumber: string): Promise<PajSavedBankAccount> {
    return this.request<PajSavedBankAccount>('POST', '/pub/v2/bank-account', {
      body: { bankCode, accountNumber },
      headers: this.keyHeaders,
    });
  }

  // ── KYC ──────────────────────────────────────────────────────────

  async submitKyc(sessionToken: string, idNumber: string, idType: PajIdType, country: PajCountry): Promise<{ message: string }> {
    return this.request<{ message: string }>('POST', '/pub/kyc', {
      body: { idNumber, idType, country },
      headers: this.bearer(sessionToken),
    });
  }

  // ── Orders ───────────────────────────────────────────────────────

  async createOnramp(sessionToken: string, params: {
    fiatAmount?: number;
    amount?: number;
    currency: PajCurrency;
    recipient: string;
    mint: string;
    chain: PajChain;
  }): Promise<PajOnrampOrder> {
    return this.request<PajOnrampOrder>('POST', '/pub/onramp', {
      body: params,
      headers: this.bearer(sessionToken),
    });
  }

  async createOfframp(params: {
    bankCode: string;
    accountNumber: string;
    currency: PajCurrency;
    fiatAmount?: number;
    amount?: number;
    mint: string;
    chain: PajChain;
    description?: string;
    customerId?: string;
  }): Promise<PajOfframpOrder> {
    return this.request<PajOfframpOrder>('POST', '/pub/v2/offramp', {
      body: params,
      headers: this.keyHeaders,
    });
  }

  // ── Transactions ─────────────────────────────────────────────────

  async getTransaction(id: string): Promise<PajTransaction> {
    return this.request<PajTransaction>('GET', `/pub/v2/transaction/${encodeURIComponent(id)}`, { headers: this.keyHeaders });
  }
}
