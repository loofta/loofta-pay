import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWalletClient, createPublicClient, http, erc20Abi, type Address } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { SupabaseService } from '@/database/supabase.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { CreateOfframpDto } from './dto/create-offramp.dto';

const BASE_USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEFAULT_BASE_RPC = 'https://mainnet.base.org';

// 1:1 conversion rate in ZKP2P 1e18 format
const RATE_1_TO_1 = '1000000000000000000';

@Injectable()
export class OfframpService {
  private readonly logger = new Logger(OfframpService.name);
  private readonly baseWalletAddress: Address | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly nearIntents: NearIntentsService,
  ) {
    const pk = config.get<string>('BASE_OFFRAMP_PRIVATE_KEY', '');
    if (pk) {
      const key = pk.startsWith('0x') ? pk : `0x${pk}`;
      const account = privateKeyToAccount(key as `0x${string}`);
      this.baseWalletAddress = account.address;
      this.logger.log(`Offramp Base wallet: ${account.address}`);
    } else {
      this.logger.warn('BASE_OFFRAMP_PRIVATE_KEY not set — Peer offramp disabled');
    }
  }

  private requireBaseWallet(): Address {
    if (!this.baseWalletAddress) throw new BadRequestException('Peer offramp not configured on this server');
    return this.baseWalletAddress;
  }

  private getPrivateKey(): `0x${string}` {
    const pk = this.config.get<string>('BASE_OFFRAMP_PRIVATE_KEY', '');
    return (pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`;
  }

  private getWalletClient() {
    const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
    const account = privateKeyToAccount(this.getPrivateKey());
    return createWalletClient({ account, chain: base, transport: http(rpc) });
  }

  private getPublicClient() {
    const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
    return createPublicClient({ chain: base, transport: http(rpc) });
  }

  async prepareOfframp(userId: string, dto: CreateOfframpDto) {
    const baseWallet = this.requireBaseWallet();

    const [solanaUsdcId, baseUsdcId] = await Promise.all([
      this.nearIntents.getDefuseAssetId('USDC', 'solana'),
      this.nearIntents.getDefuseAssetId('USDC', 'base'),
    ]);

    const quote = await this.nearIntents.getDepositQuote({
      fromToken: { tokenId: solanaUsdcId, chain: 'solana', symbol: 'USDC', decimals: 6 },
      toToken:   { tokenId: baseUsdcId,   chain: 'base',   symbol: 'USDC', decimals: 6 },
      amountIn:  dto.amountUSDC.toString(),
      recipient: baseWallet,
      refundAddress: dto.solanaAddress,
    });

    if (!quote.depositAddress) {
      throw new BadRequestException('Failed to get Near Intents bridge address');
    }

    const { data, error } = await this.supabase.getClient()
      .from('offramp_requests')
      .insert({
        user_id:                      userId,
        platform:                     dto.platform,
        platform_identifier:          dto.identifier,
        currency:                     dto.currency.toUpperCase(),
        amount_usdc:                  dto.amountUSDC,
        user_solana_address:          dto.solanaAddress,
        near_intents_deposit_address: quote.depositAddress,
        near_intents_memo:            quote.memo ?? null,
        status:                       'PENDING_BRIDGE',
      })
      .select('id')
      .single();

    if (error || !data) {
      this.logger.error('Failed to insert offramp record:', error);
      throw new BadRequestException('Failed to create offramp record');
    }

    return {
      id:             data.id,
      depositAddress: quote.depositAddress,
      memo:           quote.memo ?? null,
      baseWallet,
    };
  }

  async confirmBridge(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);
    if (record.status !== 'PENDING_BRIDGE') throw new BadRequestException('Already confirmed');
    await this.updateStatus(offrampId, 'BRIDGING');
    return { status: 'BRIDGING' };
  }

  async createZkp2pDeposit(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);

    if (!['BRIDGING', 'BRIDGE_COMPLETE'].includes(record.status)) {
      throw new BadRequestException(`Cannot create deposit from status ${record.status}`);
    }

    await this.updateStatus(offrampId, 'CREATING_DEPOSIT');

    try {
      // Verify USDC arrived on Base wallet
      const publicClient = this.getPublicClient();
      const usdcBalance = await publicClient.readContract({
        address: BASE_USDC,
        abi:     erc20Abi,
        functionName: 'balanceOf',
        args:    [this.baseWalletAddress!],
      }) as bigint;

      const requiredAtomicUsdc = BigInt(Math.round(record.amount_usdc * 1_000_000));

      if (usdcBalance < requiredAtomicUsdc) {
        // Bridge may still be in transit — caller should retry
        await this.updateStatus(offrampId, 'BRIDGING');
        return { status: 'BRIDGING', message: 'USDC not yet arrived on Base, retry shortly' };
      }

      const { OfframpClient, getContracts } = await import('@zkp2p/sdk');
      const walletClient = this.getWalletClient();
      const client = new OfframpClient({ walletClient, chainId: base.id });

      const { addresses } = getContracts(base.id, 'production');

      await client.ensureAllowance({
        token:    BASE_USDC,
        amount:   requiredAtomicUsdc,
        spender:  addresses.escrow as Address,
        maxApprove: false,
      });

      // currency is an ISO-4217 string: "USD", "EUR", etc.
      const { hash: depositTxHash } = await client.createDeposit({
        token:  BASE_USDC,
        amount: requiredAtomicUsdc,
        intentAmountRange: { min: requiredAtomicUsdc, max: requiredAtomicUsdc },
        processorNames: [record.platform],
        payeeData:       [{ offchainId: record.platform_identifier }],
        conversionRates: [[{ currency: record.currency.toUpperCase(), conversionRate: RATE_1_TO_1 }]],
      });

      // Fetch the newly created deposit ID from on-chain
      const deposits = await client.getAccountDeposits(this.baseWalletAddress!);
      const latest = Array.isArray(deposits) ? deposits[deposits.length - 1] : null;
      const depositId: bigint | undefined = latest?.depositId;

      await this.supabase.getClient()
        .from('offramp_requests')
        .update({
          zkp2p_deposit_id: depositId?.toString() ?? null,
          zkp2p_tx_hash:    depositTxHash ?? null,
          status:           'DEPOSITED',
          updated_at:       new Date().toISOString(),
        })
        .eq('id', offrampId);

      return { status: 'DEPOSITED', depositId: depositId?.toString() };

    } catch (err: any) {
      this.logger.error(`ZKP2P createDeposit failed for ${offrampId}:`, err.message);
      await this.updateStatus(offrampId, 'FAILED', err.message);
      throw new BadRequestException(err.message || 'Failed to create ZKP2P deposit');
    }
  }

  async getStatus(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);

    // Lazily check for ZKP2P fulfilment when in DEPOSITED state
    if (record.status === 'DEPOSITED' && record.zkp2p_deposit_id) {
      await this.checkFulfilment(record);
      return this.getRecord(offrampId, userId);
    }

    return record;
  }

  async cancelOfframp(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);

    if (['COMPLETE', 'CANCELLED', 'FAILED'].includes(record.status)) {
      throw new BadRequestException(`Cannot cancel in status ${record.status}`);
    }

    // Nothing on-chain yet — just mark cancelled
    if (['PENDING_BRIDGE', 'BRIDGING'].includes(record.status)) {
      await this.updateStatus(offrampId, 'CANCELLED');
      return { status: 'CANCELLED', refundNote: 'Bridge refunds automatically via Near Intents if funds were sent' };
    }

    if (!['DEPOSITED', 'CREATING_DEPOSIT'].includes(record.status) || !record.zkp2p_deposit_id) {
      await this.updateStatus(offrampId, 'CANCELLED');
      return { status: 'CANCELLED' };
    }

    await this.updateStatus(offrampId, 'CANCELLING');

    try {
      const { OfframpClient } = await import('@zkp2p/sdk');
      const walletClient = this.getWalletClient();
      const client = new OfframpClient({ walletClient, chainId: base.id });

      await client.withdrawDeposit({ depositId: BigInt(record.zkp2p_deposit_id) });

      // Bridge USDC back from Base to user's Solana wallet via Near Intents
      await this.bridgeBackToSolana(record);

    } catch (err: any) {
      this.logger.error(`Cancel failed for ${offrampId}:`, err.message);
      await this.updateStatus(offrampId, 'FAILED', `Cancel failed: ${err.message}`);
      throw new BadRequestException(err.message || 'Failed to cancel offramp');
    }

    await this.supabase.getClient()
      .from('offramp_requests')
      .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', offrampId);

    return { status: 'CANCELLED', refundNote: 'USDC is being returned to your Solana wallet via Near Intents' };
  }

  // Poll active DEPOSITED offramps for fulfilment (called by cron)
  async processActiveOfframps() {
    const { data: active } = await this.supabase.getClient()
      .from('offramp_requests')
      .select('*')
      .eq('status', 'DEPOSITED')
      .not('zkp2p_deposit_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(20);

    if (!active?.length) return;

    for (const record of active) {
      try {
        await this.checkFulfilment(record);
      } catch (err: any) {
        this.logger.warn(`processActiveOfframps error for ${record.id}:`, err.message);
      }
    }
  }

  private async checkFulfilment(record: any) {
    try {
      const { OfframpClient } = await import('@zkp2p/sdk');
      const walletClient = this.getWalletClient();
      const client = new OfframpClient({ walletClient, chainId: base.id });

      const deposit = await client.getDeposit(BigInt(record.zkp2p_deposit_id));

      // If remaining deposit amount is 0, it was fully fulfilled or withdrawn
      const remaining = (deposit as any)?.remainingDeposits ?? (deposit as any)?.remainingAmount;
      if (remaining !== undefined && BigInt(remaining) === 0n) {
        await this.supabase.getClient()
          .from('offramp_requests')
          .update({ status: 'COMPLETE', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', record.id);
      }
    } catch (err: any) {
      this.logger.debug(`checkFulfilment ${record.id}:`, err.message);
    }
  }

  private async bridgeBackToSolana(record: any) {
    const [baseUsdcId, solanaUsdcId] = await Promise.all([
      this.nearIntents.getDefuseAssetId('USDC', 'base'),
      this.nearIntents.getDefuseAssetId('USDC', 'solana'),
    ]);

    const quote = await this.nearIntents.getDepositQuote({
      fromToken: { tokenId: baseUsdcId,   chain: 'base',   symbol: 'USDC', decimals: 6 },
      toToken:   { tokenId: solanaUsdcId, chain: 'solana', symbol: 'USDC', decimals: 6 },
      amountIn:  record.amount_usdc.toString(),
      recipient: record.user_solana_address,
      refundAddress: this.baseWalletAddress!,
    });

    if (!quote.depositAddress) throw new Error('Could not get refund bridge address');

    const walletClient = this.getWalletClient();
    const atomicUsdc = BigInt(Math.round(record.amount_usdc * 1_000_000));

    await walletClient.writeContract({
      address:      BASE_USDC,
      abi:          erc20Abi,
      functionName: 'transfer',
      args:         [quote.depositAddress as Address, atomicUsdc],
    });

    this.logger.log(`Refund bridge initiated for offramp ${record.id} → ${record.user_solana_address}`);
  }

  private async getRecord(offrampId: string, userId: string) {
    const { data, error } = await this.supabase.getClient()
      .from('offramp_requests')
      .select('*')
      .eq('id', offrampId)
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new NotFoundException('Offramp request not found');
    return data;
  }

  private async updateStatus(offrampId: string, status: string, errorMessage?: string) {
    const update: Record<string, any> = { status, updated_at: new Date().toISOString() };
    if (errorMessage) update.error_message = errorMessage;
    await this.supabase.getClient().from('offramp_requests').update(update).eq('id', offrampId);
  }
}
