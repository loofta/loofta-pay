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
import { isSolanaDevnetFromConfig, isSolanaLocalhostFromConfig } from '@/common/solana-cluster-env';
import {
  MAGICBLOCK_GAS_SOL,
  MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS,
  fetchSolPriceUsd,
  grossUpForMagicblockFee,
  requestMagicblockPrivateTransfer,
  appendLooftaFeeInstruction,
  type MagicblockPrivateTransferTxResponse,
} from '@/common/magicblock-private-transfer';

const DEPOSIT_SEED = 'deposit';
const VAULT_SEED = 'vault';
const MODIFY_BALANCE_DISCRIMINATOR = Buffer.from([148, 232, 7, 240, 55, 51, 121, 115]);
const UNDELEGATE_DISCRIMINATOR = Buffer.from([131, 148, 180, 198, 91, 104, 42, 238]);
const MAGIC_PROGRAM_ID = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT_ID = new PublicKey('MagicContext1111111111111111111111111111111');

/** MagicBlock payer→burner: poll burner ATA on this interval. */
const BURNER_INBOUND_POLL_MS = 5_000;
/** Short wait inside a single sweep HTTP call (avoid gateway timeouts). */
const BURNER_INBOUND_INLINE_MAX_MS = 90_000;
/** Mainnet (no MagicBlock delivery delay): background sweep retry window. */
const BURNER_INBOUND_BACKGROUND_MAX_MS_MAINNET = 4 * 60_000;
/** Extra time after max private delay before giving up (rollup / base visibility). */
const BURNER_INBOUND_BACKGROUND_BUFFER_MS = 3 * 60_000;

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

  /** Covers MagicBlock private delivery delay on devnet (up to 10 min) plus buffer; mainnet uses a short window. */
  private getBurnerInboundBackgroundMaxMs(): number {
    if (isSolanaDevnetFromConfig(this.configService)) {
      return MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS + BURNER_INBOUND_BACKGROUND_BUFFER_MS;
    }
    return BURNER_INBOUND_BACKGROUND_MAX_MS_MAINNET;
  }

  /**
   * Create a new payment claim
   */
  async create(dto: CreateClaimDto): Promise<{ id: string; link: string }> {
    const { amount, toSel, recipient, userId, cluster } = dto;

    if (!amount || !toSel?.symbol || !toSel?.chain || !recipient) {
      throw new BadRequestException('Missing required fields');
    }

    const isDevnet = cluster === 'mainnet' ? false : cluster === 'devnet' ? true : isSolanaDevnetFromConfig(this.configService);
    const { data, error } = await this.supabaseService.payments
      .insert({
        amount: Number(amount),
        direction: 'from_sender',
        recipient_address: String(recipient),
        created_by: userId ? String(userId) : null,
        status: 'OPEN',
        to_chain: 'solana',
        to_token: 'USDC',
        is_devnet: isDevnet,
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
    const { username, amount, userId, isPrivate = false, description, cluster } = dto;
    const isDevnet = cluster === 'mainnet' ? false : cluster === 'devnet' ? true : isSolanaDevnetFromConfig(this.configService);
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

      // No burner for registered recipients — MagicBlock PER handles the private transfer
      // directly to their real wallet (resolved server-side). Burners are only needed when
      // the recipient hasn't signed up yet and funds must be held until they claim.
      const { data: claim, error: claimError } = await this.supabaseService.payments
        .insert({
          amount: Number(amount),
          direction: 'from_sender',
          recipient_address: recipientAddress,
          recipient_username: cleanUsername,
          recipient_user_id: user.privyUserId,
          created_by: userId ? String(userId) : null,
          status: 'OPEN',
          description: description || null,
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
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

    const { data: claim, error: claimError } = await this.supabaseService.payments
      .insert({
        amount: Number(amount),
        direction: 'from_sender',
        recipient_address: recipientAddress,
        created_by: userId ? String(userId) : null,
        status: 'OPEN',
        description: description || null,
        to_chain: 'solana',
        to_token: 'USDC',
        is_devnet: isDevnet,
        recipient_was_unregistered: true,
        ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
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

  /** Normalize a payment_intents row so it looks like a claim_intents row (claim_id alias). */
  private normalizeIntent(row: Record<string, unknown>): Record<string, unknown> {
    return { ...row, claim_id: row.payment_id ?? row.claim_id ?? null };
  }

  /** Map a payments-table row to the internal shape used by this service (claims field names). */
  private normalizeFromPayments(row: Record<string, unknown>): Record<string, unknown> {
    return {
      ...row,
      claim_burner_address: row.burner_address ?? null,
      claim_burner_encrypted_secret: row.burner_encrypted_secret ?? null,
      to_symbol: 'USDC',
      // compat aliases for legacy field names still consumed by page.tsx / admin UI
      paid_with_chain: row.from_chain ?? null,
      paid_with_token: row.from_token ?? null,
      is_private: null,
      creator_email: null,
    };
  }

  /** Fetch raw row by ID: tries payments first (normalized), falls back to claims. */
  private async fetchRawRow(
    id: string,
  ): Promise<{ row: Record<string, unknown>; table: 'payments' | 'claims' } | null> {
    const { data: pr } = await this.supabaseService.payments
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (pr) return { row: this.normalizeFromPayments(pr as Record<string, unknown>), table: 'payments' };
    const { data: cr } = await this.supabaseService.claims
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (cr) return { row: cr as Record<string, unknown>, table: 'claims' };
    return null;
  }

  /** Update a field set on whichever table holds this ID. Tries payments first. */
  private async updateRow(
    id: string,
    paymentsData: Record<string, unknown>,
    claimsData: Record<string, unknown>,
  ): Promise<{ error: string | null }> {
    const { data, error } = await (this.supabaseService.payments as any)
      .update(paymentsData)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (!error && data) return { error: null };
    const { error: claimErr } = await (this.supabaseService.claims as any)
      .update(claimsData)
      .eq('id', id);
    return { error: claimErr ? String(claimErr.message) : null };
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
    const burnerAddress = burnerKeypair.publicKey.toBase58();
    const secret = Buffer.from(burnerKeypair.secretKey);
    let encrypted: string;
    if (this.encryption?.isAvailable()) {
      // v2: per-payment HKDF key derived from burner address — unique key per payment
      encrypted = this.encryption.encrypt(secret, burnerAddress);
    } else {
      const key = this.getClaimBurnerDecryptionKey();
      if (!key) return null;
      encrypted = this.encryptBurnerSecret(secret, key);
    }
    return {
      claim_burner_address: burnerAddress,
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

  /** Decrypt burner secret with an explicit AES key (legacy / fallback path). */
  private decryptBurnerSecretWithKey(ciphertextBase64: string, key: Buffer): Buffer {
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

  /**
   * Decrypt a burner secret from the database.
   *
   * Supports all stored formats:
   *   • "v2:<base64>"   — per-payment HKDF key (context = burnerAddress, required)
   *   • "<base64>"      — legacy master-key encryption; falls back to SEND_PAYMENT_ENC_KEY_OLD
   *
   * @param ciphertextBase64  Value from `claim_burner_encrypted_secret` column.
   * @param burnerAddress     Value from `claim_burner_address` column (needed for v2 decryption).
   */
  private decryptClaimBurnerSecret(ciphertextBase64: string, burnerAddress?: string): Buffer {
    if (this.encryption?.isAvailable()) {
      // The EncryptionService handles v2/legacy/rotation internally
      return this.encryption.decrypt(ciphertextBase64, burnerAddress);
    }
    // Fallback: direct key path (when EncryptionService DI is unavailable)
    const key = this.getClaimBurnerDecryptionKey();
    if (!key) throw new Error('SEND_PAYMENT_ENC_KEY not available for decrypt');
    // v2 format in direct-key mode is not supported — all v2 secrets were produced
    // via EncryptionService and will be handled in the branch above.
    return this.decryptBurnerSecretWithKey(ciphertextBase64, key);
  }

  /**
   * Create a claim from email. If user exists, use their wallet. If not, create with PENDING_EMAIL so they can claim by signing in later.
   */
  async createFromEmail(dto: CreateClaimFromEmailDto): Promise<{ id: string; link: string }> {
    const { email, amount, userId, isPrivate = false, description, cluster } = dto;
    const isDevnet = cluster === 'mainnet' ? false : cluster === 'devnet' ? true : isSolanaDevnetFromConfig(this.configService);
    const cleanEmail = email.trim().toLowerCase();

    let recipientAddress: string;
    let requiresPrivate = false;

    try {
      const user = await this.usersService.findByEmail(cleanEmail);
      requiresPrivate = user.requirePrivatePayments || false;
      if (requiresPrivate && !isPrivate) {
        throw new BadRequestException(
          'This user requires private payments only. Please enable privacy when creating the payment link.',
        );
      }
      recipientAddress = await this.usersService.getSolanaWalletAddress(user.privyUserId);

      const { data: claim, error: claimError } = await this.supabaseService.payments
        .insert({
          amount: Number(amount),
          direction: 'from_sender',
          recipient_address: recipientAddress,
          recipient_user_id: user.privyUserId,
          recipient_email: cleanEmail,
          created_by: userId ? String(userId) : null,
          status: 'OPEN',
          description: description || null,
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
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

    const { data: claim, error: claimError } = await this.supabaseService.payments
      .insert({
        amount: Number(amount),
        direction: 'from_sender',
        recipient_address: recipientAddress,
        recipient_email: cleanEmail,
        created_by: userId ? String(userId) : null,
        status: 'OPEN',
        description: description || null,
        to_chain: 'solana',
        to_token: 'USDC',
        is_devnet: isDevnet,
        recipient_was_unregistered: true,
        ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
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
  async findOne(id: string, requestingUserId?: string): Promise<Claim> {
    const result = await this.fetchRawRow(id);

    if (!result) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    const claim = result.row as unknown as Claim;
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
      const isCreator = requestingUserId && claim.created_by && requestingUserId === claim.created_by;
      (claim as Claim & { recipient_pending_email_value?: string }).recipient_pending_email_value = isCreator ? pendingEmail : this.maskEmail(pendingEmail);
      const claimWithBurner = claim as unknown as { claim_burner_address?: string | null };
      this.logger.log(
        `[findOne] Pending-email claim ${id}: burner=${claimWithBurner.claim_burner_address ? 'present' : 'missing'}`,
      );
      let burnerAddr = claimWithBurner.claim_burner_address?.trim() || null;
      if (!burnerAddr) {
        burnerAddr = await this.backfillBurnerForClaim(id);
      }
      if (burnerAddr) (claim as Claim & { claim_burner_address?: string }).claim_burner_address = burnerAddr;
    }
    // Mask pending-username claims: expose flag and username so UI can show "Claim with @username"
    else if (claim.recipient_address?.startsWith(ClaimsService.PENDING_USERNAME_PREFIX)) {
      const pendingUsername = claim.recipient_address.slice(ClaimsService.PENDING_USERNAME_PREFIX.length).trim();
      (claim as Claim & { recipient_address?: string }).recipient_address = undefined;
      (claim as Claim & { recipient_pending_username?: boolean }).recipient_pending_username = true;
      (claim as Claim & { recipient_pending_username_value?: string }).recipient_pending_username_value = pendingUsername;
      const claimWithBurner = claim as unknown as { claim_burner_address?: string | null };
      this.logger.log(
        `[findOne] Pending-username claim ${id}: burner=${claimWithBurner.claim_burner_address ? 'present' : 'missing'}`,
      );
      let burnerAddr = claimWithBurner.claim_burner_address?.trim() || null;
      if (!burnerAddr) {
        burnerAddr = await this.backfillBurnerForClaim(id);
      }
      if (burnerAddr) (claim as Claim & { claim_burner_address?: string }).claim_burner_address = burnerAddr;
    }
    else if (claim.recipient_address?.trim()) {
      (claim as Claim & { recipient_is_registered?: boolean }).recipient_is_registered = true;
      const claimWithBurner = claim as unknown as { claim_burner_address?: string | null };
      if (claimWithBurner.claim_burner_address?.trim()) {
        // Burner exists: payment routes through it — hide the real recipient address
        delete (claim as unknown as Record<string, unknown>)['recipient_address'];
      }
      // No burner: recipient_address IS the payment destination for direct-wallet links — keep it
    }

    // Never expose the encrypted burner private key to the frontend
    delete (claim as unknown as Record<string, unknown>)['claim_burner_encrypted_secret'];

    // Attach fee data so the UI can show the payment breakdown on reload.
    // New payments: fee_paid_usdc column is set directly at payment time.
    // Legacy claims: fall back to the FEE_CHARGED claim_event payload.
    if (['SUCCESS', 'PRIVATE_TRANSFER_PENDING'].includes((claim.status || '').toUpperCase())) {
      if ((claim as any).fee_paid_usdc == null) {
        try {
          const { data: feeEvent } = await (this.supabaseService.claimEvents as any)
            .select('payload')
            .eq('claim_id', id)
            .eq('type', 'FEE_CHARGED')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (feeEvent?.payload?.feeAmountUsdc != null) {
            (claim as any).fee_paid_usdc = feeEvent.payload.feeAmountUsdc;
          }
        } catch { /* non-fatal */ }
      }
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
    const { error } = await this.updateRow(
      claimId,
      { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret },
      { claim_burner_address: burner.claim_burner_address, claim_burner_encrypted_secret: burner.claim_burner_encrypted_secret },
    );
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
    const result = await this.fetchRawRow(id);
    if (!result) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }
    const row = result.row as unknown as Claim & { recipient_address?: string };
    if ((row.status || '').toUpperCase() === 'DELETED') {
      throw new NotFoundException('This payment doesn\'t exist.');
    }
    return row;
  }

  /**
   * Build unsigned MagicBlock private transfer with recipient resolved server-side only
   * (not exposed in browser → MagicBlock requests).
   *
   * Any authenticated user may call **except** the intended recipient (they claim/sweep, not pay).
   * `created_by` is the payee who created the request link — not the payer — so we must not require
   * `privyUserId === created_by` (that blocked real payers and only allowed the link creator).
   */
  async buildPrivateTransferForPayer(
    claimId: string,
    privyUserId: string,
    senderWallet: string,
    requestCluster?: 'devnet' | 'mainnet',
  ): Promise<MagicblockPrivateTransferTxResponse> {
    const { requestMagicblockPrivateTransfer } = await import('@/common/magicblock-private-transfer');
    const claim = await this.findOneRaw(claimId);
    const row = claim as Claim & { claim_burner_address?: string | null };
    const { isRecipient } = await this.checkIsRecipient(claimId, privyUserId);
    if (isRecipient) {
      throw new ForbiddenException(
        'This action is for the payer. Recipients complete payment on the claim side.',
      );
    }
    const to = this.resolveEffectiveRecipientForPrivatePayment(row);
    if (!to || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) {
      throw new BadRequestException('Recipient is not available for this claim yet.');
    }
    const amountUsd = parseFloat(String(claim.amount || '0'));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new BadRequestException('Invalid claim amount');
    }
    if (amountUsd < 5) {
      throw new BadRequestException('Minimum payment amount is $5.00 USDC.');
    }
    const baseUnits = Math.round(amountUsd * 1_000_000);
    const cluster = requestCluster
      ?? (isSolanaLocalhostFromConfig(this.configService) ? 'localhost' : isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet');
    const effectiveMint = cluster === 'mainnet'
      ? new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      : new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || this.usdcMint.toBase58());

    // Correct is_devnet and stamp sender_user_id so the payer sees it in history.
    const correctIsDevnet = cluster !== 'mainnet';
    await this.supabaseService.payments
      .update({ is_devnet: correctIsDevnet, sender_user_id: privyUserId })
      .eq('id', claimId);
    this.logger.log(`[PrivatePay] stamped claim ${claimId}: is_devnet=${correctIsDevnet} sender_user_id=${privyUserId}`);

    // MagicBlock cost = 10 BPS volume fee + 0.002 SOL fixed gas fee (converted to USDC).
    // Both are added to the amount so the recipient gets exactly baseUnits after MB deducts.
    let solPriceUsd: number | null = null;
    let solFeeUnits = 0;
    try {
      solPriceUsd = await fetchSolPriceUsd();
      if (solPriceUsd !== null) {
        solFeeUnits = Math.ceil(MAGICBLOCK_GAS_SOL * solPriceUsd * 1_000_000);
      }
    } catch (e) {
      this.logger.warn(`[PrivatePay] SOL price fetch failed, skipping gas conversion: ${String(e)}`);
    }

    // MagicBlock gasless: the 0.002 SOL relay fee is charged via a separate prepended USDC
    // instruction (sender → MB sponsor). It is NOT deducted from `amount`.
    // Gross-up only covers MB's 10 BPS volume fee so recipient gets exactly baseUnits.
    const grossUnits = grossUpForMagicblockFee(baseUnits);
    this.logger.log(
      `[PrivatePay] claim=${claimId} amount=${amountUsd} baseUnits=${baseUnits} solFeeUnits=${solFeeUnits}` +
      ` solPrice=${solPriceUsd ?? 'n/a'} grossUnits=${grossUnits} cluster=${cluster} mint=${effectiveMint.toBase58().slice(0, 8)}… (gasless)`,
    );

    let txResponse = await requestMagicblockPrivateTransfer({
      from: senderWallet.trim(),
      to,
      mint: effectiveMint.toBase58(),
      amount: grossUnits,
      cluster,
      gasless: true,
    });

    const feePayerAddress = this.solanaSponsor.getFeePayerAddress();
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    const clusterConn = this.solanaSponsor.getConnectionForCluster(cluster === 'devnet' ? 'devnet' : 'mainnet');

    // Check actual SOL deficit BEFORE prefunding so we recover the exact amount spent.
    // Round up to nearest cent ($0.01 = 10,000 units) to ensure fee payer is fully covered.
    const PREFUND_MIN_LAMPORTS = 3_000_000;
    let actualTopUpLamports = 0;
    if (this.solanaSponsor.isAvailable() && solPriceUsd) {
      try {
        const senderBalance = await clusterConn.getBalance(new PublicKey(senderWallet.trim()));
        actualTopUpLamports = Math.max(0, PREFUND_MIN_LAMPORTS - senderBalance);
      } catch (e) {
        this.logger.warn(`[PrivatePay] balance check failed, falling back to MAGICBLOCK_GAS_SOL estimate: ${String(e)}`);
        actualTopUpLamports = Math.round(MAGICBLOCK_GAS_SOL * 1e9);
      }
    }

    // Append USDC fee recovery instruction: sender pays fee payer back for the SOL prefund.
    if (actualTopUpLamports > 0 && solPriceUsd && feePayerAddress && feePayerKp) {
      const actualTopUpUsdc = (actualTopUpLamports / 1e9) * solPriceUsd * 1_000_000;
      const feeUnitsRounded = Math.ceil(actualTopUpUsdc / 10_000) * 10_000;
      try {
        const modifiedTxBase64 = await appendLooftaFeeInstruction(
          txResponse.transactionBase64,
          senderWallet.trim(),
          feePayerAddress,
          feeUnitsRounded,
          effectiveMint,
          clusterConn,
          feePayerKp.publicKey,
        );
        txResponse = { ...txResponse, transactionBase64: modifiedTxBase64 };
        solFeeUnits = feeUnitsRounded;
        this.logger.log(`[PrivatePay] USDC fee recovery: ${actualTopUpLamports} lamports → ${feeUnitsRounded} units ($${(feeUnitsRounded / 1_000_000).toFixed(4)}) → ${feePayerAddress.slice(0, 8)}…`);
      } catch (e) {
        this.logger.warn(`[PrivatePay] fee ix append failed, proceeding without: ${String(e)}`);
      }
    }

    // Pre-fund sender SOL if below shuttle rent threshold (3M lamports).
    if (this.solanaSponsor.isAvailable()) {
      try {
        const topUp = await this.solanaSponsor.prefundSenderSolIfNeeded(
          senderWallet.trim(),
          clusterConn,
        );
        if (topUp > 0) {
          this.logger.log(`[PrivatePay] pre-funded sender +${topUp} lamports before MB tx`);
        }
      } catch (e) {
        this.logger.warn(`[PrivatePay] pre-fund failed, proceeding without: ${String(e)}`);
      }
    }

    return {
      ...txResponse,
      feeAmountUsdc: solFeeUnits / 1_000_000,
      feeBreakdown: {
        looftaBpsUsdc: 0,
        solRecoveryUsdc: solFeeUnits / 1_000_000,
        solLamports: Math.round(MAGICBLOCK_GAS_SOL * 1e9),
        solPriceUsd: solPriceUsd ?? 0,
      },
    };
  }

  /** Resolve the correct Solana connection and USDC mint for a claim based on its is_devnet flag.
   *  Falls back to backend SOLANA_CLUSTER config when is_devnet is null (legacy claims). */
  private resolveClaimNetwork(claim: Claim): { conn: Connection; claimMint: PublicKey; cluster: 'mainnet' | 'devnet' } {
    const rawClaim = claim as { is_devnet?: boolean | null };
    const isDevnet = rawClaim.is_devnet ?? isSolanaDevnetFromConfig(this.configService);
    const cluster: 'mainnet' | 'devnet' = isDevnet ? 'devnet' : 'mainnet';
    const conn = this.solanaSponsor.getConnectionForCluster(cluster);
    const mintStr = isDevnet
      ? (this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
      : (this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    return { conn, claimMint: new PublicKey(mintStr), cluster };
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
    // Guard: do not re-claim a completed or cancelled payment
    const claimStatus = (claim.status || '').toUpperCase();
    const claimBurnerAddress = (claim as { claim_burner_address?: string | null }).claim_burner_address?.trim();
    // Allow claiming when status is SUCCESS but a burner is still set — this means the sender
    // funded the payment before the recipient could claim, setting status to SUCCESS prematurely.
    if (claimStatus === 'CANCELLED' || (claimStatus === 'SUCCESS' && !claimBurnerAddress)) {
      throw new BadRequestException('This payment has already been completed or cancelled.');
    }
    const ra = (claim.recipient_address || '').trim();
    const isPendingEmail = ra.startsWith(ClaimsService.PENDING_EMAIL_PREFIX);
    const isPendingUsername = ra.startsWith(ClaimsService.PENDING_USERNAME_PREFIX);
    // Also allow registered recipients (real wallet stored, burner used as intermediary)
    const isRegisteredRecipient = !isPendingEmail && !isPendingUsername && !!ra;
    if (!isPendingEmail && !isPendingUsername && !isRegisteredRecipient) {
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

    // For pending claims we need to record the real wallet; for registered recipients it's already set.
    if (isPendingEmail || isPendingUsername) {
      const { error } = await this.updateRow(
        claimId,
        { recipient_address: wallet.trim(), recipient_user_id: privyUserId },
        { recipient_address: wallet.trim() },
      );
      if (error) {
        this.logger.error('Failed to claim payment:', error);
        throw new BadRequestException('Failed to claim payment.');
      }
    }

    const { sweepTxHash, sweptAmount } = await this.sweepClaimBurnerToWallet(claimId, claim, wallet);
    if (sweepTxHash) {
      await this.updateStatus(claimId, 'SUCCESS', { recipientSwept: true }, privyUserId);
      this.logger.log(`Claim ${claimId}: sweep completed immediately, marked SUCCESS`);
    } else if (claimStatus === 'SUCCESS') {
      // Status was already SUCCESS (prematurely set by sender) and burner is now empty —
      // the sweep either just ran successfully elsewhere, or funds haven't arrived yet.
      // Don't downgrade; schedule a background retry to catch late-arriving funds.
      this.logger.log(`Claim ${claimId}: burner empty but status already SUCCESS — scheduling background retry`);
      if (claimBurnerAddress) {
        this.scheduleBackgroundSweepRetry(claimId, wallet, privyUserId);
      }
    } else {
      // Funds still in-flight on MagicBlock private leg (devnet: random delay up to ~15 min). Mark
      // PRIVATE_TRANSFER_PENDING and retry sweep until getBurnerInboundBackgroundMaxMs().
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
    const backgroundMaxMs = this.getBurnerInboundBackgroundMaxMs();
    const tick = async (): Promise<void> => {
      if (Date.now() - started > backgroundMaxMs) {
        this.logger.warn(`Claim ${claimId}: background sweep poll window exhausted (${backgroundMaxMs}ms)`);
        return;
      }
      try {
        const freshClaim = await this.findOneRaw(claimId);
        const st = (freshClaim.status || '').toUpperCase();
        if (st === 'SUCCESS' || st === 'CANCELLED') return;
        const { sweepTxHash } = await this.sweepClaimBurnerToWallet(claimId, freshClaim, wallet);
        if (sweepTxHash) {
          await this.updateStatus(claimId, 'SUCCESS', { recipientSwept: true }, privyUserId);
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
      await this.updateStatus(claimId, 'SUCCESS', { recipientSwept: true }, privyUserId);
    }
    return { swept: !!sweepTxHash, sweepTxHash, sweptAmount };
  }

  /** Poll getSignatureStatuses instead of using WebSocket signatureSubscribe (avoids RPC endpoints that don't support WS). */
  private async pollConfirmTransaction(
    conn: import('@solana/web3.js').Connection,
    signature: string,
    timeoutMs = 60_000,
    intervalMs = 1_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const statuses = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = statuses.value[0];
      if (status?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Transaction ${signature} confirmation timed out`);
  }

  /** True when the latest intent for this payment came from a non-Solana chain (NEAR intent cross-chain). */
  private async isCrossChainPayment(claimId: string): Promise<boolean> {
    const supabase = this.supabaseService.getClient();
    const { data: intent } = await supabase
      .from('payment_intents')
      .select('from_chain')
      .eq('payment_id', claimId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (intent?.from_chain) {
      const c = (intent.from_chain as string).toLowerCase();
      return c !== 'sol' && c !== 'solana';
    }
    const { data: legacy } = await supabase
      .from('claim_intents')
      .select('from_chain')
      .eq('claim_id', claimId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (legacy?.from_chain) {
      const c = (legacy.from_chain as string).toLowerCase();
      return c !== 'sol' && c !== 'solana';
    }
    return false;
  }

  /**
   * Cross-chain claim path: the NEAR intent delivered USDC to the burner.
   * 1. Wait for USDC to appear in burner ATA.
   * 2. Auto-sign a MagicBlock PER private transfer: burner → recipient (requested_amount, grossed up for MB fee).
   * 3. Sweep remaining dust (Loofta fee + gas pre-paid by sender) to the fee-payer wallet.
   */
  private async sweepCrossChainBurnerPrivately(
    claimId: string,
    claim: Claim,
    wallet: string,
    burnerKeypair: Keypair,
    conn: Connection,
  ): Promise<{ sweepTxHash?: string; sweptAmount?: string }> {
    const burnerAta = await getAssociatedTokenAddress(this.usdcMint, burnerKeypair.publicKey);

    // Wait for NEAR intent USDC delivery
    let balance = BigInt(0);
    try { balance = (await getAccount(conn, burnerAta)).amount; } catch { /* not yet */ }
    if (balance === BigInt(0)) {
      balance = await this.pollBurnerAtaUntilPositive(claimId, conn, burnerAta, BURNER_INBOUND_INLINE_MAX_MS);
    }
    if (balance === BigInt(0)) {
      this.logger.log(`[CrossChain] ${claimId}: USDC not yet in burner — funds still in flight`);
      return {};
    }

    const amountUsd = parseFloat(String(claim.amount || '0'));
    const requestedBaseUnits = Math.round(amountUsd * 1_000_000);
    const transferUnits = grossUpForMagicblockFee(requestedBaseUnits);
    const cluster = isSolanaLocalhostFromConfig(this.configService) ? 'localhost'
      : isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet';

    this.logger.log(
      `[CrossChain] ${claimId}: balance=${balance} transferUnits=${transferUnits} cluster=${cluster} recipient=${wallet.slice(0, 8)}…`,
    );

    if (BigInt(transferUnits) > balance) {
      this.logger.warn(`[CrossChain] ${claimId}: balance ${balance} < transferUnits ${transferUnits} — aborting, intent may not be complete`);
      return {};
    }

    // Build PER private transfer from burner to recipient
    const txResponse = await requestMagicblockPrivateTransfer({
      from: burnerKeypair.publicKey.toBase58(),
      to: wallet.trim(),
      mint: this.usdcMint.toBase58(),
      amount: transferUnits,
      cluster,
    });

    // Auto-sign with burner keypair (and fee payer for ATA rent)
    const txBytes = Buffer.from(txResponse.transactionBase64, 'base64');
    const tx = Transaction.from(txBytes);
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    if (feePayerKp) {
      tx.feePayer = feePayerKp.publicKey;
      tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
    }
    tx.partialSign(burnerKeypair);
    if (feePayerKp) tx.partialSign(feePayerKp);

    // Submit — ephemeral rollup if MagicBlock requires it, otherwise base chain
    let sendConn = conn;
    if (txResponse.sendTo === 'ephemeral') {
      const ec = await this.getEphemeralConnectionForBurner(burnerKeypair);
      if (ec) sendConn = ec;
    }
    const sig = await sendConn.sendRawTransaction(tx.serialize({ requireAllSignatures: false }), { skipPreflight: true });
    await this.pollConfirmTransaction(conn, sig);
    this.logger.log(`[CrossChain] ${claimId}: PER transfer confirmed tx=${sig}`);

    // Sweep dust (fee + gas pre-paid into burner) to fee-payer wallet — fire-and-forget
    const feePayerAddress = this.solanaSponsor.getFeePayerAddress();
    if (feePayerKp && feePayerAddress) {
      void (async () => {
        try {
          await new Promise((r) => setTimeout(r, 4_000));
          const remaining = await getAccount(conn, burnerAta).catch(() => null);
          const dust = remaining?.amount ?? BigInt(0);
          if (dust > BigInt(0)) {
            const feePayerPubkey = new PublicKey(feePayerAddress);
            const feePayerAta = await getAssociatedTokenAddress(this.usdcMint, feePayerPubkey);
            const dustTx = new Transaction();
            try { await getAccount(conn, feePayerAta); } catch {
              dustTx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, feePayerAta, feePayerPubkey, this.usdcMint));
            }
            dustTx.add(createTransferInstruction(burnerAta, feePayerAta, burnerKeypair.publicKey, dust));
            dustTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
            dustTx.feePayer = feePayerKp.publicKey;
            dustTx.sign(burnerKeypair, feePayerKp);
            const dustSig = await conn.sendRawTransaction(dustTx.serialize(), { skipPreflight: true });
            this.logger.log(`[CrossChain] ${claimId}: dust swept (${dust} units) → fee payer tx=${dustSig}`);
          }
        } catch (e) {
          this.logger.warn(`[CrossChain] ${claimId}: dust sweep failed (non-fatal): ${String(e)}`);
        }
      })();
    }

    return { sweepTxHash: sig, sweptAmount: (requestedBaseUnits / 1_000_000).toFixed(6) };
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
      const secretKey = this.decryptClaimBurnerSecret(rawClaim.claim_burner_encrypted_secret, burnerAddr);
      const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
      const { conn, claimMint } = this.resolveClaimNetwork(claim);

      // Cross-chain payments (e.g. ETH/BTC → Solana via NEAR Intents) land in the burner
      // and must be privately forwarded to the recipient via MagicBlock PER transfer.
      const isCrossChain = await this.isCrossChainPayment(claimId);
      if (isCrossChain) {
        return this.sweepCrossChainBurnerPrivately(claimId, claim, wallet, burnerKeypair, conn);
      }

      // Always attempt PER withdraw first. This also recovers older claims that
      // were incorrectly marked non-private while funds are still in PER deposit.
      const perWithdraw = await this.tryWithdrawPerDepositToBurnerAta(
        claimId,
        burnerKeypair,
        conn,
        String(claim.amount || '0'),
      );
      const burnerAta = await getAssociatedTokenAddress(claimMint, burnerKeypair.publicKey);
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
        const recipientAta = await getAssociatedTokenAddress(claimMint, recipientPubkey);
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
                claimMint,
              ),
            );
          }
        }
        sweepTx.add(createTransferInstruction(burnerAta, recipientAta, burnerKeypair.publicKey, balance));
        const { blockhash } = await conn.getLatestBlockhash('confirmed');
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
        await this.pollConfirmTransaction(conn, sig);
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
      const { blockhash } = await sendConn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = feePayerKp.publicKey;
      tx.sign(feePayerKp, burnerKeypair);
      debug.push(`${label}: signers=[sponsor=${feePayerKp.publicKey.toBase58().slice(0, 8)}, burner=${burner.toBase58().slice(0, 8)}]`);
      const sig = await sendConn.sendTransaction(tx, [feePayerKp, burnerKeypair], { skipPreflight: true });
      debug.push(`${label}: tx=${sig}`);
      await this.pollConfirmTransaction(sendConn, sig);
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
          const { blockhash } = await conn.getLatestBlockhash('confirmed');
          withdrawTx.recentBlockhash = blockhash;
          withdrawTx.feePayer = feePayerKp.publicKey;
          withdrawTx.sign(feePayerKp, burnerKeypair);
          const sig = await conn.sendTransaction(withdrawTx, [feePayerKp, burnerKeypair], { skipPreflight: true });
          await this.pollConfirmTransaction(conn, sig);
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
          const secretKey = this.decryptClaimBurnerSecret(encryptedSecret, burnerAddress);
          const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
          const { conn, claimMint } = this.resolveClaimNetwork(claim);
          // Attempt PER -> burner ATA first so reclaim also works when funds are
          // still parked in PER deposit state.
          const perWithdraw = await this.tryWithdrawPerDepositToBurnerAta(
            claimId,
            burnerKeypair,
            conn,
            String(claim.amount || '0'),
          );

          const burnerAta = await getAssociatedTokenAddress(claimMint, burnerKeypair.publicKey);
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
            const creatorAta = await getAssociatedTokenAddress(claimMint, creatorPubkey);
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
                    claimMint,
                  ),
                );
              }
            }
            tx.add(createTransferInstruction(burnerAta, creatorAta, burnerKeypair.publicKey, balance));
            const { blockhash } = await conn.getLatestBlockhash('confirmed');
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
            await this.pollConfirmTransaction(conn, sig);
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

    const { error } = await this.updateRow(
      claimId,
      { status: 'CANCELLED' },
      { status: 'CANCELLED' },
    );

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
      this.decryptClaimBurnerSecret(rawClaim.claim_burner_encrypted_secret!, burnerAddress || undefined);
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
        const { conn, claimMint } = this.resolveClaimNetwork(claim);
        const burnerPubkey = new PublicKey(burnerAddress);
        const burnerAta = await getAssociatedTokenAddress(claimMint, burnerPubkey);

        // Check PER deposit account presence for this burner, and try a PER withdraw
        // so diagnostics reflects whether funds are stuck in PER state.
        try {
          const [depositPda] = PublicKey.findProgramAddressSync(
            [Buffer.from(DEPOSIT_SEED), burnerPubkey.toBuffer(), claimMint.toBuffer()],
            this.perProgramId,
          );
          const depositInfo = await conn.getAccountInfo(depositPda);
          perDepositDetected = !!depositInfo;
          if (depositInfo && rawClaim.claim_burner_encrypted_secret && this.canDecryptBurnerSecret() && this.solanaSponsor.isAvailable()) {
            const secretKey = this.decryptClaimBurnerSecret(rawClaim.claim_burner_encrypted_secret, burnerAddress || undefined);
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
  async findWithLatestIntent(id: string, requestingUserId?: string): Promise<{
    claim: Claim;
    intent: ClaimIntent | null;
  }> {
    const claim = await this.findOne(id, requestingUserId);

    const { data: intent } = await this.supabaseService.paymentIntents
      .select('*')
      .eq('payment_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      claim,
      intent: intent ? (this.normalizeIntent(intent as Record<string, unknown>) as unknown as ClaimIntent) : null,
    };
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
    fromToken?: string;
    /** Pass true when the recipient sweep has completed — skips the intermediary-pending guard so SUCCESS is stored as-is. */
    recipientSwept?: boolean;
    /** Total fee charged to sender in USDC (loofta BPS + SOL recovery). Persisted to claim_events. */
    feeAmountUsdc?: number;
    /** Fee breakdown snapshot at payment time. Persisted to claim_events. */
    feeBreakdown?: {
      looftaBpsUsdc: number;
      solRecoveryUsdc: number;
      solLamports: number;
      solPriceUsd: number;
    };
  }, createdByUserId?: string): Promise<Claim> {
    // Ownership check for destructive transitions
    if ((status as string).toUpperCase() === 'CANCELLED' && createdByUserId) {
      const result = await this.fetchRawRow(id);
      if (result?.row.created_by && result.row.created_by !== createdByUserId) {
        throw new ForbiddenException('Only the claim creator can cancel this payment');
      }
    }

    let effectiveStatus = status;
    const updateData: Record<string, any> = { status: effectiveStatus };

    // For unresolved recipients, sender-funded does not mean recipient-claimed yet.
    // Skip this conversion when the caller confirms the sweep has completed (recipientSwept).
    if (status === 'SUCCESS' && !extra?.recipientSwept) {
      const result = await this.fetchRawRow(id);
      if (result) {
        const isPending = this.isPendingRecipientAddress(result.row.recipient_address as string);
        const hasBurner = !!(result.row.claim_burner_address as string | null | undefined)?.trim();
        if (isPending || hasBurner) {
          effectiveStatus = 'PRIVATE_TRANSFER_PENDING';
          updateData.status = effectiveStatus;
        }
      }
    }

    // Set paid_at timestamp when status becomes SUCCESS
    if (status === 'SUCCESS') {
      updateData.paid_at = new Date().toISOString();
      if (createdByUserId) {
        const result = await this.fetchRawRow(id);
        if (result && !result.row.created_by) {
          updateData.created_by = createdByUserId;
        }
      }
    }

    // from_chain / from_token stored on payments; legacy claims fallback uses paid_with_chain
    if (extra?.paidWithChain) {
      updateData.from_chain = extra.paidWithChain;
    }
    if (extra?.fromToken ?? extra?.paidWithToken) {
      updateData.from_token = extra.fromToken ?? extra.paidWithToken;
    }

    // Persist the transaction signature for audit and recovery
    if (extra?.txHash) {
      updateData.sender_tx_hash = extra.txHash;
    }

    // Persist fee directly on the payments row so the summary is always readable on reload.
    // Legacy claims table doesn't have these columns — they're excluded from legacyUpdateData below.
    if (extra?.feeAmountUsdc != null) {
      updateData.fee_paid_usdc = extra.feeAmountUsdc;
    }

    // Legacy claims table uses paid_with_chain instead of from_chain/from_token
    const legacyUpdateData: Record<string, unknown> = { ...updateData };
    if (legacyUpdateData.from_chain !== undefined) {
      legacyUpdateData.paid_with_chain = legacyUpdateData.from_chain;
      delete legacyUpdateData.from_chain;
    }
    delete legacyUpdateData.from_token;
    delete legacyUpdateData.fee_paid_usdc;

    const { error } = await this.updateRow(id, updateData, legacyUpdateData);

    if (error) {
      this.logger.error('Failed to update claim status:', error);
      throw new Error(`Database error: ${error}`);
    }

    this.logger.log(`Updated claim ${id} status to ${effectiveStatus}`);

    if (extra?.feeBreakdown) {
      const eventPayload = {
        feeAmountUsdc: extra.feeAmountUsdc ?? null,
        ...extra.feeBreakdown,
        txHash: extra.txHash ?? null,
      };
      const { error: evtErr } = await (this.supabaseService.claimEvents as any)
        .insert({ claim_id: id, type: 'FEE_CHARGED', payload: eventPayload });
      if (evtErr) {
        this.logger.warn(`Failed to insert FEE_CHARGED event for claim ${id}: ${evtErr.message}`);
      }
    }

    return { id, status: effectiveStatus } as unknown as Claim;
  }

  /**
   * Returns claims that are PRIVATE_TRANSFER_PENDING with a saved sender_tx_hash.
   * Used by the cron verifier to poll on-chain and auto-upgrade to SUCCESS.
   */
  async getPendingTxHashClaims(): Promise<{ id: string; sender_tx_hash: string; created_at: string }[]> {
    const { data, error } = await this.supabaseService.payments
      .select('id, sender_tx_hash, created_at')
      .eq('status', 'PRIVATE_TRANSFER_PENDING')
      .not('sender_tx_hash', 'is', null);
    if (error) {
      this.logger.error('Failed to query pending tx hash claims:', error);
      return [];
    }
    return (data || []).filter((c) => !!(c as any).sender_tx_hash) as { id: string; sender_tx_hash: string; created_at: string }[];
  }

  /**
   * Save the broadcast transaction signature immediately after sendRawTransaction, before
   * confirmation polling completes. Enables recovery if the RPC polling times out.
   */
  async saveBroadcastTxHash(id: string, txHash: string): Promise<void> {
    const { error } = await this.updateRow(
      id,
      { sender_tx_hash: txHash },
      { sender_tx_hash: txHash },
    );
    if (error) {
      this.logger.error(`Failed to save broadcast tx hash for claim ${id}:`, error);
      throw new Error(`Database error: ${error}`);
    }
    this.logger.log(`Saved broadcast tx hash for claim ${id}: ${txHash.slice(0, 12)}...`);
  }

  /**
   * Get all claims for a user
   */
  async findByUser(userId: string): Promise<Claim[]> {
    const { data, error } = await this.supabaseService.payments
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch user claims:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return (data || []).map((r) => this.normalizeFromPayments(r as Record<string, unknown>) as unknown as Claim);
  }

  /**
   * Get claims by status (for cron processing)
   */
  async findByStatus(status: ClaimStatus): Promise<Claim[]> {
    const { data, error } = await this.supabaseService.payments
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch claims by status:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return (data || []).map((r) => this.normalizeFromPayments(r as Record<string, unknown>) as unknown as Claim);
  }

  /**
   * Cron-safe burner sweep: find all PRIVATE_TRANSFER_PENDING claims that still have
   * burner funds and sweep them to the already-resolved recipient_address.
   * Replaces the in-process setTimeout retries so sweeps survive server restarts.
   * Only processes claims updated within the last 10 minutes to avoid hammering old stuck claims.
   */
  async cronSweepPendingBurners(): Promise<void> {
    const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: pendingClaims, error } = await this.supabaseService.payments
      .select('*')
      .eq('status', 'PRIVATE_TRANSFER_PENDING')
      .gte('updated_at', cutoff)
      .not('burner_address', 'is', null)
      .not('burner_encrypted_secret', 'is', null);

    if (error) {
      this.logger.error('[cronSweep] Query error:', error);
      return;
    }
    if (!pendingClaims?.length) return;

    this.logger.log(`[cronSweep] Found ${pendingClaims.length} PRIVATE_TRANSFER_PENDING claims to retry`);

    for (const raw of pendingClaims) {
      const claim = this.normalizeFromPayments(raw as Record<string, unknown>) as unknown as Claim & { recipient_address?: string };
      const recipientWallet = (claim.recipient_address || '').trim();
      if (!recipientWallet || this.isPendingRecipientAddress(recipientWallet)) {
        this.logger.warn(`[cronSweep] Claim ${claim.id}: recipient not resolved yet, skipping`);
        continue;
      }
      try {
        const { sweepTxHash } = await this.sweepClaimBurnerToWallet(claim.id, claim, recipientWallet);
        if (sweepTxHash) {
          await this.updateStatus(claim.id, 'SUCCESS', { recipientSwept: true });
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
    const { data, error } = await this.supabaseService.paymentIntents
      .insert({
        payment_id: params.claimId,
        quote_id: params.quoteId || null,
        deposit_address: params.depositAddress || null,
        memo: params.memo || null,
        deadline: params.deadline ? new Date(params.deadline).toISOString() : null,
        time_estimate: params.timeEstimate || null,
        status: params.status || 'PENDING_DEPOSIT',
        from_chain: params.fromChain || null,
        to_chain: params.toChain || null,
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

    return this.normalizeIntent(data as Record<string, unknown>) as unknown as ClaimIntent;
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

    const { data, error } = await this.supabaseService.paymentIntents
      .update(updateData)
      .eq('id', intentId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update claim intent:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return this.normalizeIntent(data as Record<string, unknown>) as unknown as ClaimIntent;
  }

  /**
   * Get pending intents for processing
   * Excludes expired intents and intents older than 1 month
   */
  async getPendingIntents(): Promise<ClaimIntent[]> {
    const now = new Date().toISOString();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const { data, error } = await this.supabaseService.paymentIntents
      .select('*')
      .in('status', ['PENDING_DEPOSIT', 'IN_FLIGHT'])
      .gt('deadline', now)
      .gt('created_at', oneMonthAgo.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch pending intents:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return (data || []).map((r) => this.normalizeIntent(r as Record<string, unknown>) as unknown as ClaimIntent);
  }

  /**
   * Get all claims (admin)
   */
  async findAll(options?: {
    status?: ClaimStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ claims: Claim[]; total: number }> {
    let query = this.supabaseService.payments.select('*', { count: 'exact' });

    if (options?.status) {
      query = query.eq('status', options.status);
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

    return {
      claims: (data || []).map((r) => this.normalizeFromPayments(r as Record<string, unknown>) as unknown as Claim),
      total: count || 0,
    };
  }

  /**
   * Delete a claim and its intents (admin)
   */
  async delete(id: string): Promise<void> {
    // payment_intents cascade-deletes via FK; also clean up claim_intents for legacy records
    await this.supabaseService.claimIntents.delete().eq('claim_id', id);

    const { error: pErr } = await this.supabaseService.payments.update({ status: 'DELETED' }).eq('id', id);
    if (pErr) {
      const { error } = await this.supabaseService.claims.delete().eq('id', id);
      if (error) {
        this.logger.error('Failed to delete claim:', error);
        throw new Error(`Database error: ${error.message}`);
      }
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

    const { data: intents, error } = await this.supabaseService.paymentIntents
      .select('*')
      .eq('payment_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch claim intents:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return {
      claim,
      intents: (intents || []).map((r) => this.normalizeIntent(r as Record<string, unknown>) as unknown as ClaimIntent),
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Key rotation migration
  // ─────────────────────────────────────────────────────────────────

  /**
   * Re-encrypt all legacy (v1) burner secrets using the current key + per-payment HKDF (v2 format).
   *
   * Run this ONCE after setting SEND_PAYMENT_ENC_KEY to a new value and
   * SEND_PAYMENT_ENC_KEY_OLD to the previous value. After it completes with
   * zero errors, remove SEND_PAYMENT_ENC_KEY_OLD from your environment.
   *
   * Returns a summary so you can confirm before removing the old key.
   */
  async rotateBurnerKeys(): Promise<{
    total: number;
    alreadyV2: number;
    migrated: number;
    failed: number;
    errors: string[];
  }> {
    if (!this.encryption?.isAvailable()) {
      throw new BadRequestException('EncryptionService is not available (SEND_PAYMENT_ENC_KEY not set).');
    }
    if (!this.encryption.isRotating) {
      throw new BadRequestException(
        'SEND_PAYMENT_ENC_KEY_OLD is not set. Set it to the previous key before running rotation.',
      );
    }

    this.logger.log('[rotateBurnerKeys] Starting key rotation scan…');

    const { data: rows, error } = await this.supabaseService.payments
      .select('id, burner_address, burner_encrypted_secret')
      .not('burner_address', 'is', null)
      .not('burner_encrypted_secret', 'is', null);

    if (error) throw new Error(`DB fetch failed: ${error.message}`);

    const stats = { total: 0, alreadyV2: 0, migrated: 0, failed: 0, errors: [] as string[] };
    const { V2_PREFIX } = await import('@/modules/send-payment/encryption.service');

    for (const row of rows ?? []) {
      stats.total++;
      const ciphertext: string = (row as any).burner_encrypted_secret;
      const burnerAddress: string = (row as any).burner_address;

      if (ciphertext.startsWith(V2_PREFIX)) {
        stats.alreadyV2++;
        continue;
      }

      try {
        const secret = this.encryption.decrypt(ciphertext, undefined);
        const newCiphertext = this.encryption.encrypt(secret, burnerAddress);

        const { error: updateError } = await this.supabaseService.payments
          .update({ burner_encrypted_secret: newCiphertext })
          .eq('id', (row as any).id);

        if (updateError) throw new Error(updateError.message);
        stats.migrated++;
      } catch (e: any) {
        stats.failed++;
        stats.errors.push(`payment ${(row as any).id}: ${e?.message ?? e}`);
        this.logger.error(`[rotateBurnerKeys] Failed for payment ${(row as any).id}: ${e?.message}`);
      }
    }

    this.logger.log(
      `[rotateBurnerKeys] Done. total=${stats.total} alreadyV2=${stats.alreadyV2} migrated=${stats.migrated} failed=${stats.failed}`,
    );
    return stats;
  }
}
