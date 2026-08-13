import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';
import { SupabaseService } from '@/database/supabase.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { CreateOfframpDto } from './dto/create-offramp.dto';

const BASE_USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEFAULT_BASE_RPC = 'https://mainnet.base.org';

@Injectable()
export class OfframpService {
  private readonly logger = new Logger(OfframpService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly nearIntents: NearIntentsService,
  ) {}

  private getPublicClient() {
    const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
    return createPublicClient({ chain: base, transport: http(rpc) });
  }

  private cashClient: import('@zkp2p/cash').CashClient | null = null;
  private async getCashClient() {
    if (!this.cashClient) {
      const { createCashClient } = await import('@zkp2p/cash');
      this.cashClient = createCashClient({ environment: 'production' });
    }
    return this.cashClient;
  }

  // Fund Base wallet with ETH for gas if below threshold. Requires BASE_FUNDER_PRIVATE_KEY env var.
  private async ensureBaseGas(address: string): Promise<void> {
    const funderKey = this.config.get<string>('BASE_FUNDER_PRIVATE_KEY');
    if (!funderKey) {
      this.logger.warn('BASE_FUNDER_PRIVATE_KEY not set — cannot fund gas for Base wallet');
      return;
    }
    try {
      const publicClient = this.getPublicClient();
      const balance = await publicClient.getBalance({ address: address as Address });
      const threshold = 500_000_000_000n; // 0.0000005 ETH — below this, fund
      if (balance >= threshold) return;

      const { privateKeyToAccount } = await import('viem/accounts');
      const { createWalletClient, http, parseEther } = await import('viem');
      const { base } = await import('viem/chains');
      const rpc = this.config.get<string>('BASE_RPC_URL', DEFAULT_BASE_RPC);
      const account = privateKeyToAccount(funderKey as `0x${string}`);
      const wc = createWalletClient({ chain: base, transport: http(rpc), account });
      const hash = await wc.sendTransaction({ to: address as Address, value: parseEther('0.005') });
      this.logger.log(`Gas funded ${address} on Base: ${hash}`);
    } catch (err: any) {
      this.logger.warn(`ensureBaseGas failed for ${address}: ${err.message}`);
    }
  }

  async fundGas(offrampId: string, userId: string, baseWalletAddress: string): Promise<{ funded: boolean }> {
    await this.getRecord(offrampId, userId); // ownership check
    if (!baseWalletAddress) throw new BadRequestException('baseWalletAddress required');
    await this.ensureBaseGas(baseWalletAddress);
    return { funded: true };
  }

