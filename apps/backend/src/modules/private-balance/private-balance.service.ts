import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { isSolanaDevnetFromConfig, isSolanaLocalhostFromConfig } from '@/common/solana-cluster-env';
import { isValidSolanaAddress } from '@/common/solana-address';
import {
  MAGICBLOCK_GAS_USDC,
  estimateMagicblockGrossUp,
  requestMagicblockPrivateTransfer,
  decodeActualSenderDebit,
  toClientResponse,
  type MagicblockPrivateTransferClientResponse,
} from '@/common/magicblock-private-transfer';
import { StartPrivateDepositDto, BuildPrivateWithdrawalDto } from './dto';
import type { PrivateTransfer, PrivateTransferStatusResponse } from './entities/private-transfer.entity';

/** Loofta's own cut of every private deposit/withdrawal, taken by MagicBlock as part of the same transfer. */
export const PRIVATE_BALANCE_PLATFORM_FEE_BPS = 10;

@Injectable()
export class PrivateBalanceService {
  private readonly logger = new Logger(PrivateBalanceService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly encryption: SendPaymentEncryptionService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly nearIntentsService: NearIntentsService,
  ) {}

  /** Resolve a {symbol, chain} token ref into the Near Intents fields other calls need. */
  async resolveNearToken(symbol: string, chain: string): Promise<{ tokenId: string; chain: string; symbol: string; decimals: number }> {
    const [tokenId, decimals] = await Promise.all([
      this.nearIntentsService.getDefuseAssetId(symbol, chain),
      this.nearIntentsService.getTokenDecimals(symbol, chain),
    ]);
    return { tokenId, chain, symbol, decimals };
  }

  async resolveSolanaUsdcNearToken(): Promise<{ tokenId: string; chain: string; symbol: string; decimals: number }> {
    return this.resolveNearToken('USDC', 'solana');
  }

  /** Server config is the source of truth — mainnet-only deployments ignore any client-supplied cluster. */
  resolveCluster(clientCluster?: 'devnet' | 'mainnet'): 'mainnet' | 'devnet' {
    const serverIsDevnet = isSolanaDevnetFromConfig(this.configService);
    return serverIsDevnet ? (clientCluster === 'mainnet' ? 'mainnet' : 'devnet') : 'mainnet';
  }

  /** The cluster string MagicBlock's API expects — folds in local-dev mode, which the DB doesn't track. */
  private resolveApiCluster(dbCluster: 'mainnet' | 'devnet'): 'devnet' | 'mainnet' | 'localhost' {
    return isSolanaLocalhostFromConfig(this.configService) ? 'localhost' : dbCluster;
  }

