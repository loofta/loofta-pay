import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/redis/redis.service';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http, parseEther } from 'viem';
import { mainnet } from 'viem/chains';
import { OneClickService, OpenAPI, QuoteRequest } from '@defuse-protocol/one-click-sdk-typescript';

// Redis keys
const CLAIM_COMPANION_PREFIX = 'claim:companion:';
const CLAIM_PENDING_KEY = 'claim:pending';

// ETH on Ethereum asset ID
const ETH_MAINNET_ASSET = 'nep141:eth.omft.near';

// Minimum ETH to consider as "funded"
const MIN_ETH_FUNDED = 0.001;
const GAS_RESERVE = 0.0005;

interface ClaimCompanionData {
  claimId: string;
  recipientAddress: string;
  destinationAsset: string;
  destinationAmount: string;
  firstIntentDepositAddress: string;
  firstIntentQuoteId?: string;
  firstIntentDeadline: string;
  companionPrivateKey: string;
  companionAddress: string;
  finalIntentQuoteId?: string;
  finalIntentDepositAddress?: string;
  finalIntentDeadline?: string;
  status: 'pending_first_deposit' | 'first_received' | 'second_sent' | 'completed' | 'failed';
  amountReceivedETH?: string;
  finalTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ClaimCompanionResult {
  claimId: string;
  action: string;
  success: boolean;
  txHash?: string;
  error?: string;
}

@Injectable()
export class ClaimCompanionProcessorService {
  private readonly logger = new Logger(ClaimCompanionProcessorService.name);
  private isProcessing = false;
  private readonly ethRpcUrl: string;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.ethRpcUrl = this.configService.get<string>('ETH_RPC_URL', 'https://eth.llamarpc.com');
    
    // Initialize 1Click SDK
    const oneClickBase = this.configService.get<string>('ONECLICK_API_BASE', 'https://1click.chaindefuser.com');
    const oneClickJwt = this.configService.get<string>('ONECLICK_JWT', '');
    OpenAPI.BASE = oneClickBase;
    if (oneClickJwt) OpenAPI.TOKEN = oneClickJwt;
  }

