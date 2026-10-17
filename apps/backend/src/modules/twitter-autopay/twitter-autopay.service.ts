import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { ClaimsService } from '../claims/claims.service';
import { AutopaySignerService } from './autopay-signer.service';
import { EmailService } from '../email/email.service';
import { isPrivyUserAdmin } from '@/common/admin-check';

export interface TwitterAutopayStatus {
  isAdmin: boolean;
  /** Whether this user may turn auto-pay on: admins always, everyone once TWITTER_AUTOPAY_OPEN=true. */
  canEnable: boolean;
  twitterHandle: string | null;
  enrolled: boolean;
  signerGranted: boolean;
  perPaymentCapUsd: number;
  /** Highest per-payment limit an owner can set (matches the Privy policy). */
  maxPerPaymentCapUsd: number;
  dailyCapUsd: number;
  approvers: string[];
  /** Version of the auto-pay terms this owner accepted, or null if they never did. */
  termsAcceptedVersion: string | null;
  /** Version they must accept to (re-)enable. */
  currentTermsVersion: string;
}

/** Who a mention's author is allowed to spend as: the wallet owner themselves, or a named approver. */
export interface ResolvedPayer {
  enrollmentId: string;
  userId: string;
  ownerHandle: string;
  /** Set when the author is a team approver rather than the wallet owner. */
  approverHandle: string | null;
  signerGranted: boolean;
  perPaymentCapUsd: number;
  dailyCapUsd: number;
}

/** Flat claim fee added when the recipient is not on Loofta (mirrors the web send flow). */
export const UNREGISTERED_CLAIM_FEE_USD = 0.1;

export interface TelegramPaymentPlan {
  registered: boolean;
  /** instant: straight to their wallet; claim: they get a link; private: MagicBlock private transfer. */
  delivery: 'instant' | 'claim' | 'private';
  claimFeeUsd: number;
}

export const DEFAULT_PER_PAYMENT_CAP_USD = 25;
export const DEFAULT_DAILY_CAP_USD = 100;
// Ceiling on what an owner can set per payment. Must not exceed the Privy policy "Twitter Bot
// spend cap" (TransferChecked.amount lte 500 USDC = 500000000 base units): the policy is the real
// backstop, anything above it would be accepted here and then rejected at signing. To change it,
// change BOTH the policy in the Privy dashboard and TWITTER_AUTOPAY_MAX_PER_PAYMENT_USD (default 500).
export const DEFAULT_MAX_PER_PAYMENT_CAP_USD = 500;
/** Bump when the consent text on /app/auto-pay changes materially; owners must re-accept. */
export const AUTOPAY_TERMS_VERSION = '2026-10-16';
export const MAX_DAILY_CAP_USD = 5_000;

function maxPerPaymentCapUsd(): number {
  const v = Number(process.env.TWITTER_AUTOPAY_MAX_PER_PAYMENT_USD);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_PER_PAYMENT_CAP_USD;
}
export const MAX_APPROVERS = 20;

const normHandle = (h: string) => h.replace(/^@/, '').trim().toLowerCase();
const HANDLE_RE = /^[a-z0-9_]{1,50}$/;

export interface TwitterAutopayResult {
  paymentId: string;
  shortId: string | null;
  claimLink: string;
}

/**
 * Auto-pay on X. A wallet owner (a person or a business) enrolls, sets per-payment and daily
 * limits, and optionally names team "approvers": X handles allowed to tell @looftapay to spend
 * from that wallet. Admin-only until TWITTER_AUTOPAY_OPEN=true, same rollout shape as the
 * integrators system. Only enrolled owners and their approvers are ever eligible for the bot to
 * act on — see TwitterPaymentsService.create().
 */
