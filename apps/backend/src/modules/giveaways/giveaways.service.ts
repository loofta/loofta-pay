import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '@/redis/redis.service';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { GiveawayBurnerSweepService } from './giveaway-burner-sweep.service';
import { isPrivyUserAdmin } from '@/common/admin-check';
import { GiveawayFundingService } from './giveaway-funding.service';
import { GiveawayTokenService } from './giveaway-token.service';
import { EmailService } from '../email/email.service';
import { SolanaSponsorService } from '../claims/solana-sponsor.service';
import { UsersService } from '../users/users.service';
import { CreateGiveawayDto } from './dto/create-giveaway.dto';
import { GiveawayType, QuickCriteria } from './entities/giveaway.entity';
import { AdminReviewGiveawayDto } from './dto/admin-review-giveaway.dto';
import { AdminEditGiveawayDto } from './dto/admin-edit-giveaway.dto';
import {
  Giveaway,
  GiveawayTask,
  GiveawayStatus,
  GiveawayRewardType,
  GiveawayTaskCompletionStatus,
  GIVEAWAY_TASK_VERIFICATION_MODE,
} from './entities/giveaway.entity';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { PublicKey } from '@solana/web3.js';

// Same generator as ClaimsService/SendPaymentService/GiveawayPayoutService — duplicated rather
// than shared per this codebase's existing convention.
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

// Same convention as ata-sponsorship-guard.ts / lottery.service.ts's own alert-email constants —
// each caller defines its own address rather than a shared config, overridable via env for staging.
const GIVEAWAY_REVIEW_ALERT_EMAIL = 'lisa.bechina@gmail.com';

// 10% of the prize pool, never under $5 and never over $80 (the cap kicks in at an $800 pool). Distinct from the old per-winner MagicBlock buffer
// (removed; that was accidental overcharge with no real cost behind it). Lands in the Solana fee
// payer's own wallet at giveaway completion, not refunded to the creator like the rest of the
// burner's leftover. Waived for an official ("create as Loofta") giveaway.
const GIVEAWAY_PLATFORM_FEE_MIN_USD = 5;
const GIVEAWAY_PLATFORM_FEE_MAX_USD = 80;
const GIVEAWAY_PLATFORM_FEE_RATE = 0.1;

function giveawayPlatformFeeUsd(prizePoolUsd: number): number {
  const percent = Math.round(prizePoolUsd * GIVEAWAY_PLATFORM_FEE_RATE * 100) / 100;
  return Math.min(GIVEAWAY_PLATFORM_FEE_MAX_USD, Math.max(GIVEAWAY_PLATFORM_FEE_MIN_USD, percent));
}

// Review-link session tokens are short-lived — long enough for one sitting of task review, short
// enough that a link pasted somewhere and forgotten doesn't stay a live credential indefinitely.
const REVIEW_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