  // Non-custodial: bridge goes to the user's own Base wallet (dto.baseWalletAddress).
  async prepareOfframp(userId: string, dto: CreateOfframpDto) {
    const [solanaUsdcId, baseUsdcId] = await Promise.all([
      this.nearIntents.getDefuseAssetId('USDC', 'solana'),
      this.nearIntents.getDefuseAssetId('USDC', 'base'),
    ]);

    const quote = await this.nearIntents.getDepositQuote({
      fromToken: { tokenId: solanaUsdcId, chain: 'solana', symbol: 'USDC', decimals: 6 },
      toToken:   { tokenId: baseUsdcId,   chain: 'base',   symbol: 'USDC', decimals: 6 },
      amountIn:  dto.amountUSDC.toString(),
      recipient: dto.baseWalletAddress,
      refundAddress: dto.solanaAddress,
    });

    if (!quote.depositAddress) {
      throw new BadRequestException('Failed to get Near Intents bridge address');
    }

    // Pre-fund user's Base wallet with gas so ZKP2P signing doesn't fail (fire-and-forget)
    this.ensureBaseGas(dto.baseWalletAddress).catch(e => this.logger.warn('ensureBaseGas:', e.message));

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
      baseWallet:     dto.baseWalletAddress,
    };
  }

  async confirmBridge(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);
    if (record.status !== 'PENDING_BRIDGE') throw new BadRequestException('Already confirmed');
    await this.updateStatus(offrampId, 'BRIDGING');
    return { status: 'BRIDGING' };
  }

  // Called by frontend after user signs the Peer Cash cashout() on Base.
  async recordDeposit(
    offrampId: string,
    userId: string,
    depositId: string | null,
    txHash: string | null,
    accessPolicyTxHash: string | null = null,
    etaSeconds: number | null = null,
    etaLabel: string | null = null,
  ) {
    const record = await this.getRecord(offrampId, userId);

    if (!['BRIDGING', 'BRIDGE_COMPLETE', 'PENDING_BRIDGE'].includes(record.status)) {
      throw new BadRequestException(`Cannot record deposit from status ${record.status}`);
    }

    await this.supabase.getClient()
      .from('offramp_requests')
      .update({
        zkp2p_deposit_id:      depositId ?? null,
        zkp2p_tx_hash:         txHash ?? null,
        access_policy_tx_hash: accessPolicyTxHash ?? null,
        eta_seconds:           etaSeconds ?? null,
        eta_label:             etaLabel ?? null,
        status:                'DEPOSITED',
        updated_at:            new Date().toISOString(),
      })
      .eq('id', offrampId);

    return { status: 'DEPOSITED', depositId };
  }

  async getStatus(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);

    if (record.status === 'DEPOSITED' && record.zkp2p_deposit_id) {
      await this.checkFulfilment(record);
      return this.getRecord(offrampId, userId);
    }

    return record;
  }

  // For PENDING_BRIDGE / BRIDGING: marks CANCELLED directly.
  // For DEPOSITED: marks CANCELLING and returns a note — frontend handles ZKP2P + bridge signing.
  async cancelOfframp(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);

    if (['COMPLETE', 'CANCELLED', 'FAILED'].includes(record.status)) {
      throw new BadRequestException(`Cannot cancel in status ${record.status}`);
    }

    if (['PENDING_BRIDGE', 'BRIDGING', 'CREATING_DEPOSIT'].includes(record.status)) {
      await this.updateStatus(offrampId, 'CANCELLED');
      return { status: 'CANCELLED', refundNote: 'Bridge refunds automatically via Near Intents if funds were sent' };
    }

    // DEPOSITED: user must sign ZKP2P withdrawDeposit + USDC bridge on Base.
    // Mark CANCELLING and let frontend drive the signing.
    await this.updateStatus(offrampId, 'CANCELLING');
    return {
      status: 'CANCELLING',
      zkp2pDepositId: record.zkp2p_deposit_id ?? null,
      refundNote: 'Sign the ZKP2P withdrawal and USDC bridge on Base to complete cancellation.',
    };
  }

  // Called by frontend after it has completed ZKP2P withdrawal + Base→Solana USDC transfer.
  async markCancelled(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);
    if (['COMPLETE', 'FAILED'].includes(record.status)) {
      throw new BadRequestException(`Cannot mark cancelled from status ${record.status}`);
    }
    await this.supabase.getClient()
      .from('offramp_requests')
      .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', offrampId);
    return { status: 'CANCELLED' };
  }

  // Returns a Near Intents bridge address for Base USDC → user's Solana wallet.
  // Frontend uses this address to send USDC after ZKP2P withdrawDeposit.
  async getBridgeBackAddress(offrampId: string, userId: string, baseWalletAddress: string, amountUsdcOverride?: number) {
    const record = await this.getRecord(offrampId, userId);

    // Allow bridge-back from any non-terminal, non-complete state
    if (['COMPLETE', 'CANCELLED', 'FAILED'].includes(record.status)) {
      throw new BadRequestException(`Cannot bridge back from status ${record.status}`);
    }

    const [baseUsdcId, solanaUsdcId] = await Promise.all([
      this.nearIntents.getDefuseAssetId('USDC', 'base'),
      this.nearIntents.getDefuseAssetId('USDC', 'solana'),
    ]);

    const amountUsdc = amountUsdcOverride ?? record.amount_usdc;
    const quote = await this.nearIntents.getDepositQuote({
      fromToken: { tokenId: baseUsdcId,   chain: 'base',   symbol: 'USDC', decimals: 6 },
      toToken:   { tokenId: solanaUsdcId, chain: 'solana', symbol: 'USDC', decimals: 6 },
      amountIn:  amountUsdc.toString(),
      recipient: record.user_solana_address,
      refundAddress: baseWalletAddress,
    });

    if (!quote.depositAddress) throw new BadRequestException('Could not get refund bridge address');

    return {
      depositAddress: quote.depositAddress,
      memo:           quote.memo ?? null,
      amountUsdc,
    };
  }

  // Returns the latest non-terminal offramp record for a user (for session recovery on the frontend).
  async getUserOfframps(userId: string, limit = 10) {
    const { data } = await this.supabase.getClient()
      .from('offramp_requests')
      .select('id, created_at, platform, platform_identifier, currency, amount_usdc, status, zkp2p_deposit_id, completed_at, cancelled_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data ?? [];
  }

  async getPendingForUser(userId: string) {
    const { data } = await this.supabase.getClient()
      .from('offramp_requests')
      .select('*')
      .eq('user_id', userId)
      .not('status', 'in', '("COMPLETE","CANCELLED","FAILED")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ?? null;
  }

  // Poll active DEPOSITED offramps for fulfilment (called by cron).
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
      const cash = await this.getCashClient();
      const order = await cash.order(record.zkp2p_deposit_id);

      if (order.state === 'delivered' && !order.isInFlight) {
        await this.supabase.getClient()
          .from('offramp_requests')
          .update({ status: 'COMPLETE', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', record.id);
      }
    } catch (err: any) {
      this.logger.debug(`checkFulfilment ${record.id}:`, err.message);
    }
  }

  async getAllOfframps(page = 1, limit = 50) {
    const from = (page - 1) * limit;
    const { data, count, error } = await this.supabase.getClient()
      .from('offramp_requests')
      .select('id, created_at, updated_at, user_id, platform, platform_identifier, currency, amount_usdc, status, zkp2p_deposit_id, zkp2p_tx_hash, access_policy_tx_hash, eta_seconds, eta_label, near_intents_deposit_address, completed_at, cancelled_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);

    if (error) throw new BadRequestException('Failed to fetch offramp records');
    return { data: data ?? [], total: count ?? 0, page, limit };
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
