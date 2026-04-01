import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import nacl from 'tweetnacl';
import { Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, Connection } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { CreateClaimDto, CreateClaimFromUsernameDto, CreateClaimFromEmailDto } from './dto';
import { Claim, ClaimIntent, ClaimStatus } from './entities/claim.entity';
import { UsersService } from '../users/users.service';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { SolanaSponsorService } from './solana-sponsor.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import type { MagicblockPrivateTransferTxResponse } from '@/common/magicblock-private-transfer';

const DEPOSIT_SEED = 'deposit';
const VAULT_SEED = 'vault';
const MODIFY_BALANCE_DISCRIMINATOR = Buffer.from([148, 232, 7, 240, 55, 51, 121, 115]);
const UNDELEGATE_DISCRIMINATOR = Buffer.from([131, 148, 180, 198, 91, 104, 42, 238]);
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');

/** MagicBlock payer→burner can take up to ~3 min; poll burner ATA until then. */
const BURNER_INBOUND_POLL_MS = 5_000;
/** Short wait inside a single sweep HTTP call (avoid gateway timeouts). */
const BURNER_INBOUND_INLINE_MAX_MS = 90_000;
/** Background poller: keep trying sweep for this long after claim (covers full private delay + buffer). */
const BURNER_INBOUND_BACKGROUND_MAX_MS = 4 * 60_000;

