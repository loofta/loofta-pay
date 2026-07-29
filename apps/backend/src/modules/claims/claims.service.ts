import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException, Optional, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import nacl from 'tweetnacl';
import { Keypair, PublicKey, Transaction, VersionedTransaction, TransactionInstruction, SystemProgram, Connection, ComputeBudgetProgram } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  createCloseAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { CreateClaimDto, CreateClaimFromUsernameDto, CreateClaimFromEmailDto, CreateClaimFromSocialDto } from './dto';
import { Claim, ClaimIntent, ClaimStatus } from './entities/claim.entity';
import { UsersService, SocialPlatform } from '../users/users.service';
import { SendPaymentEncryptionService, V2_PREFIX, deriveHkdfKey } from '../send-payment/encryption.service';
import { SolanaSponsorService } from './solana-sponsor.service';
import { EmailService } from '../email/email.service';
import { isSolanaDevnetFromConfig, isSolanaLocalhostFromConfig } from '@/common/solana-cluster-env';
import { isValidSolanaAddress } from '@/common/solana-address';
import {
  MAGICBLOCK_GAS_SOL,
  MAGICBLOCK_GAS_USDC,
  MAGICBLOCK_VOLUME_FEE_BPS,
  MAGICBLOCK_PRIVATE_DEVNET_MAX_DELAY_MS,
  SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS,
  ENABLE_SINGLE_PAYMENT_PLATFORM_FEE,
  estimateMagicblockGrossUp,
  requestMagicblockPrivateTransfer,
  decodeActualSenderDebit,
  type MagicblockPrivateTransferClientResponse,
} from '@/common/magicblock-private-transfer';
import { MagicblockQuestService } from '../magicblock-quest/magicblock-quest.service';
import { PajCashBankService } from '../paj-cash/paj-cash-bank.service';
import { guardAtaSponsorship } from '@/common/ata-sponsorship-guard';
import { tokenAccountExists } from '@/common/token-account-exists';
import { reclaimBurnerFunds } from '@/common/burner-reclaim';
import { PajCashOrdersService } from '../paj-cash/paj-cash-orders.service';
import { computeLooftaFeeUsdc } from '@/common/paj-cash-fee';

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
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly baseUrl: string;
  private readonly usdcMint: PublicKey;
  private readonly perProgramId: PublicKey;
  private readonly emailSentAt = new Map<string, number>();

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    @Optional() @Inject(forwardRef(() => SendPaymentEncryptionService)) private readonly encryption: SendPaymentEncryptionService | null,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly emailService: EmailService,
    private readonly magicblockQuest: MagicblockQuestService,
    private readonly pajCashBank: PajCashBankService,
    private readonly pajCashOrders: PajCashOrdersService,
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
      `ClaimsService init: encryption=${this.encryption ? (this.encryption.isAvailable() ? 'available' : 'not configured') : 'null'}, claim burner creation=${burnerOk ? 'enabled' : 'disabled (set SEND_PAYMENT_ENC_KEY)'}, sponsor=${this.solanaSponsor.isAvailable()}, email=${this.emailService.isAvailable() ? 'available' : 'not configured (set RESEND_API_KEY)'}`,
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
  async create(dto: CreateClaimDto): Promise<{ id: string; short_id: string; link: string }> {
    const { amount, toSel, recipient, userId, cluster } = dto;

    if (!amount || !toSel?.symbol || !toSel?.chain || !recipient) {
      throw new BadRequestException('Missing required fields');
    }

    // Server config is the source of truth for mainnet vs devnet.
    // In mainnet mode, reject any client-supplied cluster override — prevents creating
    // fake-mainnet claims that actually route to devnet (recipient gets worthless USDC).
    const serverIsDevnet = isSolanaDevnetFromConfig(this.configService);
    const isDevnet = serverIsDevnet ? (cluster !== 'mainnet') : false;
    const shortId = generateShortId();
    // Always create a burner, regardless of recipient type — same policy as createFromUsername/
    // Social/Email. This is the direct-recipient-address creation path (also reachable by
    // integrators via POST /claims/create, not just the frontend), so it must not be the one
    // gap where a payment routes sender→recipient with no burner hop.
    const burner = this.createClaimBurner();
    if (!burner) {
      this.logger.warn('Creating claim without burner: SEND_PAYMENT_ENC_KEY may be missing. Claiming will fail until the key is set.');
    }
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
        short_id: shortId,
        ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error('Failed to create claim:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    const id = data.id;
    const link = `${this.baseUrl}/c/${shortId}`;

    this.logger.log(`Created claim: ${id}`);
    return { id, short_id: shortId, link };
  }

  /**
   * Create a claim from username (wallet address fetched server-side only).
   * If user exists: send directly to their wallet.
   * If user does not exist: create "burner" claim with PENDING_USERNAME so they can claim later when they sign up with that username.
   */
  async createFromUsername(dto: CreateClaimFromUsernameDto): Promise<{ id: string; short_id: string | null; link: string }> {
    const { username, amount, userId, isPrivate = false, description, cluster, treatUnregisteredAsTwitter } = dto;
    // Server config is the source of truth for mainnet vs devnet.
    // In mainnet mode, reject any client-supplied cluster override — prevents creating
    // fake-mainnet claims that actually route to devnet (recipient gets worthless USDC).
    const serverIsDevnet = isSolanaDevnetFromConfig(this.configService);
    const isDevnet = serverIsDevnet ? (cluster !== 'mainnet') : false;
    const cleanUsername = username.replace(/^@/, '').toLowerCase();

    let recipientAddress: string;

    try {
      const user = await this.usersService.findByUsername(cleanUsername);
      if (!isDevnet && !(await this.usersService.hasCompletedMainnetWalletUpdate(user.privyUserId))) {
        throw new BadRequestException(
          "This recipient is registered but hasn't updated Loofta to mainnet yet. Ask them to open Loofta and complete the update, then try sending again.",
        );
      }
      recipientAddress = await this.usersService.getSolanaWalletAddress(user.privyUserId);

      // Every payment now routes through a burner and requires an explicit claim, registered
      // recipients included — the sender never pays a recipient's real wallet directly.
      const burner = this.createClaimBurner();
      if (!burner) {
        this.logger.warn('Creating claim without burner: SEND_PAYMENT_ENC_KEY may be missing. Claiming will fail until the key is set.');
      }
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
          is_private: isPrivate,
          short_id: generateShortId(),
          ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
        })
        .select('id, short_id')
        .single();

      if (claimError) {
        this.logger.error('Error creating claim:', claimError);
        throw new BadRequestException('Failed to create claim');
      }

      const id = claim.id;
      const link = `${this.baseUrl}/c/${claim.short_id ?? id}`;
      this.logger.log(`Created claim from username: ${id} for user ${cleanUsername} (private: ${isPrivate})`);
      return { id, short_id: claim.short_id ?? null, link };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (!(err instanceof NotFoundException)) throw err;
      // User not found: create "burner" claim so they can claim later when they sign up with this username
    }

    // Tag as pending-social:twitter (not pending-username) when the sender picked this handle
    // from the Twitter option in the social picker — keeps the recipient's actual chosen
    // platform intact for "edit recipient" instead of collapsing it into a bare username.
    recipientAddress = treatUnregisteredAsTwitter
      ? `${ClaimsService.PENDING_SOCIAL_PREFIX}twitter:${cleanUsername}`
      : `${ClaimsService.PENDING_USERNAME_PREFIX}${cleanUsername}`;
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
        is_private: isPrivate,
        recipient_was_unregistered: true,
        short_id: generateShortId(),
        ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
      })
      .select('id, short_id')
      .single();

    if (claimError) {
      this.logger.error('Error creating claim from username (pending):', claimError);
      throw new BadRequestException('Failed to create claim');
    }

    const id = claim.id;
    const link = `${this.baseUrl}/c/${claim.short_id ?? id}`;
    this.logger.log(`Created claim from username (pending): ${id} for @${cleanUsername} – they can claim when they sign up${burner ? ' (unique burner)' : ''}`);
    return { id, short_id: claim.short_id ?? null, link };
  }

  /**
   * Create a claim addressed to a Discord/GitHub/Telegram handle. Mirrors createFromUsername:
   * pay the connected user's wallet directly if the handle is already linked (social_accounts),
   * otherwise fall back to a pending burner claim they can claim once they connect that handle.
   */
  async createFromSocial(dto: CreateClaimFromSocialDto): Promise<{ id: string; short_id: string | null; link: string }> {
    const { platform, handle, amount, userId, isPrivate = false, description, cluster } = dto;
    const serverIsDevnet = isSolanaDevnetFromConfig(this.configService);
    const isDevnet = serverIsDevnet ? (cluster !== 'mainnet') : false;
    const cleanHandle = handle.replace(/^@/, '').toLowerCase().trim();
    if (!cleanHandle) throw new BadRequestException('A valid handle is required.');

    let recipientAddress: string;

    try {
      const user = await this.usersService.findBySocialHandle(platform, cleanHandle);
      if (!isDevnet && !(await this.usersService.hasCompletedMainnetWalletUpdate(user.privyUserId))) {
        throw new BadRequestException(
          "This recipient is registered but hasn't updated Loofta to mainnet yet. Ask them to open Loofta and complete the update, then try sending again.",
        );
      }
      recipientAddress = await this.usersService.getSolanaWalletAddress(user.privyUserId);

      // Always create a burner here, regardless of isPrivate — deliberate, not a leftover default.
      // Public sends to a social handle still route sender→burner→recipient so the pay-time
      // privacy toggle on /c/[id] can switch a claim into private funding right up to the moment
      // it's paid, without needing a different code path per privacy setting.
      const burner = this.createClaimBurner();
      if (!burner) {
        this.logger.warn('Creating claim without burner: SEND_PAYMENT_ENC_KEY may be missing. Claiming will fail until the key is set.');
      }
      const { data: claim, error: claimError } = await this.supabaseService.payments
        .insert({
          amount: Number(amount),
          direction: 'from_sender',
          recipient_address: recipientAddress,
          recipient_username: user.username ?? null,
          recipient_user_id: user.privyUserId,
          created_by: userId ? String(userId) : null,
          status: 'OPEN',
          description: description || null,
          to_chain: 'solana',
          to_token: 'USDC',
          is_devnet: isDevnet,
          is_private: isPrivate,
          short_id: generateShortId(),
          ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
        })
        .select('id, short_id')
        .single();

      if (claimError) {
        this.logger.error('Error creating claim:', claimError);
        throw new BadRequestException('Failed to create claim');
      }

      const id = claim.id;
      const link = `${this.baseUrl}/c/${claim.short_id ?? id}`;
      this.logger.log(`Created claim from ${platform}: ${id} for @${cleanHandle} (private: ${isPrivate})`);
      return { id, short_id: claim.short_id ?? null, link };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      if (!(err instanceof NotFoundException)) throw err;
      // Handle not connected to any Loofta account yet: create "burner" claim so they can
      // claim later once they connect this platform.
    }

    recipientAddress = `${ClaimsService.PENDING_SOCIAL_PREFIX}${platform}:${cleanHandle}`;
    const burner = this.createClaimBurner();
    if (!burner) {
      this.logger.warn('Creating pending-social claim without burner: SEND_PAYMENT_ENC_KEY may be missing. Pay-with-Loofta will fail until the key is set.');
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
        is_private: isPrivate,
        recipient_was_unregistered: true,
        short_id: generateShortId(),
        ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
      })
      .select('id, short_id')
      .single();

    if (claimError) {
      this.logger.error('Error creating claim from social handle (pending):', claimError);
      throw new BadRequestException('Failed to create claim');
    }

    const id = claim.id;
    const link = `${this.baseUrl}/c/${claim.short_id ?? id}`;
    this.logger.log(`Created claim from ${platform} (pending): ${id} for @${cleanHandle} – they can claim once they connect this platform${burner ? ' (unique burner)' : ''}`);
    return { id, short_id: claim.short_id ?? null, link };
  }

  /** Sentinel prefix for claims created by email when recipient has no account yet; they claim by signing in with that email */
  static readonly PENDING_EMAIL_PREFIX = 'PENDING_EMAIL:';
  /** Sentinel prefix for claims when username doesn't exist yet; they claim by signing up with that username */
  static readonly PENDING_USERNAME_PREFIX = 'PENDING_USERNAME:';
  /** Sentinel prefix for claims addressed to a Discord/GitHub/Telegram handle with no connected account yet. Format: PENDING_SOCIAL:<platform>:<handle> */
  static readonly PENDING_SOCIAL_PREFIX = 'PENDING_SOCIAL:';

  private isPendingRecipientAddress(addr?: string | null): boolean {
    const v = (addr || '').trim();
    return (
      v.startsWith(ClaimsService.PENDING_EMAIL_PREFIX) ||
      v.startsWith(ClaimsService.PENDING_USERNAME_PREFIX) ||
      v.startsWith(ClaimsService.PENDING_SOCIAL_PREFIX)
    );
  }

  /** Parses "PENDING_SOCIAL:<platform>:<handle>" into its parts, or null if malformed. */
  private parsePendingSocialAddress(addr: string): { platform: 'discord' | 'github' | 'telegram' | 'twitter'; handle: string } | null {
    const rest = addr.slice(ClaimsService.PENDING_SOCIAL_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep < 0) return null;
    const platform = rest.slice(0, sep).trim();
    const handle = rest.slice(sep + 1).trim().toLowerCase();
    if (!handle || !['discord', 'github', 'telegram', 'twitter'].includes(platform)) return null;
    return { platform: platform as 'discord' | 'github' | 'telegram' | 'twitter', handle };
  }

  /**
   * How long a recipient-claim lock (recipient_claim_lock_at) is honored before being treated
   * as stale. claimAsRecipient holds this lock only while sweeping burner funds (bounded by
   * BURNER_INBOUND_INLINE_MAX_MS ≈ 90s) — the TTL is set well above that so it never expires a
   * genuine in-flight claim, while still self-healing if a claim attempt crashes mid-sweep
   * without reaching its `finally` release.
   */
  private static readonly RECIPIENT_CLAIM_LOCK_TTL_MS = 5 * 60_000;

  private recipientClaimLockStaleCutoffIso(): string {
    return new Date(Date.now() - ClaimsService.RECIPIENT_CLAIM_LOCK_TTL_MS).toISOString();
  }

  private isRecipientClaimLockActive(lockAt?: string | null): boolean {
    if (!lockAt) return false;
    return Date.now() - new Date(lockAt).getTime() < ClaimsService.RECIPIENT_CLAIM_LOCK_TTL_MS;
  }

  /**
   * True for Postgres "column does not exist" (42703) — lets callers degrade gracefully if the
   * recipient_claim_lock_at migration (20260713000000_payments_recipient_claim_lock.sql) hasn't
   * been deployed to this environment yet, instead of hard-failing every claim attempt.
   */
  private isMissingColumnError(error: unknown): boolean {
    return (error as { code?: string } | null | undefined)?.code === '42703';
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

  /**
   * Fetch raw row by ID: tries payments first (normalized), falls back to claims. Also accepts
   * an 8-char short_id in place of the UUID (no format collision risk — short_ids and UUIDs
   * don't overlap in length/charset), so every caller of this method transparently supports
   * either form without a separate resolve step.
   */
  private async fetchRawRow(
    id: string,
  ): Promise<{ row: Record<string, unknown>; table: 'payments' | 'claims' } | null> {
    const { data: pr } = await this.supabaseService.payments
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (pr) return { row: this.normalizeFromPayments(pr as Record<string, unknown>), table: 'payments' };

    const { data: prByShortId } = await this.supabaseService.payments
      .select('*')
      .eq('short_id', id)
      .maybeSingle();
    if (prByShortId) return { row: this.normalizeFromPayments(prByShortId as Record<string, unknown>), table: 'payments' };

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
  ): Promise<{ error: string | null; table: 'payments' | 'claims' }> {
    const { data, error } = await (this.supabaseService.payments as any)
      .update(paymentsData)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (!error && data) return { error: null, table: 'payments' };
    const { error: claimErr } = await (this.supabaseService.claims as any)
      .update(claimsData)
      .eq('id', id);
    return { error: claimErr ? String(claimErr.message) : null, table: 'claims' };
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

  /**
   * Mint a burner for a claim created outside this service (the Next.js request-money/pay-to-
   * wallet route inserts directly into Supabase and has no access to SEND_PAYMENT_ENC_KEY/KMS).
   * Called only via the internal-secret-gated controller endpoint.
   */
  mintBurnerForExternalCreation(): { claim_burner_address: string; claim_burner_encrypted_secret: string } | null {
    return this.createClaimBurner();
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
   * Read an encryption env var from .env file (fallback when ConfigService/process.env don't have it).
   * Tries backend root and cwd so it works whether run from monorepo root or apps/backend.
   */
  private getClaimBurnerDecryptionKeyFromFile(envVar: string = 'SEND_PAYMENT_ENC_KEY'): string | null {
    const tryPaths = [
      join(process.cwd(), 'apps', 'backend', '.env.local'),
      join(process.cwd(), '.env.local'),
      join(__dirname, '..', '..', '..', '.env.local'),
      join(__dirname, '..', '..', '.env.local'),
    ];
    const escaped = envVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const p of tryPaths) {
      try {
        if (existsSync(p)) {
          const content = readFileSync(p, 'utf8');
          const match = content.match(new RegExp(`${escaped}\\s*=\\s*(["']?)([^\\s#'"]+)\\1`));
          if (match?.[2]) return match[2].trim();
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  /**
   * Read SEND_PAYMENT_ENC_KEY or SEND_PAYMENT_ENC_KEY_OLD (ConfigService → process.env → .env.local file)
   * so reclaim and recipient claim-sweep can decrypt even when SendPaymentEncryptionService is not injected.
   */
  private getClaimBurnerDecryptionKey(envVar: string = 'SEND_PAYMENT_ENC_KEY'): Buffer | null {
    let raw =
      this.configService.get<string>(envVar) ??
      (typeof process !== 'undefined' ? process.env[envVar] : undefined);
    if (!raw || typeof raw !== 'string') {
      raw = this.getClaimBurnerDecryptionKeyFromFile(envVar) ?? undefined;
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

    if (ciphertextBase64.startsWith(V2_PREFIX)) {
      // Per-context HKDF-derived key — same derivation as SendPaymentEncryptionService (shared
      // via deriveHkdfKey) so this path decrypts v2 burners identically instead of only
      // supporting legacy v1, which would otherwise leave v2-encrypted funds unsweepable
      // whenever this fallback is the only decrypt path available.
      const raw = ciphertextBase64.slice(V2_PREFIX.length);
      const aesKey = deriveHkdfKey(key, burnerAddress ?? '');
      try {
        return this.decryptBurnerSecretWithKey(raw, aesKey);
      } catch (primaryErr) {
        const oldKey = this.getClaimBurnerDecryptionKey('SEND_PAYMENT_ENC_KEY_OLD');
        if (oldKey) {
          this.logger.warn('decryptClaimBurnerSecret: primary key failed (v2); retrying with SEND_PAYMENT_ENC_KEY_OLD (rotation fallback)');
          const oldAesKey = deriveHkdfKey(oldKey, burnerAddress ?? '');
          return this.decryptBurnerSecretWithKey(raw, oldAesKey);
        }
        throw primaryErr;
      }
    }

    try {
      return this.decryptBurnerSecretWithKey(ciphertextBase64, key);
    } catch (primaryErr) {
      const oldKey = this.getClaimBurnerDecryptionKey('SEND_PAYMENT_ENC_KEY_OLD');
      if (oldKey) {
        this.logger.warn('decryptClaimBurnerSecret: primary key failed; retrying with SEND_PAYMENT_ENC_KEY_OLD (rotation fallback)');
        return this.decryptBurnerSecretWithKey(ciphertextBase64, oldKey);
      }
      throw primaryErr;
    }
  }

  /**
   * Create a claim from email. If user exists, use their wallet. If not, create with PENDING_EMAIL so they can claim by signing in later.
   */
  async createFromEmail(dto: CreateClaimFromEmailDto): Promise<{ id: string; short_id: string | null; link: string }> {
    const { email, amount, userId, isPrivate = false, description, cluster } = dto;
    // Server config is the source of truth for mainnet vs devnet.
    // In mainnet mode, reject any client-supplied cluster override — prevents creating
    // fake-mainnet claims that actually route to devnet (recipient gets worthless USDC).
    const serverIsDevnet = isSolanaDevnetFromConfig(this.configService);
    const isDevnet = serverIsDevnet ? (cluster !== 'mainnet') : false;
    const cleanEmail = email.trim().toLowerCase();

    let recipientAddress: string;

    try {
      const user = await this.usersService.findByEmail(cleanEmail);
      if (!isDevnet && !(await this.usersService.hasCompletedMainnetWalletUpdate(user.privyUserId))) {
        throw new BadRequestException(
          "This recipient is registered but hasn't updated Loofta to mainnet yet. Ask them to open Loofta and complete the update, then try sending again.",
        );
      }
      recipientAddress = await this.usersService.getSolanaWalletAddress(user.privyUserId);

      const burner = this.createClaimBurner();
      if (!burner) {
        this.logger.warn('Creating claim without burner: SEND_PAYMENT_ENC_KEY may be missing. Claiming will fail until the key is set.');
      }
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
          is_private: isPrivate,
          short_id: generateShortId(),
          ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
        })
        .select('id, short_id')
        .single();

      if (claimError) {
        this.logger.error('Error creating claim from email (existing user):', claimError);
        throw new BadRequestException('Failed to create claim');
      }

      const id = claim.id;
      const link = `${this.baseUrl}/c/${claim.short_id ?? id}`;
      this.logger.log(`Created claim from email (existing user): ${id} for ${cleanEmail} (private: ${isPrivate})`);
      return { id, short_id: claim.short_id ?? null, link };
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
        is_private: isPrivate,
        recipient_was_unregistered: true,
        short_id: generateShortId(),
        ...(burner ? { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret } : {}),
      })
      .select('id, short_id')
      .single();

    if (claimError) {
      this.logger.error('Error creating claim from email (pending):', claimError);
      throw new BadRequestException('Failed to create claim');
    }

    const id = claim.id;
    const link = `${this.baseUrl}/c/${claim.short_id ?? id}`;
    this.logger.log(`Created claim from email (pending): ${id} for ${cleanEmail} – they claim by signing in${burner ? ' (unique burner)' : ''}`);
    return { id, short_id: claim.short_id ?? null, link };
  }

  /**
   * Genuinely public, pre-auth summary — used by claim pages (e.g. the standalone Loofta Link
   * app) to show "you're about to claim $X" BEFORE the visitor logs in. Deliberately returns
   * only fields that reveal nothing about the recipient's identity (unlike findOne, which
   * requires auth precisely because it exposes recipient/creator details) — no recipient_*,
   * no created_by, nothing to mask.
   */
  async findPublicSummary(idOrShortId: string): Promise<{
    id: string;
    short_id: string | null;
    amount: string;
    to_symbol: string | null;
    description: string | null;
    status: string;
  }> {
    const result = await this.fetchRawRow(idOrShortId);
    if (!result) throw new NotFoundException('Payment not found.');
    const row = result.row as Record<string, unknown>;
    if (String(row.status || '').toUpperCase() === 'DELETED') {
      throw new NotFoundException("This payment doesn't exist.");
    }
    return {
      id: String(row.id),
      short_id: (row.short_id as string) ?? null,
      amount: String(row.amount),
      to_symbol: (row.to_symbol as string) ?? 'USDC',
      description: (row.description as string) ?? null,
      status: String(row.status),
    };
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

    // Access control: only the creator or the intended recipient may view a claim.
    if (!requestingUserId) {
      throw new ForbiddenException('Authentication required to view this payment.');
    }
    const isCreator = !!(claim.created_by && claim.created_by === requestingUserId);
    // Once a claim has actually paid out, there's nothing left to authorize (no funds to move,
    // no destination to pick) — skip the recipient-identity check for this terminal state rather
    // than risk a real "Payment not found" for a legitimate recipient. This matters concretely:
    // Telegram-login can hand a returning recipient a second, unlinked Privy user id with no
    // wallet/social-account trail back to the original one (confirmed in production — see the
    // 2026-07-24 Td2mutpu incident), so checkIsRecipient's strict identity match can permanently
    // fail for the real recipient even though the payment already succeeded to their real wallet.
    const isAlreadySettled = (claim.status || '').toUpperCase() === 'SUCCESS';
    if (!isCreator && !isAlreadySettled) {
      const { isRecipient } = await this.checkIsRecipient(id, requestingUserId);
      if (!isRecipient) {
        throw new NotFoundException('Payment not found.');
      }
    }

    if (claim.created_by) {
      const creator = await this.usersService.findByPrivyId(claim.created_by);
      (claim as Claim & { creator_username?: string | null }).creator_username = creator?.username ?? null;
    }
    // Embed which bank account a "claim in Naira" was routed to, so the recipient sees durable,
    // reload-proof confirmation on the claim page itself — not just the transient toast/copy
    // shown at the moment they claimed, which is lost on refresh.
    const nairaBankAccountId = (claim as Claim & { naira_claim_bank_account_id?: string | null }).naira_claim_bank_account_id;
    if (nairaBankAccountId) {
      const bankAccount = await this.pajCashBank.getAccountById(nairaBankAccountId).catch(() => null);
      if (bankAccount) {
        (claim as Claim & { naira_claim_bank_name?: string; naira_claim_bank_last4?: string }).naira_claim_bank_name = bankAccount.bank_name;
        (claim as Claim & { naira_claim_bank_last4?: string }).naira_claim_bank_last4 = bankAccount.account_number.slice(-4);
      }
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
    // Mask pending-social claims: expose flag + platform + handle so UI can show "Claim as @handle on Discord"
    else if (claim.recipient_address?.startsWith(ClaimsService.PENDING_SOCIAL_PREFIX)) {
      const parsed = this.parsePendingSocialAddress(claim.recipient_address);
      (claim as Claim & { recipient_address?: string }).recipient_address = undefined;
      (claim as Claim & { recipient_pending_social?: boolean }).recipient_pending_social = true;
      (claim as Claim & { recipient_pending_social_platform?: string | null }).recipient_pending_social_platform = parsed?.platform ?? null;
      (claim as Claim & { recipient_pending_social_value?: string | null }).recipient_pending_social_value = parsed?.handle ?? null;
      const claimWithBurner = claim as unknown as { claim_burner_address?: string | null };
      this.logger.log(
        `[findOne] Pending-social claim ${id}: burner=${claimWithBurner.claim_burner_address ? 'present' : 'missing'}`,
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

    // Surface whether a recipient-edit is currently blocked (see recipient_claim_lock_at /
    // claim_requested_at / claimAsRecipient and the matching guards in updateClaimRecipient) —
    // creator-only, so the sender's "Edit recipient" UI can disable itself instead of the edit
    // call failing with no warning. claim_requested_at is included, not just the transient lock:
    // it's set once and never cleared the moment the recipient starts claiming, which is what
    // actually blocks edits after the lock itself has already released (see updateClaimRecipient).
    const isCreatorViewer = !!(requestingUserId && claim.created_by && requestingUserId === claim.created_by);
    if (isCreatorViewer) {
      (claim as Claim & { recipient_claim_in_progress?: boolean }).recipient_claim_in_progress =
        this.isRecipientClaimLockActive((claim as unknown as { recipient_claim_lock_at?: string | null }).recipient_claim_lock_at) ||
        !!(claim as unknown as { claim_requested_at?: string | null }).claim_requested_at;
    }
    delete (claim as unknown as Record<string, unknown>)['recipient_claim_lock_at'];

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
    gasless = true,
  ): Promise<MagicblockPrivateTransferClientResponse> {
    const { requestMagicblockPrivateTransfer, toClientResponse } = await import('@/common/magicblock-private-transfer');
    const claim = await this.findOneRaw(claimId);
    const row = claim as Claim & { claim_burner_address?: string | null };
    const { isRecipient } = await this.checkIsRecipient(claimId, privyUserId);
    if (isRecipient) {
      throw new ForbiddenException(
        'This action is for the payer. Recipients complete payment on the claim side.',
      );
    }
    const to = this.resolveEffectiveRecipientForPrivatePayment(row);
    if (!to || !isValidSolanaAddress(to)) {
      throw new BadRequestException('Recipient is not available for this claim yet.');
    }
    const amountUsd = parseFloat(String(claim.amount || '0'));
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      throw new BadRequestException('Invalid claim amount');
    }
    // Multi-send recipient rows only need to satisfy the batch-level $5 minimum already
    // enforced by BuildMultiSendDto — standalone payment links enforce it per-link here.
    const isMultiSend = (row as unknown as { is_multi_send?: boolean }).is_multi_send === true;
    if (amountUsd < 5 && !isMultiSend) {
      throw new BadRequestException('Minimum payment amount is $5.00 USDC.');
    }
    const baseUnits = Math.round(amountUsd * 1_000_000);
    // fee_on_sender=true (Exact out): MagicBlock's own exactOut grosses up the sender's debit
    //   internally so the recipient receives exactly baseUnits — no manual gross-up on our side.
    // fee_on_sender=false (Exact in): send baseUnits directly, MB deducts its fee from the amount, recipient gets less.
    // Links explicitly created non-private always force fee-on-sender: the recipient declined
    // private payments, so if the sender opts into a private transfer anyway, that's the
    // sender's choice and the sender's cost — it can't come out of the recipient's amount.
    // Otherwise the fee direction is whatever the link's own creator chose at creation time
    // (request-money links let the recipient set fee_on_sender for their own private links) —
    // no payer override; the sender is always paying to fund the burner privately here, and
    // this is the sender-initiated incognito path, so fee-on-sender is the default expectation.
    const isNonPrivateLink = (row as any).is_private === false;
    const feeOnSender = isNonPrivateLink ? true : (row as any).fee_on_sender !== false;
    const cluster = requestCluster
      ?? (isSolanaLocalhostFromConfig(this.configService) ? 'localhost' : isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet');
    const effectiveMint = cluster === 'mainnet'
      ? new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
      : new PublicKey(this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || this.usdcMint.toBase58());

    // Correct is_devnet and stamp sender_user_id so the payer sees it in history. Links created
    // non-private only record that as the CREATOR's request — if the sender pays this one
    // privately anyway (this function only runs on the private-transfer path), flip is_private
    // to true so admin/reporting reflects what actually happened, not just the original ask.
    const correctIsDevnet = cluster !== 'mainnet';
    await this.supabaseService.payments
      .update({
        is_devnet: correctIsDevnet,
        sender_user_id: privyUserId,
        ...(isNonPrivateLink ? { is_private: true } : {}),
      })
      .eq('id', claimId);
    this.logger.log(`[PrivatePay] stamped claim ${claimId}: is_devnet=${correctIsDevnet} sender_user_id=${privyUserId}${isNonPrivateLink ? ' is_private=true (sender opted into private on a non-private link)' : ''}`);

    // MagicBlock cost = 10 BPS volume fee + flat 0.2 USDC gasless relay fee, plus (disabled, see
    // ENABLE_SINGLE_PAYMENT_PLATFORM_FEE) Loofta's own cut via platformFeeBps.
    const relayFeeUnits = gasless ? Math.round(MAGICBLOCK_GAS_USDC * 1_000_000) : 0;
    const totalBps = MAGICBLOCK_VOLUME_FEE_BPS + (ENABLE_SINGLE_PAYMENT_PLATFORM_FEE ? SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS : 0);
    // MagicBlock confirmed the InvalidAccountData cause: platformFeeAccount must be the fee
    // collector's *initialized USDC ATA*, not its wallet address (undocumented on their side,
    // no validation performed). Derive it rather than passing the raw sponsor address.
    const platformFeeAccount = (ENABLE_SINGLE_PAYMENT_PLATFORM_FEE && this.solanaSponsor.getFeePayerAddress())
      ? (await getAssociatedTokenAddress(effectiveMint, new PublicKey(this.solanaSponsor.getFeePayerAddress()!))).toBase58()
      : null;
    // Exact out: pass the clean amount with exactOut:true — MagicBlock grosses up the sender's
    //   debit internally and guarantees the recipient nets exactly baseUnits.
    // Exact in:  sender pays (baseUnits - relay) + relay = baseUnits total, MB deducts its fee
    //   from (baseUnits - relay) before delivery, recipient gets less.
    const transferUnits = feeOnSender ? baseUnits : baseUnits - relayFeeUnits;
    const estimatedMbVolumeFeeUnits = feeOnSender
      ? (estimateMagicblockGrossUp(baseUnits, totalBps) - baseUnits)
      : Math.ceil((baseUnits - relayFeeUnits) * totalBps / 10_000);

    this.logger.log(
      `[PrivatePay] claim=${claimId} amount=${amountUsd} baseUnits=${baseUnits} feeOnSender=${feeOnSender}` +
      ` transferUnits=${transferUnits} relayFeeUnits=${relayFeeUnits} cluster=${cluster} mint=${effectiveMint.toBase58().slice(0, 8)}… gasless=${gasless}`,
    );

    const txResponse = await requestMagicblockPrivateTransfer({
      from: senderWallet.trim(),
      to,
      mint: effectiveMint.toBase58(),
      amount: transferUnits,
      cluster,
      exactOut: feeOnSender,
      ...(gasless ? { gasless: true } : {}),
      ...(platformFeeAccount ? { platformFeeBps: SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS, platformFeeAccount } : {}),
    });

    // Decode the actual debit from the transaction — ground truth over the gross estimate.
    const conn = cluster !== 'localhost' ? this.solanaSponsor.getConnectionForCluster(cluster) : undefined;
    const actualDebitUnits = await decodeActualSenderDebit(txResponse.transactionBase64, senderWallet.trim(), effectiveMint, conn);
    // For private transfers the main instruction is confidential; decodeActualSenderDebit only
    // sees the relay-fee SPL transfer (actualDebitUnits ≈ relay fee << baseUnits).
    const estimatedFeeUnits = estimatedMbVolumeFeeUnits + relayFeeUnits;
    const feeUnits = (actualDebitUnits != null && actualDebitUnits > 0 && actualDebitUnits < baseUnits)
      ? estimatedMbVolumeFeeUnits + actualDebitUnits
      : estimatedFeeUnits;
    this.logger.log(`[PrivatePay] claim=${claimId} decoded relay=${actualDebitUnits ?? 'n/a'} feeUnits=${feeUnits} (${actualDebitUnits != null && actualDebitUnits > 0 && actualDebitUnits < baseUnits ? 'actual-relay' : 'estimated'})`);

    return toClientResponse(txResponse, {
      feeAmountUsdc: feeUnits / 1_000_000,
      feeBreakdown: {
        looftaBpsUsdc: estimatedMbVolumeFeeUnits / 1_000_000,
        solRecoveryUsdc: relayFeeUnits / 1_000_000,
        solLamports: Math.round(MAGICBLOCK_GAS_SOL * 1e9),
        solPriceUsd: 0,
      },
    });
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

  /**
   * Every payment now routes through a burner and requires an explicit claim, including
   * sender-chosen-private payments — the sender never pays a recipient's real wallet directly.
   * When the sender pays privately, this is the MagicBlock transfer's destination: the burner.
   * The recipient separately claims burner → their real (or chosen) destination afterward.
   */
  private resolveEffectiveRecipientForPrivatePayment(
    claim: Claim & { claim_burner_address?: string | null },
  ): string {
    return (claim.claim_burner_address || '').trim();
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
      if (!pendingUsername) return { isRecipient: false };
      const creator = await this.usersService.findByPrivyId(privyUserId);
      const userUsername = creator?.username?.toLowerCase() ?? '';
      if (userUsername === pendingUsername) {
        return { isRecipient: true };
      }
      // Fallback: match against the claimant's connected X/Twitter handle. Covers the case
      // where a payment was sent to someone's X handle but their Loofta username (set at
      // signup, e.g. a "loo-" prefixed default) doesn't match it 1:1.
      const matchesTwitter = await this.usersService.verifyRecipientIdentityForSendPayment(
        privyUserId,
        'twitter',
        pendingUsername,
      );
      return { isRecipient: matchesTwitter };
    }
    if (recipientAddress.startsWith(ClaimsService.PENDING_SOCIAL_PREFIX)) {
      const parsed = this.parsePendingSocialAddress(recipientAddress);
      if (!parsed) return { isRecipient: false };
      const matches = await this.usersService.verifyRecipientIdentityForSendPayment(
        privyUserId,
        parsed.platform,
        parsed.handle,
      );
      return { isRecipient: matches };
    }
    // A registered claim stamps recipient_user_id at creation time — trust that stable identity
    // reference first. Falling back to wallet-address comparison alone breaks once a recipient's
    // registered wallet changes after the claim was created (e.g. a mainnet wallet migration),
    // since recipient_address is a point-in-time snapshot that never gets updated to match.
    const recipientUserId = (claim as { recipient_user_id?: string | null }).recipient_user_id;
    if (recipientUserId) {
      return { isRecipient: recipientUserId === privyUserId };
    }
    try {
      const userWallet = await this.usersService.getSolanaWalletAddress(privyUserId);
      return { isRecipient: userWallet.trim().toLowerCase() === recipientAddress.trim().toLowerCase() };
    } catch {
      return { isRecipient: false };
    }
  }

  /**
   * Has this sender ever completed a public (non-private) payment to this recipient before?
   * Backs the privacy nudge warning a sender their recipient already knows their wallet address —
   * a private payment going forward can't undo that. Only meaningful once the recipient has a
   * stable recipient_user_id (a still-pending recipient can't have received anything yet), so
   * this short-circuits to false rather than matching on a raw address. Backed by the partial
   * index in 20260720120000_add_payments_sender_recipient_public_idx.sql.
   */
  async hasEverPaidPublicly(senderUserId: string, recipientUserId: string): Promise<boolean> {
    if (!senderUserId || !recipientUserId) return false;
    const { data } = await this.supabaseService.payments
      .select('id')
      .eq('sender_user_id', senderUserId)
      .eq('recipient_user_id', recipientUserId)
      .eq('is_private', false)
      .eq('status', 'SUCCESS')
      .limit(1);
    return !!data?.length;
  }

  /**
   * Claim a pending payment (PENDING_EMAIL / PENDING_USERNAME) as the authenticated recipient.
   * Updates recipient_address to the user's Solana wallet so the payer can complete deposit.
   */
  async claimAsRecipient(
    claimId: string,
    privyUserId: string,
    opts?: { claimPrivately?: boolean; destinationAddress?: string; claimToNaira?: boolean },
  ): Promise<{ claimed: boolean; sweepTxHash?: string; sweptAmount?: string; feeAmountUsdc?: number }> {
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
    const isPendingSocial = ra.startsWith(ClaimsService.PENDING_SOCIAL_PREFIX);
    // Also allow registered recipients (real wallet stored, burner used as intermediary)
    const isRegisteredRecipient = !isPendingEmail && !isPendingUsername && !isPendingSocial && !!ra;
    if (!isPendingEmail && !isPendingUsername && !isPendingSocial && !isRegisteredRecipient) {
      throw new BadRequestException('This payment is not pending claim or has already been claimed.');
    }
    const { isRecipient } = await this.checkIsRecipient(claimId, privyUserId);
    if (!isRecipient) {
      throw new ForbiddenException('You are not the intended recipient of this payment.');
    }
    // identityWallet: the caller's own registered wallet — persisted to recipient_address and
    // used as the retry target for the default claim-to-wallet flow. sweepDestination: where
    // funds actually go THIS time — overridden by an explicit destinationAddress (claim to an
    // external wallet) without ever touching the recipient's on-file identity.
    const wallet = await this.usersService.getSolanaWalletAddress(privyUserId);
    if (!wallet?.trim()) {
      throw new BadRequestException('No Solana wallet linked to your account. Please add a wallet in settings.');
    }
    let sweepDestination = wallet;
    if (opts?.destinationAddress?.trim()) {
      const dest = opts.destinationAddress.trim();
      if (!isValidSolanaAddress(dest)) {
        throw new BadRequestException('Invalid destination address.');
      }
      sweepDestination = dest;
    }
    // "Claim in Naira" — resolve the recipient's default PAJ Cash bank account server-side
    // (never trust a client-supplied address for this path) and sweep straight to its
    // abstracted wallet_address instead of the recipient's own wallet. PAJ auto-converts and
    // pays out to the linked bank account once the USDC lands there — no PAJ order needed.
    let nairaBankAccountId: string | undefined;
    let nairaLooftaFeeUsdc: number | undefined;
    if (opts?.claimToNaira) {
      const defaultAccount = await this.pajCashBank.getDefaultAccount(privyUserId);
      if (!defaultAccount) {
        throw new BadRequestException('No default Naira payout account set up.');
      }
      if (!defaultAccount.wallet_address) {
        // setDefaultAccount heals this on promote-to-default, so reaching here means either the
        // healing re-registration genuinely failed, or is_default was set some other way. Either
        // way, retrying setDefaultAccount is the fix — surface a distinct, actionable message.
        throw new BadRequestException('Your default bank account needs to be reconnected — please set it as default again to refresh it.');
      }
      sweepDestination = defaultAccount.wallet_address;
      nairaBankAccountId = defaultAccount.id;
      nairaLooftaFeeUsdc = computeLooftaFeeUsdc(parseFloat(String(claim.amount || '0')));
      this.logger.log(
        `Claim ${claimId}: [MONEY] claim-to-Naira — routing payout to PAJ abstracted wallet_address=${sweepDestination} ` +
        `(bankAccountId=${nairaBankAccountId}, looftaFeeUsdc=${nairaLooftaFeeUsdc})`,
      );
    }

    // Lock the recipient identity for the duration of this claim attempt — otherwise the
    // sender's "edit recipient" action (updateClaimRecipient) could overwrite recipient_address
    // in the window between reading `ra` above and committing the resolved wallet below (the
    // sweep call this guards can run for up to BURNER_INBOUND_INLINE_MAX_MS). updateClaimRecipient
    // now allows editing a registered recipient too (not just pending ones), so this must engage
    // for both — skipping it for registered recipients was only ever safe while they were
    // uneditable in the first place.
    const usesRecipientLock = isPendingEmail || isPendingUsername || isPendingSocial || isRegisteredRecipient;
    let recipientLockHeld = false;
    if (usesRecipientLock) {
      const lockCutoff = this.recipientClaimLockStaleCutoffIso();
      const { data: lockedRows, error: lockError } = await this.supabaseService.payments
        .update({ recipient_claim_lock_at: new Date().toISOString() })
        .eq('id', claimId)
        .eq('recipient_address', ra)
        .or(`recipient_claim_lock_at.is.null,recipient_claim_lock_at.lt.${lockCutoff}`)
        .select('id');
      if (lockError && this.isMissingColumnError(lockError)) {
        this.logger.warn(`Claim ${claimId}: recipient_claim_lock_at column missing (migration not deployed yet) — proceeding without the recipient-claim lock`);
      } else if (lockError) {
        this.logger.error(`Claim ${claimId}: failed to acquire recipient-claim lock:`, lockError);
        throw new BadRequestException('Failed to start claim, please try again.');
      } else if (!lockedRows?.length) {
        throw new BadRequestException('This payment is currently being claimed or its recipient was just edited. Please refresh and try again.');
      } else {
        recipientLockHeld = true;
      }
    }

    // Persist that the verified recipient actually asked to claim this, and how — the cron sweep
    // retry (cronSweepPendingBurners) only resumes claims where this is set, so a funded-but-
    // never-claimed burner never gets auto-delivered to a recipient who hasn't chosen anything.
    // Stamp the fully-RESOLVED sweepDestination (not just the raw destinationAddress opt) — for
    // claimToNaira this is the PAJ abstracted wallet_address, not the recipient's own wallet.
    // Getting this wrong sends a stuck/retried claim to the wrong place: a real incident (claim
    // 3d05bc19) swept to the recipient's own wallet on cron retry instead of their bank account,
    // because this used to only ever record raw destinationAddress and left claimToNaira as null,
    // and cronSweepPendingBurners falls back to the recipient's own wallet when this is null.
    // Best-effort: never block the claim itself on this bookkeeping write.
    await this.supabaseService.payments
      .update({
        claim_requested_at: new Date().toISOString(),
        claim_requested_privately: opts?.claimPrivately ?? false,
        claim_requested_destination: sweepDestination !== wallet ? sweepDestination : null,
        claim_requested_naira_fee_usdc: nairaLooftaFeeUsdc ?? null,
      })
      .eq('id', claimId)
      .then(
        () => {},
        (e: unknown) => this.logger.warn(`Claim ${claimId}: failed to stamp claim_requested_at (non-fatal): ${String(e)}`),
      );

    try {
      // Attempt sweep before writing recipient_address — if sweep throws (e.g. fee payer has no SOL)
      // we must not have overwritten the PENDING_EMAIL/PENDING_USERNAME address, otherwise the user
      // cannot retry because the pending-claim detection no longer matches.
      const { sweepTxHash, sweptAmount, feeAmountUsdc, deliveredPrivately } = await this.sweepClaimBurnerToWallet(
        claimId, claim, sweepDestination, { claimPrivately: opts?.claimPrivately, looftaFeeUsdc: nairaLooftaFeeUsdc },
      );

      // Sweep didn't throw — safe to commit the resolved wallet to DB. Always the caller's own
      // identity wallet (`wallet`), never `sweepDestination` — claiming to an external address
      // must never overwrite the recipient's own on-file identity.
      if (isPendingEmail || isPendingUsername || isPendingSocial) {
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

      if (sweepTxHash) {
        await this.updateStatus(claimId, 'SUCCESS', {
          recipientSwept: true,
          deliveredPrivately,
          nairaClaim: nairaBankAccountId ? { bankAccountId: nairaBankAccountId, feeAmountUsdc: feeAmountUsdc ?? 0 } : undefined,
        }, privyUserId);
        this.notifyRecipientAfterPayment(claimId);
        if (nairaBankAccountId) {
          // Best-effort — this only powers the recipient's withdrawal-history visibility, never
          // block/fail an already-succeeded on-chain claim on it.
          this.pajCashOrders.recordNairaClaimOrder({
            userId: privyUserId,
            bankAccountId: nairaBankAccountId,
            walletAddress: sweepDestination,
            amountUsdc: parseFloat(sweptAmount || '0'),
            looftaFeeUsdc: feeAmountUsdc ?? 0,
            sweepTxHash,
          }).catch((e) => this.logger.warn(`Claim ${claimId}: recordNairaClaimOrder failed (non-fatal): ${(e as Error)?.message}`));
        }
        this.logger.log(`Claim ${claimId}: sweep completed immediately, marked SUCCESS`);
      } else if (claimStatus === 'SUCCESS') {
        // Status was already SUCCESS (prematurely set by sender) and burner is now empty —
        // the sweep either just ran successfully elsewhere, or funds haven't arrived yet.
        // Don't downgrade; schedule a background retry to catch late-arriving funds.
        this.logger.log(`Claim ${claimId}: burner empty but status already SUCCESS — scheduling background retry`);
        if (claimBurnerAddress) {
          this.scheduleBackgroundSweepRetry(claimId, sweepDestination, privyUserId, { claimPrivately: opts?.claimPrivately, looftaFeeUsdc: nairaLooftaFeeUsdc });
        }
      } else {
        // Funds still in-flight on MagicBlock private leg (devnet: random delay up to ~15 min). Mark
        // PRIVATE_TRANSFER_PENDING and retry sweep until getBurnerInboundBackgroundMaxMs().
        await this.updateStatus(claimId, 'PRIVATE_TRANSFER_PENDING', undefined, privyUserId);
        this.logger.log(`Claim ${claimId}: burner empty at claim time — marked PRIVATE_TRANSFER_PENDING, scheduling background sweep retry`);
        const rawForRetry = claim as { claim_burner_address?: string | null };
        if (rawForRetry.claim_burner_address) {
          this.scheduleBackgroundSweepRetry(claimId, sweepDestination, privyUserId, { claimPrivately: opts?.claimPrivately, looftaFeeUsdc: nairaLooftaFeeUsdc });
        }
      }

      this.logger.log(`Claim ${claimId} claimed by recipient (privy ${privyUserId})`);
      return { claimed: true, sweepTxHash, sweptAmount, feeAmountUsdc };
    } finally {
      if (recipientLockHeld) {
        await this.supabaseService.payments
          .update({ recipient_claim_lock_at: null })
          .eq('id', claimId)
          .then(
            () => {},
            (e: unknown) => this.logger.warn(`Claim ${claimId}: failed to release recipient-claim lock: ${e}`),
          );
      }
    }
  }

  /**
   * Sender action: fix a typo'd or wrong recipient on a payment they sent — whether the current
   * recipient is still unregistered (PENDING_EMAIL / PENDING_USERNAME / PENDING_SOCIAL) or already
   * resolved to a registered account at creation (e.g. a Telegram/username/email handle that
   * immediately matched an existing user) — only while it's genuinely still unclaimed. Mirrors
   * lottery.service.ts updateGiftRecipient. Blocked once claim_requested_at is set (the recipient
   * has definitively started claiming — see claimAsRecipient) or once claimed (status SUCCESS) or
   * mid-claim (recipient_claim_lock_at): the identity that claimed it, or is claiming it, is locked
   * in. claim_requested_at is the load-bearing check here rather than status/lock alone — the
   * claim lock releases as soon as claimAsRecipient's initial call returns, but its background
   * sweep retry (scheduleBackgroundSweepRetry) can still be resolving the recipient's real wallet
   * afterward while status briefly sits at PRIVATE_TRANSFER_PENDING; claim_requested_at, once set,
   * never gets cleared, so it closes that window regardless of the lock/status snapshot.
   */
  async updateClaimRecipient(opts: {
    claimId: string;
    userId: string;
    recipientType: 'email' | 'username' | 'social';
    recipientIdentifier: string;
    /** Required when recipientType is 'social' — which platform the handle belongs to. */
    platform?: SocialPlatform | 'twitter';
  }): Promise<{ ok: boolean }> {
    const result = await this.fetchRawRow(opts.claimId);
    if (!result) throw new NotFoundException('Payment not found.');
    if (result.table !== 'payments') {
      throw new BadRequestException('This payment cannot be edited.');
    }
    const claim = result.row as {
      created_by?: string | null;
      status?: string;
      recipient_address?: string | null;
      recipient_claim_lock_at?: string | null;
      claim_requested_at?: string | null;
    };
    if (!claim.created_by || claim.created_by !== opts.userId) {
      throw new ForbiddenException('Only the sender can edit the recipient.');
    }
    if ((claim.status || '').toUpperCase() === 'CANCELLED') {
      throw new BadRequestException('This payment was cancelled and can no longer be edited.');
    }
    const ra = (claim.recipient_address || '').trim();
    // Editable whether the current recipient is still pending (unregistered) OR already resolved
    // to a registered account (e.g. a Telegram/username/email handle that matched an existing
    // user immediately at creation) — the only things that actually lock this out are the recipient
    // having ever actually requested a claim, the claim having paid out, or the recipient being
    // mid-claim right now. A resolved recipient has no PENDING_* prefix to react to a change in
    // identifier the same way a pending one does, but that's fine: this always writes a fresh
    // PENDING_* sentinel below, so editing a resolved recipient correctly turns the claim pending
    // again on the corrected identifier.
    if (claim.claim_requested_at) {
      throw new BadRequestException('The recipient has already started claiming this payment and can no longer be edited.');
    }
    if ((claim.status || '').toUpperCase() === 'SUCCESS') {
      throw new BadRequestException('This payment has already been claimed and can no longer be edited.');
    }
    if (this.isRecipientClaimLockActive(claim.recipient_claim_lock_at)) {
      throw new BadRequestException('The recipient is currently claiming this payment — try again in a minute.');
    }

    let recipientAddress: string;
    const extraFields: Record<string, unknown> = {};
    if (opts.recipientType === 'email') {
      const cleanEmail = opts.recipientIdentifier.trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) throw new BadRequestException('A valid email is required.');
      recipientAddress = `${ClaimsService.PENDING_EMAIL_PREFIX}${cleanEmail}`;
      extraFields.recipient_email = cleanEmail;
      extraFields.recipient_username = null;
    } else if (opts.recipientType === 'username') {
      const cleanUsername = opts.recipientIdentifier.trim().replace(/^@/, '').toLowerCase();
      if (!cleanUsername) throw new BadRequestException('A valid username is required.');
      recipientAddress = `${ClaimsService.PENDING_USERNAME_PREFIX}${cleanUsername}`;
      extraFields.recipient_username = cleanUsername;
      extraFields.recipient_email = null;
    } else {
      const platform = opts.platform;
      if (!platform || !['discord', 'github', 'telegram', 'twitter'].includes(platform)) {
        throw new BadRequestException('A valid platform (discord, github, telegram, or twitter) is required.');
      }
      const cleanHandle = opts.recipientIdentifier.trim().replace(/^@/, '').toLowerCase();
      if (!cleanHandle) throw new BadRequestException('A valid handle is required.');
      recipientAddress = `${ClaimsService.PENDING_SOCIAL_PREFIX}${platform}:${cleanHandle}`;
      extraFields.recipient_username = null;
      extraFields.recipient_email = null;
    }

    // Re-check at write time, not just the read above — the recipient could start (or finish)
    // claiming in the gap between this method's read and this update. Both conditions —
    // recipient_address unchanged, lock not (newly) held — make the update itself a no-op if
    // that happens; .select() + a length check turns that no-op into a real error instead of
    // silently reporting success while nothing actually changed.
    const lockCutoff = this.recipientClaimLockStaleCutoffIso();
    let { data: updatedRows, error } = await this.supabaseService.payments
      .update({ recipient_address: recipientAddress, ...extraFields })
      .eq('id', opts.claimId)
      .eq('recipient_address', ra)
      .or(`recipient_claim_lock_at.is.null,recipient_claim_lock_at.lt.${lockCutoff}`)
      .select('id');
    if (error && this.isMissingColumnError(error)) {
      // recipient_claim_lock_at migration not deployed yet — retry without the lock guard
      // clause rather than blocking every recipient edit on it.
      this.logger.warn(`Claim ${opts.claimId}: recipient_claim_lock_at column missing (migration not deployed yet) — updating recipient without the lock guard`);
      ({ data: updatedRows, error } = await this.supabaseService.payments
        .update({ recipient_address: recipientAddress, ...extraFields })
        .eq('id', opts.claimId)
        .eq('recipient_address', ra)
        .select('id'));
    }
    if (error) {
      this.logger.error(`Claim ${opts.claimId}: failed to update recipient:`, error);
      throw new BadRequestException('Failed to update recipient.');
    }
    if (!updatedRows?.length) {
      throw new BadRequestException('This payment is currently being claimed and can no longer be edited. Please refresh and try again.');
    }

    // The corrected recipient never got a valid notification for the original (typo'd) value —
    // clear the per-claim de-dupe so notifyRecipientAfterPayment actually sends this time, but
    // only once the sender has actually paid (matches the controller's own notify gating).
    const statusUpper = (claim.status || '').toUpperCase();
    if (['SUCCESS', 'PRIVATE_TRANSFER_PENDING'].includes(statusUpper)) {
      this.emailSentAt.delete(opts.claimId);
      this.notifyRecipientAfterPayment(opts.claimId);
    }

    this.logger.log(`Claim ${opts.claimId}: recipient updated by sender ${opts.userId}`);
    return { ok: true };
  }

  /**
   * Poll burner ATA every few seconds until funds arrive (payer→burner private leg), then sweep to recipient.
   */
  private scheduleBackgroundSweepRetry(
    claimId: string,
    wallet: string,
    privyUserId: string,
    opts?: { claimPrivately?: boolean; looftaFeeUsdc?: number },
  ): void {
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
        const { sweepTxHash, sweptAmount, deliveredPrivately } = await this.sweepClaimBurnerToWallet(claimId, freshClaim, wallet, opts);
        if (sweepTxHash) {
          let nairaClaim: { bankAccountId: string; feeAmountUsdc: number } | undefined;
          if (opts?.looftaFeeUsdc != null) {
            const bankAccount = await this.pajCashBank.getAccountByWalletAddress(wallet).catch(() => null);
            if (bankAccount) {
              nairaClaim = { bankAccountId: bankAccount.id, feeAmountUsdc: opts.looftaFeeUsdc };
              this.pajCashOrders.recordNairaClaimOrder({
                userId: privyUserId,
                bankAccountId: bankAccount.id,
                walletAddress: wallet,
                amountUsdc: parseFloat(sweptAmount || '0'),
                looftaFeeUsdc: opts.looftaFeeUsdc,
                sweepTxHash,
              }).catch((e) => this.logger.warn(`Claim ${claimId}: recordNairaClaimOrder failed (non-fatal): ${(e as Error)?.message}`));
            }
          }
          await this.updateStatus(claimId, 'SUCCESS', { recipientSwept: true, deliveredPrivately, nairaClaim }, privyUserId);
          this.notifyRecipientAfterPayment(claimId);
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

  /** Poll on-chain burner USDC ATA until balance >= minUnits or timeout (payer→burner delivery). */
  private async pollBurnerAtaUntilPositive(
    claimId: string,
    conn: Connection,
    burnerAta: PublicKey,
    maxWaitMs: number,
    minUnits: bigint = BigInt(1),
  ): Promise<bigint> {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt += 1;
      try {
        const acc = await getAccount(conn, burnerAta);
        if (acc.amount >= minUnits) {
          this.logger.log(
            `Claim ${claimId}: burner ATA credited ${acc.amount} base units (≥${minUnits} expected, poll attempt ${attempt}, waited ≤${maxWaitMs}ms)`,
          );
          return acc.amount;
        }
        if (acc.amount > BigInt(0)) {
          this.logger.log(
            `Claim ${claimId}: burner ATA partially funded ${acc.amount}/${minUnits} base units (split in transit, attempt ${attempt})`,
          );
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
    const { sweepTxHash, sweptAmount, deliveredPrivately } = await this.sweepClaimBurnerToWallet(claimId, claim, wallet);
    if (sweepTxHash) {
      await this.updateStatus(claimId, 'SUCCESS', { recipientSwept: true, deliveredPrivately }, privyUserId);
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

  /**
   * Poll until confirmed OR the blockhash's lastValidBlockHeight is exceeded.
   * Returns true if confirmed, false if expired (caller should rebuild + resend).
   */
  private async pollUntilConfirmedOrExpired(
    conn: Connection,
    signature: string,
    lastValidBlockHeight: number,
    intervalMs = 1_500,
  ): Promise<boolean> {
    while (true) {
      const [{ value: statuses }, blockHeight] = await Promise.all([
        conn.getSignatureStatuses([signature], { searchTransactionHistory: true }),
        conn.getBlockHeight('confirmed'),
      ]);
      const status = statuses[0];
      if (status?.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return true;
      if (blockHeight > lastValidBlockHeight) return false;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /**
   * Query recent network prioritization fees for the accounts a transaction will touch, so the
   * first send attempt goes out competitively priced instead of relying on the retry-with-doubled-fee
   * path in sendAndConfirmWithRebuild to eventually land. Falls back to `floor` if the RPC call
   * fails or returns no data (e.g. brand-new accounts with no recent fee history).
   */
  private async estimatePriorityFeeMicroLamports(
    conn: Connection,
    writableAccounts: PublicKey[],
    floor: number,
  ): Promise<number> {
    try {
      const fees = await conn.getRecentPrioritizationFees({ lockedWritableAccounts: writableAccounts });
      if (!fees.length) return floor;
      const sorted = fees.map((f) => f.prioritizationFee).sort((a, b) => a - b);
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      return Math.max(floor, p75);
    } catch {
      return floor;
    }
  }

  /**
   * Send a transaction and confirm it with blockhash-expiry-aware retries.
   * If the blockhash window expires before confirmation, re-signs with a fresh blockhash and retries.
   * The transaction must have its instructions already set; blockhash/feePayer/signatures are managed here.
   *
   * The first attempt uses a network-informed priority fee (see estimatePriorityFeeMicroLamports)
   * instead of a flat base fee, and each retry still escalates from there. Without this, every
   * attempt went out at a fixed price regardless of congestion — under real congestion a
   * transaction could sit unconfirmed for the entire ~60-90s blockhash window before the expiry
   * check above even fires, then retry at a fee still too low and stall again. This is why
   * production sweeps were observed taking 60s+ and multiple attempts even for a single simple
   * transfer: it wasn't bad luck, it was structurally underpriced every single time.
   */
  private async sendAndConfirmWithRebuild(
    conn: Connection,
    tx: Transaction,
    feePayer: PublicKey,
    signers: Keypair[],
    label: string,
    maxAttempts = 3,
  ): Promise<string> {
    const BASE_PRIORITY_FEE_MICROLAMPORTS = 20_000;
    // Covers a transfer (~5k CU) plus an optional ATA-creation instruction (~25-30k CU) with
    // comfortable headroom, without setting the limit so high it inflates the fee for no reason.
    const COMPUTE_UNIT_LIMIT = 60_000;
    const writableAccounts = Array.from(
      new Set([
        feePayer.toBase58(),
        ...tx.instructions.flatMap((ix) => ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey.toBase58())),
      ]),
    ).map((s) => new PublicKey(s));
    const initialPriorityFeeMicroLamports = await this.estimatePriorityFeeMicroLamports(
      conn,
      writableAccounts,
      BASE_PRIORITY_FEE_MICROLAMPORTS,
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Drop any compute-budget instructions from a prior attempt before adding this attempt's
      // (escalated) ones — otherwise they'd stack up across retries.
      tx.instructions = tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
      const priorityFeeMicroLamports = initialPriorityFeeMicroLamports * 2 ** (attempt - 1);
      tx.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports }),
        ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
      );
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = feePayer;
      tx.signatures = [];
      for (const signer of signers) tx.partialSign(signer);
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 });
      this.logger.log(
        `[${label}] attempt ${attempt}/${maxAttempts} sent ${sig.slice(0, 8)}… (validUntilBlock=${lastValidBlockHeight}, priorityFee=${priorityFeeMicroLamports}µLamports/CU)`,
      );
      const confirmed = await this.pollUntilConfirmedOrExpired(conn, sig, lastValidBlockHeight);
      if (confirmed) {
        this.logger.log(`[${label}] confirmed: ${sig.slice(0, 8)}…`);
        return sig;
      }
      this.logger.warn(`[${label}] blockhash expired before confirmation, rebuilding (attempt ${attempt + 1}/${maxAttempts})`);
    }
    throw new Error(`Transaction failed to confirm after ${maxAttempts} blockhash windows`);
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
  /**
   * Burner-signed MagicBlock private transfer, burner -> destination. Fully server-side signing
   * (backend already custodies the burner key) — no client wallet round-trip needed. Used for:
   *  - cross-chain deposits (always private, fee pre-funded into the burner — feeOnSender: true)
   *  - "claim privately": recipient upgrading a publicly-sent payment to a private claim,
   *    paying the fee out of the claimed amount (feeOnSender: false)
   */
  private async sweepClaimBurnerPrivately(
    claimId: string,
    claim: Claim,
    destination: string,
    burnerKeypair: Keypair,
    conn: Connection,
    opts: { feeOnSender: boolean },
  ): Promise<{ sweepTxHash?: string; sweptAmount?: string; feeAmountUsdc?: number }> {
    const burnerAta = await getAssociatedTokenAddress(this.usdcMint, burnerKeypair.publicKey);

    // Wait for full delivery into the burner before forwarding.
    const amountUsd = parseFloat(String(claim.amount || '0'));
    const baseUnits = Math.round(amountUsd * 1_000_000);
    let balance = BigInt(0);
    try { balance = (await getAccount(conn, burnerAta)).amount; } catch { /* not yet */ }
    if (balance < BigInt(baseUnits)) {
      balance = await this.pollBurnerAtaUntilPositive(claimId, conn, burnerAta, BURNER_INBOUND_INLINE_MAX_MS, BigInt(baseUnits));
    }
    if (balance === BigInt(0)) {
      this.logger.log(`[PrivateSweep] ${claimId}: USDC not yet in burner — funds still in flight`);
      return {};
    }

    const relayFeeUnits = Math.round(MAGICBLOCK_GAS_USDC * 1_000_000);
    // feeOnSender=true (exact-out, e.g. cross-chain): send the clean amount, MagicBlock grosses
    //   up its own internal debit so the destination nets exactly baseUnits — the fee was
    //   already pre-funded into the burner separately (handleCrossChainDeposit's gross-up).
    // feeOnSender=false (exact-in, "claim privately"): send baseUnits minus the relay fee —
    //   the fee comes out of what the recipient set out to claim.
    const transferUnits = opts.feeOnSender ? baseUnits : baseUnits - relayFeeUnits;
    // Balance check: exact-out needs the rough gross-debit estimate (MagicBlock computes its
    // own internal gross-up); exact-in only ever needs the plain baseUnits already confirmed above.
    const estimatedGrossUnits = opts.feeOnSender ? estimateMagicblockGrossUp(baseUnits) : baseUnits;
    const cluster = isSolanaLocalhostFromConfig(this.configService) ? 'localhost'
      : isSolanaDevnetFromConfig(this.configService) ? 'devnet' : 'mainnet';

    this.logger.log(
      `[PrivateSweep] ${claimId}: balance=${balance} baseUnits=${baseUnits} transferUnits=${transferUnits} feeOnSender=${opts.feeOnSender} cluster=${cluster} destination=${destination.slice(0, 8)}…`,
    );

    if (BigInt(estimatedGrossUnits) > balance) {
      this.logger.warn(`[PrivateSweep] ${claimId}: balance ${balance} < estimatedGrossUnits ${estimatedGrossUnits} — aborting, funds may not be fully delivered yet`);
      return {};
    }

    // Loofta's cut only on the exact-in ("claim privately") branch — feeOnSender=true is the
    // cross-chain deposit sweep, whose burner is pre-funded elsewhere for exactly MagicBlock's
    // own gross-up; adding platformFeeBps there too would grow the required gross-up beyond what
    // was pre-funded and could strand the sweep (balance-check abort above). Exact-in has no such
    // pre-funding assumption — the fee just comes out of what's being delivered, same as today.
    // (Currently disabled altogether — see ENABLE_SINGLE_PAYMENT_PLATFORM_FEE.) Must be the fee
    // collector's USDC ATA, not its wallet address — see the note on the build-leg above.
    const singlePaymentPlatformFeeAccount = (ENABLE_SINGLE_PAYMENT_PLATFORM_FEE && !opts.feeOnSender && this.solanaSponsor.getFeePayerAddress())
      ? (await getAssociatedTokenAddress(this.usdcMint, new PublicKey(this.solanaSponsor.getFeePayerAddress()!))).toBase58()
      : null;

    const txResponse = await requestMagicblockPrivateTransfer({
      from: burnerKeypair.publicKey.toBase58(),
      to: destination.trim(),
      mint: this.usdcMint.toBase58(),
      amount: transferUnits,
      cluster,
      exactOut: opts.feeOnSender,
      gasless: true,
      ...(singlePaymentPlatformFeeAccount
        ? { platformFeeBps: SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS, platformFeeAccount: singlePaymentPlatformFeeAccount }
        : {}),
    });

    // MagicBlock can return either a legacy or a v0 (versioned) message depending on the
    // transfer shape (e.g. a multi-part split forces v0) — try legacy first, fall back to
    // versioned. Mirrors the same dual-path handling in usePerPrivateTransfer.ts (frontend).
    const txBytes = Buffer.from(txResponse.transactionBase64, 'base64');
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    let legacyTx: Transaction | null = null;
    let versionedTx: VersionedTransaction | null = null;
    try {
      legacyTx = Transaction.from(txBytes);
    } catch {
      versionedTx = VersionedTransaction.deserialize(txBytes);
    }
    if (legacyTx) {
      if (feePayerKp) {
        legacyTx.feePayer = feePayerKp.publicKey;
        legacyTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
      }
      legacyTx.partialSign(burnerKeypair);
      if (feePayerKp) legacyTx.partialSign(feePayerKp);
    } else if (versionedTx) {
      // gasless: true means MagicBlock's own validator is typically already the fee payer and
      // has pre-signed server-side — only sign with whichever of our own keys are actually
      // required signers (passing an extra, non-required key would throw).
      const requiredKeys = new Set(
        versionedTx.message.staticAccountKeys
          .slice(0, versionedTx.message.header.numRequiredSignatures)
          .map((k) => k.toBase58()),
      );
      const signers = [burnerKeypair, feePayerKp].filter(
        (kp): kp is Keypair => !!kp && requiredKeys.has(kp.publicKey.toBase58()),
      );
      versionedTx.sign(signers);
    }

    // Submit — ephemeral rollup if MagicBlock requires it, otherwise base chain
    let sendConn = conn;
    if (txResponse.sendTo === 'ephemeral') {
      const ec = await this.getEphemeralConnectionForBurner(burnerKeypair);
      if (ec) sendConn = ec;
    }
    const serialized = legacyTx
      ? legacyTx.serialize({ requireAllSignatures: false })
      : versionedTx!.serialize();
    const sig = await sendConn.sendRawTransaction(serialized, { skipPreflight: true });
    await this.pollConfirmTransaction(conn, sig);
    this.logger.log(`[PrivateSweep] ${claimId}: PER transfer confirmed tx=${sig}`);

    // Mark how this claim was fulfilled — independent of is_private (how it was funded).
    await this.supabaseService.payments.update({ claimed_privately: true }).eq('id', claimId).then(
      () => {},
      (e: unknown) => this.logger.warn(`[PrivateSweep] ${claimId}: failed to stamp claimed_privately (non-fatal): ${String(e)}`),
    );

    // Sweep dust (fee + gas pre-paid into burner) to fee-payer wallet AND close the burner's
    // now-finished ATA (~0.002 SOL rent → fee payer) — fire-and-forget. The close used to be
    // missing on this private/cross-chain path (only the public sweep closed), which a
    // 2026-07-29 rent audit measured as ~11% of terminal claim burners still holding their
    // rent. The MagicBlock transfer above is built by MagicBlock's relay so we can't append
    // the close there — this follow-up tx (which we do build) is the right place.
    const feePayerAddress = this.solanaSponsor.getFeePayerAddress();
    if (feePayerKp && feePayerAddress) {
      void (async () => {
        try {
          await new Promise((r) => setTimeout(r, 4_000));
          const remaining = await getAccount(conn, burnerAta).catch(() => null);
          if (!remaining) return; // ATA already closed or unreadable — nothing to reclaim
          const dust = remaining.amount ?? BigInt(0);
          const dustTx = new Transaction();
          if (dust > BigInt(0)) {
            const feePayerPubkey = new PublicKey(feePayerAddress);
            const feePayerAta = await getAssociatedTokenAddress(this.usdcMint, feePayerPubkey);
            try { await getAccount(conn, feePayerAta); } catch {
              dustTx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, feePayerAta, feePayerPubkey, this.usdcMint));
            }
            dustTx.add(createTransferInstruction(burnerAta, feePayerAta, burnerKeypair.publicKey, dust));
          }
          dustTx.add(createCloseAccountInstruction(burnerAta, feePayerKp.publicKey, burnerKeypair.publicKey));
          dustTx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
          dustTx.feePayer = feePayerKp.publicKey;
          dustTx.sign(burnerKeypair, feePayerKp);
          const dustSig = await conn.sendRawTransaction(dustTx.serialize(), { skipPreflight: true });
          this.logger.log(`[PrivateSweep] ${claimId}: dust swept (${dust} units) + burner ATA closed (rent → fee payer) tx=${dustSig}`);
        } catch (e) {
          this.logger.warn(`[PrivateSweep] ${claimId}: dust sweep/ATA close failed (non-fatal): ${String(e)}`);
        }
      })();
    }

    // Loofta's bps only applies to the exact-in branch here too, matching the platformFeeBps
    // scoping above — the cross-chain (feeOnSender=true) estimate stays MagicBlock-only.
    // (Currently disabled altogether — see ENABLE_SINGLE_PAYMENT_PLATFORM_FEE.)
    const estimatedMbVolumeFeeUnits = opts.feeOnSender
      ? (estimateMagicblockGrossUp(baseUnits) - baseUnits)
      : Math.ceil((baseUnits - relayFeeUnits) * (MAGICBLOCK_VOLUME_FEE_BPS + (ENABLE_SINGLE_PAYMENT_PLATFORM_FEE ? SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS : 0)) / 10_000);
    const feeAmountUsdc = opts.feeOnSender ? 0 : (estimatedMbVolumeFeeUnits + relayFeeUnits) / 1_000_000;

    return { sweepTxHash: sig, sweptAmount: (transferUnits / 1_000_000).toFixed(6), feeAmountUsdc };
  }

  /** Anti-drain guard for sponsor-paid ATA creation — shared with lottery.service.ts and
   *  private-balance-processor.service.ts (see @/common/ata-sponsorship-guard). Kept as a thin
   *  delegate here so this file's existing call sites don't all need touching. */
  private guardAtaSponsorship(walletAddress: string, mint: string, context: string): Promise<boolean> {
    return guardAtaSponsorship(this.supabaseService, walletAddress, mint, context, this.emailService);
  }

  /**
   * Cron backstop reclaiming ATA rent (+ residual fee/gas dust) from TERMINAL claim burners —
   * the inline closes (public sweep, private-sweep dust tx, reclaimByCreator) handle the happy
   * paths going forward; this catches anything they missed plus the historical backlog from
   * before those closes existed (rent audit 2026-07-29: ~11% of terminal claim burners still
   * held their ~0.002 SOL rent).
   *
   * Only SUCCESS/CANCELLED rows: both mean the user's money already left the burner, so any
   * residue is fee/gas prepayment surplus that belongs to the fee wallet — the same rationale as
   * the existing private-sweep dust sweep. OPEN funded-but-unclaimed burners hold user money and
   * are never touched.
   *
   * Requires migration 20260729130000 (burner_reclaimed_at on payments) — until it's applied the
   * query fails with "column does not exist" and this logs + skips harmlessly.
   */
  async cronReclaimFinishedClaimBurners(): Promise<void> {
    if (!this.canDecryptBurnerSecret()) return;
    const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
    if (!feePayerKp) return;

    const { data: rows, error } = await this.supabaseService.payments
      .select('id, burner_address, burner_encrypted_secret')
      .in('status', ['SUCCESS', 'CANCELLED'])
      .not('burner_address', 'is', null)
      .not('burner_encrypted_secret', 'is', null)
      .eq('is_devnet', false)
      .is('burner_reclaimed_at', null)
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) {
      this.logger.warn(`[BurnerReclaim] query failed (migration 20260729130000 applied yet?): ${error.message}`);
      return;
    }
    if (!rows?.length) return;

    const conn = this.solanaSponsor.getConnectionForCluster('mainnet');
    for (const row of rows) {
      try {
        const secretKey = this.decryptClaimBurnerSecret(row.burner_encrypted_secret as string, row.burner_address as string);
        const burnerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
        const result = await reclaimBurnerFunds(conn, burnerKeypair, feePayerKp);
        await this.supabaseService.payments
          .update({ burner_reclaimed_at: new Date().toISOString() })
          .eq('id', row.id);
        if (result.signature) {
          this.logger.log(`[BurnerReclaim] claim ${row.id}: reclaimed burner ${String(row.burner_address).slice(0, 8)}… (${result.closedTokenAccounts} ATA(s) closed)`);
        }
      } catch (e: any) {
        this.logger.warn(`[BurnerReclaim] claim ${row.id}: failed (will retry next cron): ${e?.message ?? e}`);
      }
    }
  }

  private async sweepClaimBurnerToWallet(
    claimId: string,
    claim: Claim & { recipient_address?: string },
    destination: string,
    opts?: { claimPrivately?: boolean; looftaFeeUsdc?: number },
  ): Promise<{ sweepTxHash?: string; sweptAmount?: string; feeAmountUsdc?: number; deliveredPrivately?: boolean }> {
    const rawClaim = claim as { claim_burner_address?: string | null; claim_burner_encrypted_secret?: string | null };
    const burnerAddr = (rawClaim.claim_burner_address || '').trim();
    let sweepTxHash: string | undefined;
    let sweptAmount: string | undefined;
    let feeAmountUsdc: number | undefined;
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
      // `await` (not a bare `return`) is required here — a returned-but-unawaited promise's
      // rejection bypasses this function's own try/catch entirely and reaches the caller as a
      // raw, unwrapped error instead of a clean BadRequestException (a real bug this once was).
      const isCrossChain = await this.isCrossChainPayment(claimId);
      if (isCrossChain) {
        const result = await this.sweepClaimBurnerPrivately(claimId, claim, destination, burnerKeypair, conn, { feeOnSender: true });
        return { ...result, deliveredPrivately: true };
      }

      // Recipient chose to upgrade this publicly-sent payment to a private claim — burner never
      // reaches this branch already-private (sender-chosen-private payments deliver directly and
      // never touch a burner), so this is always the "fee comes out of the claim" case.
      if (opts?.claimPrivately) {
        const result = await this.sweepClaimBurnerPrivately(claimId, claim, destination, burnerKeypair, conn, { feeOnSender: false });
        return { ...result, deliveredPrivately: true };
      }

      // Always attempt PER withdraw first. This also recovers older claims that
      // were incorrectly marked non-private while funds are still in PER deposit.
      const perWithdraw = await this.tryWithdrawPerDepositToBurnerAta(
        claimId,
        burnerKeypair,
        conn,
        String(claim.amount || '0'),
      );
      const amountUsdForSweep = parseFloat(String(claim.amount || '0'));
      const expectedUnits = BigInt(Math.round(amountUsdForSweep * 1_000_000));
      const burnerAta = await getAssociatedTokenAddress(claimMint, burnerKeypair.publicKey);
      let balance = BigInt(0);
      try {
        const acc = await getAccount(conn, burnerAta);
        balance = acc.amount;
      } catch {
        // ATA may not exist yet
      }
      if (balance < expectedUnits) {
        this.logger.log(
          `Claim ${claimId}: burner ATA balance=${balance} < expected=${expectedUnits} — polling for full delivery (up to ${BURNER_INBOUND_INLINE_MAX_MS}ms)…`,
        );
        balance = await this.pollBurnerAtaUntilPositive(claimId, conn, burnerAta, BURNER_INBOUND_INLINE_MAX_MS, expectedUnits);
      }
      this.logger.log(
        `Claim ${claimId}: [MONEY] burner=${burnerKeypair.publicKey.toBase58().slice(0, 8)} balance=${balance} expected=${expectedUnits} perAttempted=${perWithdraw.attempted} perSuccess=${perWithdraw.success} -> recipient ${destination.slice(0, 8)}...`,
      );
      if (balance >= expectedUnits) {
        // Direct SPL sweep: burner → recipient (public). Payer→burner was already private via MagicBlock.
        const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
        const recipientPubkey = new PublicKey(destination.trim());
        // allowOwnerOffCurve: true — a "claim in Naira" destination is PAJ's abstracted payout
        // address, which is program-derived (off-curve) rather than a real wallet. Without this,
        // getAssociatedTokenAddress throws TokenOwnerOffCurveError — an spl-token error class
        // constructed with no message, so it surfaced as "Claim transfer failed: . Please try
        // again." (real incident, claim 3d05bc19, 2026-07-28). Safe for normal on-curve wallets
        // too: this only skips a validation check, it doesn't change the derived ATA address.
        const recipientAta = await getAssociatedTokenAddress(claimMint, recipientPubkey, true);
        const sweepTx = new Transaction();
        // tokenAccountExists absorbs transient RPC blips with a couple of short retries before
        // concluding "genuinely doesn't exist" — a plain getAccount() try/catch would otherwise
        // mistake a rate-limited RPC call for a missing account, wrongly tripping the abuse guard
        // on a legitimate repeat-claim wallet on a false premise.
        if (!(await tokenAccountExists(conn, recipientAta))) {
          if (feePayerKp) {
            const allowed = await this.guardAtaSponsorship(
              recipientPubkey.toBase58(),
              claimMint.toBase58(),
              `claim:${claimId}`,
            );
            if (!allowed) {
              // Funds are untouched — still sitting in the burner — so this is safely retryable
              // by support, not a loss. Refusing here is what closes the create→close→repeat
              // sponsor-drain instead of paying rent for the same wallet's ATA a second time.
              throw new Error(
                'This wallet already received a sponsored token account once before and closed it. ' +
                  'Further free account creation is blocked to prevent abuse. Please contact support.',
              );
            }
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
        // Loofta fee ("claim in Naira" only, for now) — split the sweep into two transfer
        // instructions in the same transaction/signature rather than asking PAJ to deduct
        // anything: PAJ pays out 100% of whatever lands at `destination`. The fee payer's own
        // wallet doubles as the protocol-fee collector (same wallet as platformFeeAccount
        // elsewhere) — its USDC ATA is expected to already exist (see magicblock-private-transfer.ts)
        // but we create it if missing anyway, cheap insurance against a broadcast-time failure.
        const looftaFeeUnits = feePayerKp && opts?.looftaFeeUsdc
          ? BigInt(Math.round(opts.looftaFeeUsdc * 1_000_000))
          : BigInt(0);
        const netUnits = balance - looftaFeeUnits;
        if (looftaFeeUnits > BigInt(0) && feePayerKp) {
          const feeAta = await getAssociatedTokenAddress(claimMint, feePayerKp.publicKey);
          try {
            await getAccount(conn, feeAta);
          } catch {
            sweepTx.add(createAssociatedTokenAccountInstruction(feePayerKp.publicKey, feeAta, feePayerKp.publicKey, claimMint));
          }
          sweepTx.add(createTransferInstruction(burnerAta, feeAta, burnerKeypair.publicKey, looftaFeeUnits));
        }
        sweepTx.add(createTransferInstruction(burnerAta, recipientAta, burnerKeypair.publicKey, netUnits));
        // Reclaim the burner's own token-account rent (~0.002 SOL) back to the fee payer in the
        // same transaction — the transfers above always drain the burner ATA to exactly zero
        // (looftaFeeUnits + netUnits == balance), so it's safe to close right after. Burners are
        // single-use and never touched again, so this rent was otherwise gone for good; recovering
        // it directly offsets the ATA-creation costs the fee payer pays elsewhere in this same
        // function (recipient/fee ATA creation) instead of those being a pure one-way cost.
        if (feePayerKp) {
          sweepTx.add(createCloseAccountInstruction(burnerAta, feePayerKp.publicKey, burnerKeypair.publicKey));
        }
        const feePayerPubkey = feePayerKp?.publicKey ?? burnerKeypair.publicKey;
        const sweepSigners = feePayerKp ? [burnerKeypair, feePayerKp] : [burnerKeypair];
        // Guard: fee payer must have SOL or the tx will be silently dropped (causes "timed out" not "failed").
        const feePayerSolBalance = await conn.getBalance(feePayerPubkey).catch(() => 0);
        if (feePayerSolBalance < 10_000) {
          this.logger.warn(
            `Claim ${claimId}: fee payer ${feePayerPubkey.toBase58()} has insufficient SOL (${feePayerSolBalance} lamports) — cannot sweep`,
          );
          throw new Error('Network fee sponsorship is temporarily unavailable');
        }
        this.logger.log(
          `Claim ${claimId}: [SWEEP] direct SPL burner->recipient ${balance} base units (burner ${burnerKeypair.publicKey.toBase58().slice(0, 8)} → ${destination.slice(0, 8)}) feePayer=${feePayerPubkey.toBase58().slice(0, 8)} sol=${feePayerSolBalance}`,
        );
        const sig = await this.sendAndConfirmWithRebuild(conn, sweepTx, feePayerPubkey, sweepSigners, `sweep-${claimId.slice(0, 8)}`);
        this.logger.log(
          `Claim ${claimId}: [MONEY] ✅ swept ${balance} base-units USDC (${(Number(balance) / 1_000_000).toFixed(6)} USDC) burner=${burnerKeypair.publicKey.toBase58().slice(0, 8)} -> recipient=${destination.slice(0, 8)} tx=${sig}`,
        );
        sweepTxHash = sig;
        sweptAmount = (Number(netUnits) / 1_000_000).toFixed(6);
        if (looftaFeeUnits > BigInt(0)) feeAmountUsdc = Number(looftaFeeUnits) / 1_000_000;
      } else if (perWithdraw.attempted && !perWithdraw.success) {
        // PER deposit existed but we could not withdraw – do not silently succeed.
        throw new Error(
          `PER withdraw failed: ${perWithdraw.error ?? 'unknown'} | debug: ${(perWithdraw.debug ?? []).join(' | ')}`,
        );
      } else if (!perWithdraw.attempted) {
        // No PER deposit found and ATA is empty. Two very different situations look identical
        // here: funds never arrived yet, OR a previous sweep attempt already broadcast and landed
        // on-chain but this function threw afterward (e.g. a flaky confirmation check) before ever
        // returning sweepTxHash — the caller then never marks SUCCESS, and every later retry sees
        // the same "empty" balance and can never tell the difference on its own (see the incident
        // on claim ~b665e249, 2026-07-24: recipient had the exact expected amount on-chain while
        // this stayed PRIVATE_TRANSFER_PENDING indefinitely). Check the burner's own recent history
        // for an already-succeeded outbound transfer of the expected amount before giving up.
        const already = await this.findExistingBurnerSweep(conn, burnerKeypair.publicKey, expectedUnits);
        if (already) {
          this.logger.log(`Claim ${claimId}: burner ATA empty but an already-landed sweep tx was found (${already}) — treating as delivered instead of re-waiting`);
          sweepTxHash = already;
          sweptAmount = (Number(expectedUnits) / 1_000_000).toFixed(6);
        } else {
          this.logger.log(
            `Claim ${claimId}: no PER deposit and burner ATA empty, no prior sweep found – funds not yet deposited`,
          );
        }
      }
    } catch (e: any) {
      // e?.message can legitimately be '' (e.g. spl-token's TokenOwnerOffCurveError is
      // constructed with no message) — log the constructor name too so an empty-message
      // failure is still diagnosable instead of surfacing as a bare "Claim transfer failed: .".
      this.logger.warn(`Claim ${claimId}: burner sweep failed – [${e?.name ?? e?.constructor?.name ?? typeof e}] ${e?.message || '(no message)'}`);
      throw new BadRequestException(
        `Claim transfer failed: ${e?.message || e?.name || 'unknown error'}. Please try again.`,
      );
    }
    // Both branches that can set sweepTxHash here (the direct SPL sweep and the already-landed-sweep
    // recovery) are always plain public transfers — private delivery returns earlier, above.
    return { sweepTxHash, sweptAmount, feeAmountUsdc, deliveredPrivately: false };
  }

  /**
   * Checks a burner's own recent signatures for an already-confirmed outbound SPL transfer of
   * exactly `expectedUnits` — used only when the ATA is unexpectedly empty (see call site) to
   * distinguish "never funded" from "already swept, but the confirmation step crashed before we
   * recorded it." Limited to the last 15 signatures: a burner is single-purpose and short-lived,
   * so the real sweep (if any) is always one of the most recent transactions, never buried deep.
   */
  private async findExistingBurnerSweep(
    conn: import('@solana/web3.js').Connection,
    burner: PublicKey,
    expectedUnits: bigint,
  ): Promise<string | null> {
    try {
      const sigs = await conn.getSignaturesForAddress(burner, { limit: 15 });
      for (const sigInfo of sigs) {
        if (sigInfo.err) continue;
        const tx = await conn.getParsedTransaction(sigInfo.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx || tx.meta?.err) continue;
        for (const ix of tx.transaction.message.instructions) {
          const parsed = (ix as { parsed?: { type?: string; info?: { source?: string; amount?: string; tokenAmount?: { amount?: string } } } }).parsed;
          if (!parsed || !['transfer', 'transferChecked'].includes(parsed.type ?? '')) continue;
          const info = parsed.info;
          if (!info?.source) continue;
          const amountStr = info.tokenAmount?.amount ?? info.amount;
          if (!amountStr) continue;
          try {
            if (BigInt(amountStr) === expectedUnits) return sigInfo.signature;
          } catch {
            // non-numeric amount string — skip
          }
        }
      }
    } catch (e) {
      this.logger.warn(`findExistingBurnerSweep(${burner.toBase58().slice(0, 8)}…): lookup failed — ${(e as Error)?.message ?? e}`);
    }
    return null;
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
            if (!(await tokenAccountExists(conn, creatorAta))) {
              const feePayer = this.solanaSponsor.getFeePayerKeypair();
              if (feePayer) {
                const allowed = await this.guardAtaSponsorship(
                  creatorPubkey.toBase58(),
                  claimMint.toBase58(),
                  `reclaim:${claimId}`,
                );
                if (!allowed) {
                  // Funds are untouched — still sitting in the burner — so this is safely
                  // retryable by support, not a loss.
                  throw new Error(
                    'This wallet already received a sponsored token account once before and closed it. ' +
                      'Further free account creation is blocked to prevent abuse. Please contact support.',
                  );
                }
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
            const feePayerKp = this.solanaSponsor.getFeePayerKeypair();
            // The transfer above drains the burner ATA to exactly zero, and a cancelled claim's
            // burner is never reused — close it in the same tx so its ~0.002 SOL rent returns to
            // the fee payer instead of being stranded (rent audit 2026-07-29).
            if (feePayerKp) {
              tx.add(createCloseAccountInstruction(burnerAta, feePayerKp.publicKey, burnerKeypair.publicKey));
            }
            const reclaimFeePayerPubkey = feePayerKp?.publicKey ?? burnerKeypair.publicKey;
            const reclaimSigners = feePayerKp ? [burnerKeypair, feePayerKp] : [burnerKeypair];
            this.logger.log(`Claim ${claimId}: sending reclaim transfer ${balance} USDC burner->creator ${creatorWallet.slice(0, 8)}...`);
            const sig = await this.sendAndConfirmWithRebuild(conn, tx, reclaimFeePayerPubkey, reclaimSigners, `reclaim-${claimId.slice(0, 8)}`);
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
    /** Whether the just-completed burner→recipient delivery leg was actually private (MagicBlock) vs a
     * plain public SPL sweep. Only meaningful alongside recipientSwept:true — see updateData.is_private below. */
    deliveredPrivately?: boolean;
    /** Total fee charged to sender in USDC (loofta BPS + SOL recovery). Persisted to claim_events. */
    feeAmountUsdc?: number;
    /** Fee breakdown snapshot at payment time. Persisted to claim_events. */
    feeBreakdown?: {
      looftaBpsUsdc: number;
      solRecoveryUsdc: number;
      solLamports: number;
      solPriceUsd: number;
    };
    /** Set when this claim was delivered via "claim in Naira" — which default PAJ Cash bank
     * account it was swept to and the Loofta fee taken on that sweep. payments-only column. */
    nairaClaim?: { bankAccountId: string; feeAmountUsdc: number };
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

    // Persist that the sender actually funded this privately — the frontend passes this after a
    // MagicBlock private transfer confirms, but it was previously accepted into `extra` and never
    // written to the row, leaving `is_private` stuck at whatever claim-creation defaulted to even
    // for a genuinely private send. Only ever set true here, never false — false is already the
    // safe default and no caller on this path should be able to erase a true flag set elsewhere
    // (e.g. buildPrivateTransferForPayer's own is_private stamp).
    if (extra?.isPrivate === true) {
      updateData.is_private = true;
    }

    // The moment a burner sweep actually completes we know definitively whether that specific
    // delivery leg was private or public — safe to write is_private in either direction here
    // (unlike the intent-only flag above) because this only ever fires from the sweep-completion
    // call sites confirming genuine, completed on-chain delivery, not an earlier/weaker signal.
    if (extra?.recipientSwept === true && extra?.deliveredPrivately !== undefined) {
      updateData.is_private = extra.deliveredPrivately;
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

    if (extra?.nairaClaim) {
      updateData.naira_claim_bank_account_id = extra.nairaClaim.bankAccountId;
      updateData.naira_claim_fee_usdc = extra.nairaClaim.feeAmountUsdc;
    }

    // Legacy claims table uses paid_with_chain instead of from_chain/from_token
    const legacyUpdateData: Record<string, unknown> = { ...updateData };
    if (legacyUpdateData.from_chain !== undefined) {
      legacyUpdateData.paid_with_chain = legacyUpdateData.from_chain;
      delete legacyUpdateData.from_chain;
    }
    delete legacyUpdateData.from_token;
    delete legacyUpdateData.fee_paid_usdc;
    delete legacyUpdateData.naira_claim_bank_account_id;
    delete legacyUpdateData.naira_claim_fee_usdc;

    const { error, table: updatedTable } = await this.updateRow(id, updateData, legacyUpdateData);

    if (error) {
      this.logger.error('Failed to update claim status:', error);
      throw new Error(`Database error: ${error}`);
    }

    this.logger.log(`Updated claim ${id} status to ${effectiveStatus}`);

    // Only the primary `payments` table carries the from_chain/is_devnet/direction columns the
    // quest qualifies on — legacy `claims` rows (read-only backward-compat) never qualify anyway.
    if (effectiveStatus === 'SUCCESS' && updatedTable === 'payments') {
      this.magicblockQuest.maybePushPrivatePaymentQuest(id).catch((e) =>
        this.logger.warn(`MagicBlock quest push failed for payment ${id}: ${(e as Error)?.message}`),
      );
    }

    // claim_events FK references the legacy `claims` table only — skip for `payments` table rows
    // since fee_paid_usdc is already persisted directly on the payments row.
    if (extra?.feeBreakdown && updatedTable === 'claims') {
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

  /** Fire-and-forget email after payment confirms. 5 min delay for registered recipients, 15 min for unregistered. */
  notifyRecipientAfterPayment(claimId: string): void {
    const lastSent = this.emailSentAt.get(claimId);
    if (lastSent && Date.now() - lastSent < 60 * 60 * 1000) {
      this.logger.log(`[email] claim ${claimId}: duplicate suppressed (already sent ${Math.round((Date.now() - lastSent) / 1000)}s ago)`);
      return;
    }
    this.emailSentAt.set(claimId, Date.now());
    this.logger.log(`[email] notifyRecipientAfterPayment called for claim ${claimId} — available=${this.emailService.isAvailable()}`);
    if (!this.emailService.isAvailable()) return;
    this.sendPaymentEmail(claimId).catch((err: any) => {
      this.logger.error(`Email notification failed for claim ${claimId}: ${err?.message ?? err}`);
    });
  }

  private async sendPaymentEmail(claimId: string): Promise<void> {
    const result = await this.fetchRawRow(claimId);
    if (!result) return;
    const row = result.row;

    let recipientEmail = (row.recipient_email as string | null)?.trim().toLowerCase() || null;
    const recipientUsername = (row.recipient_username as string | null)?.trim() || null;
    this.logger.log(`[email] claim ${claimId}: recipient_email=${recipientEmail ?? 'null'}, recipient_username=${recipientUsername ?? 'null'}, recipient_address=${row.recipient_address}`);

    // Fallback 1: payment sent to @username → look up their email from account
    if (!recipientEmail && recipientUsername) {
      try {
        const recipientUser = await this.usersService.findByUsername(recipientUsername);
        recipientEmail = recipientUser.email?.trim().toLowerCase() || null;
        this.logger.log(`[email] claim ${claimId}: resolved email from username @${recipientUsername} → ${recipientEmail ?? 'null (no email on account)'}`);
      } catch {
        this.logger.warn(`[email] claim ${claimId}: could not find user @${recipientUsername}`);
      }
    }

    // Fallback 2: payment sent directly to an email address (PENDING_EMAIL:... in recipient_address)
    const recipientAddress = (row.recipient_address as string | null) || '';
    if (!recipientEmail && recipientAddress.startsWith(ClaimsService.PENDING_EMAIL_PREFIX)) {
      recipientEmail = recipientAddress.slice(ClaimsService.PENDING_EMAIL_PREFIX.length).trim().toLowerCase() || null;
      this.logger.log(`[email] claim ${claimId}: extracted email from PENDING_EMAIL address → ${recipientEmail}`);
    }

    if (!recipientEmail) {
      this.logger.warn(`[email] claim ${claimId}: no email to send to — skipping`);
      return;
    }

    let senderInfo: string | null = null;
    const createdBy = (row.created_by as string | null) || null;
    if (createdBy) {
      try {
        const [sender, senderEmail] = await Promise.all([
          this.usersService.findByPrivyId(createdBy),
          this.usersService.getEmailByPrivyId(createdBy),
        ]);
        senderInfo = sender?.username ? `@${sender.username}` : (senderEmail ?? null);
      } catch { /* ignore */ }
    }

    const isUnregistered = this.isPendingRecipientAddress(row.recipient_address as string);
    const isDev = this.configService.get<string>('NODE_ENV') === 'development';
    const delayMs = isDev ? 0 : 15 * 60 * 1000;
    const scheduledAt = delayMs > 0 ? new Date(Date.now() + delayMs).toISOString() : undefined;

    const shortId = (row.short_id as string | null) || null;
    const emailData = {
      id: claimId,
      amount: row.amount as string | number,
      description: (row.description as string | null) || null,
      senderInfo,
      recipientEmail,
      scheduledAt,
      ...(shortId ? { claimUrl: `/c/${shortId}` } : {}),
    };

    if (isUnregistered) {
      await this.emailService.sendClaimReadyEmail(emailData);
    } else {
      await this.emailService.sendPaymentReceivedEmail(emailData);
    }
  }

  /**
   * Returns claims that are PRIVATE_TRANSFER_PENDING with a saved sender_tx_hash, EXCLUDING any
   * claim that has a burner (burner_address set) — those are burner-mediated (private) claims
   * with a second, separate leg (burner → recipient), so confirming the sender's leg-1 tx here is
   * NOT the same as the payment actually completing. Every prior version of this query included
   * burner claims, and updateStatus's own downgrade guard would correctly refuse to mark them
   * SUCCESS (hasBurner) — but each of those calls still stamped a fresh paid_at/updated_at, which
   * kept the claim matching this exact same query on the very next cron tick: a self-sustaining
   * infinite loop between this verifier and updateStatus's guard, firing every minute forever
   * (incident 2026-07-24, claim b665e249). Burner claims are the sweep cron's job
   * (cronSweepPendingBurners) and the recipient's own claim action — never this verifier's.
   */
  async getPendingTxHashClaims(): Promise<{ id: string; sender_tx_hash: string; created_at: string }[]> {
    const { data, error } = await this.supabaseService.payments
      .select('id, sender_tx_hash, created_at')
      .eq('status', 'PRIVATE_TRANSFER_PENDING')
      .not('sender_tx_hash', 'is', null)
      .is('burner_address', null);
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
    // claim_requested_at IS NOT NULL is load-bearing: every payment now requires an explicit
    // claim, so this cron must only RESUME a sweep the recipient already asked for (funds
    // hadn't landed yet, or the in-process retry died on a server restart) — never proactively
    // deliver to a recipient who hasn't chosen anything, even once their wallet is resolvable.
    const { data: pendingClaims, error } = await this.supabaseService.payments
      .select('*')
      .eq('status', 'PRIVATE_TRANSFER_PENDING')
      .gte('updated_at', cutoff)
      .not('burner_address', 'is', null)
      .not('burner_encrypted_secret', 'is', null)
      .not('claim_requested_at', 'is', null);

    if (error && this.isMissingColumnError(error)) {
      this.logger.warn('[cronSweep] claim_requested_at column missing (migration not deployed yet) — skipping this tick rather than auto-sweeping unclaimed burners');
      return;
    }
    if (error) {
      this.logger.error('[cronSweep] Query error:', error);
      return;
    }
    if (!pendingClaims?.length) return;

    this.logger.log(`[cronSweep] Found ${pendingClaims.length} PRIVATE_TRANSFER_PENDING claims to retry`);

    for (const raw of pendingClaims) {
      const claim = this.normalizeFromPayments(raw as Record<string, unknown>) as unknown as Claim & { recipient_address?: string };
      const rawRow = raw as {
        claim_requested_privately?: boolean | null;
        claim_requested_destination?: string | null;
        claim_requested_naira_fee_usdc?: number | null;
        recipient_user_id?: string | null;
      };
      const recipientWallet = (claim.recipient_address || '').trim();
      if (!recipientWallet || this.isPendingRecipientAddress(recipientWallet)) {
        this.logger.warn(`[cronSweep] Claim ${claim.id}: recipient not resolved yet, skipping`);
        continue;
      }
      // Resume with the SAME choice the recipient originally made — never silently downgrade
      // a requested private/external claim (or a "claim in Naira" routed to a PAJ abstracted
      // wallet_address) to a plain public sweep to their default wallet. Losing this destination
      // was a real incident (claim 3d05bc19): it swept to the recipient's own wallet instead of
      // their bank account because claim_requested_destination was never stamped for claimToNaira.
      const destination = rawRow.claim_requested_destination?.trim() || recipientWallet;
      const claimPrivately = rawRow.claim_requested_privately === true;
      const looftaFeeUsdc = rawRow.claim_requested_naira_fee_usdc ?? undefined;
      try {
        const { sweepTxHash, sweptAmount, deliveredPrivately } = await this.sweepClaimBurnerToWallet(claim.id, claim, destination, { claimPrivately, looftaFeeUsdc });
        if (sweepTxHash) {
          let nairaClaim: { bankAccountId: string; feeAmountUsdc: number } | undefined;
          if (looftaFeeUsdc != null) {
            const bankAccount = await this.pajCashBank.getAccountByWalletAddress(destination).catch(() => null);
            if (bankAccount && rawRow.recipient_user_id) {
              nairaClaim = { bankAccountId: bankAccount.id, feeAmountUsdc: looftaFeeUsdc };
              this.pajCashOrders.recordNairaClaimOrder({
                userId: rawRow.recipient_user_id || '',
                bankAccountId: bankAccount.id,
                walletAddress: destination,
                amountUsdc: parseFloat(sweptAmount || '0'),
                looftaFeeUsdc,
                sweepTxHash,
              }).catch((e) => this.logger.warn(`[cronSweep] Claim ${claim.id}: recordNairaClaimOrder failed (non-fatal): ${(e as Error)?.message}`));
            }
          }
          await this.updateStatus(claim.id, 'SUCCESS', { recipientSwept: true, deliveredPrivately, nairaClaim });
          this.notifyRecipientAfterPayment(claim.id);
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
