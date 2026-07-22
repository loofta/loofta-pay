import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MAGICBLOCK_GAS_USDC, estimateMagicblockGrossUp } from '@/common/magicblock-private-transfer';
import { quoteAtaRentRecoveryUsdc } from '@/common/ata-rent-recovery';
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
   * Build one MagicBlock private transfer transaction per recipient.
   * Creates N payment records (identical to single payments) then calls MagicBlock
   * for each so the frontend can sign all N transactions in one go.
   */
  async buildMultiPrivateMagicblock(
    senderUserId: string,
    dto: BuildMultiSendDto,
  ): Promise<{
    transactions: Array<{
      paymentId: string;
      recipientIdentifier: string;
      amount: string;
      transactionBase64: string;
      version: string;
      sendTo: string;
      feeAmountUsdc: number;
    }>;
    links: Array<{ id: string; link: string; recipient_identifier: string; amount: string }>;
    payment_ids: string[];
    totalAmountUsdc: number;
    recipientCount: number;
  }> {
    const { requestMagicblockPrivateTransfer } = await import('@/common/magicblock-private-transfer');
    const isDevnet = isSolanaDevnetFromConfig(this.configService);
    const cluster: 'devnet' | 'mainnet' | 'localhost' = isSolanaLocalhostFromConfig(this.configService) ? 'localhost' : isDevnet ? 'devnet' : 'mainnet';
    const effectiveMint = cluster === 'mainnet'
      ? new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      : new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || this.usdcMint.toBase58());

    const PENDING_EMAIL_PREFIX = 'PENDING_EMAIL:';
    const PENDING_USERNAME_PREFIX = 'PENDING_USERNAME:';
    const PENDING_SOCIAL_PREFIX = 'PENDING_SOCIAL:';

    const transactions: Array<{
      paymentId: string; recipientIdentifier: string; amount: string;
      transactionBase64: string; version: string; sendTo: string; feeAmountUsdc: number;
    }> = [];
    const links: Array<{ id: string; link: string; recipient_identifier: string; amount: string }> = [];
    const payment_ids: string[] = [];
    let totalAmountUsdc = 0;

    for (const recipient of dto.recipients) {
      const normalizedId = this.normalizeIdentifier(recipient.recipient_type, recipient.recipient_identifier);
      const amountStr = String(recipient.amount);
      const amountUsd = parseFloat(amountStr);

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

      let toPubkey: string;
      let paymentInsert: Record<string, unknown>;

      if (isRegistered && resolvedPubkey) {
        toPubkey = resolvedPubkey;
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
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
          is_multi_send: true,
        };
      } else {
        const burner = Keypair.generate();
        const burnerEncryptedSecret = this.encryption.encrypt(Buffer.from(burner.secretKey));
        toPubkey = burner.publicKey.toBase58();
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
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
          recipient_was_unregistered: true,
          burner_address: burner.publicKey.toBase58(),
          burner_encrypted_secret: burnerEncryptedSecret,
          is_multi_send: true,
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
      const linkUrl = `${this.baseUrl}/share/${paymentId}`;

      const baseUnits = Math.round(amountUsd * 1_000_000);
      // Clean amount + exactOut:true — MagicBlock grosses up its own internal debit so the
      // recipient nets exactly baseUnits. Never gross up `amount` ourselves.
      const txResponse = await requestMagicblockPrivateTransfer({
        from: dto.sender_wallet.trim(),
        to: toPubkey,
        mint: effectiveMint.toBase58(),
        amount: baseUnits,
        cluster: cluster === 'localhost' ? 'devnet' : cluster,
        exactOut: true,
        gasless: true,
      });

      const relayFeeUnits = Math.round(MAGICBLOCK_GAS_USDC * 1_000_000);
      const feeAmountUsdc = (estimateMagicblockGrossUp(baseUnits) - baseUnits + relayFeeUnits) / 1_000_000;
      this.logger.log(`[MultiSendPrivate] payment=${paymentId} recipient=${normalizedId} amount=${amountStr} sendTo=${txResponse.sendTo}`);

      transactions.push({
        paymentId,
        recipientIdentifier: normalizedId,
        amount: amountStr,
        transactionBase64: txResponse.transactionBase64,
        version: txResponse.version,
        sendTo: txResponse.sendTo,
        feeAmountUsdc,
      });
      links.push({ id: paymentId, link: linkUrl, recipient_identifier: normalizedId, amount: amountStr });
      payment_ids.push(paymentId);
      totalAmountUsdc += amountUsd;
      // Emails are sent in confirmMultiSend after the transaction is confirmed on-chain
    }

    return { transactions, links, payment_ids, totalAmountUsdc, recipientCount: dto.recipients.length };
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
  }> {
    const isDevnet = isSolanaDevnetFromConfig(this.configService);

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
          is_multi_send: true,
        };
      } else {
        const burner = Keypair.generate();
        const burnerEncryptedSecret = this.encryption.encrypt(Buffer.from(burner.secretKey));
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

      // Fee estimate (no actual MagicBlock call — estimated from formula)
      const baseUnits = Math.round(amountUsd * 1_000_000);
      const grossUnits = estimateMagicblockGrossUp(baseUnits);
      const feeUsdc = (grossUnits - baseUnits + Math.round(MAGICBLOCK_GAS_USDC * 1_000_000)) / 1_000_000;

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
    };
  }

  private normalizeIdentifier(type: 'email' | 'twitter' | 'username' | SocialPlatform, value: string): string {
    const v = value.trim();
    if (type === 'email') return v.toLowerCase();
    return v.replace(/^@/, '').toLowerCase();
  }
}
