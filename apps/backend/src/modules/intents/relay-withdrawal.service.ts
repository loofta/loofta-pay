import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { quoteAtaRentRecoveryUsdc } from '@/common/ata-rent-recovery';

/**
 * Gasless USDC (Solana) -> ETH / USDG on Robinhood Chain, routed through Relay (relay.link).
 *
 * Why this is safe for the sponsor: we use Relay's DEPOSIT ADDRESS mode, so the user's transaction
 * is just a plain USDC transfer to a one-time address Relay issued. Relay's own instruction list
 * for that deposit is only the Associated Token + SPL Token programs, both already in
 * ALLOWED_SPONSOR_PROGRAMS, so no program whitelist is widened and the sponsor never signs
 * anything shaped by Relay. The order is persisted in near_intents_withdrawal_orders BEFORE the
 * user signs, so assertAtaCreationsAllowed binds the sponsored ATA to this exact deposit address
 * and the caller, identical to the NEAR Intents flow.
 *
 * The USDC fee (sponsor SOL + deposit-address ATA rent, plus a small margin) is stored on the
 * order as fee_usdc; the sponsor refuses to broadcast a transaction that does not pay it to the
 * fee payer. The client cannot choose the destination token contract: only the allowlist below.
 */

const RELAY_API = 'https://api.relay.link';
const SOLANA_CHAIN_ID = 792703809;
const SOL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PREVIEW_RECIPIENT = '0x000000000000000000000000000000000000dEaD';
/** Any valid Solana address works for a non-persisting preview quote (no deposit address issued). */
const PREVIEW_SOLANA_USER = '7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5';

/** Hard floor so the fixed per-transfer cost never dominates a tiny withdrawal. */
export const RELAY_MIN_WITHDRAW_USDC = 2;

/**
 * Only these destinations are routable. The USDG address is Relay's verified Global Dollar on
 * Robinhood Chain; Relay's catalog also lists several look-alike "USDG" tokens, so matching by
 * symbol is never acceptable.
 */
export const RELAY_WITHDRAW_ASSETS = {
  'robinhood:eth': {
    chainId: 4663,
    chain: 'robinhood',
    symbol: 'ETH',
    address: '0x0000000000000000000000000000000000000000',
    decimals: 18,
  },
  'robinhood:usdg': {
    chainId: 4663,
    chain: 'robinhood',
    symbol: 'USDG',
    address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    decimals: 6,
  },
} as const;

export type RelayAssetKey = keyof typeof RELAY_WITHDRAW_ASSETS;

export function isRelayAssetKey(k: unknown): k is RelayAssetKey {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(RELAY_WITHDRAW_ASSETS, k);
}

export interface RelayWithdrawQuote {
  requestId: string | null;
  depositAddress: string | null;
  amountOutFormatted: string | null;
  /** USDC the user pays on top of the amount, to cover the sponsor's costs. */
  feeUsdc: number;
  expiresInSec: number | null;
}

