import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { ClaimsService } from '../claims/claims.service';
import { type AuthenticatedIntegrator } from '../integrators/integrators.service';
import { TwitterAutopayService } from '../twitter-autopay/twitter-autopay.service';
import { CreateTwitterPaymentDto } from './dto/create-twitter-payment.dto';

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

function normaliseHandle(handle: string): string {
  return handle.replace(/^@/, '').toLowerCase().trim();
}

const TWITTER_ACCOUNT_TYPES = ['twitter_oauth', 'twitter_oauth2', 'twitter', 'x'];

@Injectable()
export class TwitterPaymentsService {
  private readonly logger = new Logger(TwitterPaymentsService.name);

  constructor(
    private readonly db: SupabaseService,
    private readonly privy: PrivyVerificationService,
    private readonly claims: ClaimsService,
    private readonly autopay: TwitterAutopayService,
  ) {}

  async create(
    dto: CreateTwitterPaymentDto,
    integrator: AuthenticatedIntegrator,
  ): Promise<{ short_id: string; link: string; already_exists?: boolean }> {
    const supabase = this.db.getClient();

    const senderTwitter = normaliseHandle(dto.sender_twitter);
    const recipientTwitter = normaliseHandle(dto.recipient_twitter);

    if (senderTwitter === recipientTwitter) {
      throw new BadRequestException('Sender and recipient cannot be the same account');
    }

    // Enrollment gate — the direct fix for "anyone can trigger the bot to reply." Only handles
    // that went through /app/twitter-bot and granted the Privy authorization key are eligible;
    // everyone else's tweet produces no request and no reply (the bot's own createPaymentRequest
    // already treats any non-2xx here as "log and skip reply", so this alone is enough — no
    // bot-side change needed). This bounds reply volume to consented, enrolled senders only,
    // which is the compliance lever that actually matters (see the bankr.bot precedent).
    const senderEnrolled = await this.autopay.isHandleEnrolled(senderTwitter);
    if (!senderEnrolled) {
      throw new ForbiddenException(`@${senderTwitter} is not enrolled in Twitter auto-pay`);
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pay.loofta.xyz';

    // Dedup by tweet_id — same tweet reprocessed after bot restart, skip re-reply
    if (dto.tweet_id) {
      const { data: byTweet } = await supabase
        .from('twitter_payment_requests')
        .select('short_id')
        .eq('tweet_id', dto.tweet_id)
        .maybeSingle();
      if (byTweet) {
        return { short_id: byTweet.short_id, link: `${baseUrl}/tw/${byTweet.short_id}`, already_exists: true };
      }
    }

    // Dedup by sender+recipient — if there's already an active unpaid request for this pair,
    // return it so we don't spam-create duplicates. If the previous one is paid, fall through
    // and create a fresh request.
    const { data: activePair } = await supabase
      .from('twitter_payment_requests')
      .select('short_id, payment_id')
      .eq('sender_twitter', senderTwitter)
      .eq('recipient_twitter', recipientTwitter)
      .is('payment_id', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activePair) {
      return { short_id: activePair.short_id, link: `${baseUrl}/tw/${activePair.short_id}`, already_exists: true };
    }

    // Daily/volume cap — the actual anti-platform-manipulation fix. A per-minute rate limit
    // (see RateLimitGuard on the controller) only guards burst rate; the flag that got the bot
    // paused was almost certainly sustained daily volume + structural repetition, not bursts.
    // Only counts real bot-sourced replies (tweet_id set), not manually-created requests.
    const dailyCap = Number(process.env.TWITTER_BOT_DAILY_REPLY_CAP ?? 150);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dailyCount } = await supabase
      .from('twitter_payment_requests')
      .select('id', { count: 'exact', head: true })
      .not('tweet_id', 'is', null)
      .gte('created_at', oneDayAgo);
    if ((dailyCount ?? 0) >= dailyCap) {
      this.logger.warn(`Twitter bot daily reply cap (${dailyCap}) reached — rejecting new request`);
      throw new BadRequestException('Daily reply limit reached — try again tomorrow');
    }

    // Generate unique short_id
    let shortId = generateShortId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data } = await supabase
        .from('twitter_payment_requests')
        .select('id')
        .eq('short_id', shortId)
        .maybeSingle();
      if (!data) break;
      shortId = generateShortId();
    }

    const { data, error } = await supabase
      .from('twitter_payment_requests')
      .insert({
        short_id: shortId,
        sender_twitter: senderTwitter,
        recipient_twitter: recipientTwitter,
        amount_usd: dto.amount_usd,
        tweet_id: dto.tweet_id ?? null,
        tweet_url: dto.tweet_url ?? null,
        is_devnet: dto.is_devnet ?? integrator.isDevnetOnly,
        integrator_id: integrator.id,
      })
      .select('short_id')
      .single();

    if (error) {
      if (error.code === '23505') throw new ConflictException('Duplicate tweet_id');
      this.logger.error('Failed to create twitter payment request', error);
      throw new BadRequestException('Failed to create request');
    }

    const link = `${baseUrl}/tw/${data.short_id}`;
    this.logger.log(`Created twitter payment request ${data.short_id} — $${dto.amount_usd} from @${senderTwitter} to @${recipientTwitter}`);
    return { short_id: data.short_id, link };
  }

  async getPublic(shortId: string) {
    const supabase = this.db.getClient();
    const { data } = await supabase
      .from('twitter_payment_requests')
      .select('short_id, sender_twitter, recipient_twitter, amount_usd, status, payment_id, is_devnet, created_at, expires_at')
      .eq('short_id', shortId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Payment request not found');
    return data;
  }

  async fund(shortId: string, userId: string, isPrivate: boolean): Promise<{ payment_id: string; payment_link: string }> {
    const supabase = this.db.getClient();

    const { data: req } = await supabase
      .from('twitter_payment_requests')
      .select('*')
      .eq('short_id', shortId)
      .maybeSingle();

    if (!req) throw new NotFoundException('Payment request not found');

    if (req.status === 'expired' || req.status === 'cancelled') {
      throw new BadRequestException(`Payment request is ${req.status}`);
    }
    if (new Date(req.expires_at) < new Date()) {
      throw new BadRequestException('This payment request has expired');
    }

    // If a payment was previously linked, verify it still exists and isn't deleted
    if (req.payment_id) {
      const { data: existing } = await supabase
        .from('payments')
        .select('id, short_id, status')
        .eq('id', req.payment_id)
        .maybeSingle();

      if (existing && existing.status?.toUpperCase() !== 'DELETED') {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://pay.loofta.xyz';
        const path = existing.short_id ?? existing.id;
        return { payment_id: existing.id, payment_link: `${baseUrl}/c/${path}` };
      }

      // Payment was deleted — clear the link and create a fresh one
      this.logger.warn(`Twitter payment ${shortId}: linked payment ${req.payment_id} no longer exists, creating new one`);
      await supabase
        .from('twitter_payment_requests')
        .update({ payment_id: null })
        .eq('short_id', shortId);
    }

    // Verify sender's linked Twitter handle via Privy
    const privyUser = await this.privy.getPrivyUser(userId);
    const twitterAccount = privyUser?.linked_accounts?.find(
      (a: any) => TWITTER_ACCOUNT_TYPES.includes((a.type ?? '').toLowerCase()),
    );
    const linkedHandle = normaliseHandle(
      twitterAccount?.username || twitterAccount?.name || twitterAccount?.address || '',
    );

    if (!linkedHandle) {
      throw new BadRequestException(
        'No Twitter account linked. Connect your Twitter in settings first.',
      );
    }
    if (linkedHandle !== req.sender_twitter) {
      throw new BadRequestException(
        `Wrong Twitter account. This payment is for @${req.sender_twitter}, but you're logged in as @${linkedHandle}.`,
      );
    }

    // Cluster now derives from the bot's own integrator row (is_devnet_only) rather than being
    // hardcoded — mainnet is an explicit per-integrator grant, same mechanism used everywhere
    // else integrators exist. No stored integrator_id (pre-migration rows) falls back to devnet.
    let isDevnet = true;
    if (req.integrator_id) {
      const { data: integratorRow } = await supabase
        .from('integrators')
        .select('is_devnet_only')
        .eq('id', req.integrator_id)
        .maybeSingle();
      isDevnet = integratorRow?.is_devnet_only ?? true;
    }
    const cluster = isDevnet ? 'devnet' : 'mainnet';

    const payment = await this.claims.createFromUsername({
      username: req.recipient_twitter,
      amount: req.amount_usd,
      userId,
      isPrivate,
      description: `Sent via @looftapay on X`,
      cluster,
    });

    // No fee charged for now — the balance/fee ledger was stripped out until it's actually
    // needed (see the plan doc). If a fee comes back later, this is where it'd charge.

    // Link temp record → real payment (status stays; actual paid state = payments.status)
    await supabase
      .from('twitter_payment_requests')
      .update({ payment_id: payment.id })
      .eq('short_id', shortId);

    this.logger.log(`Twitter payment ${shortId} linked → payment ${payment.id}`);
    return { payment_id: payment.id, payment_link: payment.link };
  }

  async updateBotReplyTweetId(shortId: string, botReplyTweetId: string): Promise<void> {
    const supabase = this.db.getClient();
    await supabase
      .from('twitter_payment_requests')
      .update({ bot_reply_tweet_id: botReplyTweetId })
      .eq('short_id', shortId);
  }
}
