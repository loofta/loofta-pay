import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MAGICBLOCK_GAS_SOL, MAGICBLOCK_GAS_USDC, estimateMagicblockGrossUp, decodeActualSenderDebit, type MagicblockPrivateTransferClientResponse } from '@/common/magicblock-private-transfer';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService, type SocialPlatform } from '../users/users.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { decryptWithPassphrase } from './vault/vault-crypto';
import type { PassphraseEncryptedPayload } from './vault/vault-crypto';
import { CreateSendPaymentDto, ClaimSendPaymentDto, BuildMultiSendDto } from './dto';
import { SendPaymentLink, SendPaymentLinkPublic, SendPaymentLinkStatus, RecipientType } from './entities/send-payment-link.entity';
import { Keypair, Connection, PublicKey, Transaction, AddressLookupTableAccount, SystemProgram } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { isSolanaDevnetFromConfig, isSolanaLocalhostFromConfig } from '@/common/solana-cluster-env';
import { isValidSolanaAddress } from '@/common/solana-address';
import { EmailService } from '../email/email.service';
import { MagicblockQuestService } from '../magicblock-quest/magicblock-quest.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;

const DECIMALS = 6;
/** SOL for burner to cover claim/reclaim gas (sent to burner, not fee payer). */
const BURNER_SOL_LAMPORTS = 500_000;

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
          `[SendPayment] Invalid SOLANA_FEE_PAYER_PRIVATE_KEY: ${err.message}. Send-payment claim/reclaim sponsorship disabled.`,
        );
      }
    } else {
      this.logger.warn(
        '[SendPayment] SOLANA_FEE_PAYER_PRIVATE_KEY not set; claim/reclaim will fail until set in backend env.',
      );
    }
  }

  /** True when SOLANA_FEE_PAYER_PRIVATE_KEY is set and valid (claim/reclaim + private pay gas can be sponsored). */
  isSponsorshipConfigured(): boolean {
    return this.feePayerKeypair !== null;
  }

  /**
   * Build unsigned MagicBlock private transfer; recipient pubkey comes from DB only
   * (not sent from the client). Only the link sender may call.
   */
  async buildPrivateTransferForSender(
    linkId: string,
    privyUserId: string,
    senderWallet: string,
  ): Promise<MagicblockPrivateTransferClientResponse> {
    const { requestMagicblockPrivateTransfer, toClientResponse } = await import('@/common/magicblock-private-transfer');
    const link = await this.getOne(linkId);
    if (link.sender_user_id !== privyUserId) {
      throw new ForbiddenException('Not the sender of this link');
    }
    const row = link as { recipient_solana_pubkey?: string | null };
    const to = (row.recipient_solana_pubkey || '').trim();
    if (!to || !isValidSolanaAddress(to)) {
      throw new BadRequestException('Recipient is not resolved for this link');
    }
    const amountUsd = parseFloat(String(link.amount || '0'));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new BadRequestException('Invalid amount');
    }
    const baseUnits = Math.round(amountUsd * 1_000_000);
    const cluster = isSolanaLocalhostFromConfig(this.configService) ? 'localhost' : isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet';
    const effectiveMint = cluster === 'mainnet'
      ? new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      : new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || this.usdcMint.toBase58());

    // MagicBlock gasless: flat 0.2 USDC relay fee charged via a prepended instruction.
    const relayFeeUnits = Math.round(MAGICBLOCK_GAS_USDC * 1_000_000);

    // Clean amount + exactOut:true — MagicBlock grosses up the sender's debit internally and
    // guarantees the recipient nets exactly baseUnits. Never gross up `amount` ourselves.
    this.logger.log(
      `[SendPayment] amount=${amountUsd} baseUnits=${baseUnits} relayFeeUnits=${relayFeeUnits}` +
      ` cluster=${cluster} mint=${effectiveMint.toBase58().slice(0, 8)}… (gasless)`,
    );

    const txResponse = await requestMagicblockPrivateTransfer({
      from: senderWallet.trim(),
      to,
      mint: effectiveMint.toBase58(),
      amount: baseUnits,
      cluster,
      exactOut: true,
      gasless: true,
    });

    const mbVolumeFeeUnits = estimateMagicblockGrossUp(baseUnits) - baseUnits;
    const actualDebitUnits = await decodeActualSenderDebit(txResponse.transactionBase64, senderWallet.trim(), effectiveMint, this.connection);
    const estimatedFeeUnits = mbVolumeFeeUnits + relayFeeUnits;
    // For private transfers the main instruction is confidential; actualDebitUnits ≈ relay fee only.
    // Total fee = estimated BPS + actual decoded relay.
    const feeUnits = (actualDebitUnits != null && actualDebitUnits > 0 && actualDebitUnits < baseUnits)
      ? mbVolumeFeeUnits + actualDebitUnits
      : estimatedFeeUnits;
    this.logger.log(`[SendPayment] decoded relay=${actualDebitUnits ?? 'n/a'} feeUnits=${feeUnits} (${actualDebitUnits != null && actualDebitUnits > 0 && actualDebitUnits < baseUnits ? 'actual-relay' : 'estimated'})`);

    return toClientResponse(txResponse, {
      feeAmountUsdc: feeUnits / 1_000_000,
      feeBreakdown: {
        looftaBpsUsdc: mbVolumeFeeUnits / 1_000_000,
        solRecoveryUsdc: relayFeeUnits / 1_000_000,
        solLamports: Math.round(MAGICBLOCK_GAS_SOL * 1e9),
        solPriceUsd: 0,
      },
    });
  }

  /**
   * Create a send payment link (MagicBlock PER). Resolves recipient Solana pubkey for email/username;
   * Twitter handles require a matching Loofta account (use email or username instead).
   */
  async create(senderUserId: string, dto: CreateSendPaymentDto): Promise<{
    id: string;
    link: string;
    deposit_address: string;
    amount: string;
    token: string;
    burner_address: string;
    required_sol_lamports: number;
    per_mode: true;
  }> {
    const recipientIdentifier = this.normalizeIdentifier(dto.recipient_type, dto.recipient_identifier);
    const amountStr = String(dto.amount);

    // Always create a burner regardless of whether the recipient is registered.
    // The sender never needs to know the recipient's real wallet — all deposits go through
    // the burner intermediary, and the backend sweeps to the real wallet after claiming.
    const resolvedRecipientPubkey = await this.resolveRecipientSolanaPubkey(dto, recipientIdentifier);
    const burner = Keypair.generate();
    const burnerAddress = burner.publicKey.toBase58();
    const burnerEncryptedSecret = this.encryption.encrypt(Buffer.from(burner.secretKey));
    // For PER: target = burner (funds held there until recipient claims).
    const recipientSolanaPubkey = burnerAddress;

    this.logger.log(
      `[SendPayment] Created burner for ${dto.recipient_type}:${recipientIdentifier} (recipient known: ${!!resolvedRecipientPubkey})`,
    );

    let depositAddress = '';
    try {
      const burnerPubkey = new PublicKey(burnerAddress);
      depositAddress = (await getAssociatedTokenAddress(this.usdcMint, burnerPubkey)).toBase58();
    } catch {
      depositAddress = '';
    }

    const { data, error } = await this.supabaseService.sendPaymentLinks
      .insert({
        sender_user_id: senderUserId,
        amount: amountStr,
        token: 'USDC',
        chain: 'solana',
        recipient_type: dto.recipient_type,
        recipient_identifier: recipientIdentifier,
        status: 'OPEN',
        burner_address: burnerAddress,
        burner_encrypted_secret: burnerEncryptedSecret,
        // Store the real recipient pubkey in DB only — never returned to the sender.
        recipient_solana_pubkey: resolvedRecipientPubkey ?? recipientSolanaPubkey,
        message: dto.message || null,
        is_devnet: isSolanaDevnetFromConfig(this.configService),
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error('Failed to create send payment link:', error);
      throw new BadRequestException('Failed to create send payment link');
    }

    const link = `${this.baseUrl}/s/${data.id}`;

    return {
      id: data.id,
      link,
      deposit_address: depositAddress,
      amount: amountStr,
      token: 'USDC',
      burner_address: burnerAddress,
      required_sol_lamports: BURNER_SOL_LAMPORTS,
      per_mode: true,
    };
  }

  private async resolveRecipientSolanaPubkey(
    dto: CreateSendPaymentDto,
    recipientIdentifier: string,
  ): Promise<string | null> {
    try {
      if (dto.recipient_type === 'username') {
        const u = await this.usersService.findByUsername(dto.recipient_identifier);
        return await this.usersService.getSolanaWalletAddress(u.privyUserId);
      }
      if (dto.recipient_type === 'email') {
        const u = await this.usersService.findByEmail(dto.recipient_identifier);
        return await this.usersService.getSolanaWalletAddress(u.privyUserId);
      }
      if (dto.recipient_type === 'twitter') {
        // For @handle recipients without account yet, we fallback to burner pending flow.
        return null;
      }
      if (dto.recipient_type === 'discord' || dto.recipient_type === 'github' || dto.recipient_type === 'telegram') {
        const u = await this.usersService.findBySocialHandle(dto.recipient_type, dto.recipient_identifier);
        return await this.usersService.getSolanaWalletAddress(u.privyUserId);
      }
    } catch (e) {
      this.logger.warn(`resolveRecipientSolanaPubkey failed (${dto.recipient_type}): ${(e as Error)?.message}`);
      return null;
    }
    return null;
  }

  /**
   * List send payment links created by the given user (for recovery after reload).
   */
  async listBySender(senderUserId: string): Promise<
    { id: string; amount: string; token: string; status: string; recipient_type: string; created_at: string }[]
  > {
    const { data, error } = await this.supabaseService.sendPaymentLinks
      .select('id, amount, token, status, recipient_type, created_at')
      .eq('sender_user_id', senderUserId)
      .eq('is_devnet', isSolanaDevnetFromConfig(this.configService))
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      this.logger.warn('listBySender failed:', error);
      return [];
    }
    return (data ?? []).map((row) => ({
      id: row.id,
      amount: row.amount,
      token: row.token,
      status: row.status,
      recipient_type: row.recipient_type,
      created_at: row.created_at,
    }));
  }

  /**
   * Get public details for a send payment link (no sensitive data).
   * If userId is provided and matches sender, includes is_sender: true.
   */
  async getPublic(id: string, userId?: string): Promise<SendPaymentLinkPublic & { deposit_address?: string; is_sender?: boolean }> {
    const { data, error } = await this.supabaseService.sendPaymentLinks
      .select('id, amount, token, chain, recipient_type, status, message, burner_address, sender_user_id, recipient_solana_pubkey')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Send payment link not found');
    }

    let deposit_address: string | null = null;
    if (data.burner_address && data.status !== 'CLAIMED' && data.status !== 'CANCELLED') {
      try {
        const burnerPubkey = new PublicKey(data.burner_address);
        const ata = await getAssociatedTokenAddress(this.usdcMint, burnerPubkey);
        deposit_address = ata.toBase58();
      } catch {
        deposit_address = null;
      }
    }

    const is_sender = Boolean(userId && data.sender_user_id === userId);

    return {
      id: data.id,
      amount: data.amount,
      token: data.token,
      chain: data.chain,
      recipient_type: data.recipient_type,
      status: data.status,
      message: data.message,
      // Only expose the derived ATA deposit address (not the underlying burner wallet or
      // recipient pubkey — those are never returned to the public to preserve recipient privacy).
      deposit_address: deposit_address ?? undefined,
      required_sol_lamports: data.burner_address ? BURNER_SOL_LAMPORTS : 0,
      ...(is_sender ? { is_sender: true } : {}),
    };
  }

  /**
   * Mark link as funded (deposit detected). Can be called by frontend after user sends USDC.
   */
  async confirmFunded(id: string, depositTxHash: string | null, senderUserId: string): Promise<SendPaymentLinkPublic> {
    const link = await this.getOne(id);
    if (link.sender_user_id !== senderUserId) {
      throw new ForbiddenException('Not the sender of this link');
    }
    if (link.status !== 'OPEN') {
      throw new BadRequestException('Link is not in OPEN status');
    }

    const { data, error } = await this.supabaseService.sendPaymentLinks
      .update({
        status: 'FUNDED',
        ...(depositTxHash ? { deposit_tx_hash: depositTxHash } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new BadRequestException('Failed to update');
    return this.toPublic(data);
  }

  /**
   * Claim: verify claimant identity via Privy, then transfer from burner to claimant embedded wallet
   */
  async claim(
    id: string,
    claimantPrivyUserId: string,
    dto?: ClaimSendPaymentDto,
  ): Promise<{ claim_tx_hash: string; amount_received: string }> {
    const link = await this.getOne(id);
    if (link.status === 'CLAIMED') {
      throw new BadRequestException('This link has already been claimed');
    }
    if (link.status === 'CANCELLED' || link.status === 'EXPIRED') {
      throw new BadRequestException('This link is no longer claimable');
    }
    if (link.status !== 'FUNDED' && link.status !== 'OPEN') {
      throw new BadRequestException('Link is not ready to claim');
    }

    const linkAny = link as unknown as Record<string, unknown>;
    if (!link.burner_encrypted_secret && linkAny.recipient_solana_pubkey) {
      if (link.status !== 'FUNDED') {
        throw new BadRequestException(
          'Payment not yet received. The sender must complete the private MagicBlock transfer first.',
        );
      }
      const matchesPer = await this.usersService.verifyRecipientIdentityForSendPayment(
        claimantPrivyUserId,
        link.recipient_type as RecipientType,
        link.recipient_identifier,
      );
      if (!matchesPer) {
        throw new ForbiddenException(
          'You are not the intended recipient of this payment. Log in with the account the sender used.',
        );
      }
      const recipientWalletAddr = await this.usersService.getSolanaWalletAddress(claimantPrivyUserId);
      if (recipientWalletAddr !== String(linkAny.recipient_solana_pubkey)) {
        throw new ForbiddenException('Recipient wallet does not match this payment link.');
      }
      const { error: claimErr } = await this.supabaseService.sendPaymentLinks
        .update({
          status: 'CLAIMED',
          receiver_privy_user_id: claimantPrivyUserId,
          claim_tx_hash: 'per-magicblock',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (claimErr) throw new BadRequestException('Failed to update link');
      this.logger.log(`[SendPayment] PER claim completed linkId=${id} correlationId=${id}`);
      return {
        claim_tx_hash: 'per-magicblock',
        amount_received: parseFloat(String(link.amount)).toFixed(DECIMALS),
      };
    }

    const matches = await this.usersService.verifyRecipientIdentityForSendPayment(
      claimantPrivyUserId,
      link.recipient_type as 'email' | 'twitter' | 'username',
      link.recipient_identifier,
    );
    if (!matches) {
      this.logger.warn(`Claim identity mismatch: link ${id} expects ${link.recipient_type}:***, claimant ${claimantPrivyUserId}`);
      throw new ForbiddenException('You are not the intended recipient of this payment. Log in with the email or Twitter account it was sent to.');
    }

    const recipientWallet = await this.usersService.getSolanaWalletAddress(claimantPrivyUserId);

    const linkRow = link as typeof link & {
      private_claim_encrypted_receiver?: string | null;
      private_claim_passphrase?: string | null;
    };

    const mint = this.usdcMint;
    const recipientPubkey = new PublicKey(recipientWallet);
    const recipientAta = await getAssociatedTokenAddress(mint, recipientPubkey);

    type BurnerWithBalance = { keypair: Keypair; ata: PublicKey; balance: bigint };
    const candidates: BurnerWithBalance[] = [];

    // Original burner (deposit_address shown to sender)
    if (link.burner_encrypted_secret) {
      const secretKey = this.encryption.decrypt(link.burner_encrypted_secret);
      const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
      const ata = await getAssociatedTokenAddress(mint, keypair.publicKey);
      let balance = BigInt(0);
      try {
        const acc = await getAccount(this.connection, ata);
        balance = acc.amount;
      } catch {
        // ATA may not exist yet
      }
      candidates.push({ keypair, ata, balance });
    }

    // Private-claim burner (used when sender did "Pay privately")
    if (
      link.status === 'FUNDED' &&
      linkRow.private_claim_encrypted_receiver &&
      linkRow.private_claim_passphrase
    ) {
      try {
        const payload: PassphraseEncryptedPayload =
          typeof linkRow.private_claim_encrypted_receiver === 'string'
            ? (JSON.parse(linkRow.private_claim_encrypted_receiver) as PassphraseEncryptedPayload)
            : (linkRow.private_claim_encrypted_receiver as PassphraseEncryptedPayload);
        const secretKey = decryptWithPassphrase(payload, linkRow.private_claim_passphrase);
        const keypair = Keypair.fromSecretKey(secretKey);
        const ata = await getAssociatedTokenAddress(mint, keypair.publicKey);
        let balance = BigInt(0);
        try {
          const acc = await getAccount(this.connection, ata);
          balance = acc.amount;
        } catch {
          // ATA may not exist yet
        }
        // Only add if different from original (avoid double-adding same burner)
        if (!candidates.some((c) => c.keypair.publicKey.equals(keypair.publicKey))) {
          candidates.push({ keypair, ata, balance });
        }
      } catch (e) {
        this.logger.warn(`Claim: failed to decrypt private-claim burner for link ${id}`, (e as Error)?.message);
      }
    }

    const withBalance = candidates.filter((c) => c.balance > BigInt(0));
    if (withBalance.length === 0) {
      throw new BadRequestException('Payment not yet received. The sender must send USDC to the deposit address first.');
    }

    const totalBalance = withBalance.reduce((sum, c) => sum + c.balance, BigInt(0));
    this.logger.log(
      `[SendPayment] Claim ${id}: transferring from ${withBalance.length} burner(s), total raw=${totalBalance} (${Number(totalBalance) / Math.pow(10, DECIMALS)} USDC)`,
    );

    const instructions = [];
    try {
      await getAccount(this.connection, recipientAta);
    } catch {
      if (!this.feePayerKeypair) {
        this.logger.error(
          `[SendPayment] Claim ${id}: recipient ATA missing and sponsorship NOT configured (SOLANA_FEE_PAYER_PRIVATE_KEY unset or invalid). Check backend startup logs for "[SendPayment] SOLANA_FEE_PAYER_PRIVATE_KEY".`,
        );
        throw new BadRequestException(
          'Cannot create recipient token account; sponsorship not configured. ' +
            'Set SOLANA_FEE_PAYER_PRIVATE_KEY in the backend env and fund that wallet with SOL. ' +
            'See apps/backend/env.template.',
        );
      }
      instructions.push(
        createAssociatedTokenAccountInstruction(
          this.feePayerKeypair.publicKey,
          recipientAta,
          recipientPubkey,
          mint,
        ),
      );
    }
    for (const { keypair, ata, balance } of withBalance) {
      instructions.push(createTransferInstruction(ata, recipientAta, keypair.publicKey, balance));
    }

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    if (!this.feePayerKeypair) {
      this.logger.error(
        `[SendPayment] Claim ${id}: sponsorship NOT configured at gas step. Restart backend after setting SOLANA_FEE_PAYER_PRIVATE_KEY in apps/backend/.env.local`,
      );
      throw new BadRequestException(
        'Sponsorship not configured; cannot pay gas for claim. ' +
          'Set SOLANA_FEE_PAYER_PRIVATE_KEY in the backend env and fund that wallet with SOL.',
      );
    }
    const signers = [this.feePayerKeypair, ...withBalance.map((c) => c.keypair)];
    const message = new TransactionMessage({
      payerKey: this.feePayerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign(signers);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    await this.supabaseService.sendPaymentLinks
      .update({
        status: 'CLAIMED',
        claim_tx_hash: signature,
        receiver_privy_user_id: claimantPrivyUserId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    const amountReceived = Number(totalBalance) / Math.pow(10, DECIMALS);
    this.logger.log(`Send payment ${id} claimed by ${claimantPrivyUserId}, amount ${amountReceived} USDC, tx ${signature}`);

    return {
      claim_tx_hash: signature,
      amount_received: amountReceived.toFixed(DECIMALS),
    };
  }

  /**
   * Sender reclaim: transfer from burner(s) back to sender.
   * - OPEN/FUNDED: reclaim all funds and mark link CANCELLED.
   * - CLAIMED: reclaim leftover (e.g. funds still in original burner after recipient claimed from private burner).
   */
  async reclaim(id: string, senderUserId: string): Promise<{ reclaim_tx_hash: string; amount_reclaimed: string }> {
    const link = await this.getOne(id);
    if (link.sender_user_id !== senderUserId) {
      throw new ForbiddenException('Only the sender can reclaim');
    }
    if (link.status !== 'OPEN' && link.status !== 'FUNDED' && link.status !== 'CLAIMED') {
      throw new BadRequestException('Link cannot be reclaimed');
    }
    if (!link.burner_encrypted_secret) {
      if (link.status === 'OPEN') {
        await this.supabaseService.sendPaymentLinks
          .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
          .eq('id', id);
        return { reclaim_tx_hash: 'cancelled-per', amount_reclaimed: '0' };
      }
      throw new BadRequestException(
        'This link uses MagicBlock PER. Use the app to move funds from program deposits.',
      );
    }

    const linkRow = link as typeof link & {
      private_claim_encrypted_receiver?: string | null;
      private_claim_passphrase?: string | null;
      private_claim_activity_id?: string | null;
    };

    const mint = this.usdcMint;
    const senderWallet = await this.usersService.getSolanaWalletAddress(senderUserId);
    const senderPubkey = new PublicKey(senderWallet);
    const senderAta = await getAssociatedTokenAddress(mint, senderPubkey);

    type BurnerWithBalance = { keypair: Keypair; ata: PublicKey; balance: bigint };
    const candidates: BurnerWithBalance[] = [];

    // Original burner
    const secretKey = this.encryption.decrypt(link.burner_encrypted_secret);
    const originalKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
    const originalAta = await getAssociatedTokenAddress(mint, originalKeypair.publicKey);
    let originalBalance = BigInt(0);
    try {
      const acc = await getAccount(this.connection, originalAta);
      originalBalance = acc.amount;
    } catch {
      // ATA may not exist
    }
    candidates.push({ keypair: originalKeypair, ata: originalAta, balance: originalBalance });

    // Private-claim burner (may have leftover)
    if (
      linkRow.private_claim_encrypted_receiver &&
      linkRow.private_claim_passphrase
    ) {
      try {
        const payload: PassphraseEncryptedPayload =
          typeof linkRow.private_claim_encrypted_receiver === 'string'
            ? (JSON.parse(linkRow.private_claim_encrypted_receiver) as PassphraseEncryptedPayload)
            : (linkRow.private_claim_encrypted_receiver as PassphraseEncryptedPayload);
        const decrypted = decryptWithPassphrase(payload, linkRow.private_claim_passphrase);
        const keypair = Keypair.fromSecretKey(decrypted);
        const ata = await getAssociatedTokenAddress(mint, keypair.publicKey);
        let balance = BigInt(0);
        try {
          const acc = await getAccount(this.connection, ata);
          balance = acc.amount;
        } catch {
          // ATA may not exist
        }
        if (!candidates.some((c) => c.keypair.publicKey.equals(keypair.publicKey))) {
          candidates.push({ keypair, ata, balance });
        }
      } catch (e) {
        this.logger.warn(`Reclaim: failed to decrypt private-claim burner for link ${id}`, (e as Error)?.message);
      }
    }

    const withBalance = candidates.filter((c) => c.balance > BigInt(0));
    if (withBalance.length === 0) {
      const originalBal = candidates[0]?.balance ?? BigInt(0);
      const privateBal = candidates.length > 1 ? candidates[1].balance : BigInt(0);
      this.logger.warn(
        `[SendPayment] Reclaim ${id}: no balance on burners. Original burner: ${Number(originalBal) / 1e6} USDC, private burner: ${Number(privateBal) / 1e6} USDC. Link amount: ${link.amount}.`,
      );
      if (link.status === 'CLAIMED') {
        const usedPrivate = Boolean(linkRow.private_claim_activity_id);
        const message = usedPrivate
          ? 'No leftover on burners. If you used Pay privately, remaining funds may still be in Privacy Cash. Please contact support with this link ID so we can help recover them.'
          : 'No leftover funds to reclaim';
        throw new BadRequestException(message);
      }
      await this.supabaseService.sendPaymentLinks
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', id);
      throw new BadRequestException('No funds to reclaim');
    }

    const totalBalance = withBalance.reduce((sum, c) => sum + c.balance, BigInt(0));
    this.logger.log(
      `[SendPayment] Reclaim ${id} (${link.status}): transferring from ${withBalance.length} burner(s), total ${Number(totalBalance) / Math.pow(10, DECIMALS)} USDC`,
    );

    if (!this.feePayerKeypair) {
      throw new BadRequestException(
        'Sponsorship not configured for reclaim. Set SOLANA_FEE_PAYER_PRIVATE_KEY and fund with SOL.',
      );
    }

    const instructions = [];
    try {
      await getAccount(this.connection, senderAta);
    } catch {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          this.feePayerKeypair.publicKey,
          senderAta,
          senderPubkey,
          mint,
        ),
      );
    }
    for (const { keypair, ata, balance } of withBalance) {
      instructions.push(createTransferInstruction(ata, senderAta, keypair.publicKey, balance));
    }

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    const signers = [this.feePayerKeypair, ...withBalance.map((c) => c.keypair)];
    const message = new TransactionMessage({
      payerKey: this.feePayerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign(signers);

    const signature = await this.connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    await this.connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    );

    const amountReclaimed = Number(totalBalance) / Math.pow(10, DECIMALS);
    const updatePayload: { status?: string; claim_tx_hash?: string; updated_at: string } = {
      updated_at: new Date().toISOString(),
    };
    if (link.status === 'OPEN' || link.status === 'FUNDED') {
      updatePayload.status = 'CANCELLED';
      updatePayload.claim_tx_hash = signature;
    }
    await this.supabaseService.sendPaymentLinks.update(updatePayload).eq('id', id);

    this.logger.log(`Send payment ${id} reclaimed by sender, ${amountReclaimed} USDC, tx ${signature}`);
    return { reclaim_tx_hash: signature, amount_reclaimed: amountReclaimed.toFixed(DECIMALS) };
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
   * automatically for new recipients — cost absorbed by the fee payer.
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
          : (recipient.recipient_type === 'discord' || recipient.recipient_type === 'github' || recipient.recipient_type === 'telegram')
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
      const linkUrl = `${this.baseUrl}/c/${paymentId}`;

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

    // ─── Phase 2: batch-check which recipient ATAs exist ──────────────────────
    const allAtaKeys = [senderAta, ...infos.map((r) => r.toAta)];
    const accountInfos = await this.connection.getMultipleAccountsInfo(allAtaKeys);

    if (accountInfos[0] === null) {
      throw new BadRequestException(
        'Your USDC token account does not exist. Please deposit USDC to your wallet first.',
      );
    }

    // ─── Phase 3: build combined transaction ──────────────────────────────────
    const instructions = [];

    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      const recipientAtaExists = accountInfos[i + 1] !== null;

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
          : (recipient.recipient_type === 'discord' || recipient.recipient_type === 'github' || recipient.recipient_type === 'telegram')
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
      const linkUrl = `${this.baseUrl}/c/${paymentId}`;

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

    if (!isDevnet) {
      const { data: waitlistRow } = await this.supabaseService.mainnetWaitlist
        .select('mainnet_access')
        .eq('privy_user_id', senderUserId)
        .eq('mainnet_access', true)
        .maybeSingle();
      if (!waitlistRow) {
        throw new ForbiddenException('Mainnet access required to use multi-send on mainnet.');
      }
    }

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
          : (recipient.recipient_type === 'discord' || recipient.recipient_type === 'github' || recipient.recipient_type === 'telegram')
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
      const linkUrl = `${this.baseUrl}/c/${shortId}`;

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

  private async getOne(id: string): Promise<SendPaymentLink & { burner_encrypted_secret?: string }> {
    const { data, error } = await this.supabaseService.sendPaymentLinks
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      throw new NotFoundException('Send payment link not found');
    }
    return data as any;
  }

  private normalizeIdentifier(type: 'email' | 'twitter' | 'username' | SocialPlatform, value: string): string {
    const v = value.trim();
    if (type === 'email') return v.toLowerCase();
    return v.replace(/^@/, '').toLowerCase();
  }

  private toPublic(row: any): SendPaymentLinkPublic {
    return {
      id: row.id,
      amount: row.amount,
      token: row.token,
      chain: row.chain,
      recipient_type: row.recipient_type,
      status: row.status,
      message: row.message,
    };
  }
}
