import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper around Collectorcrypt's Gacha API (https://docs.collectorcrypt.com/gacha/api).
 * Same fetch-based request<T> shape as PajCashService (apps/backend/src/modules/paj-cash/
 * paj-cash.service.ts) — this codebase's existing convention for a third-party HTTP integration,
 * no axios/@nestjs/axios dependency needed.
 *
 * Every endpoint below except `packStatus`/`buybackCheck` is now verified against real
 * dev-gacha.collectorcrypt.com calls (2026-08) — worth internalizing the pattern: this API's field
 * names are NOT consistent across endpoints, so pattern-matching one endpoint's shape onto another
 * has repeatedly been wrong. Specifics:
 * - `generatePack`: requires `playerAddress` (not `altPlayerAddress` — that one is for
 *   redirecting the card to a DIFFERENT wallet than the payer); response is `{ memo, transaction }`.
 * - `openPack`: response is NOT the `{status, nft, signature, rarity}` the docs prose describes —
 *   it's `{success, transactionSignature, nft_address, nftWon: {id, rarity, content: {links,
 *   metadata}}}`. Never observed `waiting_for_webhook` in testing (devnet resolved synchronously
 *   on the first poll) but the polling loop keeps it as a pending signal just in case.
 * - `submitTransaction`: body field is `signedTransaction`, NOT `transaction`; response is
 *   `{ success, signature, confirmationStatus }`.
 * - `buyback/available` (GET): query really is `nft`/`wallet` as docs describe, but the response
 *   field is `amount` (a number), not `amountUnits`.
 * - `buyback` (POST): body fields are `nftAddress`/`playerAddress`, NOT `nft`/`wallet` (sending
 *   `wallet` gets misread as the optional `altRecipient` field and 400s); response is
 *   `{ success, serializedTransaction, refundAmount, memo }`, not `{ transaction,
 *   refundAmountUnits }`.
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

export interface NftCardAttribute {
  trait_type: string;
  value: string;
}

export interface NftMetadata {
  mint?: string;
  name?: string;
  /** Front (recto) — the real card scan, confirmed live under nftWon.content.links.image. */
  image?: string;
  /** Back (verso) — the real card scan, pulled from nftWon.content.files (front/back pair; see
   *  OpenPackResponse's comment). Both are the actual Collector Crypt scans, never Loofta-branded
   *  artwork — GachaCard renders these edge-to-edge via its faceImage/backImage props specifically
   *  to skip the branded-frame treatment `image` alone would otherwise get. */
  backImage?: string;
  insuredValueUsdc?: number;
  /** Full grading/set/serial attribute list straight from Collector Crypt — used to drive the
   *  line-by-line stat reveal next to the card (CardAttributesPanel.tsx on the frontend). */
  attributes?: NftCardAttribute[];
  [key: string]: unknown; // pass-through — unverified full shape, don't drop fields we don't model yet
}

export type PackRarityTier = 'epic' | 'rare' | 'uncommon' | 'common';

/** Real shape confirmed live (2026-08) — the docs prose describes a `{status, nft, signature,
 *  rarity}` shape, but an actual dev-gacha.collectorcrypt.com call returns this instead:
 *  `{success, transactionSignature, nft_address, nftWon: {id, rarity, content: {links: {image},
 *  metadata: {name, insuredValue, ...}}}}`. Devnet returned `success: true` synchronously on the
 *  very first poll in testing — never observed the docs' `waiting_for_webhook` pending state, but
 *  `status` is kept as an optional escape hatch in case mainnet (or a slow devnet response) still
 *  uses it. `nftWon.rarity` comes back capitalized ("Common") — normalize before use. */
export interface OpenPackResponse {
  success?: boolean;
  transactionSignature?: string;
  nft_address?: string;
  nftWon?: {
    id?: string;
    rarity?: string; // capitalized, e.g. "Common" — lowercase before treating as PackRarityTier
    points?: number;
    content?: {
      links?: { image?: string };
      /** Front/back scan pair — confirmed live as exactly 2 entries, `uri` containing `/front/`
       *  or `/back/` respectively (there's no explicit "side" field, so match on the URL path). */
      files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>;
      metadata?: { name?: string; insuredValue?: string; attributes?: NftCardAttribute[]; [key: string]: unknown };
    };
    [key: string]: unknown;
  };
  status?: 'waiting_for_webhook' | string;
}

/** Real shape confirmed live (2026-08): `amount`, not `amountUnits`, and it's a NUMBER (base
 *  units, 6 decimals) not a string — sending it through `Number(avail.amountUnits)` (the old
 *  wrong field) silently produced NaN, which made every buyback-path settlement's payout amount
 *  NaN too. Absent entirely when `available: false`. */
export interface BuybackAvailableResponse {
  available: boolean;
  amount?: number;
}

/** Real shape confirmed live (2026-08) — `serializedTransaction`, not `transaction`, and
 *  `refundAmount` (a number), not `refundAmountUnits`. */
export interface BuybackResponse {
  success?: boolean;
  serializedTransaction: string; // base64-encoded, unsigned (player-signature-required) transaction
  refundAmount: number;
  memo: string;
}

export interface SubmitTransactionResponse {
  success: boolean;
  signature: string;
  confirmationStatus: 'confirmed' | 'finalized' | 'submitted' | string;
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
    // Confirmed empirically: dev-gacha.collectorcrypt.com accepts requests with no x-api-key at
    // all (there's no documented signup flow for a devnet key). Only warn on mainnet, where a
    // missing key is actually expected to fail.
    if (!key && !this.isDevnet) this.logger.warn('COLLECTORCRYPT_API_KEY not set — Gacha calls will fail');
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

  /** Creates a single pack purchase transaction — treasury signs + submits it, never a user.
   *  `playerAddress` is required (confirmed live — a request without it 400s with "Invalid
   *  request body", no more detail than that); it's the treasury's own address here, since the
   *  treasury is the sole Collectorcrypt "player" for every room (see plan doc). */
  async generatePack(packType: CollectorCryptPackType, playerAddress: string): Promise<GeneratePackResponse> {
    return this.request<GeneratePackResponse>('POST', '/api/generatePack', { body: { packType, playerAddress } });
  }

  /** Opens a purchased pack. May come back `waiting_for_webhook` — caller must poll packStatus. */
  async openPack(memo: string): Promise<OpenPackResponse> {
    return this.request<OpenPackResponse>('POST', '/api/openPack', { body: { memo } });
  }

  async buybackAvailable(nftMint: string, wallet?: string): Promise<BuybackAvailableResponse> {
    return this.request<BuybackAvailableResponse>('GET', '/api/buyback/available', { query: { nft: nftMint, wallet } });
  }

  /** Sells the NFT back for USDC — treasury signs + submits it. Must be within the 72h window.
   *  Body fields are `nftAddress`/`playerAddress`, NOT `nft`/`wallet` (that pair 400s with
   *  "Invalid altRecipient address" — `wallet` gets mistaken for the OPTIONAL `altRecipient`
   *  field, confirmed live) — a different naming pattern than buybackAvailable's GET query,
   *  which really does use `nft`/`wallet`. */
  async buyback(nftMint: string, wallet: string): Promise<BuybackResponse> {
    return this.request<BuybackResponse>('POST', '/api/buyback', { body: { nftAddress: nftMint, playerAddress: wallet } });
  }

  async buybackCheck(memo: string): Promise<{ status: 'complete' | 'pending'; [key: string]: unknown }> {
    return this.request('GET', '/api/buyback/check', { query: { memo } });
  }

  /** Body field is `signedTransaction`, not `transaction` — confirmed live: sending it as
   *  `transaction` 400s with "Missing signed transaction". */
  async submitTransaction(signedTransactionBase64: string): Promise<SubmitTransactionResponse> {
    return this.request<SubmitTransactionResponse>('POST', '/api/submitTransaction', {
      body: { signedTransaction: signedTransactionBase64 },
    });
  }

  async packStatus(memo: string): Promise<PackStatusResponse> {
    return this.request<PackStatusResponse>('GET', '/api/pack/status', { query: { memo } });
  }
}
