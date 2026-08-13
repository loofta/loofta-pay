import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { LotteryService } from '../lottery/lottery.service';
import { TwitterAutopayService } from '../twitter-autopay/twitter-autopay.service';
import { type AuthenticatedIntegrator } from '../integrators/integrators.service';
import { CreateTwitterTicketGiftDto } from './dto/create-twitter-ticket-gift.dto';

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

@Injectable()
export class TwitterTicketGiftsService {
  private readonly logger = new Logger(TwitterTicketGiftsService.name);

  constructor(
    private readonly db: SupabaseService,
    private readonly usersService: UsersService,
    private readonly lotteryService: LotteryService,
    private readonly autopay: TwitterAutopayService,
  ) {}

  async create(
    dto: CreateTwitterTicketGiftDto,
    integrator: AuthenticatedIntegrator,
  ): Promise<{ short_id: string; link: string; already_exists?: boolean; delivered_instantly?: boolean }> {
    const supabase = this.db.getClient();

    const senderTwitter = normaliseHandle(dto.sender_twitter);
    const recipientTwitter = normaliseHandle(dto.recipient_twitter);

    if (senderTwitter === recipientTwitter) {
      throw new BadRequestException('Sender and recipient cannot be the same account');
    }

    // Same enrollment gate as twitter-payments — only accounts that went through
    // /app/twitter-bot are eligible. Doubly important here: unlike payments (sender's own
    // money), gifted tickets are funded from Loofta's own treasury, so this gate is the only
    // thing standing between "anyone can tweet a command" and real, uncapped Loofta spend.
    const enrollment = await this.autopay.getEnrollmentByHandle(senderTwitter);
    if (!enrollment) {
      throw new ForbiddenException(`@${senderTwitter} is not enrolled in Twitter auto-pay`);
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pay.loofta.xyz';

    // Dedup by tweet_id
    if (dto.tweet_id) {
      const { data: byTweet } = await supabase
        .from('twitter_ticket_gifts')
        .select('short_id')
        .eq('tweet_id', dto.tweet_id)
        .maybeSingle();
      if (byTweet) {
        return { short_id: byTweet.short_id, link: `${baseUrl}/tw/${byTweet.short_id}`, already_exists: true };
      }
    }

    // Daily cap — this is real treasury spend ($1/ticket via Loofta's own funded purchase),
    // triggered by a public tweet. Capped on total TICKETS gifted, not request count, since
    // cost scales with num_tickets, not with how many tweets fired.
    const dailyCap = Number(process.env.TWITTER_BOT_DAILY_TICKET_CAP ?? 50);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentGifts } = await supabase
      .from('twitter_ticket_gifts')
      .select('num_tickets')
      .not('tweet_id', 'is', null)
      .gte('created_at', oneDayAgo);
    const ticketsGiftedToday = (recentGifts ?? []).reduce((sum, r) => sum + (r.num_tickets ?? 0), 0);
    if (ticketsGiftedToday + dto.num_tickets > dailyCap) {
      this.logger.warn(`Twitter bot daily ticket-gift cap (${dailyCap}) would be exceeded — rejecting`);
      throw new BadRequestException('Daily ticket gift limit reached — try again tomorrow');
    }

    // Resolve up front so we know whether this delivers instantly or needs a claim link —
    // createGift() does its own resolution internally too (harmless, cheap lookup), but we need
    // to know the outcome ourselves to decide what link to hand back to the bot.
    const resolved = await this.usersService.resolveGiftRecipient('handle', recipientTwitter);

    const gift = await this.lotteryService.createGift({
      adminUserId: enrollment.userId,
      numTickets: dto.num_tickets,
      recipientType: 'handle',
      recipientIdentifier: recipientTwitter,
      note: `Gifted via @looftapay on X from @${senderTwitter}`,
    });

    let shortId = generateShortId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data } = await supabase.from('twitter_ticket_gifts').select('id').eq('short_id', shortId).maybeSingle();
      if (!data) break;
      shortId = generateShortId();
    }

    const { error } = await supabase
      .from('twitter_ticket_gifts')
      .insert({
        short_id: shortId,
        sender_twitter: senderTwitter,
        recipient_twitter: recipientTwitter,
        num_tickets: dto.num_tickets,
        tweet_id: dto.tweet_id ?? null,
        tweet_url: dto.tweet_url ?? null,
        is_devnet: dto.is_devnet ?? integrator.isDevnetOnly,
        integrator_id: integrator.id,
        gift_id: gift.giftId,
        delivered_instantly: !!resolved,
      });

    if (error) {
      if (error.code === '23505') throw new ConflictException('Duplicate tweet_id');
      this.logger.error('Failed to link twitter ticket gift request', error);
      // Tickets already bought/gift already created at this point — still return a usable link
      // (the lottery gift's own claim URL) rather than a bare failure, since the gift is real.
      return { short_id: shortId, link: gift.claimUrl, delivered_instantly: !!resolved };
    }

    this.logger.log(`Gifted ${dto.num_tickets} ticket(s) from @${senderTwitter} to @${recipientTwitter} (gift ${gift.giftId}, instant=${!!resolved})`);

    // Instant delivery (recipient already registered): reply with our own /tw/:short_id
    // confirmation, which links onward to their ticket history. Not yet registered: reuse the
    // existing lottery gift claim page directly — no new UI needed for that path.
    const link = resolved ? `${baseUrl}/tw/${shortId}` : gift.claimUrl;
    return { short_id: shortId, link, delivered_instantly: !!resolved };
  }

  async getPublic(shortId: string) {
    const supabase = this.db.getClient();
    const { data } = await supabase
      .from('twitter_ticket_gifts')
      .select('short_id, sender_twitter, recipient_twitter, num_tickets, is_devnet, delivered_instantly, created_at')
      .eq('short_id', shortId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Ticket gift not found');
    return data;
  }
}
