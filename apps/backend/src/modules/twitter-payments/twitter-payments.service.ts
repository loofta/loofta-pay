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
  ) {}

  async create(dto: CreateTwitterPaymentDto): Promise<{ short_id: string; link: string }> {
    const supabase = this.db.getClient();

    const senderTwitter = normaliseHandle(dto.sender_twitter);
    const recipientTwitter = normaliseHandle(dto.recipient_twitter);

    if (senderTwitter === recipientTwitter) {
      throw new BadRequestException('Sender and recipient cannot be the same account');
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
    if (req.payment_id) {
      // Payment link already created — return it so the frontend can redirect
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://pay.loofta.xyz';
      const { data: existing } = await supabase
        .from('payments')
        .select('short_id')
        .eq('id', req.payment_id)
        .maybeSingle();
      const existingShortId = existing?.short_id;
      return {
        payment_id: req.payment_id,
        payment_link: existingShortId ? `${baseUrl}/c/${existingShortId}` : `${baseUrl}/c/${req.payment_id}`,
      };
    }
    if (req.status === 'expired' || req.status === 'cancelled') {
      throw new BadRequestException(`Payment request is ${req.status}`);
    }
    if (new Date(req.expires_at) < new Date()) {
      throw new BadRequestException('This payment request has expired');
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

    // Generate unique short_id for the real payment
    let paymentShortId = generateShortId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('short_id', paymentShortId)
        .maybeSingle();
      if (!existing) break;
      paymentShortId = generateShortId();
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://pay.loofta.xyz';
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        amount: req.amount_usd,
        direction: 'from_sender',
        recipient_address: `PENDING_USERNAME:${req.recipient_twitter}`,
        created_by: userId,
        sender_user_id: userId,
        status: 'OPEN',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        to_chain: 'solana',
        to_token: 'USDC',
        is_devnet: req.is_devnet ?? false,
        short_id: paymentShortId,
        description: `Sent via @looftapay on X`,
      })
      .select('id')
      .single();

    if (paymentError || !payment) {
      this.logger.error('Failed to create payment for twitter request', paymentError);
      throw new BadRequestException('Failed to create payment');
    }

    // Link temp record → real payment (status stays pending_funding; actual paid state = payments.status)
    await supabase
      .from('twitter_payment_requests')
      .update({ payment_id: payment.id })
      .eq('short_id', shortId);

    const paymentLink = `${baseUrl}/c/${paymentShortId}`;
    this.logger.log(`Twitter payment ${shortId} funded → payment ${payment.id} (${paymentShortId})`);
    return { payment_id: payment.id, payment_link: paymentLink };
  }

  async updateBotReplyTweetId(shortId: string, botReplyTweetId: string): Promise<void> {
    const supabase = this.db.getClient();
    await supabase
      .from('twitter_payment_requests')
      .update({ bot_reply_tweet_id: botReplyTweetId })
      .eq('short_id', shortId);
  }
}
