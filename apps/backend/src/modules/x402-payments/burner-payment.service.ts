import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService, type SocialPlatform } from '../users/users.service';
import { ClaimsService } from '../claims/claims.service';

export type PayHumanRecipientType = 'email' | 'username' | 'twitter' | 'discord' | 'github' | 'telegram';

const SOCIAL_PLATFORMS = new Set<string>(['twitter', 'discord', 'github', 'telegram']);
const USDC_DECIMALS = 6;

// Same generator as ClaimsService/SendPaymentService/TwitterPaymentsService — duplicated rather
// than shared per this codebase's existing convention (see claims.service.ts).
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

export interface CreatePendingBurnerPaymentParams {
  recipientType: PayHumanRecipientType;
  recipientIdentifier: string;
  amountUsd: number;
  description?: string;
  /** Null for x402-anonymous payments (no integrator API key involved). */
  integratorId?: string | null;
  isDevnet: boolean;
}

export interface PendingBurnerPayment {
  paymentId: string;
  shortId: string | null;
  claimLink: string;
  burnerAddress: string;
  depositAddress: string;
  /** USDC base units (6 decimals) the deposit address must receive. */
  requiredAmountBaseUnits: string;
}

/**
 * Shared primitive behind both new payment-creation entry points (POST /integrators/v1/pay-human
 * and POST /x402/pay-human): resolve the recipient, mint a burner (reusing ClaimsService's
 * existing burner/encryption machinery via mintBurnerForExternalCreation rather than
 * reimplementing it), insert a pending `payments` row, and independently verify real on-chain
 * settlement before marking it funded.
 *
 * Settlement verification here deliberately does NOT copy send-payment.service.ts's
 * confirmFunded pattern, which trusts a client-supplied deposit tx hash — that's safe there only
 * because the caller is an already-Privy-authenticated Loofta user spending their own money with
 * no incentive to lie. Arbitrary agents/integrators have no such backstop, so verifyAndMarkFunded
 * always confirms by reading the burner's actual on-chain USDC balance, never by trusting what
 * the caller (or a facilitator response) claims happened.
 */
