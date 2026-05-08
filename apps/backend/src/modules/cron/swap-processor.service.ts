import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/redis/redis.service';
import { SupabaseService } from '@/database/supabase.service';
import { createPublicClient, http, formatEther, formatUnits, erc20Abi, Address } from 'viem';
import { mainnet, base, optimism, arbitrum, polygon } from 'viem/chains';

// Redis keys for claims
const SWAP_COMPANION_PREFIX = 'claim:swap:';
const SWAP_PENDING_KEY = 'claim:swap:pending';

// Redis keys for organizations
const ORG_SWAP_COMPANION_PREFIX = 'org_swap_companion:';
const ORG_SWAP_PENDING_KEY = 'org_swap_pending';

// Token addresses per chain
const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
  1: { // Ethereum
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  },
  8453: { // Base
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  },
  10: { // Optimism
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
  },
  42161: { // Arbitrum
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  137: { // Polygon
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
};

// Chain configs
const CHAIN_CONFIGS: Record<number, any> = {
  1: mainnet,
  8453: base,
  10: optimism,
  42161: arbitrum,
  137: polygon,
};

// RPC URLs
const RPC_URLS: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  10: 'https://mainnet.optimism.io',
  42161: 'https://arb1.arbitrum.io/rpc',
  137: 'https://polygon-rpc.com',
};

interface SwapCompanionData {
  claimId?: string;
  organizationId?: string;
  companionPrivateKey: string;
  companionAddress: string;
  chainId: number;
  fromToken: string;
  fromTokenAddress: string | null;
  fromDecimals: number;
  toToken: string;
  toTokenAddress: string | null;
  toDecimals: number;
  toAmount: string;
  recipientAddress: string;
  feeAmount: string;
  feeRecipient: string;
  status: 'pending_deposit' | 'funded' | 'swapping' | 'completed' | 'failed' | 'refunded';
  amountReceived?: string;
  amountSwapped?: string;
  swapTxHash?: string;
  transferTxHash?: string;
  feeTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SwapProcessingResult {
  id: string;
  type: 'claim' | 'organization';
  status: 'completed' | 'failed' | 'waiting' | 'expired';
  txHash?: string;
  error?: string;
}

@Injectable()
export class SwapProcessorService {
  private readonly logger = new Logger(SwapProcessorService.name);
  private isProcessing = false;
  private readonly feePercent: number;

  constructor(
    private readonly redisService: RedisService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.feePercent = this.configService.get<number>('LOOFTA_FEE_PERCENT', 0.01);
  }

  /**
   * Process pending swaps every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    const autoProcess = this.configService.get<string>('AUTO_PROCESS_SWAPS', 'true');
    if (autoProcess !== 'true') {
      return;
    }
    await this.processPendingSwaps();
  }

  /**
   * Expire open payment links past their expires_at — runs every hour
   */
  @Cron(CronExpression.EVERY_HOUR)
  async expireOpenPayments() {
    try {
      const { error } = await this.supabaseService.payments
        .update({ status: 'EXPIRED' })
        .eq('status', 'OPEN')
        .lt('expires_at', new Date().toISOString());
      if (error) {
        this.logger.error('Failed to expire open payments:', error.message);
      }
    } catch (e: any) {
      this.logger.error('expireOpenPayments error:', e?.message);
    }
  }

  /**
   * Get token balance
   */
  private async getTokenBalance(
    address: string,
    tokenSymbol: string,
    chainId: number,
  ): Promise<{ formatted: string; raw: bigint }> {
    const rpcUrl = RPC_URLS[chainId];
    const chain = CHAIN_CONFIGS[chainId];

    if (!rpcUrl || !chain) {
      throw new Error(`Chain ${chainId} not supported`);
    }

    const client = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    if (tokenSymbol === 'ETH') {
      const balance = await client.getBalance({ address: address as Address });
      return { formatted: formatEther(balance), raw: balance };
    }

    const tokenAddress = TOKEN_ADDRESSES[chainId]?.[tokenSymbol];
    if (!tokenAddress) {
      throw new Error(`Token ${tokenSymbol} not supported on chain ${chainId}`);
    }

    const decimals = tokenSymbol === 'USDC' || tokenSymbol === 'USDT' ? 6 : 18;
    const balance = await client.readContract({
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address as Address],
    });

    return { formatted: formatUnits(balance, decimals), raw: balance };
  }

  /**
   * Process all pending swaps (both claims and organizations)
   */
  async processPendingSwaps(): Promise<SwapProcessingResult[]> {
    if (this.isProcessing) {
      return [];
    }

    this.isProcessing = true;
    const results: SwapProcessingResult[] = [];

    try {
      // Process claim swaps
      const claimResults = await this.processSwapType(SWAP_PENDING_KEY, 'claim');
      results.push(...claimResults);

      // Process organization swaps
      const orgResults = await this.processSwapType(ORG_SWAP_PENDING_KEY, 'organization');
      results.push(...orgResults);
    } catch (error: any) {
      this.logger.error('Error processing swaps:', error?.message);
    } finally {
      this.isProcessing = false;
    }

    return results;
  }