@Injectable()
export class TwitterAutopayService {
  private readonly logger = new Logger(TwitterAutopayService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly claimsService: ClaimsService,
    private readonly autopaySigner: AutopaySignerService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * X (@looftapay) is switched off while auto-pay is Telegram-only. Set X_BOT_ENABLED=true to bring
   * it back. Gated in resolvePayer/listEnrolledHandles, which every X path (payments, ticket gifts,
   * the bot's pre-filter) goes through, so no X command can spend while this is off.
   */
  private get xEnabled(): boolean {
    return this.configService.get<string>('X_BOT_ENABLED') === 'true';
  }

  private get isOpen(): boolean {
    return this.configService.get<string>('TWITTER_AUTOPAY_OPEN') === 'true';
  }

  async getStatus(userId: string): Promise<TwitterAutopayStatus> {
    const [isAdmin, identity, enrollment] = await Promise.all([
      isPrivyUserAdmin(this.supabaseService, this.configService, userId),
      this.usersService.findIdentityByPrivyId(userId),
      this.supabaseService.twitterAutopayEnrollments
        .select('id, enabled, signer_granted, per_payment_cap_usd, daily_cap_usd, terms_version')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    let approvers: string[] = [];
    if (enrollment.data?.id) {
      const { data } = await this.supabaseService.twitterAutopayApprovers
        .select('approver_handle')
        .eq('enrollment_id', enrollment.data.id)
        .order('created_at', { ascending: true });
      approvers = (data ?? []).map((r) => r.approver_handle as string);
    }

    return {
      isAdmin,
      canEnable: isAdmin || this.isOpen,
      twitterHandle: identity?.twitterUsername ?? null,
      enrolled: !!enrollment.data?.enabled,
      signerGranted: !!enrollment.data?.signer_granted,
      perPaymentCapUsd: Number(enrollment.data?.per_payment_cap_usd ?? DEFAULT_PER_PAYMENT_CAP_USD),
      maxPerPaymentCapUsd: maxPerPaymentCapUsd(),
      dailyCapUsd: Number(enrollment.data?.daily_cap_usd ?? DEFAULT_DAILY_CAP_USD),
      approvers,
      termsAcceptedVersion: enrollment.data?.terms_version ?? null,
      currentTermsVersion: AUTOPAY_TERMS_VERSION,
    };
  }

  /** "Request access" button on the coming-soon Twitter bot section — emails hello@loofta.xyz
   *  with whatever identity the requester has on file, so it's actionable without them needing
   *  to separately DM/email their handle themselves. */
  async requestAccess(userId: string): Promise<{ ok: true }> {
    const { data: appUser } = await this.supabaseService.appUsers
      .select('email, twitter_username, username')
      .eq('privy_user_id', userId)
      .maybeSingle();

    await this.emailService.sendTwitterBotAccessRequestEmail({
      privyUserId: userId,
      email: appUser?.email ?? null,
      twitterHandle: appUser?.twitter_username ?? null,
      username: appUser?.username ?? null,
    });

    return { ok: true };
  }

  /** Called after the client successfully completes useSigners().addSigners() on their wallet. */
  async enroll(userId: string, acceptedTerms: boolean): Promise<TwitterAutopayStatus> {
    await this.assertAllowed(userId);
    if (acceptedTerms !== true) {
      throw new BadRequestException('Accept the auto-pay terms to turn it on');
    }

    const identity = await this.usersService.findIdentityByPrivyId(userId);
    // An X handle is optional: it lets the owner (and approvers) command @looftapay on X, but
    // auto-pay also works from Telegram (@looftapay_bot) with no X account linked.
    const twitterHandle = identity?.twitterUsername?.replace(/^@/, '').toLowerCase() || null;

    const { error } = await this.supabaseService.twitterAutopayEnrollments.upsert(
      {
        user_id: userId,
        twitter_handle: twitterHandle,
        enabled: true,
        signer_granted: true,
        terms_version: AUTOPAY_TERMS_VERSION,
        terms_accepted_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) throw new Error(`Failed to enroll: ${error.message}`);

    return this.getStatus(userId);
  }

  async unenroll(userId: string): Promise<TwitterAutopayStatus> {
    await this.assertAllowed(userId);
    await this.supabaseService.twitterAutopayEnrollments.update({ enabled: false }).eq('user_id', userId);
    return this.getStatus(userId);
  }

  /** What the bot's create() flow checks — silently ignore anyone who is neither an enrolled
   *  owner nor a named approver of one. */
  async isHandleEnrolled(twitterHandle: string): Promise<boolean> {
    return (await this.resolvePayer(twitterHandle)) !== null;
  }

  /** Bot pre-filter: fetch once per poll cycle so it can skip non-enrolled mentions before
   *  parsing their text. Includes team approvers, who may command the bot on an owner's behalf. */
  async listEnrolledHandles(): Promise<string[]> {
    if (!this.xEnabled) return [];
    const { data: owners } = await this.supabaseService.twitterAutopayEnrollments
      .select('id, twitter_handle')
      .eq('enabled', true)
      .not('terms_version', 'is', null);
    const handles = new Set<string>((owners ?? []).map((r) => r.twitter_handle as string).filter(Boolean));
    const ids = (owners ?? []).map((r) => r.id as string);
    if (ids.length > 0) {
      const { data: approvers } = await this.supabaseService.twitterAutopayApprovers
        .select('approver_handle')
        .in('enrollment_id', ids);
      for (const a of approvers ?? []) handles.add(a.approver_handle as string);
    }
    return [...handles];
  }

  /**
   * Persists the bot's mention-timeline since_id cursor so a Railway restart doesn't forget it
   * and re-fetch/re-parse a batch of already-seen mentions from scratch. Harmless (tweet_id
   * dedup prevents any double-reply) but noisy and wastes API quota — this closes that.
   */
  async getPollCursor(botHandle: string): Promise<string | null> {
    const { data } = await this.supabaseService.twitterBotPollState
      .select('last_seen_tweet_id')
      .eq('bot_handle', botHandle)
      .maybeSingle();
    return data?.last_seen_tweet_id ?? null;
  }

  async setPollCursor(botHandle: string, lastSeenTweetId: string): Promise<void> {
    await this.supabaseService.twitterBotPollState.upsert(
      { bot_handle: botHandle, last_seen_tweet_id: lastSeenTweetId, updated_at: new Date().toISOString() },
      { onConflict: 'bot_handle' },
    );
  }

  /**
   * Resolves whose wallet a mention author may spend from. The author's own enrollment wins; else
   * the first enabled enrollment that lists them as an approver. Used by
   * TwitterPaymentsService.create() to decide between real auto-execution and the manual flow.
   */
  async resolvePayer(twitterHandle: string): Promise<ResolvedPayer | null> {
    if (!this.xEnabled) return null;
    const clean = normHandle(twitterHandle);
    const cols = 'id, user_id, twitter_handle, signer_granted, per_payment_cap_usd, daily_cap_usd, terms_version';
    const toPayer = (row: any, approverHandle: string | null): ResolvedPayer => ({
      enrollmentId: row.id,
      userId: row.user_id,
      ownerHandle: row.twitter_handle,
      approverHandle,
      signerGranted: !!row.signer_granted,
      perPaymentCapUsd: Number(row.per_payment_cap_usd ?? DEFAULT_PER_PAYMENT_CAP_USD),
      dailyCapUsd: Number(row.daily_cap_usd ?? DEFAULT_DAILY_CAP_USD),
    });

    const { data: own } = await this.supabaseService.twitterAutopayEnrollments
      .select(cols)
      .eq('twitter_handle', clean)
      .eq('enabled', true)
      .not('terms_version', 'is', null)
      .maybeSingle();
    if (own) return toPayer(own, null);

    const { data: link } = await this.supabaseService.twitterAutopayApprovers
      .select('enrollment_id')
      .eq('approver_handle', clean)
      .limit(20);
    for (const l of link ?? []) {
      const { data: owner } = await this.supabaseService.twitterAutopayEnrollments
        .select(cols)
        .eq('id', l.enrollment_id)
        .eq('enabled', true)
        .not('terms_version', 'is', null)
        .maybeSingle();
      if (owner) return toPayer(owner, clean);
    }
    return null;
  }

  /**
   * Telegram: the chat user is already authenticated by Telegram and mapped to a Privy user, so
   * enrollment is looked up by user id. Same gates as resolvePayer: enabled, signer granted
   * (checked by the caller), terms accepted.
   */
  async resolvePayerByUserId(userId: string): Promise<ResolvedPayer | null> {
    const { data: row } = await this.supabaseService.twitterAutopayEnrollments
      .select('id, user_id, twitter_handle, signer_granted, per_payment_cap_usd, daily_cap_usd')
      .eq('user_id', userId)
      .eq('enabled', true)
      .not('terms_version', 'is', null)
      .maybeSingle();
    if (!row) return null;
    return {
      enrollmentId: row.id,
      userId: row.user_id,
      ownerHandle: row.twitter_handle ?? '',
      approverHandle: null,
      signerGranted: !!row.signer_granted,
      perPaymentCapUsd: Number(row.per_payment_cap_usd ?? DEFAULT_PER_PAYMENT_CAP_USD),
      dailyCapUsd: Number(row.daily_cap_usd ?? DEFAULT_DAILY_CAP_USD),
    };
  }

  /**
   * Hard limits checked before any auto-pay, whoever issued the command. A breach throws rather
   * than falling back to anything: an approver's command can never be turned into a different
   * kind of spend. Daily spend is summed over the last 24h of requests this wallet funded.
   */
  async assertWithinLimits(
    payer: ResolvedPayer,
    amountUsd: number,
    opts?: { excludeTelegramActionId?: string },
  ): Promise<void> {
    const whose = payer.ownerHandle ? `@${payer.ownerHandle}'s wallet` : 'your wallet';
    if (amountUsd > payer.perPaymentCapUsd) {
      throw new BadRequestException(
        `$${amountUsd} is over the $${payer.perPaymentCapUsd} per-payment limit set on ${whose}`,
      );
    }
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [x, tg] = await Promise.all([
      this.supabaseService.getClient()
        .from('twitter_payment_requests')
        .select('amount_usd')
        .eq('funded_by_user_id', payer.userId)
        .not('payment_id', 'is', null)
        .gte('created_at', since),
      // 'processing' counts too, so two Confirm taps fired back to back can't both slip under the cap.
      (() => {
        const q = this.supabaseService.getClient()
          .from('telegram_bot_actions')
          .select('amount_usd')
          .eq('privy_user_id', payer.userId)
          .in('status', ['paid', 'processing'])
          .gte('created_at', since);
        return opts?.excludeTelegramActionId ? q.neq('id', opts.excludeTelegramActionId) : q;
      })(),
    ]);
    const sum = (rows: { amount_usd: unknown }[] | null) => (rows ?? []).reduce((t, r) => t + Number(r.amount_usd ?? 0), 0);
    const spent = sum(x.data) + sum(tg.data);
    if (spent + amountUsd > payer.dailyCapUsd) {
      throw new BadRequestException(
        `That would take ${whose} past its $${payer.dailyCapUsd} daily limit ($${spent.toFixed(2)} already sent in the last 24h)`,
      );
    }
  }

  /** Loofta-treasury-funded actions (ticket gifts) are limited to admin wallet owners, never approvers. */
  async canSpendTreasury(payer: ResolvedPayer): Promise<boolean> {
    if (payer.approverHandle) return false;
    return isPrivyUserAdmin(this.supabaseService, this.configService, payer.userId);
  }

  /** Owner-only: change the spend limits on their own enrollment. */
  async updateLimits(userId: string, limits: { perPaymentCapUsd: number; dailyCapUsd: number }): Promise<TwitterAutopayStatus> {
    await this.assertAllowed(userId);
    const { perPaymentCapUsd, dailyCapUsd } = limits;
    if (!Number.isFinite(perPaymentCapUsd) || perPaymentCapUsd <= 0 || perPaymentCapUsd > maxPerPaymentCapUsd()) {
      throw new BadRequestException(`Per-payment limit must be between $0.01 and $${maxPerPaymentCapUsd()}`);
    }
    if (!Number.isFinite(dailyCapUsd) || dailyCapUsd <= 0 || dailyCapUsd > MAX_DAILY_CAP_USD) {
      throw new BadRequestException(`Daily limit must be between $0.01 and $${MAX_DAILY_CAP_USD}`);
    }
    if (perPaymentCapUsd > dailyCapUsd) {
      throw new BadRequestException('Per-payment limit cannot be higher than the daily limit');
    }
    const { data, error } = await this.supabaseService.twitterAutopayEnrollments
      .update({ per_payment_cap_usd: perPaymentCapUsd, daily_cap_usd: dailyCapUsd })
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Failed to update limits: ${error.message}`);
    if (!data) throw new BadRequestException('Enable auto-pay first, then set your limits');
    return this.getStatus(userId);
  }

  async addApprover(userId: string, handle: string): Promise<TwitterAutopayStatus> {
    await this.assertAllowed(userId);
    const clean = normHandle(handle);
    if (!HANDLE_RE.test(clean)) throw new BadRequestException('Enter a valid X handle');
    const enrollment = await this.getOwnEnrollment(userId);
    if (clean === enrollment.twitter_handle) throw new BadRequestException('You are already the owner of this wallet');
    const { count } = await this.supabaseService.twitterAutopayApprovers
      .select('id', { count: 'exact', head: true })
      .eq('enrollment_id', enrollment.id);
    if ((count ?? 0) >= MAX_APPROVERS) throw new BadRequestException(`At most ${MAX_APPROVERS} approvers`);
    const { error } = await this.supabaseService.twitterAutopayApprovers
      .upsert({ enrollment_id: enrollment.id, approver_handle: clean }, { onConflict: 'enrollment_id,approver_handle' });
    if (error) throw new Error(`Failed to add approver: ${error.message}`);
    return this.getStatus(userId);
  }

  async removeApprover(userId: string, handle: string): Promise<TwitterAutopayStatus> {
    const enrollment = await this.getOwnEnrollment(userId);
    await this.supabaseService.twitterAutopayApprovers
      .delete()
      .eq('enrollment_id', enrollment.id)
      .eq('approver_handle', normHandle(handle));
    return this.getStatus(userId);
  }

  private async getOwnEnrollment(userId: string): Promise<{ id: string; twitter_handle: string }> {
    const { data } = await this.supabaseService.twitterAutopayEnrollments
      .select('id, twitter_handle')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) throw new BadRequestException('Enable auto-pay first');
    return data as { id: string; twitter_handle: string };
  }

  /**
   * Real execution path: creates the claim/burner (same machinery as the manual fund() flow)
   * then immediately signs and broadcasts the sender->burner transfer using the sender's granted
   * Privy authorization key — no separate confirm click. Throws on any failure (unresolved
   * wallet, signing rejected by policy, RPC error) — caller is expected to fall back to the
   * manual pending-request flow rather than treat this as fatal, since a legitimate enrolled
   * user's tweet failing here for a transient reason shouldn't just vanish with no way to pay.
   */
  async executeAutoPay(params: {
    senderUserId: string;
    recipientHandle: string;
    amountUsd: number;
    isPrivate: boolean;
    isDevnet: boolean;
  }): Promise<TwitterAutopayResult> {
    if (!this.autopaySigner.isAvailable) {
      throw new Error('Auto-pay signing is not configured (LOOFTA_BOT_AUTH_PRIVATE_KEY missing)');
    }

    const wallet = await this.autopaySigner.resolveSenderWallet(params.senderUserId);
    if (!wallet) {
      throw new Error('Sender has no delegated Solana wallet — signer grant may not have completed');
    }

    const payment = await this.claimsService.createFromUsername({
      username: params.recipientHandle,
      amount: params.amountUsd,
      userId: params.senderUserId,
      isPrivate: params.isPrivate,
      description: 'Sent via @looftapay on X',
      cluster: params.isDevnet ? 'devnet' : 'mainnet',
    });

    const { data: paymentRow } = await this.supabaseService.payments
      .select('burner_address')
      .eq('id', payment.id)
      .maybeSingle();
    // Recipient not on Loofta yet: fund the claim's burner and let the normal sweep deliver it.
    // Recipient already on Loofta (non-private): the claim carries their wallet as payTo, so send
    // straight there and mark it paid, the same sequence the browser send flow performs.
    const burnerAddress = paymentRow?.burner_address ?? null;
    const directTo = !burnerAddress ? payment.payTo : null;
    const destinationAddress = burnerAddress ?? directTo;
    if (!destinationAddress) {
      throw new Error(`Payment ${payment.id} has no burner or direct destination — cannot auto-fund`);
    }

    const { signature } = await this.autopaySigner.signAndSendTransfer({
      senderPrivyUserId: params.senderUserId,
      senderWalletId: wallet.walletId,
      senderAddress: wallet.address,
      destinationAddress,
      amountUsd: params.amountUsd,
      isDevnet: params.isDevnet,
      paymentId: payment.id,
    });

    if (directTo) {
      await this.claimsService.updateStatus(payment.id, 'SUCCESS', {
        txHash: signature,
        paidWith: 'USDC',
        paidWithToken: 'USDC',
        paidWithChain: 'solana',
      });
      this.claimsService.notifyRecipientAfterPayment(payment.id);
    }

    this.logger.log(`Auto-pay executed: payment ${payment.id} funded via granted authorization key`);
    return { paymentId: payment.id, shortId: payment.short_id, claimLink: payment.link };
  }

  /**
   * What a Telegram payment to @handle would do, so the Confirm card can say it up front and the
   * balance check can include fees. Registered + public + already has a USDC account: instant,
   * straight to their wallet. Anyone else: a claim link. Not on Loofta at all: a flat $0.10 claim
   * fee is added on top, same as the web send flow. Private: MagicBlock private transfer.
   */
  async planTelegramPayment(handle: string, isPrivate: boolean, isDevnet: boolean): Promise<TelegramPaymentPlan> {
    let recipientWallet: string | null = null;
    try {
      const user = await this.usersService.findBySocialHandle('telegram', handle);
      recipientWallet = await this.usersService.getSolanaWalletAddress(user.privyUserId);
    } catch {
      recipientWallet = null; // not on Loofta (or no wallet yet)
    }
    const registered = !!recipientWallet;
    const claimFeeUsd = registered ? 0 : UNREGISTERED_CLAIM_FEE_USD;
    if (isPrivate) return { registered, delivery: 'private', claimFeeUsd };
    if (registered && (await this.autopaySigner.usdcAccountExists(recipientWallet!, isDevnet))) {
      return { registered, delivery: 'instant', claimFeeUsd };
    }
    return { registered, delivery: 'claim', claimFeeUsd };
  }

  /**
   * Telegram auto-pay. Public: instant to a registered wallet that can already hold USDC, else a
   * burner claim (never asks the sponsor to create a token account for a payment the same user
   * made, which its drain guard refuses). Not on Loofta: the $0.10 claim fee goes to the Loofta
   * fee account in the same transaction. Private: MagicBlock private transfer with the chosen
   * delay and split, signed by the sender's granted key.
   */
  async executeTelegramAutoPay(params: {
    senderUserId: string;
    recipientHandle: string;
    amountUsd: number;
    isPrivate: boolean;
    isDevnet: boolean;
    splitOverride?: number | null;
    maxDelayMsOverride?: number | null;
  }): Promise<TwitterAutopayResult> {
    if (!this.autopaySigner.isAvailable) {
      throw new Error('Auto-pay signing is not configured (LOOFTA_BOT_AUTH_PRIVATE_KEY missing)');
    }
    const wallet = await this.autopaySigner.resolveSenderWallet(params.senderUserId);
    if (!wallet) throw new Error('Sender has no delegated Solana wallet — signer grant may not have completed');

    const cluster = params.isDevnet ? 'devnet' : 'mainnet';
    const plan = await this.planTelegramPayment(params.recipientHandle, params.isPrivate, params.isDevnet);
    const base = {
      platform: 'telegram' as const,
      handle: params.recipientHandle,
      amount: params.amountUsd,
      userId: params.senderUserId,
      description: 'Sent via @looftapay_bot on Telegram',
      cluster: cluster as 'devnet' | 'mainnet',
    };

    if (params.isPrivate) {
      const split = params.splitOverride ?? undefined;
      const maxDelayMs = params.maxDelayMsOverride ?? undefined;
      const payment = await this.claimsService.createFromSocial({ ...base, isPrivate: true, split, maxDelayMs });
      try {
        const built = await this.claimsService.buildPrivateTransferForPayer(
          payment.id, params.senderUserId, wallet.address, cluster, true, split, maxDelayMs,
        );
        const { signature } = await this.autopaySigner.signAndSendPrivateTransfer({
          senderPrivyUserId: params.senderUserId,
          senderWalletId: wallet.walletId,
          transactionBase64: built.transactionBase64,
          version: built.version,
          sendTo: built.sendTo,
          paymentId: payment.id,
        });
        await this.claimsService.updateStatus(payment.id, 'SUCCESS', {
          txHash: signature,
          paidWith: 'USDC',
          paidWithToken: 'USDC',
          paidWithChain: 'solana',
          isPrivate: true,
        });
        this.claimsService.notifyRecipientAfterPayment(payment.id);
      } catch (e) {
        await this.cancelUnfunded(payment.id);
        throw e;
      }
      if (plan.claimFeeUsd > 0) await this.collectClaimFee(params.senderUserId, wallet, plan.claimFeeUsd, params.isDevnet);
      this.logger.log(`Telegram private auto-pay executed: payment ${payment.id}`);
      return { paymentId: payment.id, shortId: payment.short_id, claimLink: payment.link };
    }

    // Public. Registered with a USDC account: direct. Everything else: burner claim.
    const payment = await this.claimsService.createFromSocial({ ...base, isPrivate: false, forceBurner: plan.delivery !== 'instant' });
    const { data: paymentRow } = await this.supabaseService.payments
      .select('burner_address')
      .eq('id', payment.id)
      .maybeSingle();
    const burnerAddress = paymentRow?.burner_address ?? null;
    const directTo = !burnerAddress ? payment.payTo : null;
    const destinationAddress = burnerAddress ?? directTo;
    if (!destinationAddress) {
      await this.cancelUnfunded(payment.id);
      throw new Error(`Payment ${payment.id} has no burner or direct destination — cannot auto-fund`);
    }
    try {
      const { signature } = await this.autopaySigner.signAndSendTransfer({
        senderPrivyUserId: params.senderUserId,
        senderWalletId: wallet.walletId,
        senderAddress: wallet.address,
        destinationAddress,
        amountUsd: params.amountUsd,
        isDevnet: params.isDevnet,
        paymentId: payment.id,
        claimFeeUsd: plan.claimFeeUsd,
      });
      if (directTo) {
        await this.claimsService.updateStatus(payment.id, 'SUCCESS', {
          txHash: signature,
          paidWith: 'USDC',
          paidWithToken: 'USDC',
          paidWithChain: 'solana',
        });
        this.claimsService.notifyRecipientAfterPayment(payment.id);
      }
    } catch (e) {
      await this.cancelUnfunded(payment.id);
      throw e;
    }
    this.logger.log(`Telegram auto-pay executed: payment ${payment.id} (${plan.delivery})`);
    return { paymentId: payment.id, shortId: payment.short_id, claimLink: payment.link };
  }

  /** Marks a claim we created but could not fund as cancelled, so it doesn't linger as OPEN. */
  private async cancelUnfunded(paymentId: string): Promise<void> {
    try {
      await this.claimsService.updateStatus(paymentId, 'CANCELLED');
    } catch (e) {
      this.logger.warn(`Could not cancel unfunded payment ${paymentId}: ${(e as Error).message}`);
    }
  }

  /** Private payments can't carry the claim fee in the MagicBlock transaction, so it is a second
   *  transfer afterwards. The payment already landed, so a failure here is logged, not thrown. */
  private async collectClaimFee(
    userId: string,
    wallet: { address: string; walletId: string },
    claimFeeUsd: number,
    isDevnet: boolean,
  ): Promise<void> {
    try {
      const feePayer = this.solanaSponsorAddress();
      if (!feePayer) return;
      await this.autopaySigner.signAndSendTransfer({
        senderPrivyUserId: userId,
        senderWalletId: wallet.walletId,
        senderAddress: wallet.address,
        destinationAddress: feePayer,
        amountUsd: claimFeeUsd,
        isDevnet,
      });
    } catch (e) {
      this.logger.warn(`Claim fee transfer failed after private auto-pay: ${(e as Error).message}`);
    }
  }

  private solanaSponsorAddress(): string | null {
    return this.autopaySigner.feePayerAddress;
  }

  private async assertAllowed(userId: string): Promise<void> {
    if (this.isOpen) return;
    const admin = await isPrivyUserAdmin(this.supabaseService, this.configService, userId);
    if (!admin) throw new ForbiddenException('Twitter auto-pay is invite-only for now');
  }
}
