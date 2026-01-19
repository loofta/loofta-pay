import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@/redis/redis.service';
import { privateKeyToAccount } from 'viem/accounts';
import { RhinestoneSDK } from '@rhinestone/sdk';
import { base } from 'viem/chains';
import { encodeFunctionData, parseAbi } from 'viem';

// Redis key prefixes (must match frontend companion API)
const PENDING_WALLETS_KEY = 'companion:pending';
const SIGNER_KEY_PREFIX = 'companion:signer:';
const PAYMENT_LOG_PREFIX = 'companion:payment:';

// Lottery contract config
const TICKET_AUTOMATOR_CONTRACT = '0x61ef1a5c0e5a91e5a6e1f7e0db8c4c1d46c1b0a2'; // Update with actual
const TICKET_PRICE_ETH = 0.0034;
const GAS_BUFFER_ETH = 0.0001;
const MIN_BALANCE_FOR_PURCHASE = TICKET_PRICE_ETH + GAS_BUFFER_ETH;
const GAS_FOR_REFUND = 0.0002;

interface SignerData {
  privateKey: string;
  recipientAddress: string;
  companionAddress: string;
  createdAt: number;
  numTickets?: number;
  totalCostETH?: string;
}

interface PaymentLog {
  id: string;
  recipientAddress: string;
  companionAddress: string;
  status: 'pending' | 'funded' | 'executing' | 'executed' | 'refunded' | 'failed';
  amountReceived?: string;
  amountRequired?: string;
  txHash?: string;
  refundTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface LotteryProcessingResult {
  recipientAddress: string;
  companionAddress: string;
  status: 'executed' | 'refunded' | 'waiting' | 'expired' | 'failed';
  txHash?: string;
  error?: string;
}

@Injectable()
export class LotteryProcessorService {
  private readonly logger = new Logger(LotteryProcessorService.name);
  private isProcessing = false;
  private readonly rhinestoneApiKey: string;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.rhinestoneApiKey = this.configService.get<string>('RHINESTONE_API_KEY', '');
  }