  /**
   * Process a specific type of swaps
   */
  private async processSwapType(
    pendingKey: string,
    type: 'claim' | 'organization',
  ): Promise<SwapProcessingResult[]> {
    const results: SwapProcessingResult[] = [];
    const pendingKeys = await this.redisService.sMembers(pendingKey);

    for (const redisKey of pendingKeys) {
      const dataStr = await this.redisService.get(redisKey);
      if (!dataStr) {
        await this.redisService.sRem(pendingKey, redisKey);
        continue;
      }

      const data: SwapCompanionData = JSON.parse(dataStr);
      const id = type === 'claim' ? data.claimId || '' : data.organizationId || '';

      // Skip if already completed or failed
      if (data.status === 'completed' || data.status === 'failed') {
        await this.redisService.sRem(pendingKey, redisKey);
        continue;
      }

      const processResult = await this.redisService.withLock(
        `swap:${type}:${id}:${data.createdAt}`,
        async () => this.processSwap(redisKey, pendingKey, data, type),
        300000, // 5 minute lock
      );

      if (processResult) {
        results.push(processResult);
      }
    }

    return results;
  }

  /**
   * Process a single swap
   */
  private async processSwap(
    redisKey: string,
    pendingKey: string,
    data: SwapCompanionData,
    type: 'claim' | 'organization',
  ): Promise<SwapProcessingResult | null> {
    const id = type === 'claim' ? data.claimId || '' : data.organizationId || '';

    try {
      // Idempotency check
      if (data.transferTxHash) {
        data.status = 'completed';
        data.updatedAt = Date.now();
        await this.redisService.set(redisKey, JSON.stringify(data));
        await this.redisService.sRem(pendingKey, redisKey);
        return { id, type, status: 'completed', txHash: data.transferTxHash };
      }

      // Check if expired (24 hours)
      if (Date.now() - data.createdAt > 24 * 60 * 60 * 1000) {
        data.status = 'failed';
        data.error = 'Expired - no deposit received within 24 hours';
        data.updatedAt = Date.now();
        await this.redisService.set(redisKey, JSON.stringify(data));
        await this.redisService.sRem(pendingKey, redisKey);

        if (type === 'claim' && data.claimId) {
          await this.supabaseService.payments.update({ status: 'EXPIRED' }).eq('id', data.claimId);
        }

        return { id, type, status: 'expired' };
      }

      // Check balance
      const balance = await this.getTokenBalance(data.companionAddress, data.fromToken, data.chainId);

      if (balance.raw === BigInt(0)) {
        return { id, type, status: 'waiting' };
      }

      // Update status
      data.status = 'funded';
      data.amountReceived = balance.formatted;
      data.updatedAt = Date.now();
      await this.redisService.set(redisKey, JSON.stringify(data));

      // Execute swap/transfer
      data.status = 'swapping';
      data.updatedAt = Date.now();
      await this.redisService.set(redisKey, JSON.stringify(data));

      const result = await this.executeSwapAndTransfer(data);

      if (result.success) {
        data.status = 'completed';
        data.swapTxHash = result.swapTxHash;
        data.transferTxHash = result.transferTxHash;
        data.updatedAt = Date.now();
        await this.redisService.set(redisKey, JSON.stringify(data));
        await this.redisService.sRem(pendingKey, redisKey);

        // Update claim status – unresolved recipients stay PRIVATE_TRANSFER_PENDING
        // until funds are swept to recipient wallet.
        if (type === 'claim' && data.claimId) {
          const { data: payment } = await this.supabaseService.payments
            .select('recipient_address')
            .eq('id', data.claimId)
            .maybeSingle();
          const recipientAddress = (payment?.recipient_address || '').trim();
          const hasPendingRecipient =
            recipientAddress.startsWith('PENDING_EMAIL:') || recipientAddress.startsWith('PENDING_USERNAME:');
          const newStatus = hasPendingRecipient ? 'PRIVATE_TRANSFER_PENDING' : 'SUCCESS';
          await this.supabaseService.payments
            .update({ status: newStatus })
            .eq('id', data.claimId);
        }

        return { id, type, status: 'completed', txHash: result.transferTxHash };
      } else {
        data.status = 'failed';
        data.error = result.error;
        data.transferTxHash = result.transferTxHash;
        data.updatedAt = Date.now();
        await this.redisService.set(redisKey, JSON.stringify(data));
        await this.redisService.sRem(pendingKey, redisKey);

        if (type === 'claim' && data.claimId) {
          await this.supabaseService.payments.update({ status: 'REFUNDED' }).eq('id', data.claimId);
        }

        return { id, type, status: 'failed', error: result.error };
      }

    } catch (error: any) {
      this.logger.error(`Error processing ${type} swap ${id}: ${error?.message}`);
      return { id, type, status: 'failed', error: error?.message };
    }
  }

  /**
   * Execute swap and transfer (EVM companion swaps no longer supported)
   */
  private async executeSwapAndTransfer(_data: SwapCompanionData): Promise<{
    success: boolean;
    swapTxHash?: string;
    transferTxHash?: string;
    error?: string;
  }> {
    return { success: false, error: 'EVM companion swaps are no longer supported' };
  }

  /**
   * Manually trigger processing
   */
  async triggerProcessing(): Promise<{ processed: number; results: SwapProcessingResult[] }> {
    const results = await this.processPendingSwaps();
    return { processed: results.length, results };
  }
}
