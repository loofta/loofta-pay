import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { SendPaymentEncryptionService } from './encryption.service';
import { VaultService } from './vault/vault.service';
import { decryptWithPassphrase } from './vault/vault-crypto';
import type { PassphraseEncryptedPayload } from './vault/vault-crypto';
import { CreateSendPaymentDto, ClaimSendPaymentDto } from './dto';
import { SendPaymentLink, SendPaymentLinkPublic, SendPaymentLinkStatus } from './entities/send-payment-link.entity';
import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bs58Module = require('bs58');
const bs58 = bs58Module?.default ?? bs58Module;

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const DECIMALS = 6;
/** SOL for burner to cover claim/reclaim gas (sent to burner, not fee payer). */
const BURNER_SOL_LAMPORTS = 500_000;

@Injectable()
export class SendPaymentService {
  private readonly logger = new Logger(SendPaymentService.name);
  private readonly baseUrl: string;
  private readonly connection: Connection;
  private readonly feePayerKeypair: Keypair | null = null;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly encryption: SendPaymentEncryptionService,
    private readonly vault: VaultService,
  ) {
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
   * Create a send payment link: generate burner, store encrypted key, return link and deposit address
   */
  async create(senderUserId: string, dto: CreateSendPaymentDto): Promise<{
    id: string;
    link: string;
    deposit_address: string;
    amount: string;
    token: string;
    burner_address: string;
    required_sol_lamports: number;
  }> {
    if (!this.encryption.isAvailable()) {
      throw new BadRequestException('Send payment is not configured (missing SEND_PAYMENT_ENC_KEY)');
    }

    const recipientIdentifier = this.normalizeIdentifier(dto.recipient_type, dto.recipient_identifier);
    const amountStr = String(dto.amount);

    const burnerKeypair = Keypair.generate();
    const burnerSecret = Buffer.from(burnerKeypair.secretKey);
    const encryptedSecret = this.encryption.encrypt(burnerSecret);

    const { data, error } = await this.supabaseService.sendPaymentLinks
      .insert({
        sender_user_id: senderUserId,
        amount: amountStr,
        token: 'USDC',
        chain: 'solana',
        recipient_type: dto.recipient_type,
        recipient_identifier: recipientIdentifier,
        status: 'OPEN',
        burner_address: burnerKeypair.publicKey.toBase58(),
        burner_encrypted_secret: encryptedSecret,
        message: dto.message || null,
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error('Failed to create send payment link:', error);
      throw new BadRequestException('Failed to create send payment link');
    }

    const depositAddress = await getAssociatedTokenAddress(
      USDC_MINT,
      burnerKeypair.publicKey,
    );

    const link = `${this.baseUrl}/s/${data.id}`;
    this.logger.log(`Created send payment ${data.id} for ${dto.recipient_type}:***`);

    return {
      id: data.id,
      link,
      deposit_address: depositAddress.toBase58(),
      amount: amountStr,
      token: 'USDC',
      burner_address: burnerKeypair.publicKey.toBase58(),
      required_sol_lamports: BURNER_SOL_LAMPORTS,
    };
  }

  /**
   * Get public details for a send payment link (no sensitive data).
   * If userId is provided and matches sender, includes is_sender: true.
   */
  async getPublic(id: string, userId?: string): Promise<SendPaymentLinkPublic & { deposit_address?: string; is_sender?: boolean }> {
    const { data, error } = await this.supabaseService.sendPaymentLinks
      .select('id, amount, token, chain, recipient_type, status, message, burner_address, sender_user_id')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Send payment link not found');
    }

    let deposit_address: string | null = null;
    if (data.burner_address && data.status !== 'CLAIMED' && data.status !== 'CANCELLED') {
      try {
        const burnerPubkey = new PublicKey(data.burner_address);
        const ata = await getAssociatedTokenAddress(USDC_MINT, burnerPubkey);
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
      deposit_address: deposit_address ?? undefined,
      burner_address: data.burner_address ?? undefined,
      required_sol_lamports: BURNER_SOL_LAMPORTS,
      ...(is_sender ? { is_sender: true } : {}),
    };
  }

  /**
   * Prepare private (Privacy Cash vault) funding: in-repo implementation.
   * No external HTTP call; uses VaultService and send_payment_links for storage.
   */
  async preparePrivate(
    id: string,
    senderUserId: string,
    senderPublicKey: string,
    sessionSignatureBase64: string,
    useSponsor: boolean = false,
  ): Promise<{
    unsignedDepositTx: string;
    lastValidBlockHeight: number;
    activityId: string;
    passphrase: string;
    /** When true, frontend must send signed tx to submit-private (backend adds sponsor sig and relays). User needs no SOL. */
    useSponsorUsed: boolean;
    /** Privacy Cash fees (sender pays so recipient gets full amount). */
    feeUsdc: number;
    /** Total USDC to deposit (recipient amount + fees). */
    totalDepositUsdc: number;
    /** Optional unsigned SOL tx: sender → burner for claim gas (0.0005 SOL). */
    unsignedSolTx?: string;
  }> {
    const link = await this.getOne(id);
    if (link.sender_user_id !== senderUserId) {
      throw new ForbiddenException('Not the sender of this link');
    }
    if (link.status !== 'OPEN') {
      throw new BadRequestException('Link is not in OPEN status');
    }
    const amount = parseFloat(link.amount);
    if (Number.isNaN(amount) || amount < 0.1) {
      throw new BadRequestException('Invalid link amount (min 0.1 USDC)');
    }
    this.logger.log(`[SendPayment] preparePrivate START id=${id} link.amount=${link.amount} amount=${amount} USDC sender=${senderPublicKey.slice(0, 8)}...`);

    // Use the link's existing burner so there is only one burner (same as deposit address).
    let existingBurnerSecretKey: Uint8Array | undefined;
    if (link.burner_encrypted_secret) {
      const secretKey = this.encryption.decrypt(link.burner_encrypted_secret);
      existingBurnerSecretKey = new Uint8Array(secretKey);
    }

    // First try: user as fee payer so Privy signAndSendTransaction can sponsor. Fallback: use_sponsor=true for backend sponsor.
    const sponsorPublicKey =
      useSponsor && this.feePayerKeypair ? this.feePayerKeypair.publicKey.toBase58() : null;
    const tryPrepare = (skipSignatureVerification: boolean) =>
      this.vault.preparePrivate(id, senderPublicKey, sessionSignatureBase64, amount, link.message ?? undefined, {
        skipSignatureVerification,
        sponsorPublicKey,
        skipUserSolCheck: true,
        existingBurnerSecretKey,
      });

    try {
      const result = await tryPrepare(false);
      this.logger.log(`[SendPayment] preparePrivate DONE id=${id} amount=${amount} USDC feeUsdc=${result.feeUsdc} totalDepositUsdc=${result.totalDepositUsdc} activityId=${result.activityId}`);
      return {
        unsignedDepositTx: result.unsignedDepositTx,
        lastValidBlockHeight: result.lastValidBlockHeight,
        activityId: result.activityId,
        passphrase: result.passphrase,
        useSponsorUsed: !!sponsorPublicKey,
        feeUsdc: result.feeUsdc,
        totalDepositUsdc: result.totalDepositUsdc,
        unsignedSolTx: result.unsignedSolTx,
      };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (message.includes('Invalid session signature')) {
        const privyUserId = await this.usersService.getPrivyUserIdByAppUserId(senderUserId);
        if (privyUserId && (await this.usersService.isSolanaAddressInLinkedAccounts(privyUserId, senderPublicKey))) {
          try {
            const result = await tryPrepare(true);
            return {
              unsignedDepositTx: result.unsignedDepositTx,
              lastValidBlockHeight: result.lastValidBlockHeight,
              activityId: result.activityId,
              passphrase: result.passphrase,
              useSponsorUsed: !!sponsorPublicKey,
              feeUsdc: result.feeUsdc,
              totalDepositUsdc: result.totalDepositUsdc,
              unsignedSolTx: result.unsignedSolTx,
            };
          } catch (fallbackErr: any) {
            this.logger.warn(`preparePrivate (linked-wallet fallback) failed for link ${id}: ${fallbackErr?.message}`);
            throw new BadRequestException(fallbackErr?.message ?? message);
          }
        }
      }
      this.logger.warn(`preparePrivate failed for link ${id}: ${message}`, err?.stack);
      throw new BadRequestException(message);
    }
  }

  /**
   * Submit signed private deposit tx: in-repo vault (relay + withdraw to burner), then mark link FUNDED.
   */
  async submitPrivate(
    id: string,
    senderUserId: string,
    body: {
      signedDepositTx: string;
      activityId: string;
      senderPublicKey: string;
      lastValidBlockHeight?: number;
      passphrase: string;
      signedSolTx?: string;
    },
    sessionSignatureBase64: string,
  ): Promise<SendPaymentLinkPublic> {
    const link = await this.getOne(id);
    if (link.sender_user_id !== senderUserId) {
      throw new ForbiddenException('Not the sender of this link');
    }
    const linkAmount = parseFloat(link.amount);
    this.logger.log(`[SendPayment] submitPrivate START id=${id} link.amount=${link.amount} linkAmount=${linkAmount} USDC body.activityId=${body.activityId}`);

    const linkRow = link as typeof link & {
      private_claim_burner_address?: string | null;
      private_claim_encrypted_receiver?: string | null;
      private_claim_encrypted_sender?: string | null;
    };
    const state = {
      private_claim_burner_address: linkRow.private_claim_burner_address ?? '',
      private_claim_encrypted_receiver: linkRow.private_claim_encrypted_receiver ?? '',
      private_claim_encrypted_sender: linkRow.private_claim_encrypted_sender ?? '',
    };
    if (!state.private_claim_burner_address || !state.private_claim_encrypted_receiver) {
      throw new BadRequestException('Private claim state missing. Call prepare first.');
    }
    if (Number.isNaN(linkAmount) || linkAmount < 0.1) {
      throw new BadRequestException(`Invalid link amount: ${link.amount}`);
    }
    this.logger.log(`[SendPayment] submitPrivate AMOUNT_CHECK id=${id} passing amount=${linkAmount} USDC to vault (match link.amount)`);

    // Deposit tx is built with user as fee payer (same as privacy-hack); relay as-is, no sponsor signature.
    const signedDepositTxToRelay = body.signedDepositTx;

    const trySubmit = (skipSignatureVerification: boolean) =>
      this.vault.submitPrivate(
        id,
        body.senderPublicKey,
        sessionSignatureBase64,
        signedDepositTxToRelay,
        body.lastValidBlockHeight,
        state,
        linkAmount,
        { skipSignatureVerification, signedSolTx: body.signedSolTx },
      );

    try {
      await trySubmit(false);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (message.includes('Invalid session signature')) {
        const privyUserId = await this.usersService.getPrivyUserIdByAppUserId(senderUserId);
        if (
          privyUserId &&
          (await this.usersService.isSolanaAddressInLinkedAccounts(privyUserId, body.senderPublicKey))
        ) {
          try {
            await trySubmit(true);
          } catch (fallbackErr: any) {
            this.logger.warn(`submitPrivate (linked-wallet fallback) failed for link ${id}: ${fallbackErr?.message}`);
            throw new BadRequestException(fallbackErr?.message ?? message);
          }
        } else {
          throw new BadRequestException(message);
        }
      } else {
        throw new BadRequestException(message);
      }
    }
    this.logger.log(`[SendPayment] submitPrivate DONE id=${id} amount=${linkAmount} USDC marking FUNDED`);
    const { data: updateData, error } = await this.supabaseService.sendPaymentLinks
      .update({
        status: 'FUNDED',
        private_claim_activity_id: body.activityId,
        private_claim_passphrase: body.passphrase,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException('Failed to update link');
    return this.toPublic(updateData);
  }

  /**
   * Return fully signed deposit tx (add sponsor signature) for frontend to send.
   * Frontend then sends the tx and calls completePrivateWithSignature with the tx signature.
   */
  async getSignedTxForPrivate(
    id: string,
    senderUserId: string,
    body: {
      signedDepositTx: string;
      activityId: string;
      senderPublicKey: string;
      lastValidBlockHeight?: number;
      passphrase: string;
    },
    sessionSignatureBase64: string,
  ): Promise<{ signed_deposit_tx: string }> {
    const link = await this.getOne(id);
    if (link.sender_user_id !== senderUserId) {
      throw new ForbiddenException('Not the sender of this link');
    }
    const linkRow = link as typeof link & {
      private_claim_burner_address?: string | null;
      private_claim_encrypted_receiver?: string | null;
      private_claim_encrypted_sender?: string | null;
    };
    const state = {
      private_claim_burner_address: linkRow.private_claim_burner_address ?? '',
      private_claim_encrypted_receiver: linkRow.private_claim_encrypted_receiver ?? '',
      private_claim_encrypted_sender: linkRow.private_claim_encrypted_sender ?? '',
    };
    if (!state.private_claim_burner_address || !state.private_claim_encrypted_receiver) {
      throw new BadRequestException('Private claim state missing. Call prepare first.');
    }
    // Deposit tx is user-signed only (no sponsor on deposit).
    return { signed_deposit_tx: body.signedDepositTx };
  }

  /**
   * Complete private claim after frontend has sent the deposit tx.
   * Backend runs withdraw to burner and marks link FUNDED.
   */
  async completePrivateWithSignature(
    id: string,
    senderUserId: string,
    body: {
      depositTxSignature: string;
      activityId: string;
      senderPublicKey: string;
      lastValidBlockHeight?: number;
      passphrase: string;
    },
    sessionSignatureBase64: string,
  ): Promise<SendPaymentLinkPublic> {
    const link = await this.getOne(id);
    if (link.sender_user_id !== senderUserId) {
      throw new ForbiddenException('Not the sender of this link');
    }
    const linkAmount = parseFloat(link.amount);
    this.logger.log(`[SendPayment] completePrivateWithSignature START id=${id} link.amount=${link.amount} linkAmount=${linkAmount} USDC depositTxSignature=${body.depositTxSignature?.slice(0, 16)}...`);

    const linkRow = link as typeof link & {
      private_claim_burner_address?: string | null;
      private_claim_encrypted_receiver?: string | null;
      private_claim_encrypted_sender?: string | null;
    };
    const state = {
      private_claim_burner_address: linkRow.private_claim_burner_address ?? '',
      private_claim_encrypted_receiver: linkRow.private_claim_encrypted_receiver ?? '',
      private_claim_encrypted_sender: linkRow.private_claim_encrypted_sender ?? '',
    };
    if (!state.private_claim_burner_address || !state.private_claim_encrypted_receiver) {
      throw new BadRequestException('Private claim state missing. Call prepare first.');
    }
    if (Number.isNaN(linkAmount) || linkAmount < 0.1) {
      throw new BadRequestException(`Invalid link amount: ${link.amount}`);
    }
    this.logger.log(`[SendPayment] completePrivateWithSignature AMOUNT_CHECK id=${id} passing amount=${linkAmount} USDC to vault (match link.amount) proceeding`);

    const tryComplete = (skipSignatureVerification: boolean) =>
      this.vault.completePrivateWithSignature(
        id,
        body.senderPublicKey,
        sessionSignatureBase64,
        body.depositTxSignature,
        body.lastValidBlockHeight,
        state,
        linkAmount,
        { skipSignatureVerification },
      );
    try {
      await tryComplete(false);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (message.includes('Invalid session signature')) {
        const privyUserId = await this.usersService.getPrivyUserIdByAppUserId(senderUserId);
        if (
          privyUserId &&
          (await this.usersService.isSolanaAddressInLinkedAccounts(privyUserId, body.senderPublicKey))
        ) {
          try {
            await tryComplete(true);
          } catch (fallbackErr: any) {
            this.logger.warn(
              `completePrivateWithSignature (linked-wallet fallback) failed for link ${id}: ${(fallbackErr as Error)?.message}`,
            );
            throw new BadRequestException((fallbackErr as Error)?.message ?? message);
          }
        } else {
          throw new BadRequestException(message);
        }
      } else {
        throw new BadRequestException(message);
      }
    }
    this.logger.log(`[SendPayment] completePrivateWithSignature DONE id=${id} amount=${linkAmount} USDC marking FUNDED`);
    const { data: updateData, error } = await this.supabaseService.sendPaymentLinks
      .update({
        status: 'FUNDED',
        private_claim_activity_id: body.activityId,
        private_claim_passphrase: body.passphrase,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new BadRequestException('Failed to update link');
    return this.toPublic(updateData);
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

    const matches = await this.usersService.verifyRecipientIdentityForSendPayment(
      claimantPrivyUserId,
      link.recipient_type as 'email' | 'twitter',
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

    const mint = USDC_MINT;
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
      throw new BadRequestException('Invalid link data');
    }

    const linkRow = link as typeof link & {
      private_claim_encrypted_receiver?: string | null;
      private_claim_passphrase?: string | null;
      private_claim_activity_id?: string | null;
    };

    const mint = USDC_MINT;
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

  private normalizeIdentifier(type: 'email' | 'twitter', value: string): string {
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
