import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { ClaimsService } from '../claims/claims.service';
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
  ) {}

  async create(dto: CreateTwitterPaymentDto): Promise<{ short_id: string; link: string }> {
    const supabase = this.db.getClient();

    const senderTwitter = normaliseHandle(dto.sender_twitter);
    const recipientTwitter = normaliseHandle(dto.recipient_twitter);

    if (senderTwitter === recipientTwitter) {
      throw new BadRequestException('Sender and recipient cannot be the same account');
    }

    // Per-sender cap: max 5 active (unfunded, unexpired) requests at a time
    const { count } = await supabase
      .from('twitter_payment_requests')
      .select('id', { count: 'exact', head: true })
      .eq('sender_twitter', senderTwitter)
      .is('payment_id', null)
      .gt('expires_at', new Date().toISOString());
    if ((count ?? 0) >= 5) {
      throw new BadRequestException(`@${senderTwitter} already has too many pending payment requests`);
    }

    // Dedup by tweet_id
    if (dto.tweet_id) {
      const { data: existing } = await supabase
        .from('twitter_payment_requests')
        .select('short_id')
        .eq('tweet_id', dto.tweet_id)
        .maybeSingle();
      if (existing) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pay.loofta.xyz';
        return { short_id: existing.short_id, link: `${baseUrl}/tw/${existing.short_id}` };
      }
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
        is_devnet: dto.is_devnet ?? false,
      })
      .select('short_id')
      .single();

    if (error) {
      if (error.code === '23505') throw new ConflictException('Duplicate tweet_id');
      this.logger.error('Failed to create twitter payment request', error);
      throw new BadRequestException('Failed to create request');
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pay.loofta.xyz';
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

  async fund(shortId: string, userId: string): Promise<{ payment_id: string; payment_link: string }> {
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

    // Create the real payment using the same flow as the send feature:
    // resolves registered users to their wallet, creates burner for unregistered ones.
    const cluster = req.is_devnet ? 'devnet' : 'mainnet';
    const payment = await this.claims.createFromUsername({
      username: req.recipient_twitter,
      amount: req.amount_usd,
      userId,
      isPrivate: true,
      description: `Sent via @looftapay on X`,
      cluster,
    });

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