@Injectable()
export class RelayWithdrawalService {
  private readonly logger = new Logger(RelayWithdrawalService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  private headers(): Record<string, string> {
    const key = this.config.get<string>('RELAY_API_KEY', '');
    return { 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}) };
  }

  /**
   * USDC fee the user pays on top of the amount: recovery of the one new token account the
   * sponsor creates for Relay's deposit address (rent + 1.25x buffer, priced at the live SOL
   * price) plus a margin in basis points of the amount (RELAY_WITHDRAW_FEE_BPS, default 25).
   * Rounded UP to 6dp so the on-chain check can never come out a unit short of what the client
   * was told to pay.
   */
  async computeFeeUsdc(amountUsdc: number): Promise<number> {
    const rent = await quoteAtaRentRecoveryUsdc(1);
    const bps = Number(this.config.get<string>('RELAY_WITHDRAW_FEE_BPS', '25'));
    const margin = (amountUsdc * (Number.isFinite(bps) && bps >= 0 ? bps : 25)) / 10_000;
    return Math.ceil((rent.totalUsdc + margin) * 1e6) / 1e6;
  }

  private async fetchQuote(opts: {
    assetKey: RelayAssetKey;
    amountUsdc: number;
    recipient: string;
    refundTo: string;
    useDepositAddress: boolean;
  }) {
    const asset = RELAY_WITHDRAW_ASSETS[opts.assetKey];
    const body: Record<string, unknown> = {
      user: opts.refundTo,
      recipient: opts.recipient,
      originChainId: SOLANA_CHAIN_ID,
      destinationChainId: asset.chainId,
      originCurrency: SOL_USDC_MINT,
      destinationCurrency: asset.address,
      amount: String(Math.round(opts.amountUsdc * 1e6)),
      tradeType: 'EXACT_INPUT',
      refundTo: opts.refundTo,
    };
    if (opts.useDepositAddress) body.useDepositAddress = true;
    const res = await fetch(`${RELAY_API}/quote/v2`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      this.logger.warn(`Relay quote failed (${res.status}): ${json?.message ?? 'unknown'}`);
      throw new Error(json?.message ? `Relay: ${json.message}` : 'Relay could not quote this route right now.');
    }
    const depositStep = (json.steps ?? []).find((s: any) => s?.depositAddress);
    return {
      requestId: (depositStep?.requestId ?? json.requestId ?? null) as string | null,
      depositAddress: (depositStep?.depositAddress ?? null) as string | null,
      amountOutFormatted: (json.details?.currencyOut?.amountFormatted ?? null) as string | null,
    };
  }

  /** Non-persisting preview used while the user types an amount. Never issues a deposit address. */
  async preview(assetKey: RelayAssetKey, amountUsdc: number): Promise<RelayWithdrawQuote> {
    this.assertAmount(amountUsdc);
    const q = await this.fetchQuote({
      assetKey,
      amountUsdc,
      recipient: PREVIEW_RECIPIENT,
      refundTo: PREVIEW_SOLANA_USER,
      useDepositAddress: false,
    });
    return {
      requestId: null,
      depositAddress: null,
      amountOutFormatted: q.amountOutFormatted,
      feeUsdc: await this.computeFeeUsdc(amountUsdc),
      expiresInSec: null,
    };
  }

  private assertAmount(amountUsdc: number) {
    if (!Number.isFinite(amountUsdc) || amountUsdc < RELAY_MIN_WITHDRAW_USDC) {
      throw new Error(`Minimum withdrawal to this network is $${RELAY_MIN_WITHDRAW_USDC}.`);
    }
  }

  /** Quote with a real deposit address and persist it BEFORE the user signs anything. */
  async createOrder(params: {
    userId: string;
    assetKey: RelayAssetKey;
    amountUsdc: number;
    destinationAddress: string;
    refundAddress: string;
  }): Promise<{
    id: string;
    depositAddress: string;
    requestId: string;
    feeUsdc: number;
    amountOutFormatted: string | null;
  }> {
    const { userId, assetKey, amountUsdc, destinationAddress, refundAddress } = params;
    this.assertAmount(amountUsdc);
    if (!/^0x[a-fA-F0-9]{40}$/.test(destinationAddress) || /^0x0{40}$/i.test(destinationAddress)) {
      throw new Error('Enter a valid Robinhood Chain (EVM) address.');
    }
    try {
      new PublicKey(refundAddress);
    } catch {
      throw new Error('Invalid refund address.');
    }

    const asset = RELAY_WITHDRAW_ASSETS[assetKey];
    const q = await this.fetchQuote({
      assetKey,
      amountUsdc,
      recipient: destinationAddress,
      refundTo: refundAddress,
      useDepositAddress: true,
    });
    if (!q.depositAddress || !q.requestId) {
      throw new Error('Relay did not return a deposit address for this route.');
    }
    // The sponsor binds the ATA owner to this string, so it must be a real Solana address.
    try {
      new PublicKey(q.depositAddress);
    } catch {
      throw new Error('Relay returned an invalid deposit address.');
    }

    const feeUsdc = await this.computeFeeUsdc(amountUsdc);
    const { data, error } = await this.supabase.nearIntentsWithdrawalOrders
      .insert({
        user_id: userId,
        from_token_id: SOL_USDC_MINT,
        from_chain: 'solana',
        to_token_id: `relay:${assetKey}`,
        to_chain: asset.chain,
        amount_usdc: amountUsdc,
        destination_address: destinationAddress,
        deposit_address: q.depositAddress,
        quote_id: q.requestId,
        provider: 'relay',
        provider_request_id: q.requestId,
        fee_usdc: feeUsdc,
        is_devnet: false,
      })
      .select('id')
      .single();
    if (error || !data) {
      this.logger.error(`createOrder: failed to persist: ${error?.message ?? 'no row'}`);
      throw new Error('Failed to create withdrawal order');
    }
    this.logger.log(`Relay withdrawal order ${data.id} user=${userId} ${assetKey} $${amountUsdc} fee=$${feeUsdc}`);
    return {
      id: data.id as string,
      depositAddress: q.depositAddress,
      requestId: q.requestId,
      feeUsdc,
      amountOutFormatted: q.amountOutFormatted,
    };
  }

  /** The Relay requestId for a deposit address, or null when it is not a Relay order. */
  async findRequestIdByDepositAddress(depositAddress: string): Promise<string | null> {
    const { data } = await this.supabase.nearIntentsWithdrawalOrders
      .select('provider_request_id')
      .eq('deposit_address', depositAddress)
      .eq('provider', 'relay')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.provider_request_id as string | undefined) ?? null;
  }

  /** Relay status mapped onto the SUCCESS / REFUNDED / FAILED / PENDING vocabulary the UI uses. */
  async getStatus(requestId: string): Promise<{ status: string; txHash?: string; raw: any }> {
    const res = await fetch(`${RELAY_API}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, {
      headers: this.headers(),
    });
    const raw: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(raw?.message ?? `Relay status ${res.status}`);
    const s = String(raw?.status ?? '').toLowerCase();
    let status = 'PENDING';
    if (s === 'success') status = 'SUCCESS';
    else if (s === 'refunded' || s === 'refund') status = 'REFUNDED';
    else if (s === 'failure') status = 'FAILED';
    else if (s === 'pending' || s === 'submitted' || s === 'delayed') status = 'PROCESSING';
    return { status, txHash: raw?.txHashes?.[0], raw };
  }
}