  /**
   * Process pending lottery purchases every minute
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    const autoProcess = this.configService.get<string>('AUTO_PROCESS_LOTTERY', 'true');
    if (autoProcess !== 'true') {
      return;
    }
    await this.processPendingLotteryPayments();
  }

  /**
   * Get companion wallet balance via RPC
   */
  private async getCompanionBalance(address: string): Promise<{ eth: number; ethWei: string }> {
    const rpcUrl = this.configService.get<string>('BASE_RPC_URL', 'https://mainnet.base.org');
    const res = await fetch(rpcUrl, {
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
    const balanceWei = data.result || '0x0';
    const balanceEth = parseInt(balanceWei, 16) / 1e18;
    return { eth: balanceEth, ethWei: BigInt(balanceWei).toString() };
  }

  /**
   * Get SDK instance
   */
  private getSDK(): RhinestoneSDK {
    if (!this.rhinestoneApiKey) {
      throw new Error('Missing RHINESTONE_API_KEY');
    }
    return new RhinestoneSDK({ apiKey: this.rhinestoneApiKey });
  }

  /**
   * Encode ticket purchase call
   */
  private encodeTicketPurchase(recipient: string, numTickets: number): string {
    const abi = parseAbi(['function purchaseTickets(address recipient, uint256 numTickets) payable']);
    return encodeFunctionData({
      abi,
      functionName: 'purchaseTickets',
      args: [recipient as `0x${string}`, BigInt(numTickets)],
    });
  }

  /**
   * Update payment log in Redis
   */
  private async updatePaymentLog(id: string, updates: Partial<PaymentLog>): Promise<void> {
    const existingStr = await this.redisService.get(`${PAYMENT_LOG_PREFIX}${id}`);
    if (existingStr) {
      const existing = JSON.parse(existingStr);
      await this.redisService.set(`${PAYMENT_LOG_PREFIX}${id}`, JSON.stringify({
        ...existing,
        ...updates,
        updatedAt: Date.now(),
      }));
    }
  }

  /**
   * Process all pending lottery payments
   */
  async processPendingLotteryPayments(): Promise<LotteryProcessingResult[]> {
    if (this.isProcessing) {
      this.logger.debug('Already processing lottery payments, skipping');
      return [];
    }

    this.isProcessing = true;
    const results: LotteryProcessingResult[] = [];

    try {
      this.logger.log('Starting lottery payment processing...');

      // Get all pending wallet keys
      const pendingKeys = await this.redisService.sMembers(PENDING_WALLETS_KEY);
      this.logger.log(`Found ${pendingKeys.length} pending lottery wallets`);

      if (pendingKeys.length === 0) {
        return [];
      }

      const sdk = this.getSDK();

      for (const redisKey of pendingKeys) {
        const processResult = await this.redisService.withLock(
          `lottery:${redisKey}`,
          async () => this.processLotteryWallet(sdk, redisKey),
          60000,
        );

        if (processResult) {
          results.push(processResult);

          // Remove from pending if processed
          if (processResult.status !== 'waiting') {
            await this.redisService.sRem(PENDING_WALLETS_KEY, redisKey);
            await this.redisService.del(redisKey);
          }
        }
      }

      this.logger.log(`Processed ${results.length} lottery payments`);
    } catch (error: any) {
      this.logger.error('Error processing lottery payments:', error?.message);
    } finally {
      this.isProcessing = false;
    }

    return results;
  }

  /**
   * Process a single lottery wallet
   */
  private async processLotteryWallet(
    sdk: RhinestoneSDK,
    redisKey: string,
  ): Promise<LotteryProcessingResult | null> {
    const signerDataStr = await this.redisService.get(redisKey);
    if (!signerDataStr) {
      return null;
    }

    const signerData: SignerData = JSON.parse(signerDataStr);
    const { recipientAddress, companionAddress, privateKey, numTickets = 1, totalCostETH, createdAt } = signerData;
    const requiredEth = totalCostETH ? parseFloat(totalCostETH) : MIN_BALANCE_FOR_PURCHASE * numTickets;
    const paymentId = `${recipientAddress.toLowerCase()}_${createdAt}`;

    this.logger.debug(`Processing lottery wallet for: ${recipientAddress}`);

    try {
      // Check if expired (24 hours)
      if (Date.now() - createdAt > 24 * 60 * 60 * 1000) {
        this.logger.debug(`Lottery payment expired for ${recipientAddress}`);
        return { recipientAddress, companionAddress, status: 'expired' };
      }

      // Check balance
      const balance = await this.getCompanionBalance(companionAddress);
      this.logger.debug(`Balance: ${balance.eth.toFixed(6)} ETH`);

      // No funds yet
      if (balance.eth < 0.0001) {
        return { recipientAddress, companionAddress, status: 'waiting' };
      }

      // Check idempotency
      const existingLogStr = await this.redisService.get(`${PAYMENT_LOG_PREFIX}${paymentId}`);
      if (existingLogStr) {
        const existingLog: PaymentLog = JSON.parse(existingLogStr);
        if (existingLog.status === 'executed' && existingLog.txHash) {
          return { recipientAddress, companionAddress, status: 'executed', txHash: existingLog.txHash };
        }
        if (existingLog.status === 'refunded' && existingLog.refundTxHash) {
          return { recipientAddress, companionAddress, status: 'refunded', txHash: existingLog.refundTxHash };
        }
      }

      // Create companion account
      const signerAccount = privateKeyToAccount(privateKey as `0x${string}`);
      const dummyOwner = {
        address: recipientAddress as `0x${string}`,
        type: 'local' as const,
        publicKey: '0x' as `0x${string}`,
        source: 'custom' as const,
        signMessage: async () => { throw new Error('Not used'); },
        signTransaction: async () => { throw new Error('Not used'); },
        signTypedData: async () => { throw new Error('Not used'); },
      };

      const companionAccount = await sdk.createAccount({
        account: { type: 'nexus' },
        owners: {
          type: 'ecdsa',
          accounts: [dummyOwner as any, signerAccount],
          threshold: 1,
        },
      });

      // Insufficient funds - refund
      if (balance.eth < requiredEth) {
        this.logger.log(`Insufficient balance for ${recipientAddress}, refunding`);
        
        const refundAmount = balance.eth - GAS_FOR_REFUND;
        if (refundAmount <= 0) {
          await this.updatePaymentLog(paymentId, { status: 'failed', error: 'Balance too low for refund' });
          return { recipientAddress, companionAddress, status: 'failed', error: 'Balance too low for refund' };
        }

        const refundWei = BigInt(Math.floor(refundAmount * 1e18));
        const refundTx = await companionAccount.sendTransaction({
          chain: base,
          calls: [{
            to: recipientAddress as `0x${string}`,
            value: refundWei,
            data: '0x' as `0x${string}`,
          }],
          signers: {
            type: 'owner',
            kind: 'ecdsa',
            accounts: [signerAccount as any],
          },
        });

        const refundResult = await companionAccount.waitForExecution(refundTx);
        const refundTxHash = (refundResult as any)?.transactionHash || '';

        await this.updatePaymentLog(paymentId, { status: 'refunded', refundTxHash });
        this.logger.log(`Refund complete: ${refundTxHash}`);

        return { recipientAddress, companionAddress, status: 'refunded', txHash: refundTxHash };
      }

      // Execute purchase
      this.logger.log(`Executing purchase for ${recipientAddress}`);
      
      const ethToSend = balance.eth - 0.0002;
      const ethAmountWei = BigInt(Math.floor(ethToSend * 1e18));
      const calldata = this.encodeTicketPurchase(recipientAddress, numTickets);

      const transaction = await companionAccount.sendTransaction({
        chain: base,
        calls: [{
          to: TICKET_AUTOMATOR_CONTRACT as `0x${string}`,
          value: ethAmountWei,
          data: calldata as `0x${string}`,
        }],
        signers: {
          type: 'owner',
          kind: 'ecdsa',
          accounts: [signerAccount as any],
        },
      });

      const result = await companionAccount.waitForExecution(transaction);
      const txHash = (result as any)?.transactionHash || '';

      await this.updatePaymentLog(paymentId, { status: 'executed', txHash });
      this.logger.log(`Purchase executed: ${txHash}`);

      return { recipientAddress, companionAddress, status: 'executed', txHash };

    } catch (error: any) {
      this.logger.error(`Error processing lottery wallet: ${error?.message}`);
      return { recipientAddress, companionAddress, status: 'failed', error: error?.message };
    }
  }

  /**
   * Manually trigger processing
   */
  async triggerProcessing(): Promise<{ processed: number; results: LotteryProcessingResult[] }> {
    const results = await this.processPendingLotteryPayments();
    return { processed: results.length, results };
  }
}
