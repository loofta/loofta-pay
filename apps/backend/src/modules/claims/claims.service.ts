import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { CreateClaimDto, CreateClaimFromUsernameDto, CreateClaimFromEmailDto } from './dto';
import { Claim, ClaimIntent, ClaimStatus } from './entities/claim.entity';
import { UsersService } from '../users/users.service';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { SolanaSponsorService } from './solana-sponsor.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/** Same as SendPaymentEncryptionService – used when that service is not injected or key not loaded there */
const ENC_ALGO = 'aes-256-gcm';
const ENC_IV_LENGTH = 16;
const ENC_TAG_LENGTH = 16;
const ENC_KEY_LENGTH = 32;

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Optional() private readonly encryption: SendPaymentEncryptionService | null,
    private readonly solanaSponsor: SolanaSponsorService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'NEXT_PUBLIC_BASE_URL',
      'https://pay.loofta.xyz',
    );
    const burnerOk = !!(this.encryption?.isAvailable() || this.getClaimBurnerDecryptionKey());
    this.logger.log(
      `ClaimsService init: encryption=${this.encryption ? (this.encryption.isAvailable() ? 'available' : 'not configured') : 'null'}, claim burner creation=${burnerOk ? 'enabled' : 'disabled (set SEND_PAYMENT_ENC_KEY)'}, sponsor=${this.solanaSponsor.isAvailable()}`,
    );
  }

  /**
   * Create a new payment claim
   */
  async create(dto: CreateClaimDto): Promise<{ id: string; link: string }> {
    const { amount, toSel, recipient, userId, isPrivate } = dto;

    if (!amount || !toSel?.symbol || !toSel?.chain || !recipient) {
      throw new BadRequestException('Missing required fields');
    }

    const { data, error } = await this.supabaseService.claims
      .insert({
        amount: String(amount),
        to_symbol: String(toSel.symbol),
        to_chain: String(toSel.chain),
        recipient_address: String(recipient),
        created_by: userId ? String(userId) : null,
        creator_email: null,
        status: 'OPEN' as ClaimStatus,
        is_private: isPrivate === true,
        is_devnet: isSolanaDevnetFromConfig(this.configService),
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error('Failed to create claim:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    const id = data.id;
    const link = `${this.baseUrl}/c/${id}`;

    this.logger.log(`Created claim: ${id}`);
    return { id, link };
  }

  /**
   * Create a claim from username (wallet address fetched server-side only).
   * If user exists: send directly to their wallet.
   * If user does not exist: create "burner" claim with PENDING_USERNAME so they can claim later when they sign up with that username.
   */
  async createFromUsername(dto: CreateClaimFromUsernameDto): Promise<{ id: string; link: string }> {
    const { username, amount, userId, isPrivate = false, description } = dto;
    const cleanUsername = username.replace(/^@/, '').toLowerCase();

    let recipientAddress: string;
    let requiresPrivate = false;
    let finalIsPrivate = isPrivate;

    try {
      const user = await this.usersService.findByUsername(cleanUsername);
      requiresPrivate = user.requirePrivatePayments || false;
      finalIsPrivate = requiresPrivate ? true : isPrivate;
      if (requiresPrivate && !isPrivate) {
        throw new BadRequestException(
          'This user requires private payments only. Please enable privacy when creating the payment link.'
        );
      }
      recipientAddress = await this.usersService.getSolanaWalletAddress(user.privyUserId);

      const { data: claim, error: claimError } = await this.supabaseService.claims
        .insert({
          amount: String(amount),
          to_symbol: 'USDC',
          to_chain: 'solana',
          recipient_address: recipientAddress,
          recipient_username: cleanUsername,
          created_by: userId ? String(userId) : null,
          creator_email: null,
          status: 'OPEN' as ClaimStatus,
          is_private: finalIsPrivate,
          description: description || null,
          is_devnet: isSolanaDevnetFromConfig(this.configService),
        })
        .select('id')
        .single();

      if (claimError) {
        this.logger.error('Error creating claim:', claimError);
        throw new BadRequestException('Failed to create claim');
      }

      const id = claim.id;
      const link = `${this.baseUrl}/c/${id}`;
      this.logger.log(`Created claim from username: ${id} for user ${cleanUsername} (private: ${finalIsPrivate}, required: ${requiresPrivate})`);
      return { id, link };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (!(err instanceof NotFoundException)) throw err;
      // User not found: create "burner" claim so they can claim later when they sign up with this username
    }

    recipientAddress = `${ClaimsService.PENDING_USERNAME_PREFIX}${cleanUsername}`;
    const burner = this.createClaimBurner();
    if (!burner) {
      this.logger.warn('Creating pending-username claim without burner: SEND_PAYMENT_ENC_KEY may be missing. Pay-with-Loofta will fail until the key is set.');
    }

    const { data: claim, error: claimError } = await this.supabaseService.claims
      .insert({
        amount: String(amount),
        to_symbol: 'USDC',
        to_chain: 'solana',
        recipient_address: recipientAddress,
        created_by: userId ? String(userId) : null,
        creator_email: null,
        status: 'OPEN' as ClaimStatus,
        is_private: isPrivate,
        description: description || null,
        is_devnet: isSolanaDevnetFromConfig(this.configService),
        ...(burner ? { claim_burner_address: burner.claim_burner_address, claim_burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
      })
      .select('id')
      .single();

    if (claimError) {
      this.logger.error('Error creating claim from username (pending):', claimError);
      throw new BadRequestException('Failed to create claim');
    }

    const id = claim.id;
    const link = `${this.baseUrl}/c/${id}`;
    this.logger.log(`Created claim from username (pending): ${id} for @${cleanUsername} – they can claim when they sign up${burner ? ' (unique burner)' : ''}`);
    return { id, link };
  }

  /** Sentinel prefix for claims created by email when recipient has no account yet; they claim by signing in with that email */
  static readonly PENDING_EMAIL_PREFIX = 'PENDING_EMAIL:';
  /** Sentinel prefix for claims when username doesn't exist yet; they claim by signing up with that username */
  static readonly PENDING_USERNAME_PREFIX = 'PENDING_USERNAME:';

  /** Generate a unique burner keypair per claim (like send-payment); secret encrypted with SEND_PAYMENT_ENC_KEY. */
  private createClaimBurner(): { claim_burner_address: string; claim_burner_encrypted_secret: string } | null {
    const burnerKeypair = Keypair.generate();
    const secret = Buffer.from(burnerKeypair.secretKey);
    let encrypted: string;
    if (this.encryption?.isAvailable()) {
      encrypted = this.encryption.encrypt(secret);
    } else {
      const key = this.getClaimBurnerDecryptionKey();
      if (!key) return null;
      encrypted = this.encryptBurnerSecret(secret, key);
    }
    return {
      claim_burner_address: burnerKeypair.publicKey.toBase58(),
      claim_burner_encrypted_secret: encrypted,
    };
  }

  /** Encrypt burner secret (same format as SendPaymentEncryptionService) when encryption service is not available. */
  private encryptBurnerSecret(plaintext: Buffer, key: Buffer): string {
    const iv = randomBytes(ENC_IV_LENGTH);
    const cipher = createCipheriv(ENC_ALGO, key, iv, { authTagLength: ENC_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  /**
   * Read SEND_PAYMENT_ENC_KEY from .env file (fallback when ConfigService/process.env don't have it).
   * Tries backend root and cwd so it works whether run from monorepo root or apps/backend.
   */
  private getClaimBurnerDecryptionKeyFromFile(): string | null {
    const tryPaths = [
      join(process.cwd(), 'apps', 'backend', '.env.local'),
      join(process.cwd(), '.env.local'),
      join(__dirname, '..', '..', '..', '.env.local'),
      join(__dirname, '..', '..', '.env.local'),
    ];
    for (const p of tryPaths) {
      try {
        if (existsSync(p)) {
          const content = readFileSync(p, 'utf8');
          const match = content.match(/SEND_PAYMENT_ENC_KEY\s*=\s*(["']?)([^\s#'"]+)\1/);
          if (match?.[2]) return match[2].trim();
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  /**
   * Read SEND_PAYMENT_ENC_KEY (ConfigService → process.env → .env.local file) so reclaim and
   * recipient claim-sweep can decrypt even when SendPaymentEncryptionService is not injected.
   */
  private getClaimBurnerDecryptionKey(): Buffer | null {
    let raw =
      this.configService.get<string>('SEND_PAYMENT_ENC_KEY') ??
      (typeof process !== 'undefined' ? process.env.SEND_PAYMENT_ENC_KEY : undefined);
    if (!raw || typeof raw !== 'string') {
      raw = this.getClaimBurnerDecryptionKeyFromFile() ?? undefined;
    }
    if (!raw || typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    const hexBuf = Buffer.from(trimmed, 'hex');
    if (hexBuf.length === ENC_KEY_LENGTH) return hexBuf;
    if (trimmed.length >= 32) return Buffer.from(trimmed.slice(0, 32), 'utf8');
    return null;
  }

  /** Decrypt burner secret (same format as SendPaymentEncryptionService). */
  private decryptBurnerSecret(ciphertextBase64: string, key: Buffer): Buffer {
    const buf = Buffer.from(ciphertextBase64, 'base64');
    if (buf.length < ENC_IV_LENGTH + ENC_TAG_LENGTH) throw new Error('Invalid ciphertext');
    const iv = buf.subarray(0, ENC_IV_LENGTH);
    const tag = buf.subarray(ENC_IV_LENGTH, ENC_IV_LENGTH + ENC_TAG_LENGTH);
    const encrypted = buf.subarray(ENC_IV_LENGTH + ENC_TAG_LENGTH);
    const decipher = createDecipheriv(ENC_ALGO, key, iv, { authTagLength: ENC_TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  /** True if we can decrypt claim burner secrets (injected service or direct key). */
  private canDecryptBurnerSecret(): boolean {
    if (this.encryption?.isAvailable()) return true;
    return this.getClaimBurnerDecryptionKey() !== null;
  }

  /** Decrypt claim burner secret; uses injected encryption service or direct key. */
  private decryptClaimBurnerSecret(ciphertextBase64: string): Buffer {
    if (this.encryption?.isAvailable()) {
      return this.encryption.decrypt(ciphertextBase64);
    }
    const key = this.getClaimBurnerDecryptionKey();
    if (!key) throw new Error('SEND_PAYMENT_ENC_KEY not available for decrypt');
    return this.decryptBurnerSecret(ciphertextBase64, key);
  }

  /**
   * Create a claim from email. If user exists, use their wallet. If not, create with PENDING_EMAIL so they can claim by signing in later.
   */
  async createFromEmail(dto: CreateClaimFromEmailDto): Promise<{ id: string; link: string }> {
    const { email, amount, userId, isPrivate = false, description } = dto;
    const cleanEmail = email.trim().toLowerCase();

    let recipientAddress: string;
    let requiresPrivate = false;

    try {
      const user = await this.usersService.findByEmail(cleanEmail);
      requiresPrivate = user.requirePrivatePayments || false;
      const finalIsPrivate = requiresPrivate ? true : isPrivate;
      if (requiresPrivate && !isPrivate) {
        throw new BadRequestException(
          'This user requires private payments only. Please enable privacy when creating the payment link.',
        );
      }
      recipientAddress = await this.usersService.getSolanaWalletAddress(user.privyUserId);

      const { data: claim, error: claimError } = await this.supabaseService.claims
        .insert({
          amount: String(amount),
          to_symbol: 'USDC',
          to_chain: 'solana',
          recipient_address: recipientAddress,
          created_by: userId ? String(userId) : null,
          creator_email: null,
          status: 'OPEN' as ClaimStatus,
          is_private: finalIsPrivate,
          description: description || null,
          is_devnet: isSolanaDevnetFromConfig(this.configService),
        })
        .select('id')
        .single();

      if (claimError) {
        this.logger.error('Error creating claim from email (existing user):', claimError);
        throw new BadRequestException('Failed to create claim');
      }

      const id = claim.id;
      const link = `${this.baseUrl}/c/${id}`;
      this.logger.log(`Created claim from email (existing user): ${id} for ${cleanEmail}`);
      return { id, link };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (!(err instanceof NotFoundException)) throw err;
      // User not found: create claim with PENDING_EMAIL so they can claim by signing in later
    }

    recipientAddress = `${ClaimsService.PENDING_EMAIL_PREFIX}${cleanEmail}`;
    const burner = this.createClaimBurner();
    if (!burner) {
      this.logger.warn('Creating pending-email claim without burner: SEND_PAYMENT_ENC_KEY may be missing. Pay-with-Loofta will fail until the key is set.');
    }

    const { data: claim, error: claimError } = await this.supabaseService.claims
      .insert({
        amount: String(amount),
        to_symbol: 'USDC',
        to_chain: 'solana',
        recipient_address: recipientAddress,
        created_by: userId ? String(userId) : null,
        creator_email: null,
        status: 'OPEN' as ClaimStatus,
        is_private: isPrivate,
        description: description || null,
        is_devnet: isSolanaDevnetFromConfig(this.configService),
        ...(burner ? { claim_burner_address: burner.claim_burner_address, claim_burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
      })
      .select('id')
      .single();

    if (claimError) {
      this.logger.error('Error creating claim from email (pending):', claimError);
      throw new BadRequestException('Failed to create claim');
    }

    const id = claim.id;
    const link = `${this.baseUrl}/c/${id}`;
    this.logger.log(`Created claim from email (pending): ${id} for ${cleanEmail} – they claim by signing in${burner ? ' (unique burner)' : ''}`);
    return { id, link };
  }

  /**
   * Get claim by ID
   */
  async findOne(id: string): Promise<Claim> {
    const { data, error } = await this.supabaseService.claims
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    const claim = data as Claim;
    if ((claim.status || '').toUpperCase() === 'DELETED') {
      throw new NotFoundException('This payment doesn\'t exist.');
    }
    if (claim.created_by) {
      const creator = await this.usersService.findByPrivyId(claim.created_by);
      (claim as Claim & { creator_username?: string | null }).creator_username = creator?.username ?? null;
    }
    // Mask pending-email claims: don't expose email to client, expose flag so UI can show "Sign in to claim"
    if (claim.recipient_address?.startsWith(ClaimsService.PENDING_EMAIL_PREFIX)) {
      (claim as Claim & { recipient_address?: string; recipient_pending_email?: boolean }).recipient_address = undefined;
      (claim as Claim & { recipient_pending_email?: boolean }).recipient_pending_email = true;
      const dataWithBurner = data as { claim_burner_address?: string | null };
      this.logger.log(`[findOne] Pending-email claim ${id}: DB has claim_burner_address=${!!dataWithBurner.claim_burner_address}`);
      let burnerAddr = dataWithBurner.claim_burner_address?.trim() || null;
      if (!burnerAddr) {
        burnerAddr = await this.backfillBurnerForClaim(id);
      }
      if (burnerAddr) (claim as Claim & { claim_burner_address?: string }).claim_burner_address = burnerAddr;
    }
    // Mask pending-username claims: expose flag and username so UI can show "Claim with @username"
    if (claim.recipient_address?.startsWith(ClaimsService.PENDING_USERNAME_PREFIX)) {
      const pendingUsername = claim.recipient_address.slice(ClaimsService.PENDING_USERNAME_PREFIX.length).trim();
      (claim as Claim & { recipient_address?: string }).recipient_address = undefined;
      (claim as Claim & { recipient_pending_username?: boolean }).recipient_pending_username = true;
      (claim as Claim & { recipient_pending_username_value?: string }).recipient_pending_username_value = pendingUsername;
      const dataWithBurner = data as { claim_burner_address?: string | null };
      this.logger.log(`[findOne] Pending-username claim ${id}: DB has claim_burner_address=${!!dataWithBurner.claim_burner_address}`);
      let burnerAddr = dataWithBurner.claim_burner_address?.trim() || null;
      if (!burnerAddr) {
        burnerAddr = await this.backfillBurnerForClaim(id);
      }
      if (burnerAddr) (claim as Claim & { claim_burner_address?: string }).claim_burner_address = burnerAddr;
    }
    return claim;
  }

  /**
   * Backfill a burner for an existing pending claim that was created without one.
   * Creates burner, persists to DB, returns burner address or null if key unavailable.
   */
  private async backfillBurnerForClaim(claimId: string): Promise<string | null> {
    const burner = this.createClaimBurner();
    if (!burner) {
      this.logger.warn(`[findOne] Cannot backfill burner for claim ${claimId}: SEND_PAYMENT_ENC_KEY not available`);
      return null;
    }
    const { error } = await this.supabaseService.claims
      .update({
        claim_burner_address: burner.claim_burner_address,
        claim_burner_encrypted_secret: burner.claim_burner_encrypted_secret,
      })
      .eq('id', claimId);
    if (error) {
      this.logger.error(`[findOne] Failed to backfill burner for claim ${claimId}:`, error);
      return null;
    }
    this.logger.log(`[findOne] Backfilled burner for pending claim ${claimId}`);
    return burner.claim_burner_address;
  }

  /**
   * Get claim by ID without masking (internal use e.g. recipient-check)
   */
  async findOneRaw(id: string): Promise<Claim & { recipient_address?: string }> {
    const { data, error } = await this.supabaseService.claims
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }
    const row = data as Claim & { recipient_address?: string };
    if ((row.status || '').toUpperCase() === 'DELETED') {
      throw new NotFoundException('This payment doesn\'t exist.');
    }
    return row;
  }

  /**
   * Check if the authenticated user is the recipient of this claim (for recipient view on /c/[id])
   */
  async checkIsRecipient(claimId: string, privyUserId: string): Promise<{ isRecipient: boolean }> {
    const claim = await this.findOneRaw(claimId);
    const recipientAddress = claim.recipient_address;
    if (!recipientAddress) {
      return { isRecipient: false };
    }
    if (recipientAddress.startsWith(ClaimsService.PENDING_EMAIL_PREFIX)) {
      const pendingEmail = recipientAddress.slice(ClaimsService.PENDING_EMAIL_PREFIX.length).trim().toLowerCase();
      const userEmail = await this.usersService.getEmailByPrivyId(privyUserId);
      return { isRecipient: !!userEmail && userEmail === pendingEmail };
    }
    if (recipientAddress.startsWith(ClaimsService.PENDING_USERNAME_PREFIX)) {
      const pendingUsername = recipientAddress.slice(ClaimsService.PENDING_USERNAME_PREFIX.length).trim().toLowerCase();
      const creator = await this.usersService.findByPrivyId(privyUserId);
      const userUsername = creator?.username?.toLowerCase() ?? '';
      return { isRecipient: !!pendingUsername && userUsername === pendingUsername };
    }
    try {
      const userWallet = await this.usersService.getSolanaWalletAddress(privyUserId);
      return { isRecipient: userWallet.trim().toLowerCase() === recipientAddress.trim().toLowerCase() };
    } catch {
      return { isRecipient: false };
    }
  }

  /**
   * Claim a pending payment (PENDING_EMAIL / PENDING_USERNAME) as the authenticated recipient.
   * Updates recipient_address to the user's Solana wallet so the payer can complete deposit.
   */
  async claimAsRecipient(claimId: string, privyUserId: string): Promise<{ claimed: boolean }> {
    const claim = await this.findOneRaw(claimId);
    const ra = (claim.recipient_address || '').trim();
    const isPendingEmail = ra.startsWith(ClaimsService.PENDING_EMAIL_PREFIX);
    const isPendingUsername = ra.startsWith(ClaimsService.PENDING_USERNAME_PREFIX);
    if (!isPendingEmail && !isPendingUsername) {
      throw new BadRequestException('This payment is not pending claim or has already been claimed.');
    }
    const { isRecipient } = await this.checkIsRecipient(claimId, privyUserId);
    if (!isRecipient) {
      throw new ForbiddenException('You are not the intended recipient of this payment.');
    }
    const wallet = await this.usersService.getSolanaWalletAddress(privyUserId);
    if (!wallet?.trim()) {
      throw new BadRequestException('No Solana wallet linked to your account. Please add a wallet in settings.');
    }
    const { error } = await this.supabaseService.claims
      .update({ recipient_address: wallet.trim() })
      .eq('id', claimId)
      .select()
      .single();
    if (error) {
      this.logger.error('Failed to claim payment:', error);
      throw new BadRequestException('Failed to claim payment.');
    }

    // If this claim had a unique burner and funds landed there, sweep USDC to the recipient (like Privacy Cash)
    const rawClaim = claim as { claim_burner_address?: string | null; claim_burner_encrypted_secret?: string | null };
    const burnerAddr = (rawClaim.claim_burner_address || '').trim();
    if (
      burnerAddr &&
      rawClaim.claim_burner_encrypted_secret &&
      this.canDecryptBurnerSecret() &&
      this.solanaSponsor?.isAvailable()
    ) {
      try {
        const secretKey = this.decryptClaimBurnerSecret(rawClaim.claim_burner_encrypted_secret);
        const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
        const conn = this.solanaSponsor.getConnection();
        const burnerAta = await getAssociatedTokenAddress(USDC_MINT, burnerKeypair.publicKey);
        let balance = BigInt(0);
        try {
          const acc = await getAccount(conn, burnerAta);
          balance = acc.amount;
        } catch {
          // ATA may not exist
        }
        this.logger.log(`Claim ${claimId}: [MONEY] claim sweep – burner ${burnerKeypair.publicKey.toBase58()} balance=${balance.toString()} -> recipient ${wallet.slice(0, 8)}...`);
        if (balance > BigInt(0)) {
          const recipientPubkey = new PublicKey(wallet.trim());
          const recipientAta = await getAssociatedTokenAddress(USDC_MINT, recipientPubkey);
          const { Transaction } = await import('@solana/web3.js');
          const tx = new Transaction();
          try {
            await getAccount(conn, recipientAta);
          } catch {
            const feePayer = this.solanaSponsor.getFeePayerKeypair();
            if (feePayer) {
              tx.add(
                createAssociatedTokenAccountInstruction(
                  feePayer.publicKey,
                  recipientAta,
                  recipientPubkey,
                  USDC_MINT,
                ),
              );
            }
          }
          tx.add(createTransferInstruction(burnerAta, recipientAta, burnerKeypair.publicKey, balance));
          const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
          tx.recentBlockhash = blockhash;
          const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
          tx.feePayer = feePayerKp?.publicKey ?? burnerKeypair.publicKey;
          tx.sign(burnerKeypair);
          const signers = [burnerKeypair];
          if (feePayerKp) {
            tx.sign(feePayerKp);
            signers.push(feePayerKp);
          }
          const sig = await conn.sendTransaction(tx, signers, { skipPreflight: true });
          await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
          this.logger.log(`Claim ${claimId}: [MONEY] swept ${balance} USDC from burner ${burnerKeypair.publicKey.toBase58()} to recipient ${wallet} tx=${sig}`);
        }
      } catch (e: any) {
        this.logger.warn(`Claim ${claimId}: burner sweep failed (recipient updated) – ${e?.message ?? e}`);
      }
    }

    this.logger.log(`Claim ${claimId} claimed by recipient (privy ${privyUserId})`);
    return { claimed: true };
  }

  /**
   * Reclaim (cancel) a claim by the creator. Sets status to CANCELLED.
   * If the claim has a burner with USDC, sweeps it to the creator's Loofta (Solana) wallet.
   * Both flows are supported: sender can reclaim (this method); recipient can claim (claimByRecipient).
   */
  async reclaimByCreator(claimId: string, privyUserId: string): Promise<{ cancelled: boolean }> {
    this.logger.log(`Claim ${claimId}: reclaim requested by creator (privy ${privyUserId})`);
    const claim = await this.findOneRaw(claimId);
    if (!claim.created_by || claim.created_by !== privyUserId) {
      throw new ForbiddenException('Only the creator of this payment can reclaim it.');
    }
    const status = (claim.status || '').toUpperCase();
    if (status === 'CANCELLED') {
      this.logger.log(`Claim ${claimId}: already cancelled`);
      return { cancelled: true };
    }

    const rawClaim = claim as { claim_burner_address?: string | null; claim_burner_encrypted_secret?: string | null };
    const burnerAddress = (rawClaim.claim_burner_address || '').trim();
    const hasBurner = !!(burnerAddress && rawClaim.claim_burner_encrypted_secret);
    const hasEncryption = this.canDecryptBurnerSecret();
    const hasSponsor = this.solanaSponsor.isAvailable();

    this.logger.log(
      `Claim ${claimId}: reclaim sweep check – burner=${burnerAddress || 'none'}, encryption=${hasEncryption} (injected=${!!this.encryption?.isAvailable()}, directKey=${!!this.getClaimBurnerDecryptionKey()}), sponsor=${hasSponsor}`,
    );

    if (!hasBurner) {
      this.logger.log(`Claim ${claimId}: no burner on claim (not funded yet or legacy claim), skipping sweep`);
    } else if (!hasEncryption) {
      this.logger.warn(
        `Claim ${claimId}: SEND_PAYMENT_ENC_KEY not available (config or process.env); cannot decrypt burner secret. Burner address: ${burnerAddress}`,
      );
    } else if (!hasSponsor) {
      this.logger.warn(`Claim ${claimId}: Solana sponsor not available; cannot pay for sweep. Burner address: ${burnerAddress}`);
    } else {
      try {
        let creatorWallet: string | null = null;
        try {
          creatorWallet = await this.usersService.getSolanaWalletAddress(privyUserId);
        } catch (walletErr: any) {
          this.logger.warn(`Claim ${claimId}: creator wallet lookup failed – ${walletErr?.message ?? walletErr}`);
        }
        this.logger.log(`Claim ${claimId}: creator Solana wallet for reclaim: ${creatorWallet ? `${creatorWallet.slice(0, 8)}...${creatorWallet.slice(-4)}` : 'not found'}`);
        if (!creatorWallet?.trim()) {
          this.logger.warn(`Claim ${claimId}: creator Solana wallet not found for privy ${privyUserId}; skipping sweep (claim will still be cancelled)`);
        } else {
          const encryptedSecret = rawClaim.claim_burner_encrypted_secret!;
          const secretKey = this.decryptClaimBurnerSecret(encryptedSecret);
          const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
          const conn = this.solanaSponsor.getConnection();
          const burnerAta = await getAssociatedTokenAddress(USDC_MINT, burnerKeypair.publicKey);
          let balance = BigInt(0);
          try {
            const acc = await getAccount(conn, burnerAta);
            balance = acc.amount;
          } catch {
            // ATA may not exist
          }
          this.logger.log(`Claim ${claimId}: burner ${burnerKeypair.publicKey.toBase58()} USDC balance=${balance.toString()}`);
          if (balance > BigInt(0)) {
            const creatorPubkey = new PublicKey(creatorWallet.trim());
            const creatorAta = await getAssociatedTokenAddress(USDC_MINT, creatorPubkey);
            const { Transaction } = await import('@solana/web3.js');
            const tx = new Transaction();
            try {
              await getAccount(conn, creatorAta);
            } catch {
              const feePayer = this.solanaSponsor.getFeePayerKeypair();
              if (feePayer) {
                tx.add(
                  createAssociatedTokenAccountInstruction(
                    feePayer.publicKey,
                    creatorAta,
                    creatorPubkey,
                    USDC_MINT,
                  ),
                );
              }
            }
            tx.add(createTransferInstruction(burnerAta, creatorAta, burnerKeypair.publicKey, balance));
            const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
            tx.recentBlockhash = blockhash;
            const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
            tx.feePayer = feePayerKp?.publicKey ?? burnerKeypair.publicKey;
            tx.sign(burnerKeypair);
            const signers = [burnerKeypair];
            if (feePayerKp) {
              tx.sign(feePayerKp);
              signers.push(feePayerKp);
            }
            this.logger.log(`Claim ${claimId}: sending reclaim transfer ${balance} USDC burner->creator ${creatorWallet.slice(0, 8)}...`);
            const sig = await conn.sendTransaction(tx, signers, { skipPreflight: true });
            await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
            this.logger.log(`Claim ${claimId}: [MONEY] reclaimed ${balance} USDC from burner ${burnerKeypair.publicKey.toBase58()} to creator ${creatorWallet} tx=${sig}`);
          } else {
            this.logger.log(`Claim ${claimId}: burner ${burnerKeypair.publicKey.toBase58()} has 0 USDC balance, nothing to transfer`);
          }
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        const stack = e?.stack ? `\n${e.stack}` : '';
        this.logger.error(`Claim ${claimId}: reclaim sweep failed – ${msg}${stack}`);
      }
    }

    const { error } = await this.supabaseService.claims
      .update({ status: 'CANCELLED' })
      .eq('id', claimId);

    if (error) {
      this.logger.error('Failed to cancel claim:', error);
      throw new BadRequestException('Failed to cancel payment.');
    }
    this.logger.log(`Claim ${claimId} reclaimed (cancelled) by creator`);
    return { cancelled: true };
  }

  /**
   * Whether the creator can reclaim (cancel and sweep). Only true when status is not CANCELLED
   * and the claim's burner has a non-zero USDC balance.
   */
  async getReclaimEligibility(claimId: string, privyUserId: string): Promise<{ canReclaim: boolean }> {
    const claim = await this.findOneRaw(claimId);
    if (!claim.created_by || claim.created_by !== privyUserId) {
      throw new ForbiddenException('Only the creator can check reclaim eligibility.');
    }
    const status = (claim.status || '').toUpperCase();
    if (status === 'CANCELLED') {
      return { canReclaim: false };
    }
    const rawClaim = claim as { claim_burner_address?: string | null; claim_burner_encrypted_secret?: string | null };
    const burnerAddress = (rawClaim.claim_burner_address || '').trim();
    const hasBurner = !!(burnerAddress && rawClaim.claim_burner_encrypted_secret);
    if (!hasBurner || !this.canDecryptBurnerSecret() || !this.solanaSponsor.isAvailable()) {
      return { canReclaim: false };
    }
    try {
      const secretKey = this.decryptClaimBurnerSecret(rawClaim.claim_burner_encrypted_secret!);
      const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
      const conn = this.solanaSponsor.getConnection();
      const burnerAta = await getAssociatedTokenAddress(USDC_MINT, burnerKeypair.publicKey);
      let balance = BigInt(0);
      try {
        const acc = await getAccount(conn, burnerAta);
        balance = acc.amount;
      } catch {
        // ATA may not exist
      }
      return { canReclaim: balance > BigInt(0) };
    } catch {
      return { canReclaim: false };
    }
  }

  /**
   * Get claim with latest intent
   */
  async findWithLatestIntent(id: string): Promise<{
    claim: Claim;
    intent: ClaimIntent | null;
  }> {
    const claim = await this.findOne(id);

    const { data: intent } = await this.supabaseService.claimIntents
      .select('*')
      .eq('claim_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return { claim, intent };
  }

  /**
   * Update claim status. When status is SUCCESS and createdByUserId is provided, backfill created_by if currently null (so payment shows in history).
   */
  async updateStatus(id: string, status: ClaimStatus, extra?: { 
    txHash?: string; 
    paidWith?: string; 
    isPrivate?: boolean;
    paidWithToken?: string;
    paidWithChain?: string;
  }, createdByUserId?: string): Promise<Claim> {
    const updateData: Record<string, any> = { status };
    
    // Set paid_at timestamp when status becomes SUCCESS
    if (status === 'SUCCESS') {
      updateData.paid_at = new Date().toISOString();
      // Backfill created_by when missing so the payment appears in history
      if (createdByUserId) {
        const { data: existing } = await this.supabaseService.claims
          .select('created_by')
          .eq('id', id)
          .maybeSingle();
        if (existing && !existing.created_by) {
          updateData.created_by = createdByUserId;
        }
      }
    }
    
    // Set is_private flag if provided (for private payments)
    if (extra?.isPrivate !== undefined) {
      updateData.is_private = extra.isPrivate;
    }
    
    // Save payment information (what token/chain was used to pay)
    if (extra?.paidWithToken) {
      updateData.paid_with_token = extra.paidWithToken;
    }
    if (extra?.paidWithChain) {
      updateData.paid_with_chain = extra.paidWithChain;
    }
    
    const { data, error } = await this.supabaseService.claims
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update claim status:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Updated claim ${id} status to ${status}${extra?.isPrivate ? ' (private)' : ''}`);
    return data;
  }

  /**
   * Get all claims for a user
   */
  async findByUser(userId: string): Promise<Claim[]> {
    const { data, error } = await this.supabaseService.claims
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch user claims:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get claims by status (for cron processing)
   */
  async findByStatus(status: ClaimStatus): Promise<Claim[]> {
    const { data, error } = await this.supabaseService.claims
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch claims by status:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create claim intent record
   */
  async createIntent(params: {
    claimId: string;
    quoteId?: string;
    depositAddress?: string;
    memo?: string | null;
    deadline?: string;
    timeEstimate?: number;
    fromChain?: string;
    toChain?: string;
    status?: string;
  }): Promise<ClaimIntent> {
    const { data, error } = await this.supabaseService.claimIntents
      .insert({
        claim_id: params.claimId,
        quote_id: params.quoteId || null,
        deposit_address: params.depositAddress || null,
        memo: params.memo || null,
        deadline: params.deadline ? new Date(params.deadline).toISOString() : null,
        time_estimate: params.timeEstimate || null,
        status: params.status || 'PENDING_DEPOSIT',
        last_status_payload: null,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create claim intent:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    // Update claim status
    await this.updateStatus(params.claimId, 'PENDING_DEPOSIT');

    return data;
  }

  /**
   * Update claim intent
   */
  async updateIntent(
    intentId: string,
    updates: Partial<{
      status: string;
      lastStatusPayload: any;
      paidAmount: string;
    }>,
  ): Promise<ClaimIntent> {
    const updateData: Record<string, unknown> = {};
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.lastStatusPayload !== undefined) updateData.last_status_payload = updates.lastStatusPayload;
    if (updates.paidAmount !== undefined) updateData.paid_amount = updates.paidAmount;

    const { data, error } = await this.supabaseService.claimIntents
      .update(updateData)
      .eq('id', intentId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update claim intent:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  }

  /**
   * Get pending intents for processing
   * Excludes expired intents and intents older than 1 month
   */
  async getPendingIntents(): Promise<ClaimIntent[]> {
    const now = new Date().toISOString();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const { data, error } = await this.supabaseService.claimIntents
      .select('*')
      .in('status', ['PENDING_DEPOSIT', 'IN_FLIGHT'])
      .gt('deadline', now) // Only intents with future deadlines
      .gt('created_at', oneMonthAgo.toISOString()) // Only intents from last month
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch pending intents:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get all claims (admin)
   */
  async findAll(options?: {
    status?: ClaimStatus;
    org_referral?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ claims: Claim[]; total: number }> {
    let query = this.supabaseService.claims.select('*', { count: 'exact' });

    if (options?.status) {
      query = query.eq('status', options.status);
    }
    if (options?.org_referral) {
      query = query.eq('org_referral', options.org_referral);
    }

    query = query.order('created_at', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }
    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      this.logger.error('Failed to fetch all claims:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return { claims: data || [], total: count || 0 };
  }

  /**
   * Delete a claim and its intents (admin)
   */
  async delete(id: string): Promise<void> {
    // First delete all intents for this claim
    const { error: intentError } = await this.supabaseService.claimIntents
      .delete()
      .eq('claim_id', id);

    if (intentError) {
      this.logger.error('Failed to delete claim intents:', intentError);
      throw new Error(`Database error: ${intentError.message}`);
    }

    // Then delete the claim
    const { error } = await this.supabaseService.claims
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete claim:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Deleted claim: ${id}`);
  }

  /**
   * Delete multiple claims (admin)
   */
  async deleteMany(ids: string[]): Promise<{ deleted: number }> {
    let deletedCount = 0;

    for (const id of ids) {
      try {
        await this.delete(id);
        deletedCount++;
      } catch (e) {
        this.logger.error(`Failed to delete claim ${id}:`, e);
      }
    }

    return { deleted: deletedCount };
  }

  /**
   * Get claim with all intents (admin)
   */
  async findWithAllIntents(id: string): Promise<{
    claim: Claim;
    intents: ClaimIntent[];
  }> {
    const claim = await this.findOne(id);

    const { data: intents, error } = await this.supabaseService.claimIntents
      .select('*')
      .eq('claim_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch claim intents:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return { claim, intents: intents || [] };
  }
}
