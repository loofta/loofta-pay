import { randomBytes } from 'crypto';
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';
import { SupabaseService } from '@/database/supabase.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { UsersService } from '@/modules/users/users.service';
import { RelayService } from '../lottery/relay.service';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { CreateOfframpDto } from './dto/create-offramp.dto';
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { cashoutLooftaFeeAtomic } from '@/common/offramp-fee';

const SOLANA_USDC_MINT_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BASE_USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEFAULT_BASE_RPC = 'https://mainnet.base.org';
const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHORT_ID_MAX_VALID = Math.floor(256 / SHORT_ID_ALPHABET.length) * SHORT_ID_ALPHABET.length;
const PLATFORM_NAMES: Record<string, string> = { venmo: 'Venmo', cashapp: 'Cash App', revolut: 'Revolut' };

function generateShortId(length = 8): string {
  let result = '';
  while (result.length < length) {
    const bytes = randomBytes(length - result.length + 4);
    for (const byte of bytes) {
      if (byte < SHORT_ID_MAX_VALID && result.length < length) {
        result += SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length];
      }
    }
  }
  return result;
}

interface StoredRelayQuote {
  bridge: 'relay';
  requestId: string;
  instructions: { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }[];
  addressLookupTableAddresses: string[];
  requiredInputUnits: string;
  /** Loofta's cut, sent as a USDC transfer to the fee payer ATA in the same transaction. */
  looftaFeeUnits?: string;
}

