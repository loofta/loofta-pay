import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OneClickService, QuoteRequest, OpenAPI } from '@defuse-protocol/one-click-sdk-typescript';

export interface NearToken {
  symbol: string;
  name: string;
  chain: string;
  address: string;
  tokenId?: string;
  decimals: number;
  logoURI?: string;
  price?: number;
  priceUpdatedAt?: string;
}

export interface QuoteResult {
  depositAddress?: string;
  memo?: string | null;
  deadline?: string;
  timeEstimate?: number;
  quoteId?: string;
  minAmountIn?: string;
  minAmountInFormatted?: string;
  amountOut?: string;
  amountOutFormatted?: string;
  raw?: any;
  error?: {
    type: 'client' | 'server' | 'network' | 'unknown';
    status?: number;
    message?: string;
  };
}

// Refund addresses by chain
const REFUND_ADDRESSES: Record<string, string> = {
  eth: '0x0000000000000000000000000000000000000000',
  ethereum: '0x0000000000000000000000000000000000000000',
  base: '0x0000000000000000000000000000000000000000',
  arb: '0x0000000000000000000000000000000000000000',
  arbitrum: '0x0000000000000000000000000000000000000000',
  op: '0x0000000000000000000000000000000000000000',
  optimism: '0x0000000000000000000000000000000000000000',
  polygon: '0x0000000000000000000000000000000000000000',
  pol: '0x0000000000000000000000000000000000000000',
  bsc: '0x0000000000000000000000000000000000000000',
  avax: '0x0000000000000000000000000000000000000000',
  near: 'system.near',
  sol: '11111111111111111111111111111111',
  solana: '11111111111111111111111111111111',
};

@Injectable()
export class NearIntentsService implements OnModuleInit {
  private readonly logger = new Logger(NearIntentsService.name);
  private readonly referralCode: string;
  private readonly appFeeBps: number;
  private readonly appFeeRecipient: string | undefined;
  private tokensCache: NearToken[] = [];
  private tokensCacheExpiry = 0;

  constructor(private readonly configService: ConfigService) {
    this.referralCode = this.configService.get<string>('ONECLICK_REFERRAL', 'loofta');
    this.appFeeBps = Number(this.configService.get<string>('APP_FEE_BPS', '0')) || 0;
    this.appFeeRecipient = this.configService.get<string>('APP_FEE_RECIPIENT');
  }

  onModuleInit() {
    const apiBase = this.configService.get<string>(
      'ONECLICK_API_BASE',
      'https://1click.chaindefuser.com',
    );
    const jwt = this.configService.get<string>('ONECLICK_JWT');

    OpenAPI.BASE = apiBase;
    if (jwt) {
      OpenAPI.TOKEN = jwt;
    }

    this.logger.log(`Near Intents SDK initialized with base: ${apiBase}`);
  }

  /**
   * Add app fees to request if configured
   */
  private attachAppFees(req: any): any {
    if (
      this.appFeeRecipient &&
      Number.isFinite(this.appFeeBps) &&
      this.appFeeBps >= 0 &&
      this.appFeeBps <= 10000
    ) {
      req.appFees = [{ recipient: this.appFeeRecipient, fee: this.appFeeBps }];
    }
    return req;
  }

  /**
   * Get refund address for a chain
   */
  getRefundAddress(chain: string): string {
    const key = String(chain || '').toLowerCase();
    return REFUND_ADDRESSES[key] || '0x0000000000000000000000000000000000000000';
  }

  /**
   * Fetch all available tokens
   */
  async getTokens(): Promise<NearToken[]> {
    // Check cache
    if (this.tokensCache.length > 0 && Date.now() < this.tokensCacheExpiry) {
      return this.tokensCache;
    }

    try {
      const response: any = await OneClickService.getTokens();
      const arr = Array.isArray(response) ? response : (response?.tokens || []);

      const tokens = arr.map((t: any) => this.mapSdkToken(t)).filter(
        (t: NearToken) => t.symbol && t.tokenId && t.chain,
      );

      // Cache for 5 minutes
      this.tokensCache = tokens;
      this.tokensCacheExpiry = Date.now() + 5 * 60 * 1000;

      return tokens;
    } catch (error) {
      this.logger.error('Failed to fetch tokens:', error);
      return this.tokensCache; // Return stale cache on error
    }
  }