@Injectable()
export class BurnerPaymentService {
  private readonly logger = new Logger(BurnerPaymentService.name);
  private readonly baseUrl: string;
  private readonly mainnetUsdcMint: PublicKey;
  private readonly devnetUsdcMint: PublicKey;
  private readonly mainnetConnection: Connection;
  private readonly devnetConnection: Connection;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly claimsService: ClaimsService,
  ) {
    this.baseUrl = this.configService.get<string>('NEXT_PUBLIC_BASE_URL') || 'https://pay.loofta.xyz';

    this.mainnetUsdcMint = new PublicKey(
      this.configService.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
    this.devnetUsdcMint = new PublicKey(
      this.configService.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    );

    const mainnetRpcUrl =
      this.configService.get<string>('SOLANA_RPC_URL') ||
      (this.configService.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.configService.get<string>('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');
    this.mainnetConnection = new Connection(mainnetRpcUrl, 'confirmed');

    const devnetRpcUrl = this.configService.get<string>('SOLANA_DEVNET_RPC_URL') || 'https://api.devnet.solana.com';
    this.devnetConnection = new Connection(devnetRpcUrl, 'confirmed');
  }

  private connectionFor(isDevnet: boolean): Connection {
    return isDevnet ? this.devnetConnection : this.mainnetConnection;
  }

  private usdcMintFor(isDevnet: boolean): PublicKey {
    return isDevnet ? this.devnetUsdcMint : this.mainnetUsdcMint;
  }

  async createPendingBurnerPayment(params: CreatePendingBurnerPaymentParams): Promise<PendingBurnerPayment> {
    const { recipientType, integratorId, isDevnet, amountUsd } = params;
    if (!(amountUsd > 0)) throw new BadRequestException('amount_usd must be greater than 0');
    if (!SOCIAL_PLATFORMS.has(recipientType) && recipientType !== 'email' && recipientType !== 'username') {
      throw new BadRequestException(`Unsupported recipient_type: ${recipientType}`);
    }

    const cleanIdentifier = this.normalizeIdentifier(recipientType, params.recipientIdentifier);
    if (!cleanIdentifier) throw new BadRequestException('recipient_identifier is required');

    const resolved = await this.resolveRecipient(recipientType, cleanIdentifier, isDevnet);

    const burner = this.claimsService.mintBurnerForExternalCreation();
    if (!burner) {
      throw new Error('Unable to mint burner wallet — SEND_PAYMENT_ENC_KEY/KMS may be misconfigured');
    }

    const burnerPubkey = new PublicKey(burner.claim_burner_address);
    const depositAddress = (await getAssociatedTokenAddress(this.usdcMintFor(isDevnet), burnerPubkey)).toBase58();
    const shortId = generateShortId();

    const { data: payment, error } = await this.supabaseService.payments
      .insert({
        amount: amountUsd,
        direction: 'from_sender',
        recipient_address: resolved.recipientAddress,
        recipient_user_id: resolved.recipientUserId,
        recipient_username: resolved.username ?? null,
        recipient_was_unregistered: !resolved.recipientUserId,
        created_by: null,
        integrator_id: integratorId ?? null,
        status: 'PENDING_DEPOSIT',
        description: params.description || null,
        to_chain: 'solana',
        to_token: 'USDC',
        is_devnet: isDevnet,
        is_private: true,
        short_id: shortId,
        burner_address: burner.claim_burner_address,
        burner_encrypted_secret: burner.claim_burner_encrypted_secret,
      })
      .select('id, short_id')
      .single();

    if (error || !payment) {
      this.logger.error('Failed to create pending burner payment:', error);
      throw new Error('Failed to create payment');
    }

    await this.supabaseService.paymentEvents.insert({
      payment_id: payment.id,
      integrator_id: integratorId ?? null,
      type: integratorId ? 'created_by_integrator' : 'created_by_x402_agent',
      payload: { recipient_type: recipientType, amount_usd: amountUsd, is_devnet: isDevnet },
    });

    return {
      paymentId: payment.id,
      shortId: payment.short_id ?? null,
      claimLink: `${this.baseUrl}/c/${payment.short_id ?? payment.id}`,
      burnerAddress: burner.claim_burner_address,
      depositAddress,
      requiredAmountBaseUnits: this.usdToBaseUnits(amountUsd).toString(),
    };
  }

  /**
   * Re-derives the deposit address/required amount for a still-pending payment — used by the
   * x402 facade to build PaymentRequirements from OUR OWN record rather than trusting whatever
   * the client echoes back in its PaymentPayload.
   */
  async getPendingPaymentInfo(
    paymentId: string,
  ): Promise<{ depositAddress: string; requiredAmountBaseUnits: string; isDevnet: boolean }> {
    const { data: payment, error } = await this.supabaseService.payments
      .select('id, status, burner_address, amount, is_devnet')
      .eq('id', paymentId)
      .maybeSingle();
    if (error || !payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'PENDING_DEPOSIT') {
      throw new BadRequestException(`Payment is no longer pending deposit (status: ${payment.status})`);
    }
    if (!payment.burner_address) throw new BadRequestException('Payment has no burner address');

    const isDevnet = !!payment.is_devnet;
    const burnerPubkey = new PublicKey(payment.burner_address);
    const depositAddress = (await getAssociatedTokenAddress(this.usdcMintFor(isDevnet), burnerPubkey)).toBase58();

    return {
      depositAddress,
      requiredAmountBaseUnits: this.usdToBaseUnits(Number(payment.amount)).toString(),
      isDevnet,
    };
  }

  /** The claim link a recipient uses once a payment is funded — same shape as at creation time. */
  async getClaimLink(paymentId: string): Promise<string> {
    const { data: payment, error } = await this.supabaseService.payments
      .select('id, short_id')
      .eq('id', paymentId)
      .maybeSingle();
    if (error || !payment) throw new NotFoundException('Payment not found');
    return `${this.baseUrl}/c/${payment.short_id ?? payment.id}`;
  }

  /**
   * Independently verifies the burner actually holds at least the required USDC by reading its
   * real on-chain token account balance — never trusts a client-supplied tx hash/assertion.
   * Flips the payment to FUNDED (compare-and-swap on status) on success. Idempotent: calling
   * this again after funding is a safe no-op.
   */
  async verifyAndMarkFunded(paymentId: string): Promise<{ funded: boolean; balanceBaseUnits: string }> {
    const { data: payment, error } = await this.supabaseService.payments
      .select('id, status, burner_address, amount, is_devnet')
      .eq('id', paymentId)
      .maybeSingle();
    if (error || !payment) throw new NotFoundException('Payment not found');
    if (!payment.burner_address) throw new BadRequestException('Payment has no burner address');

    if (payment.status !== 'PENDING_DEPOSIT') {
      // Already funded/settled/cancelled — idempotent no-op rather than re-checking on-chain.
      return { funded: payment.status === 'FUNDED' || payment.status === 'SUCCESS', balanceBaseUnits: '0' };
    }

    const isDevnet = !!payment.is_devnet;
    const connection = this.connectionFor(isDevnet);
    const mint = this.usdcMintFor(isDevnet);
    const burnerPubkey = new PublicKey(payment.burner_address);
    const ata = await getAssociatedTokenAddress(mint, burnerPubkey);

    let balanceBaseUnits = 0n;
    try {
      const account = await getAccount(connection, ata);
      balanceBaseUnits = account.amount;
    } catch {
      // Token account doesn't exist yet — burner hasn't received anything.
      balanceBaseUnits = 0n;
    }

    const requiredBaseUnits = this.usdToBaseUnits(Number(payment.amount));
    const funded = balanceBaseUnits >= requiredBaseUnits;

    if (funded) {
      // CAS on status: only transition from PENDING_DEPOSIT so a concurrent check (e.g. two
      // facilitator webhook retries) can't double-process the same payment.
      await this.supabaseService.payments
        .update({ status: 'FUNDED', paid_at: new Date().toISOString() })
        .eq('id', paymentId)
        .eq('status', 'PENDING_DEPOSIT');
      this.logger.log(
        `Payment ${paymentId} funded: burner holds ${balanceBaseUnits} (required ${requiredBaseUnits})`,
      );
    }

    return { funded, balanceBaseUnits: balanceBaseUnits.toString() };
  }

  private usdToBaseUnits(amountUsd: number): bigint {
    return BigInt(Math.round(amountUsd * 10 ** USDC_DECIMALS));
  }

  private normalizeIdentifier(type: PayHumanRecipientType, raw: string): string {
    const trimmed = (raw || '').trim();
    return type === 'email' ? trimmed.toLowerCase() : trimmed.replace(/^@/, '').toLowerCase();
  }

  private async resolveRecipient(
    type: PayHumanRecipientType,
    identifier: string,
    isDevnet: boolean,
  ): Promise<{ recipientAddress: string; recipientUserId: string | null; username: string | null }> {
    try {
      const user =
        type === 'email'
          ? await this.usersService.findByEmail(identifier)
          : type === 'username'
            ? await this.usersService.findByUsername(identifier)
            : await this.usersService.findBySocialHandle(type as SocialPlatform, identifier);

      if (!isDevnet && !(await this.usersService.hasCompletedMainnetWalletUpdate(user.privyUserId))) {
        throw new BadRequestException(
          "This recipient is registered but hasn't updated Loofta to mainnet yet. Ask them to open Loofta and complete the update, then try again.",
        );
      }
      const recipientAddress = await this.usersService.getSolanaWalletAddress(user.privyUserId);
      return { recipientAddress, recipientUserId: user.privyUserId, username: user.username ?? null };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Not found / not registered yet: fall through to a PENDING_* sentinel, exactly like
      // ClaimsService.createFromEmail/createFromUsername/createFromSocial.
    }

    if (type === 'email') {
      return { recipientAddress: `${ClaimsService.PENDING_EMAIL_PREFIX}${identifier}`, recipientUserId: null, username: null };
    }
    if (type === 'username') {
      return { recipientAddress: `${ClaimsService.PENDING_USERNAME_PREFIX}${identifier}`, recipientUserId: null, username: null };
    }
    return {
      recipientAddress: `${ClaimsService.PENDING_SOCIAL_PREFIX}${type}:${identifier}`,
      recipientUserId: null,
      username: null,
    };
  }
}