function parseRelayQuote(memo: string | null | undefined): StoredRelayQuote | null {
  if (!memo) return null;
  try {
    const parsed = JSON.parse(memo) as StoredRelayQuote;
    if (parsed?.bridge !== 'relay' || !parsed.requestId || !parsed.instructions?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function peerDepositUrl(depositId: string | null | undefined): string | null {
  if (!depositId) return null;
  const escrowIdx = depositId.lastIndexOf('_');
  if (escrowIdx <= 0) return null;
  return `https://app.peer.xyz/deposit/${depositId.slice(0, escrowIdx)}/${depositId.slice(escrowIdx + 1)}`;
}

@Injectable()
export class OfframpService {
  private readonly logger = new Logger(OfframpService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly nearIntents: NearIntentsService,
    private readonly usersService: UsersService,
    private readonly relay: RelayService,
    private readonly solanaSponsor: SolanaSponsorService,
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
    // baseWalletAddress is client-supplied and gets real ETH from BASE_FUNDER_PRIVATE_KEY — must
    // be the caller's own wallet, or any authenticated user could drain the funder by looping this
    // with fresh throwaway addresses.
    const isOwnWallet = await this.usersService.isEvmAddressInLinkedAccounts(userId, baseWalletAddress);
    if (!isOwnWallet) {
      throw new ForbiddenException('baseWalletAddress must be one of your own linked wallets');
    }
    await this.ensureBaseGas(baseWalletAddress);
    return { funded: true };
  }

  // Non-custodial: bridge goes to the user's own Base wallet (dto.baseWalletAddress).
  async prepareOfframp(userId: string, dto: CreateOfframpDto) {
    // Same ownership requirement as fundGas — this also triggers a real ETH top-up below.
    const isOwnWallet = await this.usersService.isEvmAddressInLinkedAccounts(userId, dto.baseWalletAddress);
    if (!isOwnWallet) {
      throw new ForbiddenException('baseWalletAddress must be one of your own linked wallets');
    }
    const grossUnits = BigInt(Math.round(dto.amountUSDC * 1_000_000));
    const looftaFeeUnits = cashoutLooftaFeeAtomic(grossUnits);
    // Loofta's share is taken on Solana, so the bridge only has to land the rest on Base.
    const outputUnits = grossUnits - looftaFeeUnits;
    let relayQuote;
    try {
      relayQuote = await this.relay.getSolToBaseQuote({
        fromAddress: dto.solanaAddress,
        toAddress: dto.baseWalletAddress,
        outputUnits,
      });
    } catch (err: any) {
      this.logger.error('Relay quote failed:', err?.message ?? err);
      throw new BadRequestException(err?.message || 'Failed to quote the bridge to Base');
    }

    // Pre-fund user's Base wallet with gas so the cash-out signature doesn't fail.
    this.ensureBaseGas(dto.baseWalletAddress).catch(e => this.logger.warn('ensureBaseGas:', e.message));

    const shortId = generateShortId();
    const stored: StoredRelayQuote = {
      bridge: 'relay',
      requestId: relayQuote.requestId,
      instructions: relayQuote.instructions,
      addressLookupTableAddresses: relayQuote.addressLookupTableAddresses,
      requiredInputUnits: relayQuote.requiredInputUnits.toString(),
      looftaFeeUnits: looftaFeeUnits.toString(),
    };
    const row = {
      user_id:                      userId,
      platform:                     dto.platform,
      platform_identifier:          dto.identifier,
      currency:                     dto.currency.toUpperCase(),
      amount_usdc:                  dto.amountUSDC,
      user_solana_address:          dto.solanaAddress,
      near_intents_deposit_address: null,
      near_intents_memo:            JSON.stringify(stored),
      // Share code lives here too, so the public link works before the short_id column exists.
      near_intents_status:          `sid:${shortId}`,
      status:                       'PENDING_BRIDGE',
    };
    const client = this.supabase.getClient();
    let { data, error } = await client
      .from('offramp_requests')
      .insert({ ...row, short_id: shortId })
      .select('id')
      .single();

    if (error && /short_id/i.test(error.message ?? '')) {
      this.logger.warn('offramp_requests.short_id missing — share code stored on near_intents_status');
      ({ data, error } = await client
        .from('offramp_requests')
        .insert(row)
        .select('id')
        .single());
    }

    if (error || !data) {
      this.logger.error('Failed to insert offramp record:', error);
      throw new BadRequestException(error?.message || 'Failed to create offramp record');
    }

    return {
      id:             data.id,
      shortId,
      bridge:         'relay' as const,
      requestId:      relayQuote.requestId,
      amountInUsdc:   Number(relayQuote.requiredInputUnits + looftaFeeUnits) / 1_000_000,
      baseWallet:     dto.baseWalletAddress,
    };
  }

  private async loadRelayQuote(offrampId: string, userId: string): Promise<{ record: any; quote: StoredRelayQuote }> {
    const record = await this.getRecord(offrampId, userId);
    const quote = parseRelayQuote(record.near_intents_memo as string | null);
    if (!quote) throw new BadRequestException('This payment is not a Relay bridge');
    return { record, quote };
  }

  /** USDC transfer of Loofta's cut from the paying wallet to the fee payer ATA, or null when there is none. */
  private looftaFeeTransfer(userSolanaAddress: string, quote: StoredRelayQuote) {
    const amountUnits = BigInt(quote.looftaFeeUnits ?? '0');
    if (amountUnits <= 0n) return null;
    const feePayer = this.solanaSponsor.getFeePayerAddress();
    if (!feePayer) throw new BadRequestException('Fee payer not configured');
    const mint = new PublicKey(this.config.get<string>('SOLANA_USDC_MINT_MAINNET') || SOLANA_USDC_MINT_MAINNET);
    const owner = new PublicKey(userSolanaAddress);
    return {
      mint,
      owner,
      sourceAta: getAssociatedTokenAddressSync(mint, owner),
      destAta: getAssociatedTokenAddressSync(mint, new PublicKey(feePayer)),
      amountUnits,
    };
  }

  /** Unsigned Solana deposit for the stored Relay quote. Backend fee payer covers the fee. */
  async buildRelayDepositTx(offrampId: string, userId: string) {
    const { record, quote } = await this.loadRelayQuote(offrampId, userId);
    const feePayer = this.solanaSponsor.getFeePayerAddress();
    if (!feePayer) throw new BadRequestException('Fee payer not configured');
    const conn = this.solanaSponsor.getConnection();
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const ixs = quote.instructions.map(ix => new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map(k => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
      data: Buffer.from(ix.data, 'hex'),
    }));
    const fee = this.looftaFeeTransfer(record.user_solana_address, quote);
    if (fee) ixs.push(createTransferCheckedInstruction(fee.sourceAta, fee.mint, fee.destAta, fee.owner, fee.amountUnits, 6));
    const message = new TransactionMessage({
      payerKey: new PublicKey(feePayer),
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    return { transaction: Buffer.from(tx.serialize()).toString('base64'), requestId: quote.requestId };
  }

  async submitRelayDeposit(offrampId: string, userId: string, transactionBase64: string) {
    const { record, quote } = await this.loadRelayQuote(offrampId, userId);
    let signature: string;
    try {
      ({ signature } = await this.solanaSponsor.broadcastMatchedRelayDeposit({
        transactionBase64,
        userSolanaAddress: String(record.user_solana_address),
        instructions: quote.instructions,
        looftaFee: this.looftaFeeTransfer(record.user_solana_address, quote),
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('insufficient funds')) {
        throw new BadRequestException('Not enough USDC in your wallet for this cash out, including the bridge fee.');
      }
      throw err;
    }
    await this.updateStatus(offrampId, 'BRIDGING');
    return { signature, requestId: quote.requestId };
  }

  async getRelayStatus(offrampId: string, userId: string) {
    const { quote } = await this.loadRelayQuote(offrampId, userId);
    const status = await this.relay.getStatus(quote.requestId);
    return {
      status: status === 'DONE' ? 'SUCCESS' : status === 'FAILED' ? 'FAILED' : 'PENDING',
      requestId: quote.requestId,
    };
  }

  /** Public preview for a pay-to-Venmo/Cash App/Revolut share link. No wallets or user ids. */
  async getPublicShare(shortId: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shortId);
    const isShort = /^[0-9a-zA-Z]{8}$/.test(shortId);
    if (!isUuid && !isShort) throw new NotFoundException('Payment not found');
    const cols = 'id, platform, platform_identifier, currency, amount_usdc, status, eta_seconds, eta_label, zkp2p_deposit_id';
    const client = this.supabase.getClient();
    let data: any = null;
    let error: { message?: string } | null = null;
    if (isUuid) {
      ({ data, error } = await client.from('offramp_requests').select(cols).eq('id', shortId).maybeSingle());
    } else {
      ({ data, error } = await client.from('offramp_requests').select(cols).eq('short_id', shortId).maybeSingle());
      if (error && /short_id/i.test(error.message ?? '')) {
        ({ data, error } = await client.from('offramp_requests').select(cols).eq('near_intents_status', `sid:${shortId}`).maybeSingle());
      }
    }
    if (error || !data || data.status === 'DELETED') throw new NotFoundException('Payment not found');
    const platform = String(data.platform);
    return {
      id: data.id as string,
      platform,
      platformName: PLATFORM_NAMES[platform] ?? platform,
      identifier: data.platform_identifier as string,
      currency: data.currency as string,
      amountUsdc: Number(data.amount_usdc),
      status: data.status as string,
      etaSeconds: data.eta_seconds ?? null,
      etaLabel: data.eta_label ?? null,
      peerDepositUrl: peerDepositUrl(data.zkp2p_deposit_id as string | null),
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

    // A locked but unpaid deposit can be cancelled; one a peer has already paid cannot.
    await this.assertNotLockedByPeer(record, false);

    // DEPOSITED: user must sign ZKP2P withdrawDeposit + USDC bridge on Base.
    // Mark CANCELLING and let frontend drive the signing.
    await this.updateStatus(offrampId, 'CANCELLING');
    return {
      status: 'CANCELLING',
      zkp2pDepositId: record.zkp2p_deposit_id ?? null,
      refundNote: 'Sign the ZKP2P withdrawal and USDC bridge on Base to complete cancellation.',
    };
  }

  /**
   * Hides a cancelled pay from the owner's history. In-progress and completed pays stay.
   * Soft delete: the row is kept (status DELETED) so admin can still see who created it.
   */
  async deleteOfframp(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);
    if (record.status !== 'CANCELLED') {
      throw new BadRequestException('Only a cancelled payment can be deleted');
    }
    const { data, error } = await this.supabase.getClient()
      .from('offramp_requests')
      .update({ status: 'DELETED', updated_at: new Date().toISOString() })
      .eq('id', offrampId)
      .eq('user_id', userId)
      .eq('status', 'CANCELLED')
      .select('id');
    if (error) throw new BadRequestException('Could not delete this payment');
    if (!data?.length) throw new BadRequestException('Only a cancelled payment can be deleted');
    return { deleted: true };
  }

  // Called by frontend after it has completed ZKP2P withdrawal + Base→Solana USDC transfer.
  async markCancelled(offrampId: string, userId: string) {
    const record = await this.getRecord(offrampId, userId);
    if (['COMPLETE', 'FAILED'].includes(record.status)) {
      throw new BadRequestException(`Cannot mark cancelled from status ${record.status}`);
    }
    // Funds still locked by an unpaid peer stay in escrow until the lock expires, so don't finalise yet.
    await this.assertNotLockedByPeer(record, true);
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

    // Only the Base deposit can come back; Loofta's cut was already taken on Solana.
    const grossUnits = BigInt(Math.round(Number(record.amount_usdc) * 1_000_000));
    const amountUsdc = amountUsdcOverride ?? Number(grossUnits - cashoutLooftaFeeAtomic(grossUnits)) / 1_000_000;
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

  /**
   * Rescue for USDC stranded in the user's own Base wallet (e.g. a cancelled cash out whose bridge-back never
   * finished, or whose row is gone). Needs no offramp row: the user sends USDC from their own wallet to the
   * returned deposit address and it lands on their own Solana wallet. Both ends are resolved server-side.
   */
  async getRescueBridgeBack(userId: string, baseWalletAddress: string, amountUsdc: number) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(baseWalletAddress)) throw new BadRequestException('Invalid Base wallet address');
    if (!(amountUsdc > 0) || amountUsdc > 10_000) throw new BadRequestException('Invalid amount');
    if (!(await this.usersService.isEvmAddressInLinkedAccounts(userId, baseWalletAddress))) {
      throw new ForbiddenException('baseWalletAddress must be one of your own linked wallets');
    }
    const solanaAddress = await this.usersService.getSolanaWalletAddress(userId, { skipCache: true });
    const [baseUsdcId, solanaUsdcId] = await Promise.all([
      this.nearIntents.getDefuseAssetId('USDC', 'base'),
      this.nearIntents.getDefuseAssetId('USDC', 'solana'),
    ]);
    const quote = await this.nearIntents.getDepositQuote({
      fromToken: { tokenId: baseUsdcId,   chain: 'base',   symbol: 'USDC', decimals: 6 },
      toToken:   { tokenId: solanaUsdcId, chain: 'solana', symbol: 'USDC', decimals: 6 },
      amountIn:  amountUsdc.toString(),
      recipient: solanaAddress,
      refundAddress: baseWalletAddress,
    });
    if (!quote.depositAddress) throw new BadRequestException('Could not get a bridge address');
    this.logger.log(`rescue bridge-back: user=${userId} base=${baseWalletAddress} amount=${amountUsdc}`);
    return { depositAddress: quote.depositAddress, memo: quote.memo ?? null, amountUsdc };
  }

  // Returns the latest non-terminal offramp record for a user (for session recovery on the frontend).
  async getUserOfframps(userId: string, limit = 10) {
    const { data } = await this.supabase.getClient()
      .from('offramp_requests')
      .select('id, created_at, platform, platform_identifier, currency, amount_usdc, status, zkp2p_deposit_id, filled_amount_usdc, fill_state, completed_at, cancelled_at')
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

  /**
   * PENDING_BRIDGE rows are created at prepare time, before the Solana deposit is signed. When the
   * build/sign/broadcast step fails the user just retries and a new row is made, so the old ones
   * sit there forever. Nothing has moved on-chain at that point, so cancelling them is safe.
   * The status filter on the update keeps a row that just advanced to BRIDGING untouched.
   */
  async expireStalePendingBridges(maxAgeMinutes = 30) {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.getClient()
      .from('offramp_requests')
      .update({
        status: 'CANCELLED',
        cancelled_at: now,
        updated_at: now,
        error_message: 'Expired: the bridge deposit was never sent',
      })
      .eq('status', 'PENDING_BRIDGE')
      .lt('created_at', cutoff)
      .select('id');
    if (error) {
      this.logger.warn(`expireStalePendingBridges failed: ${error.message}`);
      return;
    }
    if (data?.length) this.logger.log(`Expired ${data.length} stale PENDING_BRIDGE offramp(s)`);
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

  /**
   * Re-reads Peer first so a stale DB row can't let a paid deposit through. Always blocks once a peer has paid.
   * A lock with nothing paid yet only blocks when `blockLocked` is set (finalising a cancel), because the locked
   * USDC cannot leave escrow until the lock expires or the buyer backs out.
   */
  private async assertNotLockedByPeer(record: any, blockLocked: boolean) {
    if (!record.zkp2p_deposit_id) return;
    const live = await this.checkFulfilment(record);
    const state = live?.state ?? record.fill_state;
    const filled = live?.filledUsdc ?? Number(record.filled_amount_usdc ?? 0);
    if (state === 'returned') return;
    if (filled > 0 || ['delivering', 'delivered'].includes(state ?? '')) {
      throw new BadRequestException('A peer has already paid this payment, so it can no longer be cancelled.');
    }
    if (blockLocked && state === 'matched') {
      throw new BadRequestException('A buyer has locked this payment but not paid yet. Your funds are released when their lock expires, then try again.');
    }
  }

  private async checkFulfilment(record: any): Promise<{ state: string | null; filledUsdc: number } | null> {
    try {
      const cash = await this.getCashClient();
      let state: string | null = null;
      let filledUsdc = 0;
      let inFlight = true;
      try {
        const order = await cash.order(record.zkp2p_deposit_id);
        state = order.state;
        filledUsdc = Number(order.filledAmount) / 1_000_000;
        inFlight = order.isInFlight;
      } catch {
        // Deposits priced under the oracle are hidden from cash.order(). Read the indexer row directly.
        const discounted = await this.readDiscountedDeposit(record.zkp2p_deposit_id);
        if (!discounted) return null;
        state = discounted.state;
        filledUsdc = discounted.filledUsdc;
        inFlight = discounted.inFlight;
      }

      // Completion detection must never be coupled to the fill-tracking columns below — if that
      // write fails for any reason (e.g. a migration lagging behind a deploy), status updates
      // should keep working independently.
      if (state === 'delivered' && !inFlight) {
        await this.supabase.getClient()
          .from('offramp_requests')
          .update({ status: 'COMPLETE', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', record.id);
      }

      await this.supabase.getClient()
        .from('offramp_requests')
        .update({
          filled_amount_usdc: filledUsdc,
          fill_state:         state,
          updated_at:         new Date().toISOString(),
        })
        .eq('id', record.id)
        .then(({ error }) => { if (error) this.logger.debug(`checkFulfilment fill columns ${record.id}:`, error.message); });
      return { state, filledUsdc };
    } catch (err: any) {
      this.logger.debug(`checkFulfilment ${record.id}:`, err.message);
      return null;
    }
  }

  /** Peer hides non-zero spreads from cash.order(). The indexer row still has the fill totals. */
  private async readDiscountedDeposit(depositId: string): Promise<{ state: string; filledUsdc: number; inFlight: boolean } | null> {
    const { IndexerClient, IndexerDepositService, defaultIndexerEndpoint } = await import('@zkp2p/sdk');
    const service = new IndexerDepositService(new IndexerClient(defaultIndexerEndpoint('PRODUCTION')));
    const rows = await service.fetchDepositsByIds([depositId]);
    const deposit = rows[0];
    if (!deposit) return null;
    const remaining = BigInt(deposit.remainingDeposits ?? 0);
    const outstanding = BigInt(deposit.outstandingIntentAmount ?? 0);
    const taken = BigInt(deposit.totalAmountTaken ?? 0);
    const withdrawn = BigInt(deposit.totalWithdrawn ?? 0);
    // Leftover spread smaller than one more fill can never be taken, so it isn't live funds.
    const minFill = BigInt(deposit.intentAmountMin ?? 0);
    const hasLiveFunds = remaining >= (minFill > 10_000n ? minFill : 10_000n) || outstanding > 0n;
    let state = 'awaiting-buyer';
    if (outstanding > 0n) state = taken > 0n ? 'delivering' : 'matched';
    else if (!hasLiveFunds && withdrawn > 0n) state = 'returned';
    else if (taken > 0n && !hasLiveFunds) state = 'delivered';
    else if (taken > 0n) state = 'delivering';
    const inFlight = state === 'awaiting-buyer' || state === 'matched' || state === 'delivering';
    return { state, filledUsdc: Number(taken) / 1_000_000, inFlight };
  }

  async getAllOfframps(page = 1, limit = 50) {
    const from = (page - 1) * limit;
    const { data, count, error } = await this.supabase.getClient()
      .from('offramp_requests')
      .select('id, created_at, updated_at, user_id, platform, platform_identifier, currency, amount_usdc, status, zkp2p_deposit_id, zkp2p_tx_hash, access_policy_tx_hash, eta_seconds, eta_label, filled_amount_usdc, fill_state, near_intents_deposit_address, completed_at, cancelled_at', { count: 'exact' })
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