  /**
   * Search tokens by query
   */
  async searchTokens(query: string): Promise<NearToken[]> {
    const tokens = await this.getTokens();
    const q = (query || '').trim().toLowerCase();

    if (!q) return tokens;

    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.chain.toLowerCase().includes(q),
    );
  }

  /**
   * Get Defuse asset ID for a token
   */
  async getDefuseAssetId(symbol: string, chain: string): Promise<string> {
    const tokens = await this.getTokens();
    const sym = symbol.toUpperCase();
    const ch = chain.toLowerCase();

    const token = tokens.find(
      (t) =>
        t.symbol.toUpperCase() === sym &&
        t.chain.toLowerCase() === ch,
    );

    if (token?.tokenId) {
      return token.tokenId;
    }

    // Fallback: construct common patterns
    if (sym === 'ETH') {
      if (ch === 'eth' || ch === 'ethereum') return 'nep141:eth.omft.near';
      if (ch === 'arb' || ch === 'arbitrum') return 'nep141:arb.omft.near';
      if (ch === 'base') return 'nep141:base.omft.near';
      if (ch === 'op' || ch === 'optimism') return 'nep141:op.omft.near';
      return `nep141:${ch}.omft.near`;
    }

    this.logger.warn(`Could not find asset ID for ${symbol} on ${chain}`);
    return `nep141:${ch}.omft.near`;
  }

  /**
   * Get token price
   */
  async getTokenPrice(symbol: string, chain: string): Promise<number | undefined> {
    const tokens = await this.getTokens();
    const token = tokens.find(
      (t) =>
        t.symbol.toUpperCase() === symbol.toUpperCase() &&
        t.chain.toLowerCase() === chain.toLowerCase(),
    );
    return token?.price;
  }

  /**
   * Get token decimals
   */
  async getTokenDecimals(symbol: string, chain: string): Promise<number> {
    const tokens = await this.getTokens();
    const token = tokens.find(
      (t) =>
        t.symbol.toUpperCase() === symbol.toUpperCase() &&
        t.chain.toLowerCase() === chain.toLowerCase(),
    );
    return token?.decimals ?? 18;
  }

  /**
   * Get dry quote (for estimation)
   */
  async getDryQuote(params: {
    fromToken: { tokenId: string; chain: string; decimals: number };
    toToken: { tokenId: string; chain: string; decimals: number };
    amount: string;
    slippageBps?: number;
  }): Promise<QuoteResult> {
    const { fromToken, toToken, amount, slippageBps = 100 } = params;

    const toAtomic = (val: string, decimals: number): string => {
      const [i, f = ''] = String(val).split('.');
      const cleanF = f.replace(/\D/g, '').slice(0, Math.max(0, decimals));
      const padded = (i.replace(/\D/g, '') || '0') + cleanF.padEnd(decimals, '0');
      return BigInt(padded).toString();
    };

    const atomicIn = toAtomic(amount, fromToken.decimals);

    try {
      const req = this.attachAppFees({
        dry: true,
        swapType: QuoteRequest.swapType.EXACT_INPUT,
        slippageTolerance: slippageBps,
        originAsset: fromToken.tokenId,
        depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
        destinationAsset: toToken.tokenId,
        amount: atomicIn,
        refundTo: this.getRefundAddress(fromToken.chain),
        refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
        recipient: this.getRefundAddress(toToken.chain),
        recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
        deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        quoteWaitingTimeMs: 3000,
        referral: this.referralCode,
      });

      const raw = await OneClickService.getQuote(req as any);
      const q = (raw as any)?.quote || raw;

      const amountOut = q?.amountOutFormatted
        ? String(q.amountOutFormatted)
        : typeof q?.amountOut === 'string' && toToken.decimals != null
          ? (Number(q.amountOut) / Math.pow(10, toToken.decimals)).toString()
          : undefined;

      return { raw, amountOut, amountOutFormatted: amountOut };
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      const message = error?.body?.message || error?.message;
      let type: 'client' | 'server' | 'network' | 'unknown' = 'unknown';

      if (typeof status === 'number') {
        if (status >= 400 && status < 500) type = 'client';
        else if (status >= 500) type = 'server';
      } else if (message?.toLowerCase().includes('network')) {
        type = 'network';
      }

      return { error: { type, status, message } };
    }
  }

  /**
   * Get deposit quote (non-dry)
   */
  async getDepositQuote(params: {
    fromToken: { tokenId: string; chain: string; symbol: string; decimals: number };
    toToken: { tokenId: string; chain: string; symbol: string; decimals: number };
    amountIn: string;
    recipient: string;
    refundAddress?: string;
    useIntentsMode?: boolean;
    referral?: string;
  }): Promise<QuoteResult> {
    const {
      fromToken,
      toToken,
      amountIn,
      recipient,
      refundAddress,
      useIntentsMode = false,
      referral,
    } = params;

    const toAtomic = (val: string, decimals: number): string => {
      const [i, f = ''] = String(val).split('.');
      const cleanF = f.replace(/\D/g, '').slice(0, Math.max(0, decimals));
      const padded = (i.replace(/\D/g, '') || '0') + cleanF.padEnd(decimals, '0');
      return BigInt(padded).toString();
    };

    const atomicIn = toAtomic(amountIn, fromToken.decimals);
    const refundTo = refundAddress || this.getRefundAddress(fromToken.chain);

    try {
      let req: any;

      if (useIntentsMode) {
        req = this.attachAppFees({
          dry: false,
          swapType: 'EXACT_INPUT',
          slippageTolerance: 100,
          originAsset: fromToken.tokenId,
          depositType: 'INTENTS',
          destinationAsset: toToken.tokenId,
          amount: atomicIn,
          refundTo,
          refundType: 'INTENTS',
          recipient,
          recipientType: 'INTENTS',
          deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          quoteWaitingTimeMs: 3000,
        });
      } else {
        req = this.attachAppFees({
          dry: false,
          swapType: QuoteRequest.swapType.EXACT_INPUT,
          slippageTolerance: 100,
          originAsset: fromToken.tokenId,
          depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
          destinationAsset: toToken.tokenId,
          amount: atomicIn,
          refundTo,
          refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
          recipient,
          recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
          deadline: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
          quoteWaitingTimeMs: 5000,
          referral: referral || this.referralCode,
        });
      }

      const raw = await OneClickService.getQuote(req);
      const q = (raw as any)?.quote || raw || {};

      return {
        depositAddress: q?.depositAddress || q?.address,
        memo: q?.memo ?? null,
        deadline: q?.deadline,
        timeEstimate: q?.timeEstimate,
        quoteId: q?.id || q?.quoteId,
        minAmountIn: q?.minAmountIn,
        minAmountInFormatted: q?.minAmountInFormatted,
        raw,
      };
    } catch (error: any) {
      this.logger.error('Deposit quote error:', error?.message);
      throw error;
    }
  }

  /**
   * Get execution status for a deposit address
   */
  async getExecutionStatus(depositAddress: string): Promise<any> {
    if (!depositAddress) {
      throw new Error('Missing depositAddress');
    }

    return OneClickService.getExecutionStatus(depositAddress);
  }

  /**
   * Map SDK token to our format
   */
  private mapSdkToken(t: any): NearToken {
    const symbol = t?.symbol || '';
    const assetId = t?.assetId || t?.tokenId || t?.address;
    const blockchain = typeof t?.blockchain === 'string'
      ? t.blockchain.toLowerCase()
      : (t?.chain || '');

    return {
      symbol,
      name: symbol || '',
      chain: blockchain || '',
      address: t?.assetId || t?.contractAddress || '',
      tokenId: assetId,
      decimals: typeof t?.decimals === 'number' ? t.decimals : 0,
      logoURI: t?.icon || t?.logoURI,
      price: typeof t?.price === 'number' ? t.price : undefined,
      priceUpdatedAt: typeof t?.priceUpdatedAt === 'string' ? t.priceUpdatedAt : undefined,
    };
  }
}