@Injectable()
export class GiveawaysService {
  private readonly logger = new Logger(GiveawaysService.name);
  private readonly usdcMint: string;
  private readonly isDevnet: boolean;
  private readonly baseUrl: string;
  private readonly reviewLinkSecret: string | null;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly burnerSweep: GiveawayBurnerSweepService,
    private readonly fundingService: GiveawayFundingService,
    private readonly emailService: EmailService,
    private readonly privy: PrivyVerificationService,
    private readonly redis: RedisService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly usersService: UsersService,
    private readonly tokenService: GiveawayTokenService,
  ) {
    this.isDevnet = isSolanaDevnetFromConfig(this.configService);
    const defaultUsdcMint = this.isDevnet
      ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
      : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    this.usdcMint =
      this.configService.get<string>('SOLANA_USDC_MINT') ||
      this.configService.get<string>('NEXT_PUBLIC_SOLANA_USDC_MINT') ||
      defaultUsdcMint;
    this.baseUrl = this.configService.get<string>('NEXT_PUBLIC_BASE_URL', 'https://pay.loofta.com');
    // Reuses LOOFTA_INTERNAL_SECRET (already required in Railway for claims.controller.ts's
    // internal-BFF gate) instead of provisioning a new env var — Lisa: no more secrets that need
    // adding to Railway before a feature actually works there, after tonight's SORSA_API_KEY gap.
    // Every HMAC input below is prefixed to keep this domain-separated from that unrelated use —
    // same root secret, but a review-link HMAC can never collide with or be mistaken for an
    // internal-caller check.
    this.reviewLinkSecret = this.configService.get<string>('LOOFTA_INTERNAL_SECRET') || null;
    if (!this.reviewLinkSecret) this.logger.warn('LOOFTA_INTERNAL_SECRET not configured — public review links disabled.');
  }

  private cluster(giveaway: Giveaway): 'devnet' | 'mainnet' {
    return giveaway.is_devnet ? 'devnet' : 'mainnet';
  }

  private hmac(value: string): string {
    if (!this.reviewLinkSecret) throw new BadRequestException('Review links are not configured on this server');
    return createHmac('sha256', this.reviewLinkSecret).update(`giveaway-review-link:${value}`).digest('base64url');
  }

  /** Creator-only: (re)generates the public, password-protected review link for this giveaway.
   *  Regenerating overwrites the previous token/password hash, so the old link/password stop
   *  working immediately — deliberately only one live link per giveaway at a time. The plaintext
   *  password is returned exactly once here and never stored or retrievable again; only its HMAC
   *  is persisted. */
  async generateReviewLink(giveawayId: string, creatorId: string): Promise<{ url: string; password: string }> {
    await this.findOneForCreator(giveawayId, creatorId); // ownership check — throws if not the creator
    if (!this.reviewLinkSecret) throw new BadRequestException('Review links are not configured on this server');

    const token = randomBytes(24).toString('base64url');
    const password = randomBytes(9).toString('base64url');
    const passwordHash = this.hmac(password);

    const { error } = await this.supabaseService.giveaways
      .update({ review_link_token: token, review_link_password_hash: passwordHash, review_link_created_at: new Date().toISOString() })
      .eq('id', giveawayId);
    if (error) throw new BadRequestException(error.message);

    return { url: `${this.baseUrl}/rewards/giveaways/review/${token}`, password };
  }

  /** Public: exchanges the review link's password for a short-lived session token scoped to this
   *  one giveaway. Rate-limited per token to blunt password guessing (the token itself is already
   *  unguessable, but defense in depth costs nothing here). */
  async authenticateReviewLink(token: string, password: string): Promise<{ sessionToken: string; giveawayTitle: string }> {
    const rate = await this.redis.slideWindow(`review-link-auth:${token}`, 5, 15 * 60);
    if (!rate.allowed) throw new ForbiddenException('Too many attempts — try again later');

    const { data, error } = await this.supabaseService.giveaways
      .select('id, title, review_link_password_hash')
      .eq('review_link_token', token)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data?.review_link_password_hash) throw new NotFoundException('Review link not found');

    const expected = Buffer.from(data.review_link_password_hash as string);
    const actual = Buffer.from(this.hmac(password));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new ForbiddenException('Incorrect password');
    }

    const giveawayId = data.id as string;
    const expiresAt = Date.now() + REVIEW_SESSION_TTL_MS;
    const payload = `${giveawayId}.${expiresAt}`;
    const sessionToken = `${Buffer.from(payload).toString('base64url')}.${this.hmac(payload)}`;
    return { sessionToken, giveawayTitle: data.title as string };
  }

  /** Verifies a review-link session token was issued for exactly this giveaway and hasn't expired.
   *  Returns the giveawayId on success — callers must still scope every subsequent query to it,
   *  this only proves "this session is allowed to act on this one giveaway," not authorization for
   *  any particular completion (see GiveawayEntriesService.reviewCompletionScoped).
   *
   *  Also confirms `token` (the review-link URL this request came in on) is still the giveaway's
   *  ACTIVE link. Regenerating overwrites review_link_token/password_hash, which already stops any
   *  *new* login with the old password — but without this check, a session issued minutes before
   *  regeneration (still within its up-to-2h TTL) would keep working regardless, since the session
   *  token itself doesn't otherwise know the link was rotated. Deliberately only one live link+
   *  session lineage per giveaway at a time. */
  async verifyReviewSessionToken(token: string, sessionToken: string): Promise<string> {
    const [encodedPayload, signature] = (sessionToken || '').split('.');
    if (!encodedPayload || !signature) throw new ForbiddenException('Invalid session');
    const payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const expectedSig = Buffer.from(this.hmac(payload));
    const actualSig = Buffer.from(signature);
    if (expectedSig.length !== actualSig.length || !timingSafeEqual(expectedSig, actualSig)) {
      throw new ForbiddenException('Invalid session');
    }
    const [giveawayId, expiresAtStr] = payload.split('.');
    if (!giveawayId || Date.now() > Number(expiresAtStr)) throw new ForbiddenException('Session expired — re-enter the password');

    const { data } = await this.supabaseService.giveaways.select('review_link_token').eq('id', giveawayId).maybeSingle();
    if (!data || data.review_link_token !== token) {
      throw new ForbiddenException('This review link was regenerated — ask for the new link');
    }
    return giveawayId;
  }

  /** Resolves a review link token to its giveaway id, without exposing the giveaway itself —
   *  used by the guard/controller before a session exists yet. */
  async findGiveawayIdByReviewToken(token: string): Promise<string> {
    const { data, error } = await this.supabaseService.giveaways.select('id').eq('review_link_token', token).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Review link not found');
    return data.id as string;
  }

  /** Historically included a per-winner buffer (10bps USDC + 0.002 SOL-equivalent) sized to cover
   *  a direct MagicBlock private sweep to each winner's wallet. Winner payout no longer works that
   *  way — giveaway-payout.service.ts now funds a dedicated claim burner via a plain internal SPL
   *  transfer (no MagicBlock hop, no fee out of this burner at all; any claim-time MagicBlock fee
   *  is the recipient's own /c/[id] claim, paid from their claim burner, not this one). Nothing
   *  spends that buffer anymore for any creator, official or not, so required funding is exactly
   *  the prize pool — no markup, no "refunded later" surprise. */
  private computeFundingRequiredUsd(prizeAmountUsd: number, winnerCount: number): number {
    return prizeAmountUsd * winnerCount;
  }

  /** Columns for a token prize. Empty (all null) for USDC and Megapot. The mint is re-checked
   *  on-chain here so a client cannot invent a symbol or a token program. */
  private async prizeColumns(dto: CreateGiveawayDto, rewardType: GiveawayRewardType) {
    const empty = {
      prize_mint: null,
      prize_token_symbol: null,
      prize_token_name: null,
      prize_token_logo: null,
      prize_token_decimals: null,
      prize_token_program: null,
      prize_token_base_units: null,
      prize_swap_tx: null,
    };
    if (!dto.prize_mint?.trim()) return empty;
    if (rewardType === GiveawayRewardType.MEGAPOT_TICKET) {
      throw new BadRequestException('Ticket prizes cannot also pick a token.');
    }
    if (this.isDevnet) {
      throw new BadRequestException('Token prizes are available on mainnet only.');
    }
    const token = await this.tokenService.resolveMint(dto.prize_mint);
    return {
      ...empty,
      prize_mint: token.mint,
      prize_token_symbol: token.symbol,
      prize_token_name: token.name,
      prize_token_logo: token.logo,
      prize_token_decimals: token.decimals,
      prize_token_program: token.tokenProgram,
    };
  }

  private async logEvent(giveawayId: string, type: string, payload?: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabaseService.giveawayEvents.insert({ giveaway_id: giveawayId, type, payload: payload ?? null });
    if (error) this.logger.warn(`[GiveawayEvent] ${giveawayId} ${type}: failed to log (non-fatal): ${error.message}`);
  }

  /** No stored email column — resolved live from the creator's linked Privy account, if any, only
   *  at send time. Creators who never linked an email simply don't get this notification. */
  private async resolveLinkedEmail(userId: string): Promise<string | null> {
    const privyUser = await this.privy.getPrivyUser(userId).catch(() => null);
    const emailAccount = privyUser?.linked_accounts?.find((a: any) => (a.type ?? '').toLowerCase() === 'email');
    return (emailAccount?.address as string | undefined) ?? null;
  }

  /** Quick X giveaways: no tasks, one cleaned-up criteria object. Handles/hashtags are stored
   *  lowercase without @/# so the sync query and the local match check agree exactly. */
  private normalizeQuickCriteria(dto: CreateGiveawayDto): QuickCriteria {
    const c = dto.quick_criteria;
    if (!c) throw new BadRequestException('A quick giveaway needs quick_criteria.');
    const clean = (v: string, re: RegExp) => v.trim().replace(re, '').toLowerCase();
    const mentions = Array.from(new Set((c.required_mentions ?? []).map((m) => clean(m, /^@/)).filter((m) => /^[a-z0-9_]{1,15}$/.test(m))));
    const hashtags = Array.from(new Set((c.required_hashtags ?? []).map((h) => clean(h, /^#/)).filter((h) => /^[a-z0-9_]{1,60}$/.test(h))));
    const requiredText = c.required_text?.trim() || undefined;
    const requireMedia = c.require_media === true;
    if (!mentions.length && !hashtags.length && !requiredText && !requireMedia) {
      throw new BadRequestException('Add at least one required @mention, #hashtag or phrase so we know which posts qualify.');
    }
    const startAt = new Date(c.start_at);
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('start_at must be a valid date');
    return {
      required_mentions: mentions,
      required_hashtags: hashtags,
      ...(requiredText ? { required_text: requiredText } : {}),
      ...(requireMedia ? { require_media: true } : {}),
      ...(c.announcement_url ? { announcement_url: c.announcement_url.trim() } : {}),
      start_at: startAt.toISOString(),
    };
  }

  async create(userId: string, dto: CreateGiveawayDto): Promise<Giveaway> {
    const closeAt = new Date(dto.entries_close_at);
    if (Number.isNaN(closeAt.getTime()) || closeAt.getTime() <= Date.now()) {
      throw new BadRequestException('entries_close_at must be a valid future date');
    }

    const isQuick = dto.giveaway_type === GiveawayType.QUICK_POST;
    const quickCriteria = isQuick ? this.normalizeQuickCriteria(dto) : null;
    if (!isQuick && !dto.tasks?.length) throw new BadRequestException('Add at least one task.');

    const rewardType = dto.reward_type ?? GiveawayRewardType.USDC;
    // Megapot tickets are $1 each (TICKET_PRICE_USDC) — prize_amount_usd becomes numTickets
    // directly at payout time (giveaway-payout.service.ts), and lottery_gifts.num_tickets itself
    // is capped 1-100, so enforce both constraints up front rather than failing deep in payout.
    if (rewardType === GiveawayRewardType.MEGAPOT_TICKET) {
      if (!Number.isInteger(dto.prize_amount_usd) || dto.prize_amount_usd < 1 || dto.prize_amount_usd > 100) {
        throw new BadRequestException('Ticket prizes must be a whole dollar amount between $1 and $100 per winner.');
      }
    }
    const prize = await this.prizeColumns(dto, rewardType);

    // "Create as Loofta" — never trust dto.is_official alone; re-check the caller is actually an
    // admin here, server-side, same as every other admin-gated action in this module. An official
    // giveaway auto-approves (mints its burner and skips PENDING_APPROVAL) so the sole admin can
    // test the full funding -> draw -> claim pipeline without a redundant self-approval click.
    const isOfficial = !!dto.is_official && (await isPrivyUserAdmin(this.supabaseService, this.configService, userId));
    const officialBurner = isOfficial ? this.burnerSweep.createBurner() : null;
    if (isOfficial && !officialBurner) {
      throw new BadRequestException('Giveaway burner minting is not configured (SEND_PAYMENT_ENC_KEY missing). Contact an engineer.');
    }

    const platformFeeUsd = isOfficial ? 0 : giveawayPlatformFeeUsd(dto.prize_amount_usd * dto.winner_count);
    const funding_required_usd = this.computeFundingRequiredUsd(dto.prize_amount_usd, dto.winner_count) + platformFeeUsd;

    // A creator with no email linked to their Privy account is otherwise invisible once
    // submitted — no way to notify them of approval/rejection/expiry, and no way for admin to
    // reach them beyond their raw Privy id. Not enforced for an official ("create as Loofta")
    // giveaway, created by the admin themselves for internal testing.
    const creatorEmail = isOfficial ? null : await this.resolveLinkedEmail(userId);
    if (!isOfficial && !creatorEmail) {
      throw new BadRequestException('Add an email to your account before creating a giveaway — we use it to notify you about approval, funding, and payouts.');
    }

    const { data: giveaway, error } = await this.supabaseService.giveaways
      .insert({
        created_by: userId,
        title: dto.title,
        description: dto.description ?? null,
        logo_url: dto.logo_url ?? null,
        project_name: dto.project_name ?? null,
        short_id: generateShortId(),
        winner_count: dto.winner_count,
        selection_mode: dto.selection_mode,
        prize_amount_usd: dto.prize_amount_usd,
        reward_type: rewardType,
        ...prize,
        entries_close_at: closeAt.toISOString(),
        eligibility: dto.eligibility ?? {},
        giveaway_type: isQuick ? GiveawayType.QUICK_POST : GiveawayType.STANDARD,
        quick_criteria: quickCriteria,
        quick_duration_hours: isQuick ? dto.quick_duration_hours ?? null : null,
        funding_required_usd,
        platform_fee_usd: platformFeeUsd,
        is_devnet: this.isDevnet,
        mint: this.usdcMint,
        is_official: isOfficial,
        status: isOfficial ? GiveawayStatus.PENDING_FUNDING : GiveawayStatus.PENDING_APPROVAL,
        ...(isOfficial
          ? {
              admin_reviewed_by: userId,
              admin_reviewed_at: new Date().toISOString(),
              burner_address: officialBurner!.address,
              burner_encrypted_secret: officialBurner!.encryptedSecret,
            }
          : {}),
      })
      .select()
      .single();
    if (error || !giveaway) {
      throw new BadRequestException(`Failed to create giveaway: ${error?.message ?? 'unknown error'}`);
    }

    const taskRows = (dto.tasks ?? []).map((t, index) => ({
      giveaway_id: giveaway.id,
      order_index: index,
      task_type: t.task_type,
      config: t.config ?? {},
      // Fixed per-task-type, never client-supplied — see GIVEAWAY_TASK_VERIFICATION_MODE.
      verification_mode: GIVEAWAY_TASK_VERIFICATION_MODE[t.task_type],
    }));
    const { error: tasksError } = taskRows.length ? await this.supabaseService.giveawayTasks.insert(taskRows) : { error: null };
    if (tasksError) {
      // Roll back the giveaway row rather than leave a task-less giveaway stuck in PENDING_APPROVAL.
      await this.supabaseService.giveaways.delete().eq('id', giveaway.id);
      throw new BadRequestException(`Failed to create giveaway tasks: ${tasksError.message}`);
    }

    await this.logEvent(giveaway.id, 'submitted', { winner_count: dto.winner_count, task_count: dto.tasks?.length ?? 0, giveaway_type: isQuick ? 'quick_post' : 'standard' });
    if (isOfficial) {
      await this.logEvent(giveaway.id, 'approved', { admin: userId, auto: true, burner_address: officialBurner!.address });
    } else {
      // Fire-and-forget — PENDING_APPROVAL otherwise sits invisible until someone happens to open
      // the admin dashboard. Not sent for official giveaways, which auto-approve above.
      const alertEmail = this.configService.get<string>('GIVEAWAY_REVIEW_ALERT_EMAIL', GIVEAWAY_REVIEW_ALERT_EMAIL);
      const adminPath = this.configService.get<string>('ADMIN_SECRET_PATH', '');
      this.emailService
        .sendGiveawaySubmittedAlertEmail({
          to: alertEmail,
          title: giveaway.title,
          creatorEmail,
          prizeAmountUsd: dto.prize_amount_usd,
          winnerCount: dto.winner_count,
          adminUrl: adminPath ? `${this.baseUrl}/app/${adminPath}` : `${this.baseUrl}/app`,
        })
        .catch((e) => this.logger.warn(`[Giveaway] ${giveaway.id}: failed to send submission alert email (non-fatal): ${e?.message ?? e}`));
    }
    return giveaway as Giveaway;
  }

  /** Creator self-service edit — full rewrite of the same shape create() accepts, any time before
   *  the giveaway is actually FUNDED (DRAFT, PENDING_APPROVAL, or PENDING_FUNDING). Unlike the
   *  admin edit (post-approval, deliberately narrow) this can touch every field including
   *  prize/winner-count/tasks, since no money has moved yet at any of these statuses — but once
   *  PENDING_FUNDING, "no money has moved" has to be checked live, not assumed: a deposit can land
   *  mid-edit. If anything has already landed in the burner, prize_amount_usd/winner_count/
   *  selection_mode (the fields that drive funding_required_usd) are frozen — changing the target
   *  out from under a partial depositor risks the funding cron flipping OPEN against a stale
   *  threshold (see checkAndUpdateFundingStatus's own optimistic-concurrency guard for the other
   *  half of this race). Title/description/tasks/eligibility/entries_close_at stay editable
   *  regardless. Once FUNDED, this endpoint refuses entirely — from there it's the admin edit
   *  (narrow) or support (everything else). */
  async updateBeforeFunded(id: string, userId: string, dto: CreateGiveawayDto): Promise<Giveaway> {
    const giveaway = await this.findOneOrThrow(id);
    if (giveaway.created_by !== userId) throw new ForbiddenException('Not your giveaway');
    if (
      giveaway.status !== GiveawayStatus.DRAFT &&
      giveaway.status !== GiveawayStatus.PENDING_APPROVAL &&
      giveaway.status !== GiveawayStatus.PENDING_FUNDING
    ) {
      throw new BadRequestException(`Cannot edit — giveaway is ${giveaway.status}, already funded or beyond`);
    }

    const isQuick = giveaway.giveaway_type === GiveawayType.QUICK_POST;
    const quickCriteria = isQuick ? this.normalizeQuickCriteria({ ...dto, giveaway_type: GiveawayType.QUICK_POST }) : null;
    if (!isQuick && !dto.tasks?.length) throw new BadRequestException('Add at least one task.');

    const rewardType = dto.reward_type ?? GiveawayRewardType.USDC;
    if (rewardType === GiveawayRewardType.MEGAPOT_TICKET) {
      if (!Number.isInteger(dto.prize_amount_usd) || dto.prize_amount_usd < 1 || dto.prize_amount_usd > 100) {
        throw new BadRequestException('Ticket prizes must be a whole dollar amount between $1 and $100 per winner.');
      }
    }
    const prize = await this.prizeColumns(dto, rewardType);

    if (giveaway.status === GiveawayStatus.PENDING_FUNDING) {
      // Re-check on-chain rather than trusting the DB's (possibly stale) confirmed amount — same
      // pattern as cancelOrDelete's PENDING_FUNDING branch.
      const { fundingConfirmedUsd } = await this.fundingService.checkAndUpdateFundingStatus(giveaway);
      const moneyShapeChanged =
        Number(giveaway.prize_amount_usd) !== dto.prize_amount_usd ||
        giveaway.winner_count !== dto.winner_count ||
        giveaway.selection_mode !== dto.selection_mode ||
        giveaway.reward_type !== rewardType ||
        (giveaway.prize_mint ?? null) !== (prize.prize_mint ?? null);
      if (fundingConfirmedUsd > 0 && moneyShapeChanged) {
        throw new BadRequestException(
          'Funds have already started arriving for this giveaway, so the prize amount, winner count, and ' +
          'selection mode can no longer be changed. Contact support if you need to change them: hello@loofta.xyz or t.me/looftapay.',
        );
      }
    }

    const closeAt = new Date(dto.entries_close_at);
    if (Number.isNaN(closeAt.getTime()) || closeAt.getTime() <= Date.now()) {
      throw new BadRequestException('entries_close_at must be a valid future date');
    }
    // Preserve the platform fee already snapshotted at creation (never recompute from the live
    // constant here — that constant could change between creation and this edit) and re-add it on
    // top of the recomputed prize pool, since prize_amount_usd/winner_count may have just changed.
    const funding_required_usd = this.computeFundingRequiredUsd(dto.prize_amount_usd, dto.winner_count) + Number(giveaway.platform_fee_usd);

    const { data, error } = await this.supabaseService.giveaways
      .update({
        title: dto.title,
        description: dto.description ?? null,
        logo_url: dto.logo_url ?? null,
        project_name: dto.project_name ?? null,
        winner_count: dto.winner_count,
        selection_mode: dto.selection_mode,
        prize_amount_usd: dto.prize_amount_usd,
        reward_type: rewardType,
        ...prize,
        entries_close_at: closeAt.toISOString(),
        eligibility: dto.eligibility ?? {},
        ...(isQuick ? { quick_criteria: quickCriteria } : {}),
        funding_required_usd,
      })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(`Failed to update giveaway: ${error?.message ?? 'unknown error'}`);

    // Replace tasks wholesale — simplest correct approach given no entries/completions can exist
    // yet for a giveaway that hasn't reached OPEN (entries only start once OPEN).
    const { error: deleteError } = await this.supabaseService.giveawayTasks.delete().eq('giveaway_id', id);
    if (deleteError) throw new BadRequestException(`Failed to update tasks: ${deleteError.message}`);
    const taskRows = (dto.tasks ?? []).map((t, index) => ({
      giveaway_id: id,
      order_index: index,
      task_type: t.task_type,
      config: t.config ?? {},
      verification_mode: GIVEAWAY_TASK_VERIFICATION_MODE[t.task_type],
    }));
    const { error: tasksError } = taskRows.length ? await this.supabaseService.giveawayTasks.insert(taskRows) : { error: null };
    if (tasksError) throw new BadRequestException(`Failed to update giveaway tasks: ${tasksError.message}`);

    await this.logEvent(id, 'edited', { by: userId, status: giveaway.status });
    return data as Giveaway;
  }

  async findMine(userId: string): Promise<Giveaway[]> {
    // Cancelled giveaways are dropped by self-service delete — the creator's own list should
    // read as "gone", not linger with a Cancelled card forever. Still visible to admins.
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .eq('created_by', userId)
      .neq('status', GiveawayStatus.CANCELLED)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }

  async findOneForCreator(id: string, userId: string): Promise<Giveaway & { tasks: GiveawayTask[] }> {
    const giveaway = await this.findOneOrThrow(id);
    if (giveaway.created_by !== userId) throw new ForbiddenException('Not your giveaway');
    const tasks = await this.getTasks(id);
    return { ...giveaway, tasks };
  }

  async findOneOrThrow(id: string): Promise<Giveaway> {
    const { data, error } = await this.supabaseService.giveaways.select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Giveaway not found');
    return data as Giveaway;
  }

  async getTasks(giveawayId: string): Promise<GiveawayTask[]> {
    const { data, error } = await this.supabaseService.giveawayTasks
      .select('*')
      .eq('giveaway_id', giveawayId)
      .order('order_index', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as GiveawayTask[];
  }

  /**
   * Creator self-service delete/cancel — only while it's still safe to do without moving money or
   * touching entries: before approval (nothing exists yet, hard-delete) or while awaiting funding
   * AND the burner has never received anything (soft-cancel, no refund needed). Once any USDC has
   * actually landed in the burner, self-service delete is refused — cancelling with real funds
   * already moved needs a human, not a button. Once OPEN or later, entries/tasks are in progress
   * too, same refusal.
   */
  async cancelOrDelete(id: string, userId: string): Promise<{ deleted: boolean; cancelled: boolean }> {
    const giveaway = await this.findOneOrThrow(id);
    if (giveaway.created_by !== userId) throw new ForbiddenException('Not your giveaway');

    if (giveaway.status === GiveawayStatus.DRAFT || giveaway.status === GiveawayStatus.PENDING_APPROVAL) {
      const { error } = await this.supabaseService.giveaways.delete().eq('id', id);
      if (error) throw new BadRequestException(error.message);
      return { deleted: true, cancelled: false };
    }

    if (giveaway.status === GiveawayStatus.PENDING_FUNDING) {
      // Re-check on-chain rather than trusting the DB's (possibly stale) confirmed amount.
      const { fundingConfirmedUsd } = await this.fundingService.checkAndUpdateFundingStatus(giveaway);
      if (fundingConfirmedUsd > 0) {
        throw new BadRequestException(
          'This giveaway already has funds in its burner, so it can\'t be deleted automatically. ' +
          'Contact support to cancel it: hello@loofta.xyz or t.me/looftapay.',
        );
      }
      const { error } = await this.supabaseService.giveaways
        .update({ status: GiveawayStatus.CANCELLED, cancel_reason: 'Cancelled by creator (no funds received)' })
        .eq('id', id);
      if (error) throw new BadRequestException(error.message);
      await this.logEvent(id, 'cancelled', { by: 'creator' });
      return { deleted: false, cancelled: true };
    }

    throw new BadRequestException(
      `Cannot delete a giveaway that is ${giveaway.status} — contact support to cancel it: hello@loofta.xyz or t.me/looftapay.`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Cron support
  // ─────────────────────────────────────────────────────────────────

  /** Giveaways whose status can still change on its own (open for entries, closed and about to
   *  freeze, or mid-draw) — the draw cron's per-tick worklist. */
  async findAdvanceable(): Promise<Giveaway[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .in('status', [GiveawayStatus.OPEN, GiveawayStatus.ENTRIES_CLOSED, GiveawayStatus.DRAWING])
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }

  /** Terminal giveaways whose burner still needs its GC reclaim pass (rent/dust recovery
   *  backstop) — mirrors claims.service.ts's cronReclaimFinishedClaimBurners. */
  async findTerminalUnreclaimedBurners(): Promise<Giveaway[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .in('status', [GiveawayStatus.COMPLETED, GiveawayStatus.CANCELLED, GiveawayStatus.REFUNDED, GiveawayStatus.UNDERFUNDED_EXPIRED])
      .not('burner_address', 'is', null)
      .is('burner_reclaimed_at', null)
      .order('created_at', { ascending: true })
      .limit(10);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Giveaway[];
  }

  async markBurnerReclaimed(giveawayId: string): Promise<void> {
    const { error } = await this.supabaseService.giveaways.update({ burner_reclaimed_at: new Date().toISOString() }).eq('id', giveawayId);
    if (error) this.logger.warn(`[Giveaway] ${giveawayId}: failed to mark burner_reclaimed_at: ${error.message}`);
  }

  // ─────────────────────────────────────────────────────────────────
  // Admin
  // ─────────────────────────────────────────────────────────────────

  async findPendingApproval(): Promise<(Giveaway & { created_by_email: string | null })[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .eq('status', GiveawayStatus.PENDING_APPROVAL)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const giveaways = (data ?? []) as Giveaway[];
    return Promise.all(
      giveaways.map(async (g) => ({ ...g, created_by_email: await this.resolveLinkedEmail(g.created_by) })),
    );
  }

  /** Cancelled giveaways are hidden from the creator's own "mine" list (findMine) once cancelled —
   *  this is the one place they're still visible, for admin audit/support context. */
  async findCancelled(): Promise<(Giveaway & { created_by_email: string | null })[]> {
    const { data, error } = await this.supabaseService.giveaways
      .select('*')
      .eq('status', GiveawayStatus.CANCELLED)
      .order('updated_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const giveaways = (data ?? []) as Giveaway[];
    return Promise.all(
      giveaways.map(async (g) => ({ ...g, created_by_email: await this.resolveLinkedEmail(g.created_by) })),
    );
  }

  /** Admin lookup across every giveaway regardless of status — the only way an admin can find a
   *  giveaway that isn't PENDING_APPROVAL/CANCELLED (e.g. one that's already OPEN) in order to
   *  edit it. Optional title search since there's no other index for an admin to browse by. */
  async findAllForAdmin(search?: string): Promise<(Giveaway & { created_by_email: string | null })[]> {
    let query = this.supabaseService.giveaways.select('*').order('created_at', { ascending: false }).limit(100);
    if (search?.trim()) query = query.ilike('title', `%${search.trim()}%`);
    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);
    const giveaways = (data ?? []) as Giveaway[];
    return Promise.all(
      giveaways.map(async (g) => ({ ...g, created_by_email: await this.resolveLinkedEmail(g.created_by) })),
    );
  }

  /** Admin, support-mediated edit — see AdminEditGiveawayDto for why prize/winner-count/selection
   *  fields are deliberately not editable here. Works at any point except the terminal statuses,
   *  where there's nothing left to usefully change. */
  async adminEdit(id: string, adminUserId: string, dto: AdminEditGiveawayDto): Promise<Giveaway> {
    const giveaway = await this.findOneOrThrow(id);
    const TERMINAL = [
      GiveawayStatus.COMPLETED,
      GiveawayStatus.CANCELLED,
      GiveawayStatus.REJECTED,
      GiveawayStatus.REFUNDED,
      GiveawayStatus.UNDERFUNDED_EXPIRED,
    ];
    if (TERMINAL.includes(giveaway.status)) {
      throw new BadRequestException(`Cannot edit a giveaway that is ${giveaway.status}`);
    }

    const update: Record<string, unknown> = {};
    if (dto.title !== undefined) update.title = dto.title;
    if (dto.description !== undefined) update.description = dto.description;
    if (dto.logo_url !== undefined) update.logo_url = dto.logo_url;
    if (dto.entries_close_at !== undefined) {
      const closeAt = new Date(dto.entries_close_at);
      if (Number.isNaN(closeAt.getTime())) throw new BadRequestException('entries_close_at must be a valid date');
      update.entries_close_at = closeAt.toISOString();
    }
    if (
      dto.min_followers !== undefined ||
      dto.min_account_age_days !== undefined ||
      dto.verified_only !== undefined ||
      dto.required_countries !== undefined ||
      dto.required_continents !== undefined ||
      dto.excluded_countries !== undefined
    ) {
      update.eligibility = {
        ...giveaway.eligibility,
        ...(dto.min_followers !== undefined ? { min_followers: dto.min_followers } : {}),
        ...(dto.min_account_age_days !== undefined ? { min_account_age_days: dto.min_account_age_days } : {}),
        ...(dto.verified_only !== undefined ? { verified_only: dto.verified_only } : {}),
        ...(dto.required_countries !== undefined ? { required_countries: dto.required_countries } : {}),
        ...(dto.required_continents !== undefined ? { required_continents: dto.required_continents } : {}),
        ...(dto.excluded_countries !== undefined ? { excluded_countries: dto.excluded_countries } : {}),
      };
    }
    if (Object.keys(update).length === 0 && !dto.tasks?.length && !dto.delete_task_ids?.length && !dto.new_tasks?.length) {
      throw new BadRequestException('No editable fields provided');
    }

    let result: Giveaway = giveaway;
    if (Object.keys(update).length > 0) {
      const { data, error } = await this.supabaseService.giveaways
        .update(update)
        .eq('id', id)
        .select()
        .single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to update giveaway');
      result = data as Giveaway;
    }

    // Task edits update `config` in place on the existing row (matched by id, scoped to this
    // giveaway) — never delete/reinsert. giveaway_task_completions FK-cascades off
    // giveaway_tasks.id, and entrants may already have completions recorded against these exact
    // rows; task_type/verification_mode are fixed and not editable here.
    if (dto.tasks?.length) {
      for (const t of dto.tasks) {
        const { error: taskError } = await this.supabaseService.giveawayTasks
          .update({ config: t.config })
          .eq('id', t.id)
          .eq('giveaway_id', id);
        if (taskError) throw new BadRequestException(`Failed to update task ${t.id}: ${taskError.message}`);
      }
    }

    // Deleting a task is a real delete, not a soft-remove — giveaway_task_completions
    // FK-cascades off giveaway_tasks.id, so any entrant's completion for it (including an
    // already-verified one) is gone too. That's the intent: the task no longer exists, so neither
    // does anyone's record of having done it.
    if (dto.delete_task_ids?.length) {
      const { error: delError } = await this.supabaseService.giveawayTasks
        .delete()
        .in('id', dto.delete_task_ids)
        .eq('giveaway_id', id);
      if (delError) throw new BadRequestException(`Failed to delete task(s): ${delError.message}`);
    }

    // New tasks need a pending completion stub backfilled for every existing entrant — mirrors
    // GiveawayEntriesService.createTaskCompletionStubs, which only runs at entry time and would
    // otherwise never see a task added after someone already entered.
    if (dto.new_tasks?.length) {
      // order_index must stay unique per giveaway — the frontend task list keys off it, and a
      // fixed value here would collide with itself the second time a task was ever added (or with
      // an existing task at the same index), causing a duplicate React key.
      const { data: existingTasks } = await this.supabaseService.giveawayTasks.select('order_index').eq('giveaway_id', id);
      const nextOrderIndex = 1 + Math.max(-1, ...(existingTasks ?? []).map((t) => t.order_index as number));
      const { data: insertedTasks, error: insError } = await this.supabaseService.giveawayTasks
        .insert(
          dto.new_tasks.map((t, i) => ({
            giveaway_id: id,
            order_index: nextOrderIndex + i,
            task_type: t.task_type,
            config: t.config ?? {},
            verification_mode: GIVEAWAY_TASK_VERIFICATION_MODE[t.task_type],
          })),
        )
        .select();
      if (insError) throw new BadRequestException(`Failed to add task(s): ${insError.message}`);

      const { data: entries, error: entriesError } = await this.supabaseService.giveawayEntries.select('id').eq('giveaway_id', id);
      if (entriesError) throw new BadRequestException(`Failed to backfill task completions: ${entriesError.message}`);
      if (entries?.length && insertedTasks?.length) {
        const stubRows = entries.flatMap((e) =>
          (insertedTasks as GiveawayTask[]).map((t) => ({
            giveaway_entry_id: e.id,
            giveaway_task_id: t.id,
            verification_status: GiveawayTaskCompletionStatus.PENDING,
          })),
        );
        const { error: stubError } = await this.supabaseService.giveawayTaskCompletions.insert(stubRows);
        if (stubError) throw new BadRequestException(`Failed to backfill task completions: ${stubError.message}`);
      }
    }

    await this.logEvent(id, 'admin_edited', {
      admin: adminUserId,
      fields: Object.keys(update),
      task_ids: dto.tasks?.map((t) => t.id) ?? [],
      deleted_task_ids: dto.delete_task_ids ?? [],
      new_task_count: dto.new_tasks?.length ?? 0,
    });
    return result;
  }

  /** Approve -> mints the burner and moves to PENDING_FUNDING; reject -> REJECTED with a reason.
   *  Mirrors the `organizations` self-serve pending -> active/inactive shape — a plain admin
   *  status update, no dedicated approve/reject routes. */
  async adminReview(id: string, adminUserId: string, dto: AdminReviewGiveawayDto): Promise<Giveaway> {
    const giveaway = await this.findOneOrThrow(id);
    if (giveaway.status !== GiveawayStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, not PENDING_APPROVAL`);
    }

    if (dto.decision === 'reject') {
      if (!dto.rejection_reason) throw new BadRequestException('rejection_reason is required to reject a giveaway');
      const { data, error } = await this.supabaseService.giveaways
        .update({
          status: GiveawayStatus.REJECTED,
          admin_reviewed_by: adminUserId,
          admin_reviewed_at: new Date().toISOString(),
          rejection_reason: dto.rejection_reason,
        })
        .eq('id', id)
        .select()
        .single();
      if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to reject giveaway');
      await this.logEvent(id, 'rejected', { reason: dto.rejection_reason, admin: adminUserId });

      this.resolveLinkedEmail(data.created_by).then((recipientEmail) => {
        if (!recipientEmail) return;
        this.emailService
          .sendGiveawayRejectedEmail({ recipientEmail, title: data.title, reason: dto.rejection_reason! })
          .catch((e) => this.logger.warn(`[Giveaway] ${id}: failed to send rejection email (non-fatal): ${e?.message ?? e}`));
      });

      return data as Giveaway;
    }

    const burner = this.burnerSweep.createBurner();
    if (!burner) {
      throw new BadRequestException('Giveaway burner minting is not configured (SEND_PAYMENT_ENC_KEY missing). Contact an engineer before approving giveaways.');
    }

    const { data, error } = await this.supabaseService.giveaways
      .update({
        status: GiveawayStatus.PENDING_FUNDING,
        admin_reviewed_by: adminUserId,
        admin_reviewed_at: new Date().toISOString(),
        burner_address: burner.address,
        burner_encrypted_secret: burner.encryptedSecret,
      })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to approve giveaway');
    await this.logEvent(id, 'approved', { admin: adminUserId, burner_address: burner.address });

    this.resolveLinkedEmail(data.created_by).then((recipientEmail) => {
      if (!recipientEmail) return;
      this.emailService
        .sendGiveawayApprovedEmail({
          recipientEmail,
          title: data.title,
          giveawayUrl: `${this.baseUrl}/rewards/giveaways/${id}/manage`,
        })
        .catch((e) => this.logger.warn(`[Giveaway] ${id}: failed to send approval email (non-fatal): ${e?.message ?? e}`));
    });

    return data as Giveaway;
  }

  /** Admin manual expiry — for a giveaway that was approved (PENDING_FUNDING) but the creator
   *  never funded it. Re-checks the burner's on-chain balance first (same guard as
   *  cancelOrDelete's PENDING_FUNDING branch) so an admin can't accidentally expire one that
   *  actually just got funded and is about to flip to OPEN via the funding cron. */
  async adminExpireUnfunded(id: string, adminUserId: string, reason?: string): Promise<Giveaway> {
    const giveaway = await this.findOneOrThrow(id);
    if (giveaway.status !== GiveawayStatus.PENDING_FUNDING) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, not PENDING_FUNDING — nothing to expire`);
    }

    const { fundingConfirmedUsd } = await this.fundingService.checkAndUpdateFundingStatus(giveaway);
    if (fundingConfirmedUsd > 0) {
      throw new BadRequestException('This giveaway already has funds in its burner — refresh and check its funding status instead of expiring it.');
    }

    const expireReason = reason?.trim() || 'Approved but never funded';
    const { data, error } = await this.supabaseService.giveaways
      .update({ status: GiveawayStatus.UNDERFUNDED_EXPIRED, cancel_reason: expireReason })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to expire giveaway');
    await this.logEvent(id, 'expired', { admin: adminUserId, reason: expireReason });

    this.resolveLinkedEmail(data.created_by).then((recipientEmail) => {
      if (!recipientEmail) return;
      this.emailService
        .sendGiveawayExpiredEmail({ recipientEmail, title: data.title, reason: expireReason })
        .catch((e) => this.logger.warn(`[Giveaway] ${id}: failed to send expiry email (non-fatal): ${e?.message ?? e}`));
    });

    return data as Giveaway;
  }

  /**
   * Admin cancel — for a giveaway that's already past approval (PENDING_FUNDING, FUNDED, OPEN, or
   * ENTRIES_CLOSED) and needs to be pulled, e.g. a policy issue found after the fact. Not for
   * DRAFT/PENDING_APPROVAL — reject (adminReview) or the creator's own cancelOrDelete already
   * cover those, and not for DRAWING/WINNERS_SELECTED/PAYOUT_IN_PROGRESS or a terminal status —
   * once a draw has started, winners may already be selected or paid, which needs a human, not a
   * status flip. Refunds whatever's sitting in the burner back to the creator in full (no platform
   * fee withheld — the giveaway never actually ran) before flipping to CANCELLED; a failed refund
   * doesn't block the cancellation itself (mirrors GiveawayPayoutService.finalizeIfComplete's
   * non-fatal refund — the terminal-burner GC cron will still reclaim the dust eventually, just to
   * the fee payer instead of the creator, so a failure here is logged for manual follow-up).
   */
  async adminCancel(id: string, adminUserId: string, reason?: string): Promise<Giveaway> {
    const giveaway = await this.findOneOrThrow(id);
    const CANCELLABLE = [
      GiveawayStatus.PENDING_FUNDING,
      GiveawayStatus.FUNDED,
      GiveawayStatus.OPEN,
      GiveawayStatus.ENTRIES_CLOSED,
    ];
    if (!CANCELLABLE.includes(giveaway.status)) {
      throw new BadRequestException(
        `Cannot cancel — giveaway is ${giveaway.status}. Reject it instead if it's still pending approval, or contact support once a draw is in progress or it has already finished.`,
      );
    }

    const cancelReason = reason?.trim() || 'Cancelled by admin';

    if (giveaway.burner_address && giveaway.burner_encrypted_secret && giveaway.mint) {
      try {
        const conn = this.solanaSponsor.getConnectionForCluster(this.cluster(giveaway));
        const mint = new PublicKey(giveaway.mint);
        const burnerKeypair = this.burnerSweep.decryptBurner(giveaway.burner_address, giveaway.burner_encrypted_secret);
        const creatorWallet = await this.usersService.getSolanaWalletAddress(giveaway.created_by, { skipCache: true });
        const refund = await this.burnerSweep.refundRemainingToCreator({
          conn,
          burnerKeypair,
          creatorWallet,
          mint,
          context: `giveaway:${id}:admin-cancel-refund`,
          callerUserId: giveaway.created_by,
        });
        if (refund) await this.logEvent(id, 'refund_issued', { tx_hash: refund.sweepTxHash, by: 'admin' });
      } catch (e) {
        this.logger.warn(`[Giveaway] ${id}: admin-cancel refund failed (non-fatal, GC cron will catch remaining dust): ${String(e)}`);
      }
    }

    const { data, error } = await this.supabaseService.giveaways
      .update({ status: GiveawayStatus.CANCELLED, cancel_reason: cancelReason })
      .eq('id', id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to cancel giveaway');
    await this.logEvent(id, 'cancelled', { by: 'admin', admin: adminUserId, reason: cancelReason });

    this.resolveLinkedEmail(data.created_by).then((recipientEmail) => {
      if (!recipientEmail) return;
      this.emailService
        .sendGiveawayCancelledEmail({ recipientEmail, title: data.title, reason: cancelReason })
        .catch((e) => this.logger.warn(`[Giveaway] ${id}: failed to send cancellation email (non-fatal): ${e?.message ?? e}`));
    });

    return data as Giveaway;
  }
}