/** Same as SendPaymentEncryptionService – used when that service is not injected or key not loaded there */
const ENC_ALGO = 'aes-256-gcm';
const ENC_IV_LENGTH = 16;
const ENC_TAG_LENGTH = 16;
const ENC_KEY_LENGTH = 32;

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly baseUrl: string;
  private readonly usdcMint: PublicKey;
  private readonly perProgramId: PublicKey;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Optional() private readonly encryption: SendPaymentEncryptionService | null,
    private readonly solanaSponsor: SolanaSponsorService,
  ) {
    const defaultUsdcMint = isSolanaDevnetFromConfig(this.configService)
      ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
      : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const mintStr =
      this.configService.get<string>('SOLANA_USDC_MINT') ||
      this.configService.get<string>('NEXT_PUBLIC_SOLANA_USDC_MINT') ||
      defaultUsdcMint;
    this.usdcMint = new PublicKey(mintStr);
    const perProgramStr =
      this.configService.get<string>('PER_PROGRAM_ID') ||
      this.configService.get<string>('NEXT_PUBLIC_PER_PROGRAM_ID') ||
      'EQMRkmeCbzZaXyEDwgqiTqgg8kUjxBXPe616odmPjSwL';
    this.perProgramId = new PublicKey(perProgramStr);
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

  private isPendingRecipientAddress(addr?: string | null): boolean {
    const v = (addr || '').trim();
    return v.startsWith(ClaimsService.PENDING_EMAIL_PREFIX) || v.startsWith(ClaimsService.PENDING_USERNAME_PREFIX);
  }

  private formatError(error: unknown): string {
    if (!error) return 'unknown error';
    if (typeof error === 'string') return error;
    const anyErr = error as any;
    const parts: string[] = [];
    if (anyErr?.message) parts.push(String(anyErr.message));
    if (anyErr?.name) parts.push(`name=${String(anyErr.name)}`);
    if (anyErr?.code !== undefined) parts.push(`code=${String(anyErr.code)}`);
    if (Array.isArray(anyErr?.logs) && anyErr.logs.length > 0) {
      parts.push(`logs=${anyErr.logs.slice(0, 8).join(' | ')}`);
    }
    try {
      const json = JSON.stringify(anyErr);
      if (json && json !== '{}' && json !== '[]') parts.push(`raw=${json}`);
    } catch {
      // ignore stringify errors
    }
    if (parts.length > 0) return parts.join(' ; ');
    return String(error);
  }

  private getMagicblockAuthCandidates(): string[] {
    const explicit = this.configService.get<string>('NEXT_PUBLIC_MAGICBLOCK_URL')?.replace(/\?.*$/, '').replace(/\/$/, '');
    const cluster =
      this.configService.get<string>('SOLANA_CLUSTER')?.trim() ||
      this.configService.get<string>('NEXT_PUBLIC_SOLANA_CLUSTER')?.trim() ||
      '';
    const candidates: string[] = [];
    const add = (u?: string) => {
      if (!u) return;
      const x = u.replace(/\/$/, '');
      if (!candidates.includes(x)) candidates.push(x);
    };
    add(explicit);
    if (cluster === 'mainnet-beta') {
      add('https://mainnet-tee.magicblock.app');
    } else {
      add('https://tee.magicblock.app');
    }
    return candidates;
  }

  private async getEphemeralConnectionForBurner(
    burnerKeypair: Keypair,
  ): Promise<import('@solana/web3.js').Connection | null> {
    try {
      const sdk = await import('@magicblock-labs/ephemeral-rollups-sdk');
      const getAuthToken = (sdk as any).getAuthToken as
        | ((baseUrl: string, publicKey: PublicKey, signMessage: (message: Uint8Array) => Promise<Uint8Array>) => Promise<string | { token: string }>)
        | undefined;
      if (!getAuthToken) return null;
      const candidates = this.getMagicblockAuthCandidates();
      const signMessage = async (message: Uint8Array) => nacl.sign.detached(message, burnerKeypair.secretKey);
      // Try each candidate up to MAX_AUTH_ATTEMPTS times with exponential backoff.
      const MAX_AUTH_ATTEMPTS = 3;
      for (const baseUrl of candidates) {
        let lastErr: unknown;
        for (let attempt = 0; attempt < MAX_AUTH_ATTEMPTS; attempt++) {
          try {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
            const res = await getAuthToken(baseUrl, burnerKeypair.publicKey, signMessage);
            const token = typeof res === 'string' ? res : res?.token;
            if (!token) break; // empty token — move to next candidate
            const rpcBase = baseUrl.replace(/\/$/, '');
            this.logger.log(`Ephemeral auth succeeded for burner via ${baseUrl} (attempt ${attempt + 1})`);
            return new (await import('@solana/web3.js')).Connection(`${rpcBase}?token=${token}`, 'confirmed');
          } catch (e) {
            lastErr = e;
          }
        }
        if (lastErr) {
          this.logger.warn(`Ephemeral auth failed for ${baseUrl} after ${MAX_AUTH_ATTEMPTS} attempts: ${this.formatError(lastErr)}`);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Privacy-safe email display for public claim pages. */
  private maskEmail(email: string): string {
    const clean = (email || '').trim().toLowerCase();
    const [local, domain] = clean.split('@');
    if (!local || !domain) return 'email recipient';
    const maskedLocal =
      local.length <= 2 ? `${local[0] || '*'}*` : `${local.slice(0, 2)}***`;
    const domainParts = domain.split('.');
    const root = domainParts[0] || '';
    const tld = domainParts.slice(1).join('.');
    const maskedRoot =
      root.length <= 2 ? `${root[0] || '*'}*` : `${root.slice(0, 2)}***`;
    return `${maskedLocal}@${maskedRoot}${tld ? `.${tld}` : ''}`;
  }

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
      const pendingEmail = claim.recipient_address.slice(ClaimsService.PENDING_EMAIL_PREFIX.length).trim().toLowerCase();
      (claim as Claim & { recipient_address?: string; recipient_pending_email?: boolean }).recipient_address = undefined;
      (claim as Claim & { recipient_pending_email?: boolean }).recipient_pending_email = true;
      (claim as Claim & { recipient_pending_email_value?: string }).recipient_pending_email_value = this.maskEmail(pendingEmail);
      const dataWithBurner = data as { claim_burner_address?: string | null };
      this.logger.log(
        `[findOne] Pending-email claim ${id}: claim_burner_address=${dataWithBurner.claim_burner_address?.trim() || 'missing'}`,
      );
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
      this.logger.log(
        `[findOne] Pending-username claim ${id}: claim_burner_address=${dataWithBurner.claim_burner_address?.trim() || 'missing'}`,
      );
      let burnerAddr = dataWithBurner.claim_burner_address?.trim() || null;
      if (!burnerAddr) {
        burnerAddr = await this.backfillBurnerForClaim(id);
      }
      if (burnerAddr) (claim as Claim & { claim_burner_address?: string }).claim_burner_address = burnerAddr;
    }

    // Never expose the encrypted burner private key to the frontend
    delete (claim as unknown as Record<string, unknown>)['claim_burner_encrypted_secret'];

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
   * Build unsigned MagicBlock private transfer with recipient resolved server-side only
   * (not exposed in browser → MagicBlock requests). Only the claim payer may call.
   */
  async buildPrivateTransferForPayer(
    claimId: string,
    privyUserId: string,
    senderWallet: string,
  ): Promise<MagicblockPrivateTransferTxResponse> {
    const { requestMagicblockPrivateTransfer } = await import('@/common/magicblock-private-transfer');
    const claim = await this.findOneRaw(claimId);
    const row = claim as Claim & { claim_burner_address?: string | null };
    if (!row.created_by || row.created_by !== privyUserId) {
      throw new ForbiddenException('Only the payer can build this private transfer.');
    }
    const to = this.resolveEffectiveRecipientForPrivatePayment(row);
    if (!to || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) {
      throw new BadRequestException('Recipient is not available for this claim yet.');
    }
    const amountUsd = parseFloat(String(claim.amount || '0'));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new BadRequestException('Invalid claim amount');
    }
    const baseUnits = Math.round(amountUsd * 1_000_000);
    const cluster = isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet';
    return requestMagicblockPrivateTransfer({
      from: senderWallet.trim(),
      to,
      mint: this.usdcMint.toBase58(),
      amount: baseUnits,
      cluster,
    });
  }

  /** Same routing as frontend getEffectiveRecipient: pending → burner, else wallet. */
  private resolveEffectiveRecipientForPrivatePayment(
    claim: Claim & { claim_burner_address?: string | null },
  ): string {
    const ra = (claim.recipient_address || '').trim();
    const burner = (claim.claim_burner_address || '').trim();
    if (
      ra &&
      !ra.startsWith(ClaimsService.PENDING_EMAIL_PREFIX) &&
      !ra.startsWith(ClaimsService.PENDING_USERNAME_PREFIX)
    ) {
      return ra;
    }
    return burner;
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
      // Use Privy-linked account verification (not only app_users sync) so recipient can claim immediately after login.
      const matches = await this.usersService.verifyRecipientIdentityForSendPayment(
        privyUserId,
        'email',
        pendingEmail,
      );
      return { isRecipient: matches };
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
  async claimAsRecipient(
    claimId: string,
    privyUserId: string,
  ): Promise<{ claimed: boolean; sweepTxHash?: string; sweptAmount?: string }> {
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

    const { sweepTxHash, sweptAmount } = await this.sweepClaimBurnerToWallet(claimId, claim, wallet);
    if (sweepTxHash) {
      await this.updateStatus(claimId, 'SUCCESS', undefined, privyUserId);
      this.logger.log(`Claim ${claimId}: sweep completed immediately, marked SUCCESS`);
    } else {
      // Funds still in-flight on MagicBlock private leg (up to ~3 min). Mark PRIVATE_TRANSFER_PENDING
      // and retry sweep after that window.
      await this.updateStatus(claimId, 'PRIVATE_TRANSFER_PENDING', undefined, privyUserId);
      this.logger.log(`Claim ${claimId}: burner empty at claim time — marked PRIVATE_TRANSFER_PENDING, scheduling background sweep retry`);
      const rawForRetry = claim as { claim_burner_address?: string | null };
      if (rawForRetry.claim_burner_address) {
        this.scheduleBackgroundSweepRetry(claimId, wallet, privyUserId);
      }
    }

    this.logger.log(`Claim ${claimId} claimed by recipient (privy ${privyUserId})`);
    return { claimed: true, sweepTxHash, sweptAmount };
  }

  /**
   * Poll burner ATA every few seconds until funds arrive (payer→burner private leg), then sweep to recipient.
   */
  private scheduleBackgroundSweepRetry(claimId: string, wallet: string, privyUserId: string): void {
    const started = Date.now();
    const tick = async (): Promise<void> => {
      if (Date.now() - started > BURNER_INBOUND_BACKGROUND_MAX_MS) {
        this.logger.warn(`Claim ${claimId}: background sweep poll window exhausted (${BURNER_INBOUND_BACKGROUND_MAX_MS}ms)`);
        return;
      }
      try {
        const freshClaim = await this.findOneRaw(claimId);
        const st = (freshClaim.status || '').toUpperCase();
        if (st === 'SUCCESS' || st === 'CANCELLED') return;
        const { sweepTxHash } = await this.sweepClaimBurnerToWallet(claimId, freshClaim, wallet);
        if (sweepTxHash) {
          await this.updateStatus(claimId, 'SUCCESS', undefined, privyUserId);
          this.logger.log(`Claim ${claimId}: background poll sweep succeeded, marked SUCCESS`);
          return;
        }
      } catch (e: any) {
        this.logger.warn(`Claim ${claimId}: background sweep tick — ${e?.message ?? e}`);
      }
      setTimeout(() => {
        void tick();
      }, BURNER_INBOUND_POLL_MS);
    };
    setTimeout(() => {
      void tick();
    }, BURNER_INBOUND_POLL_MS);
  }

  /** Poll on-chain burner USDC ATA until balance &gt; 0 or timeout (payer→burner delivery). */
  private async pollBurnerAtaUntilPositive(
    claimId: string,
    conn: Connection,
    burnerAta: PublicKey,
    maxWaitMs: number,
  ): Promise<bigint> {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      try {
        const acc = await getAccount(conn, burnerAta);
        if (acc.amount > BigInt(0)) {
          this.logger.log(
            `Claim ${claimId}: burner ATA credited ${acc.amount} base units (poll attempt ${attempt}, waited ≤${maxWaitMs}ms)`,
          );
          return acc.amount;
        }
      } catch {
        /* ATA missing or not funded yet */
      }
      await new Promise((r) => setTimeout(r, BURNER_INBOUND_POLL_MS));
    }
    try {
      const acc = await getAccount(conn, burnerAta);
      return acc.amount;
    } catch {
      return BigInt(0);
    }
  }

  /** Retry-only path: recipient can manually re-run burner sweep to their wallet. */
  async retryRecipientSweep(
    claimId: string,
    privyUserId: string,
  ): Promise<{ swept: boolean; sweepTxHash?: string; sweptAmount?: string }> {
    const claim = await this.findOneRaw(claimId);
    const wallet = await this.usersService.getSolanaWalletAddress(privyUserId);
    const recipientAddress = (claim.recipient_address || '').trim().toLowerCase();
    if (!wallet?.trim() || recipientAddress !== wallet.trim().toLowerCase()) {
      throw new ForbiddenException('You are not the recipient wallet for this payment.');
    }
    const { sweepTxHash, sweptAmount } = await this.sweepClaimBurnerToWallet(claimId, claim, wallet);
    if (sweepTxHash) {
      await this.updateStatus(claimId, 'SUCCESS', undefined, privyUserId);
    }
    return { swept: !!sweepTxHash, sweepTxHash, sweptAmount };
  }

  private async sweepClaimBurnerToWallet(
    claimId: string,
    claim: Claim & { recipient_address?: string },
    wallet: string,
  ): Promise<{ sweepTxHash?: string; sweptAmount?: string }> {
    const rawClaim = claim as { claim_burner_address?: string | null; claim_burner_encrypted_secret?: string | null };
    const burnerAddr = (rawClaim.claim_burner_address || '').trim();
    let sweepTxHash: string | undefined;
    let sweptAmount: string | undefined;
    if (!burnerAddr || !rawClaim.claim_burner_encrypted_secret) {
      return {};
    }
    if (!this.canDecryptBurnerSecret()) {
      throw new BadRequestException(
        'Claim burner decryption is not configured. Please contact support to recover this payment.',
      );
    }
    if (!this.solanaSponsor?.isAvailable()) {
      throw new BadRequestException(
        'Claim sponsorship is not configured. Please contact support to recover this payment.',
      );
    }
    try {
      const secretKey = this.decryptClaimBurnerSecret(rawClaim.claim_burner_encrypted_secret);
      const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
      const conn = this.solanaSponsor.getConnection();
      // Always attempt PER withdraw first. This also recovers older claims that
      // were incorrectly marked non-private while funds are still in PER deposit.
      const perWithdraw = await this.tryWithdrawPerDepositToBurnerAta(
        claimId,
        burnerKeypair,
        conn,
        String(claim.amount || '0'),
      );
      const burnerAta = await getAssociatedTokenAddress(this.usdcMint, burnerKeypair.publicKey);
      let balance = BigInt(0);
      try {
        const acc = await getAccount(conn, burnerAta);
        balance = acc.amount;
      } catch {
        // ATA may not exist yet
      }
      if (balance === BigInt(0)) {
        this.logger.log(
          `Claim ${claimId}: burner ATA empty after PER step — polling for payer→burner delivery (up to ${BURNER_INBOUND_INLINE_MAX_MS}ms)…`,
        );
        balance = await this.pollBurnerAtaUntilPositive(claimId, conn, burnerAta, BURNER_INBOUND_INLINE_MAX_MS);
      }
      this.logger.log(
        `Claim ${claimId}: [MONEY] burner=${burnerKeypair.publicKey.toBase58().slice(0, 8)} balance=${balance} perAttempted=${perWithdraw.attempted} perSuccess=${perWithdraw.success} -> recipient ${wallet.slice(0, 8)}...`,
      );
      if (balance > BigInt(0)) {
        // Direct SPL sweep: burner → recipient (public). Payer→burner was already private via MagicBlock.
        const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
        const recipientPubkey = new PublicKey(wallet.trim());
        const recipientAta = await getAssociatedTokenAddress(this.usdcMint, recipientPubkey);
        const sweepTx = new Transaction();
        try {
          await getAccount(conn, recipientAta);
        } catch {
          if (feePayerKp) {
            sweepTx.add(
              createAssociatedTokenAccountInstruction(
                feePayerKp.publicKey,
                recipientAta,
                recipientPubkey,
                this.usdcMint,
              ),
            );
          }
        }
        sweepTx.add(createTransferInstruction(burnerAta, recipientAta, burnerKeypair.publicKey, balance));
        const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
        sweepTx.recentBlockhash = blockhash;
        sweepTx.feePayer = feePayerKp?.publicKey ?? burnerKeypair.publicKey;
        sweepTx.sign(burnerKeypair);
        const signers = [burnerKeypair];
        if (feePayerKp) {
          sweepTx.sign(feePayerKp);
          signers.push(feePayerKp);
        }
        this.logger.log(
          `Claim ${claimId}: [SWEEP] direct SPL burner->recipient ${balance} base units (burner ${burnerKeypair.publicKey.toBase58().slice(0, 8)} → ${wallet.slice(0, 8)})`,
        );
        const sig = await conn.sendTransaction(sweepTx, signers, { skipPreflight: true });
        await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        this.logger.log(
          `Claim ${claimId}: [MONEY] ✅ swept ${balance} base-units USDC (${(Number(balance) / 1_000_000).toFixed(6)} USDC) burner=${burnerKeypair.publicKey.toBase58().slice(0, 8)} -> recipient=${wallet.slice(0, 8)} tx=${sig}`,
        );
        sweepTxHash = sig;
        sweptAmount = (Number(balance) / 1_000_000).toFixed(6);
      } else if (perWithdraw.attempted && !perWithdraw.success) {
        // PER deposit existed but we could not withdraw – do not silently succeed.
        throw new Error(
          `PER withdraw failed: ${perWithdraw.error ?? 'unknown'} | debug: ${(perWithdraw.debug ?? []).join(' | ')}`,
        );
      } else if (!perWithdraw.attempted) {
        // No PER deposit found and ATA is empty – funds may already be swept or were never deposited.
        this.logger.log(
          `Claim ${claimId}: no PER deposit and burner ATA empty – funds likely already swept or not yet deposited`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`Claim ${claimId}: burner sweep failed – ${e?.message ?? e}`);
      throw new BadRequestException(
        `Claim transfer failed: ${e?.message ?? 'unknown error'}. Please try again.`,
      );
    }
    return { sweepTxHash, sweptAmount };
  }

  private parsePerDepositAmountRaw(data: Buffer): bigint {
    // Anchor account layout: 8 discriminator + 32 user + 32 token_mint + 8 amount
    if (!data || data.length < 80) return 0n;
    return data.readBigUInt64LE(72);
  }

  /**
   * Undelegate a PER deposit back to the base chain so modify_balance (withdraw) can be called.
   *
   * Canonical pipeline:
   *   1. Ephemeral RPC (preferred) – sign with [burner + sponsor], send to ephemeral node.
   *      After the TX confirms we wait up to SETTLE_POLL_SECONDS for the deposit owner on mainnet
   *      to flip from DELEGATION_PROGRAM_ID → perProgramId.
   *   2. Mainnet RPC fallback – used only when ephemeral auth fails entirely.
   *
   * Resilience: auth is retried up to 3×/endpoint (see getEphemeralConnectionForBurner).
   *             Settlement poll runs for SETTLE_POLL_SECONDS (60 s) giving slow validators time.
   *             A 2 s grace period before polling begins avoids early false-negatives.
   */
  private async tryUndelegatePerDeposit(
    claimId: string,
    burnerKeypair: Keypair,
    conn: import('@solana/web3.js').Connection,
    depositPda: PublicKey,
  ): Promise<{ attempted: boolean; success: boolean; error?: string; txHash?: string; debug?: string[] }> {
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayerKp) return { attempted: false, success: false, error: 'fee payer unavailable' };
    const burner = burnerKeypair.publicKey;
    const debug: string[] = [];

    const SETTLE_POLL_SECONDS = 60;
    const SETTLE_GRACE_MS = 2_000;

    /**
     * After a confirmed undelegate TX, allow SETTLE_GRACE_MS for the ephemeral node to
     * queue the mainnet write, then poll once per second until the deposit owner on mainnet
     * flips to perProgramId (up to SETTLE_POLL_SECONDS).
     */
    const waitForOwnerFlip = async (label: string): Promise<boolean> => {
      await new Promise((r) => setTimeout(r, SETTLE_GRACE_MS));
      for (let i = 0; i < SETTLE_POLL_SECONDS; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const info = await conn.getAccountInfo(depositPda);
          if (info && info.owner.equals(this.perProgramId)) {
            this.logger.log(`Claim ${claimId}: ${label} owner flipped to PER at poll=${i + 1}`);
            debug.push(`${label}: owner flipped at poll=${i + 1}`);
            return true;
          }
        } catch (pollErr: any) {
          debug.push(`${label}: poll ${i + 1} error – ${this.formatError(pollErr)}`);
        }
      }
      debug.push(`${label}: owner did NOT flip after ${SETTLE_POLL_SECONDS} s`);
      return false;
    };

    // Undelegate IX: user = burner (authority), payer = sponsor, session_token = optional/absent.
    const buildUndelegateIx = () =>
      new TransactionInstruction({
        programId: this.perProgramId,
        keys: [
          { pubkey: burner, isSigner: true, isWritable: false },              // user / authority
          { pubkey: feePayerKp.publicKey, isSigner: true, isWritable: true }, // payer
          { pubkey: PublicKey.default, isSigner: false, isWritable: false },  // session_token (optional → none)
          { pubkey: depositPda, isSigner: false, isWritable: true },
          { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
        ],
        data: UNDELEGATE_DISCRIMINATOR,
      });

    const sendUndelegate = async (
      sendConn: import('@solana/web3.js').Connection,
      label: string,
    ): Promise<string> => {
      const ix = buildUndelegateIx();
      const tx = new Transaction().add(ix);
      const { blockhash, lastValidBlockHeight } = await sendConn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = feePayerKp.publicKey;
      tx.sign(feePayerKp, burnerKeypair);
      debug.push(`${label}: signers=[sponsor=${feePayerKp.publicKey.toBase58().slice(0, 8)}, burner=${burner.toBase58().slice(0, 8)}]`);
      const sig = await sendConn.sendTransaction(tx, [feePayerKp, burnerKeypair], { skipPreflight: true });
      debug.push(`${label}: tx=${sig}`);
      await sendConn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      return sig;
    };

    // ── Variant 1: ephemeral RPC ──────────────────────────────────────────────
    const ephemeralConn = await this.getEphemeralConnectionForBurner(burnerKeypair);
    if (ephemeralConn) {
      try {
        const sig = await sendUndelegate(ephemeralConn, 'ephemeral');
        const flipped = await waitForOwnerFlip('ephemeral');
        if (flipped) {
          this.logger.log(`Claim ${claimId}: undelegate ephemeral succeeded tx=${sig}`);
          return { attempted: true, success: true, txHash: sig, debug };
        }
        // TX confirmed but settlement didn't complete in time. The ephemeral node may still
        // be settling; caller should retry the whole claim flow after a delay.
        const err = `ephemeral tx confirmed (${sig}) but mainnet owner did not flip in ${SETTLE_POLL_SECONDS} s – retry later`;
        debug.push(err);
        this.logger.warn(`Claim ${claimId}: ${err}`);
        return { attempted: true, success: false, error: err, debug };
      } catch (e: any) {
        const msg = this.formatError(e);
        debug.push(`ephemeral failed: ${msg}`);
        this.logger.warn(`Claim ${claimId}: undelegate ephemeral failed – ${msg}`);
        // Fall through to mainnet only when the TX itself couldn't be sent/confirmed.
      }
    } else {
      debug.push('ephemeral connection unavailable – auth failed for all candidates');
      this.logger.warn(`Claim ${claimId}: ephemeral auth failed, trying mainnet fallback`);
    }

    // ── Variant 2: mainnet RPC fallback (only reached when ephemeral auth failed) ──
    try {
      const sig = await sendUndelegate(conn, 'mainnet');
      const flipped = await waitForOwnerFlip('mainnet');
      if (flipped) {
        this.logger.log(`Claim ${claimId}: undelegate mainnet fallback succeeded tx=${sig}`);
        return { attempted: true, success: true, txHash: sig, debug };
      }
      const err = `mainnet tx confirmed (${sig}) but owner did not flip in ${SETTLE_POLL_SECONDS} s`;
      debug.push(err);
      return { attempted: true, success: false, error: err, debug };
    } catch (e: any) {
      const msg = this.formatError(e);
      this.logger.warn(`Claim ${claimId}: undelegate mainnet fallback failed – ${msg}`);
      debug.push(`mainnet failed: ${msg}`);
      return { attempted: true, success: false, error: msg, debug };
    }
  }

  private async tryWithdrawPerDepositToBurnerAta(
    claimId: string,
    burnerKeypair: Keypair,
    conn: import('@solana/web3.js').Connection,
    claimAmountStr: string,
  ): Promise<{ attempted: boolean; success: boolean; error?: string; depositAmountRaw?: string; txHash?: string; debug?: string[] }> {
    const debug: string[] = [];
    try {
      const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
      if (!feePayerKp) return { attempted: false, success: false, error: 'fee payer unavailable', debug: ['fee payer unavailable'] };
      const burner = burnerKeypair.publicKey;
      const [depositPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(DEPOSIT_SEED), burner.toBuffer(), this.usdcMint.toBuffer()],
        this.perProgramId,
      );
      let depositInfo = await conn.getAccountInfo(depositPda);
      if (!depositInfo) return { attempted: false, success: false, error: 'deposit PDA not found', debug: ['deposit PDA not found'] };
      debug.push(`deposit owner=${depositInfo.owner.toBase58()}`);
      if (!depositInfo.owner.equals(this.perProgramId)) {
        // Deposit is still delegated – undelegate first. tryUndelegatePerDeposit polls
        // mainnet until the owner flip is confirmed before returning success.
        const undelegateResult = await this.tryUndelegatePerDeposit(claimId, burnerKeypair, conn, depositPda);
        if (undelegateResult.debug?.length) debug.push(...undelegateResult.debug);
        if (!undelegateResult.success) {
          return {
            attempted: true,
            success: false,
            error: undelegateResult.error || 'failed to undelegate deposit',
            debug,
          };
        }
        // Refetch after the confirmed flip.
        const refreshed = await conn.getAccountInfo(depositPda);
        if (!refreshed || !refreshed.owner.equals(this.perProgramId)) {
          return {
            attempted: true,
            success: false,
            error: `deposit owner still ${refreshed?.owner.toBase58() ?? 'unknown'} after successful undelegate`,
            debug,
          };
        }
        depositInfo = refreshed;
      }

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from(VAULT_SEED), this.usdcMint.toBuffer()],
        this.perProgramId,
      );
      const burnerAta = await getAssociatedTokenAddress(this.usdcMint, burner);
      const vaultAta = await getAssociatedTokenAddress(this.usdcMint, vaultPda, true);
      const amountNum = Number(claimAmountStr || '0');
      const claimAmountRaw = BigInt(Math.max(0, Math.floor(amountNum * 1_000_000)));
      const depositAmountRaw = this.parsePerDepositAmountRaw(depositInfo.data);
      const amountRaw =
        depositAmountRaw > 0n
          ? (claimAmountRaw > 0n && claimAmountRaw <= depositAmountRaw ? claimAmountRaw : depositAmountRaw)
          : claimAmountRaw;
      if (amountRaw <= 0n) {
        debug.push(`deposit amount raw=${depositAmountRaw.toString()}`);
        return {
          attempted: true,
          success: false,
          error: `deposit amount is zero (owner=${depositInfo.owner.toBase58()})`,
          depositAmountRaw: depositAmountRaw.toString(),
          debug,
        };
      }
      const amountBuf = Buffer.alloc(8);
      amountBuf.writeBigUInt64LE(amountRaw);
      const withdrawData = Buffer.concat([MODIFY_BALANCE_DISCRIMINATOR, amountBuf, Buffer.from([0])]); // increase=false
      const buildWithdrawIx = () =>
        new TransactionInstruction({
          programId: this.perProgramId,
          keys: [
            { pubkey: feePayerKp.publicKey, isSigner: true, isWritable: true },
            { pubkey: burner, isSigner: true, isWritable: false },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: depositPda, isSigner: false, isWritable: true },
            { pubkey: burnerAta, isSigner: false, isWritable: true },
            { pubkey: vaultAta, isSigner: false, isWritable: true },
            { pubkey: this.usdcMint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: withdrawData,
        });

      // Attempt withdraw with 1 automatic retry on transient failure (e.g. blockhash expired).
      const MAX_WITHDRAW_ATTEMPTS = 2;
      let lastWithdrawErr: unknown;
      for (let attempt = 0; attempt < MAX_WITHDRAW_ATTEMPTS; attempt++) {
        try {
          if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000));
          const withdrawTx = new Transaction().add(buildWithdrawIx());
          const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
          withdrawTx.recentBlockhash = blockhash;
          withdrawTx.feePayer = feePayerKp.publicKey;
          withdrawTx.sign(feePayerKp, burnerKeypair);
          const sig = await conn.sendTransaction(withdrawTx, [feePayerKp, burnerKeypair], { skipPreflight: true });
          await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
          this.logger.log(`Claim ${claimId}: PER withdraw->burner ATA tx=${sig} (attempt ${attempt + 1})`);
          debug.push(`withdraw tx=${sig} (attempt ${attempt + 1})`);
          return { attempted: true, success: true, txHash: sig, depositAmountRaw: depositAmountRaw.toString(), debug };
        } catch (e: any) {
          lastWithdrawErr = e;
          debug.push(`withdraw attempt ${attempt + 1} failed: ${this.formatError(e)}`);
        }
      }
      const msg = this.formatError(lastWithdrawErr);
      this.logger.warn(`Claim ${claimId}: PER withdraw failed after ${MAX_WITHDRAW_ATTEMPTS} attempts (${msg})`);
      return { attempted: true, success: false, error: msg, debug };
    } catch (e: any) {
      const msg = this.formatError(e);
      this.logger.warn(`Claim ${claimId}: PER withdraw attempt failed (${msg})`);
      return { attempted: true, success: false, error: msg, debug: [`withdraw exception: ${msg}`] };
    }
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

    let reclaimBlockedReason: string | null = null;
    if (!hasBurner) {
      this.logger.log(`Claim ${claimId}: no burner on claim (not funded yet or legacy claim), skipping sweep`);
    } else if (!hasEncryption) {
      this.logger.warn(
        `Claim ${claimId}: SEND_PAYMENT_ENC_KEY not available (config or process.env); cannot decrypt burner secret. Burner address: ${burnerAddress}`,
      );
      reclaimBlockedReason = 'Burner decryption is not configured (SEND_PAYMENT_ENC_KEY missing).';
    } else if (!hasSponsor) {
      this.logger.warn(`Claim ${claimId}: Solana sponsor not available; cannot pay for sweep. Burner address: ${burnerAddress}`);
      reclaimBlockedReason = 'Solana sponsor is not configured; cannot withdraw/sweep burner funds.';
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
          reclaimBlockedReason = 'Creator Solana wallet not found. Link a wallet first.';
        } else {
          const encryptedSecret = rawClaim.claim_burner_encrypted_secret!;
          const secretKey = this.decryptClaimBurnerSecret(encryptedSecret);
          const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
          const conn = this.solanaSponsor.getConnection();
          // Attempt PER -> burner ATA first so reclaim also works when funds are
          // still parked in PER deposit state.
          const perWithdraw = await this.tryWithdrawPerDepositToBurnerAta(
            claimId,
            burnerKeypair,
            conn,
            String(claim.amount || '0'),
          );

          const burnerAta = await getAssociatedTokenAddress(this.usdcMint, burnerKeypair.publicKey);
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
            const creatorAta = await getAssociatedTokenAddress(this.usdcMint, creatorPubkey);
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
                    this.usdcMint,
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
            const statusUpper = (claim.status || '').toUpperCase();
            if (statusUpper === 'SUCCESS' || statusUpper === 'PRIVATE_TRANSFER_PENDING') {
              const perReason = perWithdraw.error ? ` PER: ${perWithdraw.error}` : '';
              const perAmt =
                perWithdraw.depositAmountRaw !== undefined
                  ? ` PER amount=${(Number(perWithdraw.depositAmountRaw || '0') / 1_000_000).toFixed(6)} USDC.`
                  : '';
              reclaimBlockedReason = `No reclaimable USDC found in burner ATA after PER withdraw attempt.${perAmt}${perReason} Claim was NOT cancelled.`;
            }
          }
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        const stack = e?.stack ? `\n${e.stack}` : '';
        this.logger.error(`Claim ${claimId}: reclaim sweep failed – ${msg}${stack}`);
        reclaimBlockedReason = `Reclaim transfer failed: ${msg}`;
      }
    }

    if (reclaimBlockedReason) {
      throw new BadRequestException(reclaimBlockedReason);
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
   * Whether the creator can reclaim (cancel and attempt sweep). For pending-recipient
   * flows, we should allow reclaim whenever a burner exists and reclaim prerequisites
   * are configured, even if burner ATA currently shows 0 (funds may still be in PER).
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
      // Ensure burner secret can be decrypted; reclaim endpoint needs this.
      this.decryptClaimBurnerSecret(rawClaim.claim_burner_encrypted_secret!);
      return { canReclaim: true };
    } catch {
      return { canReclaim: false };
    }
  }

  /**
   * Troubleshoot helper: show whether funds are currently in claim burner.
   * Access limited to claim creator or intended recipient.
   */
  async getBurnerDiagnostics(
    claimId: string,
    privyUserId: string,
  ): Promise<{
    canView: true;
    claimId: string;
    claimStatus: string;
    isPrivate: boolean;
    paidWithToken: string | null;
    paidWithChain: string | null;
    burnerAddress: string | null;
    burnerUsdcRaw: string;
    burnerUsdc: string;
    perDepositDetected: boolean;
    perWithdrawAttempted: boolean;
    perDepositAmountRaw?: string;
    perWithdrawError?: string | null;
    perDebugLog?: string[];
    recipientWallet: string | null;
  }> {
    const claim = await this.findOneRaw(claimId);
    const isCreator = !!claim.created_by && claim.created_by === privyUserId;
    const recipientCheck = await this.checkIsRecipient(claimId, privyUserId);
    if (!isCreator && !recipientCheck.isRecipient) {
      throw new ForbiddenException('You are not allowed to view diagnostics for this payment.');
    }

    const rawClaim = claim as {
      claim_burner_address?: string | null;
      claim_burner_encrypted_secret?: string | null;
      paid_with_token?: string | null;
      paid_with_chain?: string | null;
    };
    const burnerAddress = (rawClaim.claim_burner_address || '').trim() || null;
    let burnerUsdcRaw = '0';
    let perDepositDetected = false;
    let perWithdrawAttempted = false;
    let perDepositAmountRaw: string | undefined;
    let perWithdrawError: string | null = null;
    const perDebugLog: string[] = [];
    if (burnerAddress) {
      try {
        const conn = this.solanaSponsor.getConnection();
        const burnerPubkey = new PublicKey(burnerAddress);
        const burnerAta = await getAssociatedTokenAddress(this.usdcMint, burnerPubkey);

        // Check PER deposit account presence for this burner, and try a PER withdraw
        // so diagnostics reflects whether funds are stuck in PER state.
        try {
          const [depositPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(DEPOSIT_SEED), burnerPubkey.toBuffer(), this.usdcMint.toBuffer()],
            this.perProgramId,
          );
          const depositInfo = await conn.getAccountInfo(depositPda);
          perDepositDetected = !!depositInfo;
          if (depositInfo && rawClaim.claim_burner_encrypted_secret && this.canDecryptBurnerSecret() && this.solanaSponsor.isAvailable()) {
            const secretKey = this.decryptClaimBurnerSecret(rawClaim.claim_burner_encrypted_secret);
            const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
            const withdrawResult = await this.tryWithdrawPerDepositToBurnerAta(
              claimId,
              burnerKeypair,
              conn,
              String(claim.amount || '0'),
            );
            perWithdrawAttempted = withdrawResult.attempted;
            perDepositAmountRaw = withdrawResult.depositAmountRaw;
            perWithdrawError = withdrawResult.success ? null : withdrawResult.error || null;
            if (withdrawResult.debug?.length) perDebugLog.push(...withdrawResult.debug);
          } else if (depositInfo) {
            perDepositAmountRaw = this.parsePerDepositAmountRaw(depositInfo.data).toString();
            perDebugLog.push(`deposit detected; raw amount=${perDepositAmountRaw}`);
          }
        } catch {
          // Keep diagnostics best-effort.
        }

        try {
          const acc = await getAccount(conn, burnerAta);
          burnerUsdcRaw = acc.amount.toString();
        } catch {
          burnerUsdcRaw = '0';
        }
      } catch {
        burnerUsdcRaw = '0';
      }
    }

    let recipientWallet: string | null = null;
    try {
      recipientWallet = await this.usersService.getSolanaWalletAddress(privyUserId);
    } catch {
      recipientWallet = null;
    }

    return {
      canView: true,
      claimId,
      claimStatus: String(claim.status || ''),
      isPrivate: claim.is_private === true || perDepositDetected,
      paidWithToken: rawClaim.paid_with_token ?? null,
      paidWithChain: rawClaim.paid_with_chain ?? null,
      burnerAddress,
      burnerUsdcRaw,
      burnerUsdc: (Number(burnerUsdcRaw) / 1_000_000).toFixed(6),
      perDepositDetected,
      perWithdrawAttempted,
      perDepositAmountRaw,
      perWithdrawError,
      perDebugLog: perDebugLog.length ? perDebugLog : undefined,
      recipientWallet,
    };
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
   * For CANCELLED: if callerUserId is provided, enforces that only the creator can cancel.
   */
  async updateStatus(id: string, status: ClaimStatus, extra?: { 
    txHash?: string; 
    paidWith?: string; 
    isPrivate?: boolean;
    paidWithToken?: string;
    paidWithChain?: string;
  }, createdByUserId?: string): Promise<Claim> {
    // Ownership check for destructive transitions
    if ((status as string).toUpperCase() === 'CANCELLED' && createdByUserId) {
      const { data: existing } = await this.supabaseService.claims
        .select('created_by')
        .eq('id', id)
        .maybeSingle();
      if (existing?.created_by && existing.created_by !== createdByUserId) {
        throw new ForbiddenException('Only the claim creator can cancel this payment');
      }
    }

    let effectiveStatus = status;
    const updateData: Record<string, any> = { status: effectiveStatus };

    // For unresolved recipients, sender-funded does not mean recipient-claimed yet.
    if (status === 'SUCCESS') {
      const { data: existingClaim } = await this.supabaseService.claims
        .select('recipient_address')
        .eq('id', id)
        .maybeSingle();
      if (existingClaim && this.isPendingRecipientAddress(existingClaim.recipient_address)) {
        effectiveStatus = 'PRIVATE_TRANSFER_PENDING';
        updateData.status = effectiveStatus;
      }
    }
    
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

    this.logger.log(`Updated claim ${id} status to ${effectiveStatus}${extra?.isPrivate ? ' (private)' : ''}`);
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
   * Cron-safe burner sweep: find all PRIVATE_TRANSFER_PENDING claims that still have
   * burner funds and sweep them to the already-resolved recipient_address.
   * Replaces the in-process setTimeout retries so sweeps survive server restarts.
   * Only processes claims updated within the last 10 minutes to avoid hammering old stuck claims.
   */
  async cronSweepPendingBurners(): Promise<void> {
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: pendingClaims, error } = await this.supabaseService.claims
      .select('*')
      .eq('status', 'PRIVATE_TRANSFER_PENDING')
      .gte('updated_at', cutoff)
      .not('claim_burner_address', 'is', null)
      .not('claim_burner_encrypted_secret', 'is', null);

    if (error) {
      this.logger.error('[cronSweep] Query error:', error);
      return;
    }
    if (!pendingClaims?.length) return;

    this.logger.log(`[cronSweep] Found ${pendingClaims.length} PRIVATE_TRANSFER_PENDING claims to retry`);

    for (const raw of pendingClaims) {
      const claim = raw as Claim & { recipient_address?: string };
      const recipientWallet = (claim.recipient_address || '').trim();
      if (!recipientWallet || this.isPendingRecipientAddress(recipientWallet)) {
        this.logger.warn(`[cronSweep] Claim ${claim.id}: recipient not resolved yet, skipping`);
        continue;
      }
      try {
        const { sweepTxHash } = await this.sweepClaimBurnerToWallet(claim.id, claim, recipientWallet);
        if (sweepTxHash) {
          await this.updateStatus(claim.id, 'SUCCESS');
          this.logger.log(`[cronSweep] Claim ${claim.id}: sweep succeeded → SUCCESS`);
        } else {
          this.logger.debug(`[cronSweep] Claim ${claim.id}: burner still empty, will retry next tick`);
        }
      } catch (e: any) {
        this.logger.warn(`[cronSweep] Claim ${claim.id}: sweep error — ${e?.message ?? e}`);
      }
    }
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
