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

  async getRate(): Promise<PajRateResponse> {
    return this.request('GET', '/pub/rate');
  }

  async getOnrampValue(sessionToken: string, fiatAmount: number, mint: string, currency: string): Promise<PajValueQuote> {
    const qs = new URLSearchParams({ amount: String(fiatAmount), mint, currency });
    return this.request<PajValueQuote>('GET', `/pub/rates/onramp-value?${qs}`, { headers: this.bearer(sessionToken) });
  }

  async getOfframpValue(sessionToken: string, tokenAmount: number, mint: string, currency: string): Promise<PajValueQuote> {
    const qs = new URLSearchParams({ amount: String(tokenAmount), mint, currency });
    return this.request<PajValueQuote>('GET', `/pub/rates/offramp-value?${qs}`, { headers: this.bearer(sessionToken) });
  }

  // ── Banks ────────────────────────────────────────────────────────

  async getBanks(sessionToken: string): Promise<PajBank[]> {
    return this.request<PajBank[]>('GET', '/pub/bank', { headers: this.bearer(sessionToken) });
  }

  async confirmBankAccount(sessionToken: string, bankId: string, accountNumber: string): Promise<PajResolvedBankAccount> {
    const qs = new URLSearchParams({ bankId, accountNumber });
    return this.request<PajResolvedBankAccount>('GET', `/pub/bank-account/confirm?${qs}`, { headers: this.bearer(sessionToken) });
  }

  async saveBankAccount(sessionToken: string, bankId: string, accountNumber: string): Promise<PajSavedBankAccount> {
    return this.request<PajSavedBankAccount>('POST', '/pub/bank-account', {
      body: { bankId, accountNumber },
      headers: this.bearer(sessionToken),
    });
  }

  async getSavedBankAccounts(sessionToken: string): Promise<PajSavedBankAccount[]> {
    return this.request<PajSavedBankAccount[]>('GET', '/pub/bank-account', { headers: this.bearer(sessionToken) });
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

  async createOfframp(sessionToken: string, params: {
    bank: string;
    accountNumber: string;
    currency: PajCurrency;
    fiatAmount?: number;
    amount?: number;
    mint: string;
    chain: PajChain;
    description?: string;
  }): Promise<PajOfframpOrder> {
    return this.request<PajOfframpOrder>('POST', '/pub/offramp', {
      body: params,
      headers: this.bearer(sessionToken),
    });
  }

  // ── Transactions ─────────────────────────────────────────────────

  async getTransaction(sessionToken: string, id: string): Promise<PajTransaction> {
    return this.request<PajTransaction>('GET', `/pub/transactions/${encodeURIComponent(id)}`, { headers: this.bearer(sessionToken) });
  }

  async getAllTransactions(sessionToken: string): Promise<PajTransaction[]> {
    return this.request<PajTransaction[]>('GET', '/pub/transactions', { headers: this.bearer(sessionToken) });
  }
}
