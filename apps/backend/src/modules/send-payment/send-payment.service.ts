import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import {
  MAGICBLOCK_GAS_USDC,
  MAGICBLOCK_VOLUME_FEE_BPS,
  SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS,
  ENABLE_SINGLE_PAYMENT_PLATFORM_FEE,
  estimateMagicblockGrossUp,
  resolveMagicblockRelayFeeUsdc,
} from '@/common/magicblock-private-transfer';
import { quoteAtaRentRecoveryUsdc } from '@/common/ata-rent-recovery';
import { guardAtaSponsorship } from '@/common/ata-sponsorship-guard';
import { reclaimBurnerFunds } from '@/common/burner-reclaim';
import { isValidSolanaSignature } from '@/common/solana-address';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService, type SocialPlatform } from '../users/users.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { BuildMultiSendDto } from './dto';
import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { isSolanaDevnetFromConfig, isSolanaLocalhostFromConfig, getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { EmailService } from '../email/email.service';
import { MagicblockQuestService } from '../magicblock-quest/magicblock-quest.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;

const DECIMALS = 6;

// Same generator as ClaimsService/TwitterPaymentsService — duplicated rather than shared per
// this codebase's existing convention (see claims.service.ts, twitter-payments.service.ts).
const SHORT_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHORT_ID_MAX_VALID = Math.floor(256 / SHORT_ID_ALPHABET.length) * SHORT_ID_ALPHABET.length;

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

@Injectable()
export class SendPaymentService {
  private readonly logger = new Logger(SendPaymentService.name);
  private readonly baseUrl: string;
  private readonly connection: Connection;
  private readonly feePayerKeypair: Keypair | null = null;
  private readonly usdcMint: PublicKey;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly encryption: SendPaymentEncryptionService,
    private readonly emailService: EmailService,
    private readonly magicblockQuest: MagicblockQuestService,
  ) {
    // Both the connection and the mint must branch on the SAME cluster decision
    // (isSolanaDevnetFromConfig) — previously this always resolved mainnet regardless of cluster
    // config, so a devnet-configured deployment would connect to devnet RPC (if SOLANA_RPC_URL
    // happened to be a devnet URL) while still transacting the mainnet USDC mint, or vice versa.
    // SOLANA_USDC_MINT (singular, cluster-agnostic) is no longer read here — see
    // SOLANA_USDC_MINT_MAINNET/_DEVNET below, same pattern as private-balance.service.ts.
    const isDevnetCluster = isSolanaDevnetFromConfig(this.configService);
    const mintStr = isDevnetCluster
      ? this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
      : this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    this.usdcMint = new PublicKey(mintStr);
    this.baseUrl = this.configService.get<string>('NEXT_PUBLIC_BASE_URL', 'https://pay.loofta.xyz');
    const rpcUrl = isDevnetCluster
      ? this.configService.get<string>('SOLANA_RPC_URL') ||
        this.configService.get<string>('SOLANA_DEVNET_RPC_URL') ||
        (this.configService.get<string>('HELIUS_API_KEY')
          ? `https://devnet.helius-rpc.com/?api-key=${this.configService.get('HELIUS_API_KEY')}`
          : 'https://api.devnet.solana.com')
      : getMainnetSolanaRpcUrl(this.configService);
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.logger.log(`[SendPayment] cluster=${isDevnetCluster ? 'devnet' : 'mainnet'} rpc=${rpcUrl}`);
    const pkRaw = this.configService.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    const pk = typeof pkRaw === 'string' ? pkRaw.trim().replace(/^["']|["']$/g, '') : '';
    this.logger.log(
      `[SendPayment] SOLANA_FEE_PAYER_PRIVATE_KEY: ${pk ? `present (length=${pk.length})` : 'NOT SET'}`,
    );
    if (pk) {
      try {
        let secret: Uint8Array;
        const first = pk.charAt(0);
        if (first === '[' || first === '{') {
          const arr = JSON.parse(pk) as number[];
          if (!Array.isArray(arr) || arr.length !== 64) {
            throw new Error('Key must be 64-byte array when using JSON format');
          }
          secret = Uint8Array.from(arr);
        } else {
          const decoded = bs58.decode(pk);
          secret = decoded instanceof Uint8Array ? decoded : new Uint8Array(decoded);
        }
        if (secret.length !== 32 && secret.length !== 64) {
          throw new Error(`Key must be 32 or 64 bytes after decode, got ${secret.length}`);
        }
        const keypair = Keypair.fromSecretKey(secret);
        this.feePayerKeypair = keypair;
        this.logger.log(`[SendPayment] Fee sponsor ENABLED: payer ${keypair.publicKey.toBase58().slice(0, 8)}...`);
      } catch (e) {
        const err = e as Error;
        this.logger.warn(
          `[SendPayment] Invalid SOLANA_FEE_PAYER_PRIVATE_KEY: ${err.message}. Multi-send sponsorship disabled.`,
        );
      }
    } else {
      this.logger.warn(
        '[SendPayment] SOLANA_FEE_PAYER_PRIVATE_KEY not set; multi-send will fail until set in backend env.',
      );
    }
  }

  /**
   * Build one combined SPL transfer transaction for multiple recipients.
   *
   * Why not MagicBlock per recipient? Each MagicBlock transfer is pre-signed by the MB
   * validator with its own blockhash — extracting instructions and merging them into a new
   * transaction would invalidate those signatures. A single direct SPL transfer transaction
   * is the correct approach for bulk sends: one sender signature, one broadcast, zero MB fee.
   *
   * Fee model: our fee-payer key sponsors SOL gas. Sender pays exactly the amounts they enter.
   * Recipients receive the exact amount entered (no BPS deduction). USDC ATAs are created
   * automatically for new recipients — but their rent is NOT free: whoever later closes that
   * ATA reclaims the rent for themselves, so an unrecovered sponsor-paid creation is a permanent
   * loss that can be cycled indefinitely (create, close, repeat). We charge a small ATA-rent
   * recovery fee (see ata-rent-recovery.ts) on top of the sender's entered amounts whenever this
   * transaction actually needs to create one or more new ATAs — recipients who already have an
   * ATA still cost nothing extra. This mirrors the fix MagicBlock made for their own hosted
   * Payments API after hitting the same sponsor-drain issue.
   *
   * For email recipients not yet on Loofta: funds land in a burner wallet and a claim email
   * is sent. For registered users: funds land directly in their wallet.
   */
  async buildMultiPrivateTransfer(
    senderUserId: string,
    dto: BuildMultiSendDto,
  ): Promise<{
    transactionBase64: string;
    version: 'v0';
    lastValidBlockHeight: number;
    links: Array<{ id: string; link: string; recipient_identifier: string; amount: string }>;
    payment_ids: string[];
    totalAmountUsdc: number;
    recipientCount: number;
    /** ATA-rent recovery charged on top of totalAmountUsdc; 0 when every recipient already has a USDC ATA. */
    networkFeeUsdc: number;
  }> {
    if (!this.feePayerKeypair) {
      throw new BadRequestException(
        'Gas sponsorship not configured (SOLANA_FEE_PAYER_PRIVATE_KEY). Cannot build multi-send transaction.',
      );
    }

    const isDevnet = isSolanaDevnetFromConfig(this.configService);
    const senderPubkey = new PublicKey(dto.sender_wallet.trim());
    const senderAta = await getAssociatedTokenAddress(this.usdcMint, senderPubkey);

    const PENDING_EMAIL_PREFIX = 'PENDING_EMAIL:';
    const PENDING_USERNAME_PREFIX = 'PENDING_USERNAME:';
    const PENDING_SOCIAL_PREFIX = 'PENDING_SOCIAL:';
    // Every row this call creates belongs to the same batch (see createMultiPayments for the
    // private-path counterpart) — kept consistent even though only the private hub-fanout flow
    // reads it today.
    const multiSendBatchId = randomUUID();

    type RecipientInfo = {
      normalizedId: string;
      recipientType: string;
      amountStr: string;
      amountUnits: bigint;
      toPubkey: PublicKey;
      toAta: PublicKey;
      paymentId: string;
      linkUrl: string;
      recipientEmail: string | null;
      isRegistered: boolean;
      message: string | null;
    };

    // ─── Phase 1: resolve wallets + create payment records (same table as single payments) ──
    const infos: RecipientInfo[] = [];

    for (const recipient of dto.recipients) {
      const normalizedId = this.normalizeIdentifier(recipient.recipient_type, recipient.recipient_identifier);
      const amountStr = String(recipient.amount);
      const amountUnits = BigInt(Math.round(parseFloat(amountStr) * 1_000_000));

      let resolvedPubkey: string | null = null;
      let recipientUserId: string | null = null;
      let isRegistered = false;

      try {
        if (recipient.recipient_type === 'username') {
          const u = await this.usersService.findByUsername(normalizedId);
          resolvedPubkey = await this.usersService.getSolanaWalletAddress(u.privyUserId);
          recipientUserId = u.privyUserId;
          isRegistered = true;
        } else if (recipient.recipient_type === 'email') {
          const u = await this.usersService.findByEmail(normalizedId);
          resolvedPubkey = await this.usersService.getSolanaWalletAddress(u.privyUserId);
          recipientUserId = u.privyUserId;
          isRegistered = true;
        } else if (recipient.recipient_type === 'discord' || recipient.recipient_type === 'github' || recipient.recipient_type === 'telegram') {
          const u = await this.usersService.findBySocialHandle(recipient.recipient_type, normalizedId);
          resolvedPubkey = await this.usersService.getSolanaWalletAddress(u.privyUserId);
          recipientUserId = u.privyUserId;
          isRegistered = true;
        }
      } catch {
        resolvedPubkey = null;
        isRegistered = false;
      }

      let toPubkey: PublicKey;
      let paymentInsert: Record<string, unknown>;

      if (isRegistered && resolvedPubkey) {
        // Registered user — send directly to their wallet (no burner needed)
        toPubkey = new PublicKey(resolvedPubkey);
        paymentInsert = {
          amount: parseFloat(amountStr),
          direction: 'from_sender',
          recipient_address: resolvedPubkey,
          recipient_user_id: recipientUserId,
          ...(recipient.recipient_type === 'email' ? { recipient_email: normalizedId } : {}),
          ...(recipient.recipient_type === 'username' ? { recipient_username: normalizedId } : {}),
          created_by: senderUserId,
          sender_user_id: senderUserId,
          status: 'OPEN',
          description: recipient.message || null,
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
          is_multi_send: true,
          // Explicit — this is the public combined-tx path, nothing about this send is private.
          // payments.is_private DEFAULTs to true at the DB level, so leaving this unset here was
          // showing a "Private" badge in the sender's own history for a payment sent in the open.
          is_private: false,
          multi_send_batch_id: multiSendBatchId,
        };
      } else {
        // Unregistered — create burner; recipient claims from /c/{id} after signing up
        const burner = Keypair.generate();
        const burnerEncryptedSecret = this.encryption.encrypt(Buffer.from(burner.secretKey));
        toPubkey = burner.publicKey;
        const recipientAddress = recipient.recipient_type === 'email'
          ? `${PENDING_EMAIL_PREFIX}${normalizedId}`
          : (recipient.recipient_type === 'discord' || recipient.recipient_type === 'github' || recipient.recipient_type === 'telegram' || recipient.recipient_type === 'twitter')
            ? `${PENDING_SOCIAL_PREFIX}${recipient.recipient_type}:${normalizedId}`
            : `${PENDING_USERNAME_PREFIX}${normalizedId}`;
        paymentInsert = {
          amount: parseFloat(amountStr),
          direction: 'from_sender',
          recipient_address: recipientAddress,
          ...(recipient.recipient_type === 'email' ? { recipient_email: normalizedId } : {}),
          created_by: senderUserId,
          sender_user_id: senderUserId,
          status: 'OPEN',
          description: recipient.message || null,
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
          recipient_was_unregistered: true,
          burner_address: burner.publicKey.toBase58(),
          burner_encrypted_secret: burnerEncryptedSecret,
          is_multi_send: true,
          is_private: false,
          multi_send_batch_id: multiSendBatchId,
        };
      }

      const toAta = await getAssociatedTokenAddress(this.usdcMint, toPubkey);

      const { data, error } = await this.supabaseService.payments
        .insert(paymentInsert)
        .select('id')
        .single();

      if (error) {
        throw new BadRequestException(`Failed to create payment for ${normalizedId}: ${error.message}`);
      }

      const paymentId = (data as { id: string }).id;
      const linkUrl = `${this.baseUrl}/share/${paymentId}`;

      this.logger.log(
        `[MultiSend] payment=${paymentId} recipient=${normalizedId} amount=${amountStr} registered=${isRegistered} to=${toPubkey.toBase58().slice(0, 8)}…`,
      );

      infos.push({
        normalizedId,
        recipientType: recipient.recipient_type,
        amountStr,
        amountUnits,
        toPubkey,
        toAta,
        paymentId,
        linkUrl,
        recipientEmail: recipient.recipient_type === 'email' ? normalizedId : null,
        isRegistered,
        message: recipient.message || null,
      });
    }

    // ─── Phase 2: batch-check which recipient ATAs exist (+ our own fee-payer USDC ATA,
    // needed below if we have to route a rent-recovery fee to it) ──────────────────────
    const feePayerUsdcAta = await getAssociatedTokenAddress(this.usdcMint, this.feePayerKeypair.publicKey);
    const allAtaKeys = [senderAta, feePayerUsdcAta, ...infos.map((r) => r.toAta)];
    const accountInfos = await this.connection.getMultipleAccountsInfo(allAtaKeys);

    if (accountInfos[0] === null) {
      throw new BadRequestException(
        'Your USDC token account does not exist. Please deposit USDC to your wallet first.',
      );
    }
    const feePayerAtaExists = accountInfos[1] !== null;

    const newAtaCount = infos.filter((_, i) => accountInfos[i + 2] === null).length;
    const recovery = await quoteAtaRentRecoveryUsdc(newAtaCount);
    if (recovery.newAtaCount > 0) {
      this.logger.log(
        `[MultiSend] ATA rent recovery: ${recovery.newAtaCount} new ATA(s) → $${recovery.totalUsdc.toFixed(4)} charged to sender (solPrice=${recovery.solPriceUsd ?? 'unavailable'})`,
      );
    }

    // ─── Phase 3: build combined transaction ──────────────────────────────────
    const instructions = [];

    if (recovery.totalUsdcUnits > 0 && !feePayerAtaExists) {
      // One-time bootstrap of our own USDC ATA — not a per-request cost, happens at most once ever.
      instructions.push(
        createAssociatedTokenAccountInstruction(
          this.feePayerKeypair.publicKey,
          feePayerUsdcAta,
          this.feePayerKeypair.publicKey,
          this.usdcMint,
        ),
      );
    }

    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      const recipientAtaExists = accountInfos[i + 2] !== null;

      if (!recipientAtaExists) {
        // Anti-drain guard — this cost IS recovered from the sender (recovery.totalUsdcUnits
        // below), so unlike the other sponsor-paid-ATA sites this isn't free money for a
        // recipient on its own. Still guarded as a backstop: don't rely solely on the rent-
        // recovery estimate being exactly right, and don't let a recipient farm free sponsored
        // accounts across many different senders' multi-sends just because no single sender
        // notices the pattern.
        const allowed = await guardAtaSponsorship(
          this.supabaseService,
          info.toPubkey.toBase58(),
          this.usdcMint.toBase58(),
          `multi-send:${info.toPubkey.toBase58()}`,
          this.emailService,
        );
        if (!allowed) {
          throw new BadRequestException(
            `Recipient ${info.toPubkey.toBase58().slice(0, 8)}… already received a sponsored token account once before and closed it. Remove them from this send or ask them to fund their own account first.`,
          );
        }
        instructions.push(
          createAssociatedTokenAccountInstruction(
            this.feePayerKeypair.publicKey,
            info.toAta,
            info.toPubkey,
            this.usdcMint,
          ),
        );
      }

      instructions.push(
        createTransferInstruction(senderAta, info.toAta, senderPubkey, info.amountUnits),
      );
    }

    if (recovery.totalUsdcUnits > 0) {
      instructions.push(
        createTransferInstruction(senderAta, feePayerUsdcAta, senderPubkey, recovery.totalUsdcUnits),
      );
    }

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: this.feePayerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([this.feePayerKeypair]);

    const transactionBase64 = Buffer.from(tx.serialize()).toString('base64');
    const totalAmountUsdc = infos.reduce((sum, r) => sum + parseFloat(r.amountStr), 0);

    // ─── Phase 4: fire-and-forget email per email recipient ────────────────────
    for (const info of infos) {
      if (!info.recipientEmail) continue;
      const emailData = {
        id: info.paymentId,
        amount: info.amountStr,
        description: info.message ?? undefined,
        recipientEmail: info.recipientEmail,
        claimUrl: info.linkUrl,
      };
      if (info.isRegistered) {
        this.emailService.sendPaymentReceivedEmail(emailData).catch((e: unknown) =>
          this.logger.warn(`[MultiSend] sendPaymentReceivedEmail failed for ${info.recipientEmail}: ${String(e)}`),
        );
      } else {
        this.emailService.sendClaimReadyEmail(emailData).catch((e: unknown) =>
          this.logger.warn(`[MultiSend] sendClaimReadyEmail failed for ${info.recipientEmail}: ${String(e)}`),
        );
      }
    }

    return {
      transactionBase64,
      version: 'v0',
      lastValidBlockHeight,
      links: infos.map((r) => ({ id: r.paymentId, link: r.linkUrl, recipient_identifier: r.normalizedId, amount: r.amountStr })),
      payment_ids: infos.map((r) => r.paymentId),
      totalAmountUsdc,
      recipientCount: infos.length,
      networkFeeUsdc: recovery.totalUsdc,
    };
  }

  /**
   * Sender has broadcast their one funding transfer (sender → this batch's fresh throwaway
   * burner) — flip every row in the batch OPEN → IN_FLIGHT immediately (the recipient's claim
   * page already renders IN_FLIGHT as "waiting for funds," never a stale OPEN or a pay prompt),
   * then kick off the server-side fan-out from the batch burner in the background. Nothing here
   * blocks the HTTP response; the sender's own signature is already done at this point.
   */
  confirmMultiSendBatchFunding(senderUserId: string, multiSendBatchId: string, txHash?: string): void {
    this.logger.log(`[MultiSendFunding] batch=${multiSendBatchId} funding tx broadcast txHash=${txHash?.slice(0, 12) ?? 'n/a'}`);
    this.finalizeMultiSendFunding(multiSendBatchId, senderUserId, txHash).catch((e) =>
      this.logger.warn(`[MultiSendFunding] batch=${multiSendBatchId} confirm failed: ${(e as Error)?.message}`),
    );
  }

  /** CAS the batch AWAITING_FUNDING → FUNDING_CONFIRMED (idempotent — a duplicate confirm call is
   *  a silent no-op), batch-flip its rows OPEN → IN_FLIGHT, then start the fan-out. */
  private async finalizeMultiSendFunding(multiSendBatchId: string, senderUserId: string, txHash?: string): Promise<void> {
    const nowIso = new Date().toISOString();
    const { data: updated, error } = await this.supabaseService.multiSendBatches
      .update({ status: 'FUNDING_CONFIRMED', funding_tx_hash: txHash ?? null, funded_at: nowIso })
      .eq('id', multiSendBatchId)
      .eq('sender_user_id', senderUserId)
      .eq('status', 'AWAITING_FUNDING')
      .select('id');
    if (error) {
      this.logger.warn(`[MultiSendFunding] batch=${multiSendBatchId} status update failed: ${error.message}`);
      return;
    }
    if (!updated?.length) {
      this.logger.log(`[MultiSendFunding] batch=${multiSendBatchId}: already confirmed (idempotent no-op)`);
      return;
    }
    const { error: rowsErr } = await this.supabaseService.payments
      .update({ status: 'IN_FLIGHT' })
      .eq('multi_send_batch_id', multiSendBatchId)
      .eq('sender_user_id', senderUserId)
      .eq('status', 'OPEN');
    if (rowsErr) {
      this.logger.warn(`[MultiSendFunding] batch=${multiSendBatchId}: failed to flip rows to IN_FLIGHT: ${rowsErr.message}`);
    }
    this.runMultiSendFanOut(multiSendBatchId).catch((e) =>
      this.logger.warn(`[MultiSendFanOut] batch=${multiSendBatchId} failed: ${(e as Error)?.message}`),
    );
  }

  async confirmMultiSend(senderUserId: string, paymentIds: string[], txHash?: string, feeUsdc?: number, clientIp?: string): Promise<void> {
    if (!paymentIds.length) return;

    // Client-supplied txHash is never chain-verified before this point (SolanaTxVerifierService
    // does that async, minutes later, for PRIVATE_TRANSFER_PENDING rows only). Reject anything
    // that can't even be a real signature here so a caller can't plant garbage in
    // sender_tx_hash and trigger a "you got paid" email off a transfer that never happened.
    if (txHash && !isValidSolanaSignature(txHash)) {
      this.logger.warn(
        `[MultiSend] REJECTED malformed tx_hash — user=${senderUserId} ip=${clientIp ?? 'unknown'} paymentIds=${paymentIds.join(',')} txHash="${txHash.slice(0, 32)}"`,
      );
      throw new BadRequestException('tx_hash is not a valid Solana transaction signature');
    }

    // Fetch rows first so we can split registered vs unregistered and compute per-row fees
    const { data: rows, error: fetchError } = await this.supabaseService.payments
      .select('id, amount, recipient_email, recipient_username, recipient_was_unregistered, burner_address, description')
      .in('id', paymentIds);
    if (fetchError) {
      this.logger.warn(`[MultiSend] confirmMultiSend fetch failure: ${fetchError.message}`);
      return;
    }

    const now = new Date().toISOString();
    const allRows = rows ?? [];

    // Compute fee per payment from stored amount (server-side; frontend value used as hint only)
    const computedFeeByPaymentId = new Map<string, number>(
      allRows.map((row) => {
        const amountUsd = parseFloat(String(row.amount || '0'));
        const baseUnits = Math.round(amountUsd * 1_000_000);
        const grossUnits = estimateMagicblockGrossUp(baseUnits);
        const computed = (grossUnits - baseUnits + Math.round(MAGICBLOCK_GAS_USDC * 1_000_000)) / 1_000_000;
        // Prefer frontend-passed value when available (may be more precise), otherwise fall back to estimate
        return [row.id as string, feeUsdc ?? computed];
      }),
    );

    // Track which IDs were successfully updated so we only email after confirmed DB write
    const successfullyUpdatedIds = new Set<string>();

    // Update each payment individually so each gets its own computed fee
    for (const row of allRows) {
      const paymentId = row.id as string;
      const rowFee = computedFeeByPaymentId.get(paymentId);
      const isUnregistered = !!row.recipient_was_unregistered;
      // A registered recipient can still have a burner_address set — the private fan-out
      // (runMultiSendFanOut) routes every recipient through their own dedicated burner,
      // registered or not, unlike the direct combined-tx path (buildMultiPrivateTransfer) which
      // sends registered recipients straight to their real wallet with no burner at all. Landing
      // in a burner is not the same as the recipient having the money — they still have to claim
      // it (see claimAsRecipient's existing "SUCCESS but burner still set" handling), so treat any
      // row with a burner the same as an unregistered one instead of trusting isUnregistered alone.
      const hasBurner = !!row.burner_address;
      const status = (isUnregistered || hasBurner) ? 'PRIVATE_TRANSFER_PENDING' : 'SUCCESS';
      const updatePayload: Record<string, unknown> = {
        status,
        sender_user_id: senderUserId,
        fee_paid_usdc: rowFee,
        ...(txHash ? { sender_tx_hash: txHash } : {}),
        ...(!isUnregistered ? { paid_at: now } : {}),
      };
      const { error } = await this.supabaseService.payments
        .update(updatePayload)
        .eq('id', paymentId)
        .eq('sender_user_id', senderUserId);
      if (error) {
        this.logger.warn(`[MultiSend] confirmMultiSend update failure id=${paymentId}: ${error.message}`);
      } else {
        this.logger.log(`[MultiSend] marked payment=${paymentId} ${status} fee=${rowFee?.toFixed(4) ?? 'n/a'} txHash=${txHash?.slice(0, 12) ?? 'n/a'}`);
        successfullyUpdatedIds.add(paymentId);
        // PRIVATE_TRANSFER_PENDING qualifies too, same as claims.service.ts's updateStatus — the
        // sender's leg into the burner is already confirmed at that status, and waiting for
        // SUCCESS risks the recipient's later non-private claim overwriting is_private back to
        // false first (see maybePushPrivatePaymentQuest's comment), silently dropping the push.
        if (status === 'SUCCESS' || status === 'PRIVATE_TRANSFER_PENDING') {
          this.magicblockQuest.maybePushPrivatePaymentQuest(paymentId).catch((e) =>
            this.logger.warn(`MagicBlock quest push failed for payment ${paymentId}: ${(e as Error)?.message}`),
          );
        }
      }
    }

    // Only send emails for payments whose status was successfully written to DB
    for (const row of allRows) {
      if (!successfullyUpdatedIds.has(row.id as string)) {
        this.logger.warn(`[MultiSend] skipping email for ${row.id} — status update failed`);
        continue;
      }
      const recipientEmail = (row.recipient_email as string | null) || null;
      let email = recipientEmail;
      if (!email && row.recipient_username) {
        try {
          const u = await this.usersService.findByUsername(row.recipient_username as string);
          email = u.email?.trim().toLowerCase() || null;
        } catch { /* no account */ }
      }
      if (!email) continue;
      const claimUrl = `${this.baseUrl}/c/${row.id}`;
      const isDev = this.configService.get<string>('NODE_ENV') === 'development';
      const scheduledAt = isDev ? undefined : new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const emailData = { id: row.id, amount: String(row.amount), description: (row.description as string | null) ?? undefined, recipientEmail: email, claimUrl, scheduledAt };
      if (row.recipient_was_unregistered) {
        this.emailService.sendClaimReadyEmail(emailData).catch((e: unknown) =>
          this.logger.warn(`[MultiSend] sendClaimReadyEmail failed for ${email}: ${String(e)}`));
      } else {
        this.emailService.sendPaymentReceivedEmail(emailData).catch((e: unknown) =>
          this.logger.warn(`[MultiSend] sendPaymentReceivedEmail failed for ${email}: ${String(e)}`));
      }
    }
  }

  /**
   * A private multi-send recipient's own fee, computed exactly like a normal single private
   * payment (ClaimsService.buildPrivateTransferForPayer's feeOnSender formula: MagicBlock's own
   * bps + Loofta's SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS, gross-up on the amount, plus one flat
   * relay fee) — no batch discount, computed per row every time it's used (estimate, funding
   * total, and the real charge applied on the fan-out leg all call this same function so they
   * never drift from each other). relayFeeUnits should come from resolveRelayFeeUnits(), which
   * already carries this codebase's safety margin for live SOL/USD drift.
   */
  private singlePaymentFeeUnits(amountBaseUnits: number, relayFeeUnits: number): number {
    const totalBps = MAGICBLOCK_VOLUME_FEE_BPS + (ENABLE_SINGLE_PAYMENT_PLATFORM_FEE ? SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS : 0);
    const grossUnits = estimateMagicblockGrossUp(amountBaseUnits, totalBps);
    return (grossUnits - amountBaseUnits) + relayFeeUnits;
  }

  /**
   * Build the sender's ONE funding transfer for a multi-send batch — a plain SPL transfer, sender
   * wallet → a fresh, single-use burner generated just for this batch (never the shared fee-payer
   * wallet: a reused, discoverable custodial address is what let the old hub design be drained —
   * see .claude/skills/solana-sponsor-safety). Deliberately NOT a MagicBlock private transfer:
   * this leg confirms instantly with no delivery-delay wait for the sender, and the sender's own
   * outbound transfer to an anonymous single-use burner is by itself not very revealing. Privacy
   * is preserved where it matters — each individual recipient payout (runMultiSendFanOut,
   * triggered from confirmMultiSendBatchFunding once this tx confirms) is still its own MagicBlock
   * private transfer. The funding amount covers every recipient's amount PLUS that recipient's own
   * single-payment fee, computed per row — not a batch-blended discount — so the burner always
   * holds enough for every individual fan-out leg's own relay + platform fee.
   */
  async buildMultiSendBatchFunding(
    senderUserId: string,
    multiSendBatchId: string,
    senderWallet: string,
    requestCluster?: 'devnet' | 'mainnet',
  ): Promise<{
    transactionBase64: string;
    version: 'v0';
    sendTo: 'base';
    feeAmountUsdc: number;
    paymentIds: string[];
    totalAmountUsdc: number;
  }> {
    if (!this.feePayerKeypair) {
      throw new BadRequestException('Gas sponsorship not configured (SOLANA_FEE_PAYER_PRIVATE_KEY). Cannot build batch funding transfer.');
    }

    const { data: batch, error: batchErr } = await this.supabaseService.multiSendBatches
      .select('id, status')
      .eq('id', multiSendBatchId)
      .eq('sender_user_id', senderUserId)
      .single();
    if (batchErr || !batch) {
      throw new BadRequestException('Multi-send batch not found for this sender.');
    }
    if ((batch as { status: string }).status !== 'AWAITING_FUNDING') {
      throw new BadRequestException('This batch has already been funded.');
    }

    const { data: rows, error } = await this.supabaseService.payments
      .select('id, amount')
      .eq('multi_send_batch_id', multiSendBatchId)
      .eq('sender_user_id', senderUserId)
      .eq('status', 'OPEN');
    if (error || !rows?.length) {
      throw new BadRequestException('Multi-send batch not found for this sender.');
    }

    const cluster: 'devnet' | 'mainnet' = isSolanaDevnetFromConfig(this.configService)
      ? 'devnet'
      : (requestCluster ?? 'mainnet');
    const effectiveMint = cluster === 'mainnet'
      ? new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      : new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || this.usdcMint.toBase58());

    const relayFeeUnits = await this.resolveRelayFeeUnits();
    let totalFundingBaseUnits = 0;
    let totalFeeUsdc = 0;
    for (const row of rows) {
      const amountUnits = Math.round(parseFloat(String(row.amount || '0')) * 1_000_000);
      const feeUnits = this.singlePaymentFeeUnits(amountUnits, relayFeeUnits);
      totalFundingBaseUnits += amountUnits + feeUnits;
      totalFeeUsdc += feeUnits / 1_000_000;
    }

    const burner = Keypair.generate();
    const burnerEncryptedSecret = this.encryption.encrypt(Buffer.from(burner.secretKey));
    const { error: updateErr } = await this.supabaseService.multiSendBatches
      .update({
        burner_address: burner.publicKey.toBase58(),
        burner_encrypted_secret: burnerEncryptedSecret,
        total_funded_base_units: totalFundingBaseUnits,
      })
      .eq('id', multiSendBatchId)
      .eq('status', 'AWAITING_FUNDING');
    if (updateErr) {
      throw new BadRequestException(`Failed to prepare batch funding: ${updateErr.message}`);
    }

    const senderPubkey = new PublicKey(senderWallet.trim());
    const senderAta = await getAssociatedTokenAddress(effectiveMint, senderPubkey);
    const burnerAta = await getAssociatedTokenAddress(effectiveMint, burner.publicKey);

    const senderAtaInfo = await this.connection.getAccountInfo(senderAta);
    if (!senderAtaInfo) {
      throw new BadRequestException('Your USDC token account does not exist. Please deposit USDC to your wallet first.');
    }

    // Plain SPL transfer, not a MagicBlock private transfer — this leg's only job is getting funds
    // into the batch's own throwaway burner fast, with an instant on-chain confirmation for the
    // sender (no MagicBlock delivery delay). Privacy is preserved on the recipient-facing side
    // instead: each fan-out leg (runMultiSendFanOut, burner → recipient) is still an individual
    // MagicBlock private transfer. The burner's own ATA is guaranteed not to exist yet (freshly
    // generated key, can't have prior on-chain history), so creating it here is unconditional — the
    // fee payer fronts that rent and gets it back via reclaimBurnerFunds when the batch completes,
    // same as every other burner in this codebase.
    const instructions = [
      createAssociatedTokenAccountInstruction(this.feePayerKeypair.publicKey, burnerAta, burner.publicKey, effectiveMint),
      createTransferInstruction(senderAta, burnerAta, senderPubkey, totalFundingBaseUnits),
    ];

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: this.feePayerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([this.feePayerKeypair]);

    this.logger.log(
      `[MultiSendFunding] batch=${multiSendBatchId} rows=${rows.length} totalFundingBaseUnits=${totalFundingBaseUnits} burner=${burner.publicKey.toBase58().slice(0, 8)}… feeUsdc=${totalFeeUsdc.toFixed(4)}`,
    );

    return {
      transactionBase64: Buffer.from(tx.serialize()).toString('base64'),
      version: 'v0',
      sendTo: 'base',
      feeAmountUsdc: totalFeeUsdc,
      paymentIds: rows.map((r) => r.id as string),
      totalAmountUsdc: rows.reduce((sum, r) => sum + parseFloat(String(r.amount || '0')), 0),
    };
  }

  /**
   * Cron entry point: finds batches whose fan-out evidently died mid-flight (funded a while ago,
   * still not COMPLETED) and resumes them. Safe to call anytime — runMultiSendFanOut's own CAS
   * only lets it actually proceed on a batch that's genuinely stale, and its row-level claiming
   * means a batch that's still legitimately in progress is simply skipped, not disturbed.
   */
  async retryStuckMultiSendBatches(): Promise<void> {
    const staleThreshold = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data: stuck, error } = await this.supabaseService.multiSendBatches
      .select('id')
      .in('status', ['FUNDING_CONFIRMED', 'FANNING_OUT'])
      .not('funded_at', 'is', null)
      .lt('funded_at', staleThreshold);
    if (error) {
      this.logger.warn(`[MultiSendRetry] failed to query stuck batches: ${error.message}`);
      return;
    }
    for (const row of (stuck ?? []) as Array<{ id: string }>) {
      this.logger.log(`[MultiSendRetry] resuming stuck batch=${row.id}`);
      await this.runMultiSendFanOut(row.id).catch((e) =>
        this.logger.warn(`[MultiSendRetry] batch=${row.id} resume failed: ${(e as Error)?.message}`),
      );
    }
  }

  /**
   * Polls a broadcast signature for confirmation without assuming we have its original
   * blockhash/lastValidBlockHeight on hand (a resumed leg from a prior crashed run won't).
   *
   * Three distinct outcomes, not two — collapsing 'errored' into 'pending' was a real bug: a
   * signature that failed on-chain (e.g. a destination ATA that didn't exist yet at the moment
   * this specific transaction landed) returns the exact same finalized `err` forever. Treating
   * that as "not confirmed yet, check again later" meant a retry just re-polled a permanently
   * dead signature on every future pass, never actually trying again — the row was stuck for
   * good even though the underlying cause (e.g. the destination account) may since have resolved.
   */
  private async waitForConfirmation(signature: string, timeoutMs = 60_000): Promise<'confirmed' | 'errored' | 'pending'> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value } = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      if (value?.err) return 'errored';
      if (value?.confirmationStatus === 'confirmed' || value?.confirmationStatus === 'finalized') return 'confirmed';
      await new Promise((r) => setTimeout(r, 1500));
    }
    return 'pending';
  }

  /**
   * Fan out this batch's freshly-funded burner to each recipient with its own individual
   * MagicBlock private transfer, one at a time, signed directly by the burner's own key (server-
   * held, no user interaction) — no artificial delay between legs, each finalizes independently
   * as fast as build+broadcast+confirm allows.
   *
   * Idempotency, two layers:
   *  - Batch-level: this function only proceeds past a CAS on multi_send_batches.status (fresh
   *    FUNDING_CONFIRMED, or a stale FANNING_OUT whose fan_out_started_at is old enough that the
   *    previous attempt evidently died — the only caller that can legitimately hit the stale
   *    branch is the retryStuckMultiSendBatches cron). Only one runner can own a batch at a time.
   *  - Row-level (the one that actually prevents a double payment): a row's payments.sender_tx_hash
   *    starts NULL. Before sending anything, this claims the row by writing the sentinel
   *    'CLAIMED' with `.is('sender_tx_hash', null)` — a second runner racing the same row loses
   *    the claim and skips it. Once a real signature exists (broadcast succeeded), it is NEVER
   *    resent — a resumed run just re-polls that same signature and finalizes the row's status.
   */
  private async runMultiSendFanOut(batchId: string): Promise<void> {
    const nowIso = new Date().toISOString();
    const staleThreshold = new Date(Date.now() - 15 * 60_000).toISOString();

    let claim = await this.supabaseService.multiSendBatches
      .update({ status: 'FANNING_OUT', fan_out_started_at: nowIso })
      .eq('id', batchId)
      .eq('status', 'FUNDING_CONFIRMED')
      .select('id, sender_user_id, burner_address, burner_encrypted_secret, total_funded_base_units');
    if (claim.error) {
      this.logger.warn(`[MultiSendFanOut] batch=${batchId}: claim (fresh) failed: ${claim.error.message}`);
      return;
    }
    if (!claim.data?.length) {
      // Not fresh — only take over a FANNING_OUT batch whose previous attempt has gone stale.
      claim = await this.supabaseService.multiSendBatches
        .update({ status: 'FANNING_OUT', fan_out_started_at: nowIso })
        .eq('id', batchId)
        .eq('status', 'FANNING_OUT')
        .lt('fan_out_started_at', staleThreshold)
        .select('id, sender_user_id, burner_address, burner_encrypted_secret, total_funded_base_units');
      if (claim.error || !claim.data?.length) {
        this.logger.log(`[MultiSendFanOut] batch=${batchId}: not claimable (already running, done, or not yet stale)`);
        return;
      }
    }

    const batch = claim.data[0] as {
      sender_user_id: string;
      burner_address: string;
      burner_encrypted_secret: string;
      total_funded_base_units: number | null;
    };
    const burnerSecret = this.encryption.decrypt(batch.burner_encrypted_secret);
    const burnerKeypair = Keypair.fromSecretKey(burnerSecret);

    const cluster: 'devnet' | 'mainnet' | 'localhost' = isSolanaLocalhostFromConfig(this.configService)
      ? 'localhost'
      : (isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet');
    const feePayerUsdcAta = await getAssociatedTokenAddress(this.usdcMint, this.feePayerKeypair!.publicKey);
    const relayFeeUnits = await this.resolveRelayFeeUnits();

    // No burner-balance wait needed here (unlike an earlier version of this function): the funding
    // leg is now a plain SPL transfer (see buildMultiSendBatchFunding), not a MagicBlock private
    // transfer — its on-chain confirmation IS the delivery, atomically, in the same transaction.
    // confirmMultiSendBatchFunding only flips rows to IN_FLIGHT and calls this function after that
    // confirmation already happened, so the burner is guaranteed funded by the time we get here.

    const { data: rows, error: rowsErr } = await this.supabaseService.payments
      .select('id, amount, burner_address, sender_tx_hash')
      .eq('multi_send_batch_id', batchId)
      .eq('status', 'IN_FLIGHT');
    if (rowsErr) {
      this.logger.warn(`[MultiSendFanOut] batch=${batchId}: failed to load rows: ${rowsErr.message}`);
      return;
    }

    for (const row of (rows ?? []) as Array<{ id: string; amount: string; burner_address: string | null; sender_tx_hash: string | null }>) {
      const existingHash = (row.sender_tx_hash || '').trim() || null;
      try {
        let sig: string;
        if (existingHash && existingHash !== 'CLAIMED') {
          // A prior run already broadcast this row's leg (real money moved) — never resend, just
          // pick the confirmation back up.
          sig = existingHash;
        } else {
          if (!existingHash) {
            const rowClaim = await this.supabaseService.payments
              .update({ sender_tx_hash: 'CLAIMED' })
              .eq('id', row.id)
              .is('sender_tx_hash', null)
              .select('id');
            if (!rowClaim.data?.length) {
              this.logger.log(`[MultiSendFanOut] payment=${row.id}: claimed by another run, skipping`);
              continue;
            }
          }
          // existingHash === 'CLAIMED' here means a prior run claimed this row and died before
          // broadcasting anything — safe to retake, nothing was sent. Both branches converge here.
          const burnerAddress = (row.burner_address || '').trim();
          if (!burnerAddress) {
            this.logger.warn(`[MultiSendFanOut] payment=${row.id}: no burner_address, skipping`);
            continue;
          }
          const amountUnits = Math.round(parseFloat(String(row.amount || '0')) * 1_000_000);

          const { requestMagicblockPrivateTransfer } = await import('@/common/magicblock-private-transfer');
          const txResponse = await requestMagicblockPrivateTransfer({
            from: burnerKeypair.publicKey.toBase58(),
            to: burnerAddress,
            mint: this.usdcMint.toBase58(),
            amount: amountUnits,
            cluster: cluster === 'localhost' ? 'devnet' : cluster,
            exactOut: true,
            gasless: true,
            ...(ENABLE_SINGLE_PAYMENT_PLATFORM_FEE
              ? { platformFeeBps: SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS, platformFeeAccount: feePayerUsdcAta.toBase58() }
              : {}),
          });
          const txBytes = Buffer.from(txResponse.transactionBase64, 'base64');
          const vtx = VersionedTransaction.deserialize(txBytes);
          vtx.sign([burnerKeypair]);
          sig = await this.connection.sendRawTransaction(vtx.serialize(), { skipPreflight: true, maxRetries: 3 });
          await this.supabaseService.payments.update({ sender_tx_hash: sig }).eq('id', row.id);
          this.logger.log(`[MultiSendFanOut] payment=${row.id} leg broadcast burner=${burnerAddress.slice(0, 8)}… sig=${sig.slice(0, 12)}…`);
        }

        const outcome = await this.waitForConfirmation(sig);
        if (outcome === 'pending') {
          this.logger.warn(`[MultiSendFanOut] payment=${row.id}: leg ${sig.slice(0, 12)}… not confirmed yet — will retry on next fan-out pass`);
          continue;
        }
        if (outcome === 'errored') {
          // A definitively failed signature never changes outcome on re-poll — clearing the claim
          // here (not just on a pre-broadcast failure) is what lets the NEXT pass build and send
          // an actual new transaction instead of re-checking a permanently dead one forever. Seen
          // for real: a fan-out leg attempted before the destination's token account existed yet
          // failed with InvalidAccountData on-chain — retrying with a fresh transaction after the
          // account exists succeeds normally.
          this.logger.warn(`[MultiSendFanOut] payment=${row.id}: leg ${sig.slice(0, 12)}… failed on-chain — releasing claim for a fresh attempt next pass`);
          await this.supabaseService.payments.update({ sender_tx_hash: null }).eq('id', row.id).eq('sender_tx_hash', sig);
          continue;
        }
        const amountUnits = Math.round(parseFloat(String(row.amount || '0')) * 1_000_000);
        const rowFeeUsdc = this.singlePaymentFeeUnits(amountUnits, relayFeeUnits) / 1_000_000;
        await this.confirmMultiSend(batch.sender_user_id, [row.id], sig, rowFeeUsdc);
        this.logger.log(`[MultiSendFanOut] payment=${row.id} confirmed sig=${sig.slice(0, 12)}…`);
      } catch (e) {
        this.logger.warn(`[MultiSendFanOut] payment=${row.id} failed: ${String(e)}`);
        // Only release the claim if nothing was actually sent — if a real signature already
        // landed in sender_tx_hash, leave it; a retry must never re-send, only re-confirm.
        await this.supabaseService.payments.update({ sender_tx_hash: null }).eq('id', row.id).eq('sender_tx_hash', 'CLAIMED');
      }
    }

    const { count: remainingCount } = await this.supabaseService.payments
      .select('id', { count: 'exact', head: true })
      .eq('multi_send_batch_id', batchId)
      .eq('status', 'IN_FLIGHT');
    if (!remainingCount) {
      await this.supabaseService.multiSendBatches
        .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
        .eq('id', batchId);
      try {
        await reclaimBurnerFunds(this.connection, burnerKeypair, this.feePayerKeypair!);
        await this.supabaseService.multiSendBatches
          .update({ burner_reclaimed_at: new Date().toISOString() })
          .eq('id', batchId);
      } catch (e) {
        this.logger.warn(`[MultiSendFanOut] batch=${batchId}: burner reclaim failed (cron will retry): ${String(e)}`);
      }
      this.logger.log(`[MultiSendFanOut] batch=${batchId}: COMPLETED`);
    }
  }

  /**
   * Step 1 of multi-send: create N payment records only — NO MagicBlock calls yet.
   * Returns payment IDs, claim links, and per-recipient fee estimates.
   */
  async createMultiPayments(
    senderUserId: string,
    dto: BuildMultiSendDto,
  ): Promise<{
    payment_ids: string[];
    links: Array<{ id: string; link: string; short_id: string; recipient_identifier: string; amount: string }>;
    fee_items: Array<{ payment_id: string; recipient_identifier: string; amount: string; fee_usdc: number }>;
    total_amount_usdc: number;
    total_fee_usdc: number;
    recipient_count: number;
    multi_send_batch_id: string;
  }> {
    const isDevnet = isSolanaDevnetFromConfig(this.configService);
    // Every row this call creates belongs to the same batch — the batch-funding build/fan-out
    // steps use this to look up every sibling row without threading payment_ids arrays through
    // extra plumbing.
    const multiSendBatchId = randomUUID();

    const PENDING_EMAIL_PREFIX = 'PENDING_EMAIL:';
    const PENDING_USERNAME_PREFIX = 'PENDING_USERNAME:';
    // Matches ClaimsService.PENDING_SOCIAL_PREFIX exactly — multi-send inserts into the same
    // shared `payments` table the claims module reads, so PENDING_SOCIAL: rows created here are
    // already understood by ClaimsService.checkIsRecipient/claimAsRecipient with no further work.
    const PENDING_SOCIAL_PREFIX = 'PENDING_SOCIAL:';

    const payment_ids: string[] = [];
    const links: Array<{ id: string; link: string; short_id: string; recipient_identifier: string; amount: string }> = [];
    const fee_items: Array<{ payment_id: string; recipient_identifier: string; amount: string; fee_usdc: number }> = [];
    let total_amount_usdc = 0;
    let total_fee_usdc = 0;

    const relayFeeUnitsForEstimate = await this.resolveRelayFeeUnits();

    const { error: batchInsertErr } = await this.supabaseService.multiSendBatches.insert({
      id: multiSendBatchId,
      sender_user_id: senderUserId,
      sender_wallet: dto.sender_wallet,
      status: 'AWAITING_FUNDING',
    });
    if (batchInsertErr) {
      throw new BadRequestException(`Failed to create multi-send batch: ${batchInsertErr.message}`);
    }

    for (const recipient of dto.recipients) {
      const normalizedId = this.normalizeIdentifier(recipient.recipient_type, recipient.recipient_identifier);
      const amountStr = String(recipient.amount);
      const amountUsd = parseFloat(amountStr);
      const shortId = generateShortId();

      let resolvedPubkey: string | null = null;
      let recipientUserId: string | null = null;
      let isRegistered = false;
      try {
        if (recipient.recipient_type === 'username') {
          const u = await this.usersService.findByUsername(normalizedId);
          resolvedPubkey = await this.usersService.getSolanaWalletAddress(u.privyUserId);
          recipientUserId = u.privyUserId;
          isRegistered = true;
        } else if (recipient.recipient_type === 'email') {
          const u = await this.usersService.findByEmail(normalizedId);
          resolvedPubkey = await this.usersService.getSolanaWalletAddress(u.privyUserId);
          recipientUserId = u.privyUserId;
          isRegistered = true;
        } else if (recipient.recipient_type === 'discord' || recipient.recipient_type === 'github' || recipient.recipient_type === 'telegram') {
          const u = await this.usersService.findBySocialHandle(recipient.recipient_type, normalizedId);
          resolvedPubkey = await this.usersService.getSolanaWalletAddress(u.privyUserId);
          recipientUserId = u.privyUserId;
          isRegistered = true;
        }
      } catch {
        resolvedPubkey = null;
        isRegistered = false;
      }

      // This function only ever backs the private-send path (createPayments/executePayment in
      // MultiSendFlow.tsx) — the public combined-tx path uses buildMultiPrivateTransfer instead,
      // which creates its own rows and sends registered recipients straight to their real wallet.
      // Every row here needs a burner as the private-transfer destination regardless of
      // registration status, since buildPrivateTransferForPayer/resolveEffectiveRecipientForPrivatePayment
      // (claims.service.ts) always resolves the private hop's destination from claim_burner_address —
      // registered recipients still get identified for the claim via recipient_user_id
      // (checkIsRecipient, claims.service.ts:1231-1234), same pattern already used elsewhere for
      // "registered recipient, burner used as intermediary" (claims.service.ts:1285-1286).
      const burner = Keypair.generate();
      const burnerEncryptedSecret = this.encryption.encrypt(Buffer.from(burner.secretKey));
      let paymentInsert: Record<string, unknown>;

      if (isRegistered && resolvedPubkey) {
        paymentInsert = {
          amount: amountUsd,
          direction: 'from_sender',
          recipient_address: resolvedPubkey,
          recipient_user_id: recipientUserId,
          ...(recipient.recipient_type === 'email' ? { recipient_email: normalizedId } : {}),
          ...(recipient.recipient_type === 'username' ? { recipient_username: normalizedId } : {}),
          created_by: senderUserId,
          sender_user_id: senderUserId,
          status: 'OPEN',
          description: recipient.message || null,
          from_chain: 'solana',
          from_token: 'USDC',
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
          short_id: shortId,
          recipient_was_unregistered: false,
          burner_address: burner.publicKey.toBase58(),
          burner_encrypted_secret: burnerEncryptedSecret,
          is_multi_send: true,
          is_private: true,
          multi_send_batch_id: multiSendBatchId,
        };
      } else {
        const recipientAddress = recipient.recipient_type === 'email'
          ? `${PENDING_EMAIL_PREFIX}${normalizedId}`
          : (recipient.recipient_type === 'discord' || recipient.recipient_type === 'github' || recipient.recipient_type === 'telegram' || recipient.recipient_type === 'twitter')
            ? `${PENDING_SOCIAL_PREFIX}${recipient.recipient_type}:${normalizedId}`
            : `${PENDING_USERNAME_PREFIX}${normalizedId}`;
        paymentInsert = {
          amount: amountUsd,
          direction: 'from_sender',
          recipient_address: recipientAddress,
          ...(recipient.recipient_type === 'email' ? { recipient_email: normalizedId } : {}),
          created_by: senderUserId,
          sender_user_id: senderUserId,
          status: 'OPEN',
          description: recipient.message || null,
          from_chain: 'solana',
          from_token: 'USDC',
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
          short_id: shortId,
          recipient_was_unregistered: true,
          burner_address: burner.publicKey.toBase58(),
          burner_encrypted_secret: burnerEncryptedSecret,
          is_multi_send: true,
          is_private: true,
          multi_send_batch_id: multiSendBatchId,
        };
      }

      const { data, error } = await this.supabaseService.payments
        .insert(paymentInsert)
        .select('id')
        .single();

      if (error) {
        throw new BadRequestException(`Failed to create payment for ${normalizedId}: ${error.message}`);
      }

      const paymentId = (data as { id: string }).id;
      const linkUrl = `${this.baseUrl}/share/${shortId}`;

      // This row's own real cost — the same formula that's actually charged on its fan-out leg
      // (singlePaymentFeeUnits), not a pro-rata split of a batch-blended number.
      const baseUnits = Math.round(amountUsd * 1_000_000);
      const feeUsdc = this.singlePaymentFeeUnits(baseUnits, relayFeeUnitsForEstimate) / 1_000_000;

      this.logger.log(
        `[MultiSendCreate] payment=${paymentId} recipient=${normalizedId} amount=${amountStr} registered=${isRegistered} feeUsdc=${feeUsdc}`,
      );

      payment_ids.push(paymentId);
      links.push({ id: paymentId, link: linkUrl, short_id: shortId, recipient_identifier: normalizedId, amount: amountStr });
      fee_items.push({ payment_id: paymentId, recipient_identifier: normalizedId, amount: amountStr, fee_usdc: feeUsdc });
      total_amount_usdc += amountUsd;
      total_fee_usdc += feeUsdc;
    }

    return {
      payment_ids,
      links,
      fee_items,
      total_amount_usdc,
      total_fee_usdc,
      recipient_count: dto.recipients.length,
      multi_send_batch_id: multiSendBatchId,
    };
  }

  private normalizeIdentifier(type: 'email' | 'twitter' | 'username' | SocialPlatform, value: string): string {
    const v = value.trim();
    if (type === 'email') return v.toLowerCase();
    // Strip a trailing Discord discriminator (e.g. "username#0") — senders no longer need to
    // type one; see UsersService.normalizeRecipientIdentifier for the matching counterpart.
    return v.replace(/^@/, '').replace(/#\d+$/, '').toLowerCase();
  }

  /**
   * MagicBlock's flat relay fee, priced live so estimates don't drift stale as SOL/USD moves —
   * delegates to resolveMagicblockRelayFeeUsdc, which already carries a floor + 5% safety margin
   * (see that function's doc comment) so a batch's funding transfer can't leave the burner short
   * for one of its later fan-out legs purely from price drift between build time and send time.
   */
  private async resolveRelayFeeUnits(): Promise<number> {
    const relayFeeUsdc = await resolveMagicblockRelayFeeUsdc();
    return Math.round(relayFeeUsdc * 1_000_000);
  }
}