  getUsdcMint(cluster: 'mainnet' | 'devnet'): PublicKey {
    const mintStr = cluster === 'devnet'
      ? (this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
      : (this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    return new PublicKey(mintStr);
  }

  /** Generate a one-time burner keypair; secret encrypted with SEND_PAYMENT_ENC_KEY (same pattern as claim/send-payment burners). */
  createBurner(): { address: string; encryptedSecret: string } {
    if (!this.encryption.isAvailable()) {
      throw new ServiceUnavailableException('Private transfer is not configured. Please try again later.');
    }
    const burnerKeypair = Keypair.generate();
    const address = burnerKeypair.publicKey.toBase58();
    const encryptedSecret = this.encryption.encrypt(Buffer.from(burnerKeypair.secretKey), address);
    return { address, encryptedSecret };
  }

  decryptBurnerSecret(ciphertext: string, address: string): Keypair {
    if (!this.encryption.isAvailable()) {
      throw new ServiceUnavailableException('Private transfer signing is not configured.');
    }
    const secretKey = this.encryption.decrypt(ciphertext, address);
    return Keypair.fromSecretKey(new Uint8Array(secretKey));
  }

  private async getRow(id: string, userId: string): Promise<PrivateTransfer> {
    const { data, error } = await this.supabaseService.privateTransfers.select('*').eq('id', id).single();
    if (error || !data) throw new NotFoundException('Private transfer not found');
    const row = data as PrivateTransfer;
    if (row.user_id !== userId) throw new ForbiddenException('Not your private transfer');
    return row;
  }

  // ─────────────────────────────────────────────────────────────────
  // Private Deposit: external/other funds -> burner -> user's Loofta wallet
  // ─────────────────────────────────────────────────────────────────

  async startDeposit(userId: string, dto: StartPrivateDepositDto): Promise<{ id: string; depositAddress: string; memo?: string | null }> {
    // Cross-chain sources are built (see below + PrivateBalanceProcessorService) but disabled
    // until failed/refunded bridges have an automated recovery path — a failed cross-chain
    // deposit today refunds into the burner in the ORIGINAL source token, which nothing
    // currently detects or sweeps. Re-enable by removing this guard once that's handled.
    if (dto.source_token) {
      throw new BadRequestException('Private deposit currently supports USDC on Solana only — cross-chain sources are coming soon.');
    }

    const cluster = this.resolveCluster(dto.cluster);
    const burner = this.createBurner();

    // ── Direct: USDC on Solana straight to the burner, no Near Intents leg ──
    if (!dto.source_token) {
      if (!dto.amount_usdc) throw new BadRequestException('amount_usdc is required');

      const { data, error } = await this.supabaseService.privateTransfers.insert({
        user_id: userId,
        direction: 'deposit',
        status: 'awaiting_funds',
        burner_address: burner.address,
        burner_encrypted_secret: burner.encryptedSecret,
        amount_requested_usdc: dto.amount_usdc,
        cluster,
      }).select('id').single();

      if (error || !data) {
        this.logger.error(`startDeposit: insert failed: ${error?.message}`);
        throw new BadRequestException('Could not start private deposit. Please try again.');
      }

      this.logger.log(`[PrivateDeposit] ${data.id}: started (direct), burner=${burner.address.slice(0, 8)}… amount=${dto.amount_usdc} cluster=${cluster}`);
      return { id: data.id as string, depositAddress: burner.address };
    }

    // Guaranteed unreachable — the guard at the top of this method already rejected any request
    // with source_token set, so dto.source_token is always undefined here.
    throw new BadRequestException('Private deposit currently supports USDC on Solana only — cross-chain sources are coming soon.');
  }

  /**
   * Cross-chain: any Near-Intents-supported token -> burner (USDC on Solana). Not currently
   * called from startDeposit() — see the guard at its top — kept as a standalone, independently
   * type-checked method so it's ready to wire back in once failed-bridge refund recovery exists,
   * rather than bit-rotting as a dead inline branch.
   */
  private async startCrossChainDeposit(
    userId: string,
    dto: StartPrivateDepositDto & { source_token: NonNullable<StartPrivateDepositDto['source_token']> },
    burner: { address: string; encryptedSecret: string },
    cluster: 'mainnet' | 'devnet',
  ): Promise<{ id: string; depositAddress: string; memo?: string | null }> {
    if (!dto.source_amount) throw new BadRequestException('source_amount is required when source_token is set');

    const [fromToken, toToken] = await Promise.all([
      this.resolveNearToken(dto.source_token.symbol, dto.source_token.chain),
      this.resolveSolanaUsdcNearToken(),
    ]);

    let quote;
    try {
      quote = await this.nearIntentsService.getDepositQuote({
        fromToken,
        toToken,
        amountIn: dto.source_amount.toString(),
        recipient: burner.address,
        refundAddress: burner.address,
        referral: 'loofta',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Could not get a deposit address for ${dto.source_token.symbol}: ${msg}`);
    }
    if (!quote.depositAddress) {
      throw new BadRequestException(`Could not get a deposit address for ${dto.source_token.symbol}`);
    }

    // Estimated USDC output — informational only. Completion is driven by the Near Intents
    // bridge status reaching success, then delivering whatever actually lands in the burner —
    // never gated on this estimate matching exactly (swap rates move between quote and fill).
    const estimatedUsdc = Number(quote.amountOutFormatted) || 0;

    const { data, error } = await this.supabaseService.privateTransfers.insert({
      user_id: userId,
      direction: 'deposit',
      status: 'awaiting_funds',
      burner_address: burner.address,
      burner_encrypted_secret: burner.encryptedSecret,
      amount_requested_usdc: estimatedUsdc,
      cluster,
      source_or_dest_token: dto.source_token,
      near_deposit_address: quote.depositAddress,
      near_memo: quote.memo ?? null,
    }).select('id').single();

    if (error || !data) {
      this.logger.error(`startDeposit: insert failed: ${error?.message}`);
      throw new BadRequestException('Could not start private deposit. Please try again.');
    }

    this.logger.log(`[PrivateDeposit] ${data.id}: started (cross-chain ${dto.source_token.symbol}/${dto.source_token.chain}), burner=${burner.address.slice(0, 8)}… nearDeposit=${quote.depositAddress.slice(0, 8)}… estUsdc=${estimatedUsdc} cluster=${cluster}`);
    return { id: data.id as string, depositAddress: quote.depositAddress, memo: quote.memo ?? null };
  }

  // ─────────────────────────────────────────────────────────────────
  // Private Withdrawal: user's Loofta wallet -> burner -> destination
  // ─────────────────────────────────────────────────────────────────

  async buildWithdrawal(userId: string, dto: BuildPrivateWithdrawalDto): Promise<{ id: string } & MagicblockPrivateTransferClientResponse> {
    // Cross-chain destinations are built (see startOutboundBridge in PrivateBalanceProcessorService)
    // but disabled until failed/refunded bridges have an automated recovery path. Re-enable by
    // removing this guard once that's handled.
    if (dto.destination_token) {
      throw new BadRequestException('Private withdrawal currently supports USDC on Solana only — cross-chain destinations are coming soon.');
    }

    const destinationAddress = dto.destination_address.trim();
    if (!isValidSolanaAddress(destinationAddress)) {
      throw new BadRequestException('Invalid destination address');
    }

    const cluster = this.resolveCluster(dto.cluster);
    const apiCluster = this.resolveApiCluster(cluster);
    const mint = this.getUsdcMint(cluster);
    const baseUnits = Math.round(dto.amount_usdc * 1_000_000);

    // Server-resolved — never trust a client-supplied sender for the user's own balance.
    const userWallet = await this.usersService.getSolanaWalletAddress(userId);
    const burner = this.createBurner();
    const platformFeeAccount = this.solanaSponsor.getFeePayerAddress();

    let txResponse;
    try {
      txResponse = await requestMagicblockPrivateTransfer({
        from: userWallet,
        to: burner.address,
        mint: mint.toBase58(),
        amount: baseUnits,
        cluster: apiCluster,
        exactOut: true,
        gasless: true,
        ...(platformFeeAccount ? { platformFeeBps: PRIVATE_BALANCE_PLATFORM_FEE_BPS, platformFeeAccount } : {}),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[PrivateWithdrawal] build failed for user ${userId}: ${msg}`);
      throw new BadRequestException(`Could not build private withdrawal: ${msg}`);
    }

    const { data, error } = await this.supabaseService.privateTransfers.insert({
      user_id: userId,
      direction: 'withdrawal',
      status: 'awaiting_signature',
      burner_address: burner.address,
      burner_encrypted_secret: burner.encryptedSecret,
      amount_requested_usdc: dto.amount_usdc,
      cluster,
      destination_address: destinationAddress,
      source_or_dest_token: dto.destination_token ?? null,
    }).select('id').single();

    if (error || !data) {
      this.logger.error(`buildWithdrawal: insert failed: ${error?.message}`);
      throw new BadRequestException('Could not start private withdrawal. Please try again.');
    }

    const relayFeeUnits = Math.round(MAGICBLOCK_GAS_USDC * 1_000_000);
    const mbVolumeFeeUnits = estimateMagicblockGrossUp(baseUnits) - baseUnits;
    const conn = this.solanaSponsor.getConnectionForCluster(cluster);
    const actualDebitUnits = await decodeActualSenderDebit(txResponse.transactionBase64, userWallet, mint, conn);
    const estimatedFeeUnits = mbVolumeFeeUnits + relayFeeUnits;
    const feeUnits = (actualDebitUnits != null && actualDebitUnits > 0 && actualDebitUnits < baseUnits)
      ? mbVolumeFeeUnits + actualDebitUnits
      : estimatedFeeUnits;

    this.logger.log(`[PrivateWithdrawal] ${data.id}: built, burner=${burner.address.slice(0, 8)}… amount=${dto.amount_usdc} dest=${destinationAddress.slice(0, 8)}… cluster=${cluster}`);

    return {
      id: data.id as string,
      ...toClientResponse(txResponse, {
        feeAmountUsdc: feeUnits / 1_000_000,
        feeBreakdown: {
          looftaBpsUsdc: mbVolumeFeeUnits / 1_000_000,
          solRecoveryUsdc: relayFeeUnits / 1_000_000,
          solLamports: Math.round(MAGICBLOCK_GAS_USDC * 1e9),
          solPriceUsd: 0,
        },
      }),
    };
  }

  async recordWithdrawalSignature(id: string, userId: string, signature: string): Promise<void> {
    const row = await this.getRow(id, userId);
    if (row.direction !== 'withdrawal' || row.status !== 'awaiting_signature') {
      throw new BadRequestException('This private withdrawal is not awaiting a signature');
    }
    const { error } = await this.supabaseService.privateTransfers
      .update({ leg1_tx_signature: signature, status: 'delivering_to_burner' })
      .eq('id', id);
    if (error) {
      this.logger.error(`recordWithdrawalSignature: update failed for ${id}: ${error.message}`);
      throw new BadRequestException('Could not record signature');
    }
    this.logger.log(`[PrivateWithdrawal] ${id}: leg1 signature recorded sig=${signature.slice(0, 12)}…`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Status
  // ─────────────────────────────────────────────────────────────────

  async getStatus(id: string, userId: string): Promise<PrivateTransferStatusResponse> {
    const row = await this.getRow(id, userId);
    return {
      id: row.id,
      direction: row.direction,
      status: row.status,
      amountRequestedUsdc: Number(row.amount_requested_usdc),
      depositAddress: row.direction === 'deposit' ? (row.near_deposit_address || row.burner_address) : undefined,
      depositMemo: row.direction === 'deposit' ? row.near_memo : undefined,
      destinationAddress: row.destination_address,
      leg1TxSignature: row.leg1_tx_signature,
      leg2TxSignature: row.leg2_tx_signature,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
