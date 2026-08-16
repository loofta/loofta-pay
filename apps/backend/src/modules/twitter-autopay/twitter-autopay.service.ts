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
  twitterHandle: string | null;
  enrolled: boolean;
  signerGranted: boolean;
}

export interface TwitterAutopayResult {
  paymentId: string;
  shortId: string | null;
  claimLink: string;
}

/**
 * Admin-only for now (see isPrivyUserAdmin gate on enroll/unenroll) — the plan is to open this
 * up once the bot has run for a while under a small, hand-picked set of users, same rollout
 * shape as the integrators system. Only enrolled handles are ever eligible for the bot to act
 * on — see TwitterPaymentsService.create()'s enrollment check.
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

  async getStatus(userId: string): Promise<TwitterAutopayStatus> {
    const [isAdmin, identity, enrollment] = await Promise.all([
      isPrivyUserAdmin(this.supabaseService, this.configService, userId),
      this.usersService.findIdentityByPrivyId(userId),
      this.supabaseService.twitterAutopayEnrollments.select('enabled, signer_granted').eq('user_id', userId).maybeSingle(),
    ]);

    return {
      isAdmin,
      twitterHandle: identity?.twitterUsername ?? null,
      enrolled: !!enrollment.data?.enabled,
      signerGranted: !!enrollment.data?.signer_granted,
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
  async enroll(userId: string): Promise<TwitterAutopayStatus> {
    await this.assertAdmin(userId);

    const identity = await this.usersService.findIdentityByPrivyId(userId);
    const twitterHandle = identity?.twitterUsername?.replace(/^@/, '').toLowerCase();
    if (!twitterHandle) {
      throw new BadRequestException('Link your X account in Loofta before enabling the bot');
    }

    const { error } = await this.supabaseService.twitterAutopayEnrollments.upsert(
      { user_id: userId, twitter_handle: twitterHandle, enabled: true, signer_granted: true },
      { onConflict: 'user_id' },
    );
    if (error) throw new Error(`Failed to enroll: ${error.message}`);

    return this.getStatus(userId);
  }

  async unenroll(userId: string): Promise<TwitterAutopayStatus> {
    await this.assertAdmin(userId);
    await this.supabaseService.twitterAutopayEnrollments.update({ enabled: false }).eq('user_id', userId);
    return this.getStatus(userId);
  }

  /** What the bot's create() flow checks — silently ignore anyone not on this list. */
  async isHandleEnrolled(twitterHandle: string): Promise<boolean> {
    const clean = twitterHandle.replace(/^@/, '').toLowerCase();
    const { data } = await this.supabaseService.twitterAutopayEnrollments
      .select('id')
      .eq('twitter_handle', clean)
      .eq('enabled', true)
      .maybeSingle();
    return !!data;
  }

  /** Bot pre-filter: fetch once per poll cycle so it can skip non-enrolled mentions before
   *  parsing their text, instead of parsing everything and only rejecting at create() time. */
  async listEnrolledHandles(): Promise<string[]> {
    const { data } = await this.supabaseService.twitterAutopayEnrollments
      .select('twitter_handle')
      .eq('enabled', true);
    return (data ?? []).map((r) => r.twitter_handle as string);
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

  /** Used by TwitterPaymentsService.create() to decide whether to attempt real auto-execution
   *  vs. falling back to the manual create-then-fund flow. */
  async getEnrollmentByHandle(twitterHandle: string): Promise<{ userId: string; signerGranted: boolean } | null> {
    const clean = twitterHandle.replace(/^@/, '').toLowerCase();
    const { data } = await this.supabaseService.twitterAutopayEnrollments
      .select('user_id, signer_granted')
      .eq('twitter_handle', clean)
      .eq('enabled', true)
      .maybeSingle();
    if (!data) return null;
    return { userId: data.user_id, signerGranted: !!data.signer_granted };
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
    if (!paymentRow?.burner_address) {
      throw new Error(`Payment ${payment.id} has no burner address — cannot auto-fund`);
    }

    await this.autopaySigner.signAndSendTransfer({
      senderPrivyUserId: params.senderUserId,
      senderWalletId: wallet.walletId,
      senderAddress: wallet.address,
      destinationAddress: paymentRow.burner_address,
      amountUsd: params.amountUsd,
      isDevnet: params.isDevnet,
      paymentId: payment.id,
    });

    this.logger.log(`Auto-pay executed: payment ${payment.id} funded via granted authorization key`);
    return { paymentId: payment.id, shortId: payment.short_id, claimLink: payment.link };
  }

  private async assertAdmin(userId: string): Promise<void> {
    const admin = await isPrivyUserAdmin(this.supabaseService, this.configService, userId);
    if (!admin) throw new ForbiddenException('Twitter auto-pay is admin-only for now');
  }
}
