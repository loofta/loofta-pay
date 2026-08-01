import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper around Collectorcrypt's Gacha API (https://docs.collectorcrypt.com/gacha/api).
 * Same fetch-based request<T> shape as PajCashService (apps/backend/src/modules/paj-cash/
 * paj-cash.service.ts) — this codebase's existing convention for a third-party HTTP integration,
 * no axios/@nestjs/axios dependency needed.
 *
 * IMPORTANT: the field names on the response types below are inferred from Collectorcrypt's docs
 * PROSE (no raw example JSON was available while writing this), not verified against a live
 * response. Confirm every field actually used against a real `dev-gacha.collectorcrypt.com` call
 * before trusting this in production — treat these types as a best-effort starting point, not
 * ground truth.
 */

export class CollectorCryptApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = 'CollectorCryptApiError';
  }
}

export type CollectorCryptPackType = 'pokemon_50' | 'pokemon_250';

export interface GeneratePackResponse {
  memo: string;
  transaction: string; // base64-encoded, unsigned (player-signature-required) transaction
}

export interface NftMetadata {
  mint?: string;
  name?: string;
  image?: string;
  insuredValueUsdc?: number;
  [key: string]: unknown; // pass-through — unverified full shape, don't drop fields we don't model yet
}

export type PackRarityTier = 'epic' | 'rare' | 'uncommon' | 'common';

export interface OpenPackResponse {
  status: 'success' | 'waiting_for_webhook' | 'already_opened';
  nft?: NftMetadata;
  signature?: string;
  rarity?: PackRarityTier;
  rollValue?: number;
  buybackAmountUnits?: string; // turbo-mode only; USDC base units (6 decimals), as a string
}

export interface BuybackAvailableResponse {
  available: boolean;
  amountUnits: string; // USDC base units (6 decimals), as a string
}

export interface BuybackResponse {
  transaction: string; // base64-encoded, unsigned (player-signature-required) transaction
  refundAmountUnits: string;
  memo: string;
}

export interface SubmitTransactionResponse {
  signature: string;
  status: 'confirmed' | 'finalized' | 'submitted';
}

export interface PackStatusResponse {
  memo: string;
  status: string;
  [key: string]: unknown;
}

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAINNET_BASE_URL = 'https://gacha.collectorcrypt.com';
const DEFAULT_DEVNET_BASE_URL = 'https://dev-gacha.collectorcrypt.com';

@Injectable()
export class CollectorCryptClient {
  private readonly logger = new Logger(CollectorCryptClient.name);

  constructor(private readonly config: ConfigService) {}

  private get isDevnet(): boolean {
    return this.config.get<string>('COLLECTORCRYPT_ENV', 'devnet') !== 'mainnet';
  }

  private get baseUrl(): string {
    const override = this.config.get<string>('COLLECTORCRYPT_API_URL');
    if (override) return override;
    return this.isDevnet ? DEFAULT_DEVNET_BASE_URL : DEFAULT_MAINNET_BASE_URL;
  }

  private get apiKey(): string {
    const key = this.config.get<string>('COLLECTORCRYPT_API_KEY', '');
    if (!key) this.logger.warn('COLLECTORCRYPT_API_KEY not set — Gacha calls will fail');
    return key;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const res = await fetch(url.toString(), {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await res.text();
    let json: unknown;
    if (text) {
      try { json = JSON.parse(text); } catch { json = text; }
    }

    if (!res.ok) {
      const message = (json && typeof json === 'object' && 'message' in json)
        ? String((json as { message: unknown }).message)
        : `Collectorcrypt request failed (${res.status})`;
      throw new CollectorCryptApiError(message, res.status, json);
    }

    return json as T;
  }

  /** Creates a single pack purchase transaction — treasury signs + submits it, never a user. */
  async generatePack(packType: CollectorCryptPackType): Promise<GeneratePackResponse> {
    return this.request<GeneratePackResponse>('POST', '/api/generatePack', { body: { packType } });
  }

  /** Opens a purchased pack. May come back `waiting_for_webhook` — caller must poll packStatus. */
  async openPack(memo: string): Promise<OpenPackResponse> {
    return this.request<OpenPackResponse>('POST', '/api/openPack', { body: { memo } });
  }

  async buybackAvailable(nftMint: string, wallet?: string): Promise<BuybackAvailableResponse> {
    return this.request<BuybackAvailableResponse>('GET', '/api/buyback/available', { query: { nft: nftMint, wallet } });
  }

  /** Sells the NFT back for USDC — treasury signs + submits it. Must be within the 72h window. */
  async buyback(nftMint: string, wallet: string): Promise<BuybackResponse> {
    return this.request<BuybackResponse>('POST', '/api/buyback', { body: { nft: nftMint, wallet } });
  }

  async buybackCheck(memo: string): Promise<{ status: 'complete' | 'pending'; [key: string]: unknown }> {
    return this.request('GET', '/api/buyback/check', { query: { memo } });
  }

  async submitTransaction(signedTransactionBase64: string): Promise<SubmitTransactionResponse> {
    return this.request<SubmitTransactionResponse>('POST', '/api/submitTransaction', {
      body: { transaction: signedTransactionBase64 },
    });
  }

  async packStatus(memo: string): Promise<PackStatusResponse> {
    return this.request<PackStatusResponse>('GET', '/api/pack/status', { query: { memo } });
  }
}
