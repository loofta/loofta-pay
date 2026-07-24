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
  MAGICBLOCK_GAS_SOL,
  MAGICBLOCK_VOLUME_FEE_BPS,
  MULTI_SEND_LOOFTA_PLATFORM_FEE_BPS,
  ENABLE_MULTI_SEND_PLATFORM_FEE,
  estimateMagicblockGrossUp,
  fetchSolPriceUsd,
} from '@/common/magicblock-private-transfer';
import { quoteAtaRentRecoveryUsdc } from '@/common/ata-rent-recovery';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService, type SocialPlatform } from '../users/users.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { BuildMultiSendDto } from './dto';
import { Keypair, Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { isSolanaDevnetFromConfig, isSolanaLocalhostFromConfig } from '@/common/solana-cluster-env';
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
    const mintStr =
      this.configService.get<string>('SOLANA_USDC_MINT') ||
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    this.usdcMint = new PublicKey(mintStr);
    this.baseUrl = this.configService.get<string>('NEXT_PUBLIC_BASE_URL', 'https://pay.loofta.xyz');
    const rpcUrl =
      this.configService.get<string>('SOLANA_RPC_URL') ||
      (this.configService.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.configService.get('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');
    this.connection = new Connection(rpcUrl, 'confirmed');
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
   * Sender has broadcast their one hub transfer for a private multi-send batch — kick off the
   * server-side fan-out (poll hub balance, then a plain SPL transfer per recipient burner) in
   * the background. Nothing here blocks the HTTP response; the sender's own signature is already
   * done at this point. Each recipient's row moves to PRIVATE_TRANSFER_PENDING/SUCCESS as its own
   * fan-out transfer confirms (see fanOutMultiSendHubTransfer → confirmMultiSend per row).
   */
  confirmMultiSendHub(senderUserId: string, multiSendBatchId: string, txHash?: string): void {
    this.logger.log(`[MultiSendHub] batch=${multiSendBatchId} hub transfer broadcast txHash=${txHash?.slice(0, 12) ?? 'n/a'} — starting fan-out`);
    this.fanOutMultiSendHubTransfer(multiSendBatchId, senderUserId).catch((e) =>
      this.logger.warn(`[MultiSendFanOut] batch=${multiSendBatchId} failed: ${(e as Error)?.message}`),
    );
  }

  async confirmMultiSend(senderUserId: string, paymentIds: string[], txHash?: string, feeUsdc?: number): Promise<void> {
    if (!paymentIds.length) return;

    // Fetch rows first so we can split registered vs unregistered and compute per-row fees
    const { data: rows, error: fetchError } = await this.supabaseService.payments
      .select('id, amount, recipient_email, recipient_username, recipient_was_unregistered, description')
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
      const status = isUnregistered ? 'PRIVATE_TRANSFER_PENDING' : 'SUCCESS';
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
        if (status === 'SUCCESS') {
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
   * Build the sender's ONE private MagicBlock transfer for a multi-send batch — sender wallet →
   * hub (Loofta's own fee-payer wallet). Requires createMultiPayments to have already run for
   * this batch (rows + multiSendBatchId must exist). This is the sender's only signature for the
   * whole batch; the hub then fans out to each recipient's own burner with plain SPL transfers
   * (fanOutMultiSendHubTransfer, triggered from confirmMultiSend once this tx is broadcast).
   *
   * Why not a second MagicBlock private transfer for the fan-out too? MagicBlock charges its fee
   * per transfer call, not per batch — a second private hop would double-charge it. A plain
   * transfer out of a wallet that was itself funded privately costs network fee only and doesn't
   * expose the sender (only "a known Loofta wallet paid burner X", never who funded the hub).
   */
  async buildMultiSendHubTransfer(
    senderUserId: string,
    multiSendBatchId: string,
    senderWallet: string,
    requestCluster?: 'devnet' | 'mainnet',
  ): Promise<{
    transactionBase64: string;
    version: string;
    sendTo: string;
    feeAmountUsdc: number;
    paymentIds: string[];
    totalAmountUsdc: number;
  }> {
    if (!this.feePayerKeypair) {
      throw new BadRequestException('Gas sponsorship not configured (SOLANA_FEE_PAYER_PRIVATE_KEY). Cannot build hub transfer.');
    }
    const { requestMagicblockPrivateTransfer } = await import('@/common/magicblock-private-transfer');

    const { data: rows, error } = await this.supabaseService.payments
      .select('id, amount')
      .eq('multi_send_batch_id', multiSendBatchId)
      .eq('sender_user_id', senderUserId);
    if (error || !rows?.length) {
      throw new BadRequestException('Multi-send batch not found for this sender.');
    }

    const cluster: 'devnet' | 'mainnet' | 'localhost' = isSolanaLocalhostFromConfig(this.configService)
      ? 'localhost'
      : (requestCluster ?? (isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet'));
    const effectiveMint = cluster === 'mainnet'
      ? new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      : new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || this.usdcMint.toBase58());

    const totalBaseUnits = rows.reduce((sum, r) => sum + Math.round(parseFloat(String(r.amount || '0')) * 1_000_000), 0);
    const hubAddress = this.feePayerKeypair.publicKey.toBase58();

    const relayFeeUnits = await this.resolveRelayFeeUnits();
    // Cap Loofta's cut so the batch's actual charge never exceeds what N separate per-recipient
    // private transfers would have cost — a fixed bps rate can't guarantee that on its own since
    // it scales with dollar amount while the thing multi-send actually saves (fewer flat relay
    // fees) doesn't. See computeDynamicPlatformFeeBps.
    // (Disabled altogether — see ENABLE_MULTI_SEND_PLATFORM_FEE — until MagicBlock confirms the
    // platformFeeBps + exactOut combination that broke claims.service.ts's single-payment path.)
    const dynamicLooftaBps = ENABLE_MULTI_SEND_PLATFORM_FEE ? this.computeDynamicPlatformFeeBps(rows, totalBaseUnits, relayFeeUnits) : 0;

    // Clean batch total + exactOut:true — MagicBlock grosses up the sender's debit internally so
    // the hub nets exactly totalBaseUnits. platformFeeBps/platformFeeAccount take Loofta's own
    // cut in the same call, additive to MagicBlock's own bps.
    const txResponse = await requestMagicblockPrivateTransfer({
      from: senderWallet.trim(),
      to: hubAddress,
      mint: effectiveMint.toBase58(),
      amount: totalBaseUnits,
      cluster: cluster === 'localhost' ? 'devnet' : cluster,
      exactOut: true,
      gasless: true,
      ...(ENABLE_MULTI_SEND_PLATFORM_FEE ? { platformFeeBps: dynamicLooftaBps, platformFeeAccount: hubAddress } : {}),
    });

    const totalBps = MAGICBLOCK_VOLUME_FEE_BPS + dynamicLooftaBps;
    const grossUnits = estimateMagicblockGrossUp(totalBaseUnits, totalBps);
    const feeAmountUsdc = (grossUnits - totalBaseUnits + relayFeeUnits) / 1_000_000;

    this.logger.log(
      `[MultiSendHub] batch=${multiSendBatchId} rows=${rows.length} totalBaseUnits=${totalBaseUnits} hub=${hubAddress.slice(0, 8)}… sendTo=${txResponse.sendTo} looftaBps=${dynamicLooftaBps} feeUsdc=${feeAmountUsdc.toFixed(4)}`,
    );

    return {
      transactionBase64: txResponse.transactionBase64,
      version: txResponse.version,
      sendTo: txResponse.sendTo,
      feeAmountUsdc,
      paymentIds: rows.map((r) => r.id as string),
      totalAmountUsdc: totalBaseUnits / 1_000_000,
    };
  }

  /**
   * Fan out the hub's freshly-received batch total to each recipient's own burner with plain,
   * non-private SPL transfers signed by the fee-payer keypair — same low-level pattern as the
   * dust-sweep code in ClaimsService.sweepClaimBurnerPrivately. No proportional fee on this hop
   * (network fee only), so recipients receive their exact listed amount by construction.
   *
   * Fire-and-forget from confirmMultiSend once the sender's hub transfer is broadcast — the
   * sender-side signature is already done at that point, nothing here blocks the HTTP response.
   */
  private async fanOutMultiSendHubTransfer(multiSendBatchId: string, senderUserId: string): Promise<void> {
    if (!this.feePayerKeypair) {
      this.logger.warn(`[MultiSendFanOut] batch=${multiSendBatchId}: no fee payer keypair configured, cannot fan out`);
      return;
    }
    const feePayerKp = this.feePayerKeypair;

    const { data: rows, error } = await this.supabaseService.payments
      .select('id, amount, burner_address, recipient_was_unregistered')
      .eq('multi_send_batch_id', multiSendBatchId)
      .eq('sender_user_id', senderUserId)
      .eq('status', 'OPEN');
    if (error || !rows?.length) {
      this.logger.warn(`[MultiSendFanOut] batch=${multiSendBatchId}: fetch failed or no OPEN rows (${error?.message ?? 'none'})`);
      return;
    }

    const totalBaseUnits = rows.reduce((sum, r) => sum + Math.round(parseFloat(String(r.amount || '0')) * 1_000_000), 0);
    const relayFeeUnits = await this.resolveRelayFeeUnits();
    // Best-effort re-derivation of the bps actually used at buildMultiSendHubTransfer time — same
    // formula, same rows, so deterministic unless the live SOL price moved between the two calls
    // (fee_paid_usdc is already an estimate elsewhere in this file, not reconciled against
    // on-chain ground truth, so this drift is consistent with the existing precision bar).
    const dynamicLooftaBps = this.computeDynamicPlatformFeeBps(rows, totalBaseUnits, relayFeeUnits);
    const totalBps = MAGICBLOCK_VOLUME_FEE_BPS + dynamicLooftaBps;
    const batchFeeUnits = estimateMagicblockGrossUp(totalBaseUnits, totalBps) - totalBaseUnits + relayFeeUnits;

    const hubAta = await getAssociatedTokenAddress(this.usdcMint, feePayerKp.publicKey);

    // Poll until the hub's balance covers the batch — MagicBlock's private-delivery delay
    // (1-10 min randomized on mainnet) still applies to the sender→hub leg.
    const deadline = Date.now() + 11 * 60_000;
    let balance = BigInt(0);
    while (Date.now() < deadline) {
      try {
        balance = (await getAccount(this.connection, hubAta)).amount;
      } catch { /* hub ATA may not exist yet on the very first batch ever */ }
      if (balance >= BigInt(totalBaseUnits)) break;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    if (balance < BigInt(totalBaseUnits)) {
      this.logger.warn(`[MultiSendFanOut] batch=${multiSendBatchId}: hub balance ${balance} never reached ${totalBaseUnits} within timeout`);
      return;
    }
    this.logger.log(`[MultiSendFanOut] batch=${multiSendBatchId}: hub funded (${balance} units) — fanning out to ${rows.length} recipients`);

    for (const row of rows as Array<{ id: string; amount: string; burner_address: string | null; recipient_was_unregistered: boolean | null }>) {
      // Jittered timing softens batch-correlation — an observer watching the hub's public txs
      // sees recipients funded at spread-out times instead of one obvious burst of N transfers.
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20_000)));
      try {
        const burnerAddress = (row.burner_address || '').trim();
        if (!burnerAddress) {
          this.logger.warn(`[MultiSendFanOut] payment=${row.id}: no burner_address, skipping`);
          continue;
        }
        const destPubkey = new PublicKey(burnerAddress);
        const destAta = await getAssociatedTokenAddress(this.usdcMint, destPubkey);
        const rowUnits = Math.round(parseFloat(String(row.amount || '0')) * 1_000_000);

        const tx = new Transaction();
        let destAtaExists = true;
        try { await getAccount(this.connection, destAta); } catch { destAtaExists = false; }
        if (!destAtaExists) {
          // Fresh one-time burner — no create→close→responsor drain vector like a real wallet's
          // ATA would have, so this skips guardAtaSponsorship (same as the public multi-send
          // path's burner ATA creation in buildMultiPrivateTransfer).
          tx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, destAta, destPubkey, this.usdcMint));
        }
        tx.add(createTransferInstruction(hubAta, destAta, feePayerKp.publicKey, rowUnits));
        tx.recentBlockhash = (await this.connection.getLatestBlockhash('confirmed')).blockhash;
        tx.feePayer = feePayerKp.publicKey;
        tx.sign(feePayerKp);
        const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });

        const rowFeeUsdc = totalBaseUnits > 0 ? (batchFeeUnits * rowUnits) / totalBaseUnits / 1_000_000 : 0;
        // Reuses confirmMultiSend's existing per-row status/email logic (PRIVATE_TRANSFER_PENDING
        // vs SUCCESS, paid_at, quest push, claim-ready/payment-received emails) instead of
        // duplicating it — one row at a time so each gets its own pro-rated fee share.
        await this.confirmMultiSend(senderUserId, [row.id], sig, rowFeeUsdc);
        this.logger.log(`[MultiSendFanOut] payment=${row.id} funded burner=${burnerAddress.slice(0, 8)}… sig=${sig.slice(0, 12)}…`);
      } catch (e) {
        this.logger.warn(`[MultiSendFanOut] payment=${row.id} fan-out failed: ${String(e)}`);
      }
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
    // Every row this call creates belongs to the same batch — the hub-funded private fan-out
    // (buildMultiSendHubTransfer + the fan-out step it triggers) uses this to look up every
    // sibling row without threading payment_ids arrays through extra plumbing.
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

    // Batch-level fee (one MagicBlock private transfer, sender → hub, for the whole batch) —
    // not a per-row fee. MagicBlock's own 10bps + Loofta's platformFeeBps, plus one flat relay
    // fee, gross-up computed on the batch total. Distributed proportionally below purely for the
    // per-row fee_items display; the actual charge is the single hub transfer's own gross-up.
    const totalBatchBaseUnits = dto.recipients.reduce((sum, r) => sum + Math.round(Number(r.amount) * 1_000_000), 0);
    const relayFeeUnitsForEstimate = await this.resolveRelayFeeUnits();
    const dynamicLooftaBpsForEstimate = this.computeDynamicPlatformFeeBps(dto.recipients, totalBatchBaseUnits, relayFeeUnitsForEstimate);
    const totalBps = MAGICBLOCK_VOLUME_FEE_BPS + dynamicLooftaBpsForEstimate;
    const batchGrossUnits = estimateMagicblockGrossUp(totalBatchBaseUnits, totalBps);
    const batchFeeUnits = batchGrossUnits - totalBatchBaseUnits + relayFeeUnitsForEstimate;
    const total_fee_usdc = batchFeeUnits / 1_000_000;

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

      // This row's proportional share of the one batch-level fee — display only, not a
      // separately-charged amount (the hub transfer charges the batch total once).
      const baseUnits = Math.round(amountUsd * 1_000_000);
      const feeUsdc = totalBatchBaseUnits > 0 ? (batchFeeUnits * baseUnits) / totalBatchBaseUnits / 1_000_000 : 0;

      this.logger.log(
        `[MultiSendCreate] payment=${paymentId} recipient=${normalizedId} amount=${amountStr} registered=${isRegistered} feeUsdc=${feeUsdc}`,
      );

      payment_ids.push(paymentId);
      links.push({ id: paymentId, link: linkUrl, short_id: shortId, recipient_identifier: normalizedId, amount: amountStr });
      fee_items.push({ payment_id: paymentId, recipient_identifier: normalizedId, amount: amountStr, fee_usdc: feeUsdc });
      total_amount_usdc += amountUsd;
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
    return v.replace(/^@/, '').toLowerCase();
  }

  /**
   * MagicBlock's flat relay fee is 0.002 SOL, not a fixed USD amount — price it live so fee
   * estimates don't drift stale as SOL/USD moves. Falls back to the flat MAGICBLOCK_GAS_USDC
   * approximation only if the price fetch fails (fetchSolPriceUsd never fakes a price itself).
   */
  private async resolveRelayFeeUnits(): Promise<number> {
    const solPriceUsd = await fetchSolPriceUsd();
    const relayFeeUsdc = solPriceUsd ? MAGICBLOCK_GAS_SOL * solPriceUsd : MAGICBLOCK_GAS_USDC;
    return Math.round(relayFeeUsdc * 1_000_000);
  }

  /**
   * Caps Loofta's platformFeeBps on a batch's hub transfer so the actual charge never exceeds
   * what N separate per-recipient private transfers (the pre-hub model) would have cost, minus a
   * small guaranteed-savings buffer — "multi-send is cheaper" holds by construction instead of
   * only for large-enough batches. A fixed bps rate can't guarantee this on its own: Loofta's cut
   * scales with the dollar amount, but what multi-send actually saves (fewer flat relay fees)
   * doesn't — so for a small batch of large payments the extra bps can outweigh the flat-fee
   * savings. Walks down from MULTI_SEND_LOOFTA_PLATFORM_FEE_BPS to 0 and returns the highest bps
   * that still clears the target; 0 (MagicBlock's own rate only, no Loofta cut) always clears it,
   * since at bps=0 the new model is the old model's bps rate plus one flat fee instead of N.
   */
  private computeDynamicPlatformFeeBps(
    rows: Array<{ amount: string | number | null }>,
    totalBaseUnits: number,
    relayFeeUnits: number,
  ): number {
    const GUARANTEED_SAVINGS_UNITS = 30_000; // $0.03 buffer so cent-rounding never erases the shown discount
    const oldModelFeeUnits = rows.reduce((sum, r) => {
      const net = Math.round(parseFloat(String(r.amount ?? '0')) * 1_000_000);
      if (net <= 0) return sum;
      const gross = estimateMagicblockGrossUp(net, MAGICBLOCK_VOLUME_FEE_BPS);
      return sum + (gross - net) + relayFeeUnits;
    }, 0);
    const targetMaxFeeUnits = oldModelFeeUnits - GUARANTEED_SAVINGS_UNITS;

    for (let bps = MULTI_SEND_LOOFTA_PLATFORM_FEE_BPS; bps > 0; bps--) {
      const gross = estimateMagicblockGrossUp(totalBaseUnits, MAGICBLOCK_VOLUME_FEE_BPS + bps);
      const newFeeUnits = (gross - totalBaseUnits) + relayFeeUnits;
      if (newFeeUnits <= targetMaxFeeUnits) return bps;
    }
    return 0;
  }
}