  /**
   * Process pending claim companions every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    const autoProcess = this.configService.get<string>('AUTO_PROCESS_CLAIM_COMPANIONS', 'true');
    if (autoProcess !== 'true') {
      return;
    }
    await this.processPendingClaimCompanions();
  }

  /**
   * Get ETH balance of an address
   */
  private async getEthBalance(address: string): Promise<{ eth: number; wei: bigint }> {
    const res = await fetch(this.ethRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1,
      }),
    });
    const data = await res.json();
    const balanceWei = BigInt(data.result || '0x0');
    const balanceEth = Number(balanceWei) / 1e18;
    return { eth: balanceEth, wei: balanceWei };
  }

  /**
   * Update companion data in Redis
   */
  private async updateCompanionData(key: string, updates: Partial<ClaimCompanionData>): Promise<void> {
    const existingStr = await this.redisService.get(key);
    if (existingStr) {
      const existing = JSON.parse(existingStr);
      await this.redisService.set(key, JSON.stringify({
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      }), 86400);
    }
  }

  /**
   * Process all pending claim companions
   */
  async processPendingClaimCompanions(): Promise<ClaimCompanionResult[]> {
    if (this.isProcessing) {
      this.logger.debug('Already processing claim companions, skipping');
      return [];
    }

    this.isProcessing = true;
    const results: ClaimCompanionResult[] = [];

    try {
      this.logger.log('Starting claim companion processing...');

      const pendingKeys = await this.redisService.sMembers(CLAIM_PENDING_KEY);
      this.logger.log(`Found ${pendingKeys.length} pending claim companions`);

      for (const redisKey of pendingKeys) {
        const dataStr = await this.redisService.get(redisKey);
        if (!dataStr) {
          await this.redisService.sRem(CLAIM_PENDING_KEY, redisKey);
          continue;
        }

        const data: ClaimCompanionData = JSON.parse(dataStr);
        const { claimId } = data;

        const processResult = await this.redisService.withLock(
          `claim:${claimId}`,
          async () => this.processClaimCompanion(redisKey, data),
          300000, // 5 minute lock
        );

        if (processResult) {
          results.push(processResult);
        }
      }

      this.logger.log(`Processed ${results.length} claim companions`);
    } catch (error: any) {
      this.logger.error('Error processing claim companions:', error?.message);
    } finally {
      this.isProcessing = false;
    }

    return results;
  }

  /**
   * Process a single claim companion
   */
  private async processClaimCompanion(
    redisKey: string,
    data: ClaimCompanionData,
  ): Promise<ClaimCompanionResult | null> {
    const { claimId, companionAddress, companionPrivateKey, recipientAddress, destinationAsset, destinationAmount, status } = data;

    this.logger.debug(`Processing claim ${claimId}, status: ${status}`);

    try {
      // Check idempotency
      if (data.finalTxHash && status === 'completed') {
        this.logger.debug(`Claim ${claimId} already completed`);
        await this.redisService.sRem(CLAIM_PENDING_KEY, redisKey);
        return { claimId, action: 'already_completed', success: true, txHash: data.finalTxHash };
      }

      // Check if expired (24h)
      if (Date.now() - data.createdAt > 24 * 60 * 60 * 1000) {
        this.logger.debug(`Claim ${claimId} expired`);
        await this.updateCompanionData(redisKey, { status: 'failed', error: 'Expired after 24 hours' });
        await this.redisService.sRem(CLAIM_PENDING_KEY, redisKey);
        return { claimId, action: 'expired', success: false, error: 'Expired' };
      }

      // Check companion wallet balance
      const balance = await this.getEthBalance(companionAddress);
      this.logger.debug(`Companion ${companionAddress} balance: ${balance.eth} ETH`);

      if (status === 'pending_first_deposit') {
        if (balance.eth >= MIN_ETH_FUNDED) {
          this.logger.log(`Companion funded with ${balance.eth} ETH`);
          await this.updateCompanionData(redisKey, {
            status: 'first_received',
            amountReceivedETH: balance.eth.toFixed(8),
          });
          data.status = 'first_received';
          data.amountReceivedETH = balance.eth.toFixed(8);
        } else {
          return { claimId, action: 'waiting', success: true };
        }
      }

      if (data.status === 'first_received') {
        // Create final intent (ETH → destination token)
        this.logger.log(`Creating final intent for claim ${claimId}`);

        const ethToSend = balance.eth - GAS_RESERVE;
        if (ethToSend <= 0) {
          return { claimId, action: 'insufficient_balance', success: false };
        }

        // Create the final intent quote with EXACT_OUTPUT
        const finalIntentRequest = {
          dry: false,
          swapType: QuoteRequest.swapType.EXACT_OUTPUT,
          slippageTolerance: 100,
          originAsset: ETH_MAINNET_ASSET,
          depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
          destinationAsset,
          amount: destinationAmount,
          refundTo: companionAddress,
          refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
          recipient: recipientAddress,
          recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
          deadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          quoteWaitingTimeMs: 5000,
          referral: this.configService.get<string>('ONECLICK_REFERRAL', 'loofta'),
        };

        let finalQuote: any;
        try {
          finalQuote = await OneClickService.getQuote(finalIntentRequest as any);
        } catch (err: any) {
          this.logger.error(`Final intent quote failed: ${err?.message}`);
          await this.updateCompanionData(redisKey, { status: 'failed', error: `Final intent failed: ${err?.message}` });
          await this.redisService.sRem(CLAIM_PENDING_KEY, redisKey);
          return { claimId, action: 'final_intent_failed', success: false, error: err?.message };
        }

        const quote = (finalQuote as any)?.quote || finalQuote;
        const depositAddress = quote?.depositAddress;
        const requiredEth = parseFloat(quote?.minAmountInFormatted || quote?.amountInFormatted || '0');

        if (!depositAddress) {
          await this.updateCompanionData(redisKey, { status: 'failed', error: 'No deposit address for final intent' });
          await this.redisService.sRem(CLAIM_PENDING_KEY, redisKey);
          return { claimId, action: 'no_deposit_address', success: false };
        }

        if (ethToSend < requiredEth) {
          await this.updateCompanionData(redisKey, {
            status: 'failed',
            error: `Insufficient ETH: have ${ethToSend.toFixed(6)}, need ${requiredEth.toFixed(6)}`,
          });
          await this.redisService.sRem(CLAIM_PENDING_KEY, redisKey);
          return { claimId, action: 'insufficient_eth', success: false };
        }

        // Store final intent info
        await this.updateCompanionData(redisKey, {
          finalIntentQuoteId: quote?.id || quote?.quoteId,
          finalIntentDepositAddress: depositAddress,
          finalIntentDeadline: quote?.deadline,
        });

        // Send ETH to final intent deposit address
        this.logger.log(`Sending ${requiredEth} ETH to ${depositAddress}`);

        const account = privateKeyToAccount(companionPrivateKey as `0x${string}`);
        const walletClient = createWalletClient({
          account,
          chain: mainnet,
          transport: http(this.ethRpcUrl),
        });

        try {
          const txHash = await walletClient.sendTransaction({
            to: depositAddress as `0x${string}`,
            value: parseEther(requiredEth.toFixed(8)),
          });

          this.logger.log(`Transaction sent: ${txHash}`);

          await this.updateCompanionData(redisKey, {
            status: 'second_sent',
            finalTxHash: txHash,
          });

          return { claimId, action: 'second_hop_sent', success: true, txHash };
        } catch (err: any) {
          this.logger.error(`Transaction failed: ${err?.message}`);
          await this.updateCompanionData(redisKey, { status: 'failed', error: `TX failed: ${err?.message}` });
          await this.redisService.sRem(CLAIM_PENDING_KEY, redisKey);
          return { claimId, action: 'tx_failed', success: false, error: err?.message };
        }
      }

      if (data.status === 'second_sent') {
        this.logger.log(`Second hop sent, marking claim ${claimId} as completed`);
        await this.updateCompanionData(redisKey, { status: 'completed' });
        await this.redisService.sRem(CLAIM_PENDING_KEY, redisKey);
        return { claimId, action: 'completed', success: true, txHash: data.finalTxHash };
      }

      return { claimId, action: 'waiting', success: true };

    } catch (err: any) {
      this.logger.error(`Error processing claim ${claimId}: ${err?.message}`);
      return { claimId, action: 'error', success: false, error: err?.message };
    }
  }

  /**
   * Manually trigger processing
   */
  async triggerProcessing(): Promise<{ processed: number; results: ClaimCompanionResult[] }> {
    const results = await this.processPendingClaimCompanions();
    return { processed: results.length, results };
  }
}
