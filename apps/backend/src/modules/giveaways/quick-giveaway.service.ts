import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '@/redis/redis.service';
import { XVerificationService, TIER_MIN_CRYPTO_FOLLOWERS } from './x-verification.service';
import { GiveawaysService } from './giveaways.service';
import {
  Giveaway,
  GiveawayEntry,
  GiveawayEntryStatus,
  GiveawayStatus,
  GiveawayType,
  QuickCriteria,
} from './entities/giveaway.entity';

/** Pages of 20 posts per sync. Each page is one Sorsa call against the daily cap, so this is the
 *  hard ceiling on what a single sync can cost (see the cost incidents in x-verification.service). */
const MAX_PAGES_PER_SYNC = 5;
/** Public page views trigger a lazy sync at most this often per giveaway. */
const SYNC_THROTTLE_MS = 5 * 60 * 1000;
const ELIGIBILITY_CACHE_SECONDS = 60;
const MAX_POSTS_RETURNED = 300;

const TIER_NAMES: Record<string, string> = { noted: 'Noted', credible: 'Credible', significant: 'Significant', supreme: 'Supreme' };

export interface QuickPost {
  entry_id: string;
  x_handle: string;
  avatar_url: string | null;
  post_id: string | null;
  post_url: string | null;
  post_text: string | null;
  post_created_at: string | null;
  post_media: GiveawayEntry['post_media'];
  shortlisted: boolean;
  status: GiveawayEntryStatus;
}

export interface EligibilityResult {
  eligible: boolean;
  /** Plain-language checklist, one line per requirement, so the page can show what is missing. */
  checks: Array<{ label: string; ok: boolean }>;
  post_url?: string;
  reason?: string;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Quick X giveaways: no "Enter" button. Qualifying public posts are found with a bounded Sorsa
 * search and stored as giveaway_entries (user_id = 'x:<x user id>', one entry per author). From
 * there the normal pipeline takes over: the creator hand-picks (manual mode) or the VRF draws
 * (random mode), and winners are paid by X username.
 */
@Injectable()
export class QuickGiveawayService {
  private readonly logger = new Logger(QuickGiveawayService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly redis: RedisService,
    private readonly xVerification: XVerificationService,
    private readonly giveawaysService: GiveawaysService,
  ) {}

  // ───────────────────────── matching ─────────────────────────

  private buildQuery(c: QuickCriteria, fromHandle?: string): string {
    const parts: string[] = [];
    if (fromHandle) parts.push(`from:${fromHandle}`);
    for (const h of c.required_hashtags) parts.push(`#${h}`);
    for (const m of c.required_mentions) parts.push(`@${m}`);
    if (c.required_text) parts.push(`"${c.required_text.replace(/"/g, '')}"`);
    parts.push(`since:${dateOnly(c.start_at)}`);
    return parts.join(' ');
  }

  /** Per-requirement checklist for one tweet. The sync only keeps tweets where all are ok. */
  private hasMedia(t: Record<string, any>): boolean {
    const entities = Array.isArray(t.entities) ? t.entities : [];
    return entities.some((e: any) => e?.type === 'photo' || e?.type === 'video');
  }

  private checkTweet(
    t: Record<string, any>,
    c: QuickCriteria,
    elig?: Giveaway['eligibility'],
  ): Array<{ label: string; ok: boolean }> {
    const text = String(t.full_text ?? '').toLowerCase();
    const created = new Date(String(t.created_at ?? '')).getTime();
    const checks: Array<{ label: string; ok: boolean }> = [];
    checks.push({
      label: 'Posted after the giveaway started',
      ok: Number.isFinite(created) && created >= new Date(c.start_at).getTime(),
    });
    for (const m of c.required_mentions) checks.push({ label: `Tags @${m}`, ok: text.includes(`@${m}`) });
    for (const h of c.required_hashtags) checks.push({ label: `Uses #${h}`, ok: new RegExp(`#${h}(?![a-z0-9_])`).test(text) });
    if (c.required_text) checks.push({ label: `Mentions "${c.required_text}"`, ok: text.includes(c.required_text.toLowerCase()) });
    if (c.require_media) checks.push({ label: 'Includes an image or video', ok: this.hasMedia(t) });
    // Author-level filters ride on the user object the search already returned: no extra X call.
    const minAge = elig?.min_account_age_days;
    if (typeof minAge === 'number' && minAge > 0) {
      const createdAt = new Date(String(t.user?.created_at ?? '')).getTime();
      checks.push({
        label: `X account ${minAge}+ days old`,
        ok: Number.isFinite(createdAt) && (Date.now() - createdAt) / 86_400_000 >= minAge,
      });
    }
    if (elig?.verified_only) checks.push({ label: 'Verified on X', ok: t.user?.verified === true });
    return checks;
  }

  /** Reputation tier gate. Costs one (cached) Sorsa call, so callers run it only after every
   *  free check has passed. Errors propagate so a cap or outage never admits unchecked posts. */
  private async meetsTier(handle: string, elig?: Giveaway['eligibility']): Promise<boolean> {
    const min = elig?.min_tier ? TIER_MIN_CRYPTO_FOLLOWERS[elig.min_tier] : 0;
    if (!min) return true;
    return (await this.xVerification.cryptoFollowerCount(handle)) >= min;
  }

  private isQualifying(t: Record<string, any>, c: QuickCriteria, elig?: Giveaway['eligibility']): boolean {
    if (t.retweeted_status) return false;
    const author = String(t.user?.username ?? '').toLowerCase();
    if (!author || t.user?.protected) return false;
    // The partner accounts being tagged (and the creator) never compete for their own prize.
    if (c.required_mentions.includes(author)) return false;
    return this.checkTweet(t, c, elig).every((x) => x.ok);
  }

  // ───────────────────────── storage ─────────────────────────

  private mediaOf(t: Record<string, any>): GiveawayEntry['post_media'] {
    const entities = Array.isArray(t.entities) ? t.entities : [];
    const media = entities
      .filter((e: any) => e?.type === 'photo' || e?.type === 'video')
      .slice(0, 4)
      .map((e: any) => ({ type: String(e.type), preview: e.preview ? String(e.preview) : undefined, link: e.link ? String(e.link) : undefined }));
    return media.length ? media : null;
  }

  /** Inserts the author's first qualifying post. A second post from the same author is ignored
   *  (unique per giveaway+user), which is what keeps one person from stacking the draw. */
  private async insertPostEntry(giveaway: Giveaway, t: Record<string, any>): Promise<boolean> {
    const authorId = String(t.user?.id ?? '');
    const handle = String(t.user?.username ?? '');
    const postId = String(t.id ?? '');
    if (!authorId || !handle || !postId) return false;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { count } = await this.supabaseService.giveawayEntries
        .select('id', { count: 'exact', head: true })
        .eq('giveaway_id', giveaway.id);
      const { error } = await this.supabaseService.giveawayEntries.insert({
        giveaway_id: giveaway.id,
        user_id: `x:${authorId}`,
        entry_index: (count ?? 0) + 1,
        x_user_id: authorId,
        x_handle: handle,
        avatar_url: t.user?.profile_image_url ?? null,
        eligibility_snapshot: {
          followers_count: Number(t.user?.followers_count ?? 0),
          account_created_at: String(t.user?.created_at ?? ''),
        },
        status: GiveawayEntryStatus.ENTERED,
        post_id: postId,
        post_url: `https://x.com/${handle}/status/${postId}`,
        post_text: String(t.full_text ?? '').slice(0, 1000),
        post_created_at: t.created_at ? new Date(String(t.created_at)).toISOString() : null,
        post_media: this.mediaOf(t),
      });
      if (!error) return true;
      if (error.message.includes('giveaway_entries_giveaway_user_uidx')) return false; // already has a post
      if (!error.message.includes('duplicate key')) {
        this.logger.warn(`[QuickGiveaway] ${giveaway.id}: insert failed for @${handle}: ${error.message}`);
        return false;
      }
      // entry_index collision: retry with a fresh count
    }
    return false;
  }

  // ───────────────────────── contest window ─────────────────────────

  /**
   * The contest length counts from the moment the giveaway goes OPEN, not from creation. Safe to
   * call repeatedly: only the first call after OPEN does anything.
   */
  async ensureWindowStarted(giveaway: Giveaway): Promise<Giveaway> {
    if (
      giveaway.giveaway_type !== GiveawayType.QUICK_POST ||
      giveaway.status !== GiveawayStatus.OPEN ||
      giveaway.quick_window_started_at ||
      !giveaway.quick_duration_hours
    ) {
      return giveaway;
    }
    const now = new Date();
    const closeAt = new Date(now.getTime() + giveaway.quick_duration_hours * 3_600_000);
    const { data } = await this.supabaseService.giveaways
      .update({ quick_window_started_at: now.toISOString(), entries_close_at: closeAt.toISOString() })
      .eq('id', giveaway.id)
      .is('quick_window_started_at', null)
      .select('*')
      .maybeSingle();
    return (data as Giveaway | null) ?? (await this.giveawaysService.findOneOrThrow(giveaway.id));
  }

  // ───────────────────────── sync ─────────────────────────

  /**
   * Pulls qualifying posts from X. Safe to call from anywhere (page views, the draw): it claims a
   * per-giveaway slot first, so concurrent callers do not each pay for the same search.
   * `force` skips the 5 minute throttle (used by the final sync right before the draw).
   */
  async sync(giveaway: Giveaway, opts: { force?: boolean; includeClosed?: boolean } = {}): Promise<{ added: number; synced: boolean }> {
    if (giveaway.giveaway_type !== GiveawayType.QUICK_POST || !giveaway.quick_criteria) return { added: 0, synced: false };
    const allowed = opts.includeClosed ? [GiveawayStatus.OPEN, GiveawayStatus.ENTRIES_CLOSED] : [GiveawayStatus.OPEN];
    if (!allowed.includes(giveaway.status)) return { added: 0, synced: false };
    if (!this.xVerification.isAvailable()) return { added: 0, synced: false };

    // Compare-and-swap on quick_last_synced_at: only the caller that flips it runs the search.
    const now = new Date();
    const staleBefore = new Date(now.getTime() - (opts.force ? 0 : SYNC_THROTTLE_MS)).toISOString();
    const { data: claimed } = await this.supabaseService.giveaways
      .update({ quick_last_synced_at: now.toISOString() })
      .eq('id', giveaway.id)
      .or(`quick_last_synced_at.is.null,quick_last_synced_at.lt.${staleBefore}`)
      .select('id');
    if (!claimed?.length) return { added: 0, synced: false };

    const criteria = giveaway.quick_criteria;
    const query = this.buildQuery(criteria);
    let cursor: string | undefined;
    let added = 0;
    try {
      for (let page = 0; page < MAX_PAGES_PER_SYNC; page++) {
        const res = await this.xVerification.searchTweetsPage(query, cursor);
        if (!res.tweets.length) break;
        // Oldest first within the page so the earliest post by an author is the one kept.
        const sorted = [...res.tweets].sort((a, b) => new Date(String(a.created_at)).getTime() - new Date(String(b.created_at)).getTime());
        for (const t of sorted) {
          if (!this.isQualifying(t, criteria, giveaway.eligibility)) continue;
          if (!(await this.meetsTier(String(t.user?.username ?? ''), giveaway.eligibility))) continue;
          if (await this.insertPostEntry(giveaway, t)) added++;
        }
        if (!res.nextCursor || res.nextCursor === cursor) break;
        cursor = res.nextCursor;
      }
    } catch (e: any) {
      // Cap errors and Sorsa outages just leave the feed as it was; the next sync retries.
      this.logger.warn(`[QuickGiveaway] ${giveaway.id}: sync stopped early: ${e?.message ?? e}`);
    }
    if (added) this.logger.log(`[QuickGiveaway] ${giveaway.id}: +${added} qualifying post(s)`);
    return { added, synced: true };
  }

  // ───────────────────────── public reads ─────────────────────────

  /** The public feed. Lazily refreshes while the giveaway is open. Excluded posts are hidden. */
  async listPosts(giveawayId: string): Promise<{ posts: QuickPost[]; total: number; last_synced_at: string | null; draw_pool: 'all' | 'shortlist' }> {
    let giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    if (giveaway.giveaway_type !== GiveawayType.QUICK_POST) throw new BadRequestException('Not a quick giveaway');
    giveaway = await this.ensureWindowStarted(giveaway);
    await this.sync(giveaway);
    giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);

    const { data, error } = await this.supabaseService.giveawayEntries
      .select('id, x_handle, avatar_url, post_id, post_url, post_text, post_created_at, post_media, shortlisted, status')
      .eq('giveaway_id', giveawayId)
      .neq('status', GiveawayEntryStatus.DISQUALIFIED)
      .order('post_created_at', { ascending: false })
      .limit(MAX_POSTS_RETURNED);
    if (error) throw new BadRequestException(error.message);
    const posts: QuickPost[] = (data ?? []).map((e: any) => ({
      entry_id: e.id,
      x_handle: e.x_handle,
      avatar_url: e.avatar_url,
      post_id: e.post_id,
      post_url: e.post_url,
      post_text: e.post_text,
      post_created_at: e.post_created_at,
      post_media: e.post_media,
      shortlisted: e.shortlisted === true,
      status: e.status,
    }));
    return { posts, total: posts.length, last_synced_at: giveaway.quick_last_synced_at, draw_pool: giveaway.quick_draw_pool ?? 'all' };
  }

  /** "Check eligibility": looks at the handle's own recent posts and says what is missing. */
  async checkEligibility(giveawayId: string, rawHandle: string): Promise<EligibilityResult> {
    const giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    const criteria = giveaway.quick_criteria;
    if (giveaway.giveaway_type !== GiveawayType.QUICK_POST || !criteria) throw new BadRequestException('Not a quick giveaway');
    const handle = rawHandle.replace(/^@/, '').trim().toLowerCase();
    if (!/^[a-z0-9_]{1,15}$/.test(handle)) throw new BadRequestException('Enter a valid X username');
    if (criteria.required_mentions.includes(handle)) {
      return { eligible: false, checks: [], reason: `@${handle} is one of the accounts running this giveaway.` };
    }

    // Already in the pool: answer from our own data, no X call.
    const { data: existing } = await this.supabaseService.giveawayEntries
      .select('id, status, post_url')
      .eq('giveaway_id', giveawayId)
      .ilike('x_handle', handle)
      .maybeSingle();
    if (existing) {
      if (existing.status === GiveawayEntryStatus.DISQUALIFIED) {
        return { eligible: false, checks: [], reason: 'This post was removed by the organiser.' };
      }
      return { eligible: true, checks: this.allOk(criteria, giveaway.eligibility), post_url: existing.post_url ?? undefined };
    }

    const cacheKey = `quickgiveaway:elig:${giveawayId}:${handle}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached) as EligibilityResult; } catch { /* fall through */ }
    }

    if (giveaway.status !== GiveawayStatus.OPEN) {
      return { eligible: false, checks: [], reason: 'This giveaway is no longer taking posts.' };
    }
    if (!this.xVerification.isAvailable()) throw new BadRequestException('Eligibility checks are unavailable right now.');

    const { tweets } = await this.xVerification.searchTweetsPage(`from:${handle} since:${dateOnly(criteria.start_at)}`);
    const own = tweets.filter((t) => !t.retweeted_status && String(t.user?.username ?? '').toLowerCase() === handle);

    let result: EligibilityResult;
    const winner = own.find((t) => this.isQualifying(t, criteria, giveaway.eligibility));
    if (winner && !(await this.meetsTier(handle, giveaway.eligibility))) {
      result = {
        eligible: false,
        checks: [...this.allOk(criteria, giveaway.eligibility).filter((c) => !c.label.includes('reputation')), { label: this.tierLabel(giveaway.eligibility), ok: false }],
        post_url: `https://x.com/${handle}/status/${winner.id}`,
        reason: 'Your post follows the rules, but your account is below the minimum crypto reputation tier for this giveaway.',
      };
    } else if (winner) {
      await this.insertPostEntry(giveaway, winner);
      result = { eligible: true, checks: this.allOk(criteria, giveaway.eligibility), post_url: `https://x.com/${handle}/status/${winner.id}` };
    } else if (!own.length) {
      result = {
        eligible: false,
        checks: this.checklist(criteria, false, giveaway.eligibility),
        reason: `We could not find any post from @${handle} since the giveaway started.`,
      };
    } else {
      // Report against the closest attempt so the message is specific ("missing #halloweengiveaway").
      const best = own
        .map((t) => ({ t, checks: this.checkTweet(t, criteria, giveaway.eligibility) }))
        .sort((a, b) => b.checks.filter((x) => x.ok).length - a.checks.filter((x) => x.ok).length)[0];
      result = { eligible: false, checks: best.checks, post_url: `https://x.com/${handle}/status/${best.t.id}`, reason: 'Your closest post is missing something.' };
    }
    await this.redis.set(cacheKey, JSON.stringify(result), ELIGIBILITY_CACHE_SECONDS);
    return result;
  }

  private checklist(c: QuickCriteria, ok: boolean, elig?: Giveaway['eligibility']) {
    const labels = [
      ...c.required_mentions.map((m) => `Tags @${m}`),
      ...c.required_hashtags.map((h) => `Uses #${h}`),
      ...(c.required_text ? [`Mentions "${c.required_text}"`] : []),
      ...(c.require_media ? ['Includes an image or video'] : []),
      ...(elig?.min_account_age_days ? [`X account ${elig.min_account_age_days}+ days old`] : []),
      ...(elig?.verified_only ? ['Verified on X'] : []),
      ...(elig?.min_tier ? [this.tierLabel(elig)] : []),
    ];
    return labels.map((label) => ({ label, ok }));
  }

  private tierLabel(elig?: Giveaway['eligibility']): string {
    return `Crypto reputation: ${TIER_NAMES[elig?.min_tier ?? ''] ?? ''} tier or higher`;
  }

  private allOk(c: QuickCriteria, elig?: Giveaway['eligibility']) {
    return this.checklist(c, true, elig);
  }

  // ───────────────────────── creator actions ─────────────────────────

  private async assertCreatorOwnsQuick(giveawayId: string, creatorId: string): Promise<Giveaway> {
    const giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    if (giveaway.created_by !== creatorId) throw new ForbiddenException('Not your giveaway');
    if (giveaway.giveaway_type !== GiveawayType.QUICK_POST) throw new BadRequestException('Not a quick giveaway');
    return giveaway;
  }

  /** Creator-triggered refresh. Still throttled to 30s so a nervous click spree cannot burn the cap. */
  async refresh(giveawayId: string, creatorId: string): Promise<{ added: number; synced: boolean }> {
    const giveaway = await this.assertCreatorOwnsQuick(giveawayId, creatorId);
    const last = giveaway.quick_last_synced_at ? new Date(giveaway.quick_last_synced_at).getTime() : 0;
    if (Date.now() - last < 30_000) return { added: 0, synced: false };
    return this.sync(giveaway, { force: true });
  }

  /** Hide a spam / off-topic post from the pool and the public feed (reversible). */
  async setExcluded(giveawayId: string, entryId: string, creatorId: string, excluded: boolean): Promise<void> {
    const giveaway = await this.assertCreatorOwnsQuick(giveawayId, creatorId);
    if (giveaway.status !== GiveawayStatus.OPEN) {
      throw new BadRequestException('Posts can only be hidden while the giveaway is open.');
    }
    const { error } = await this.supabaseService.giveawayEntries
      .update({ status: excluded ? GiveawayEntryStatus.DISQUALIFIED : GiveawayEntryStatus.ENTERED })
      .eq('id', entryId)
      .eq('giveaway_id', giveawayId);
    if (error) throw new BadRequestException(error.message);
  }

  /** Star / unstar a post. The shortlist is public: the page shows exactly who the draw can pick. */
  async setShortlisted(giveawayId: string, entryId: string, creatorId: string, on: boolean): Promise<void> {
    const giveaway = await this.assertCreatorOwnsQuick(giveawayId, creatorId);
    if (giveaway.status !== GiveawayStatus.OPEN) {
      throw new BadRequestException('The shortlist is locked once the giveaway closes.');
    }
    const { error } = await this.supabaseService.giveawayEntries
      .update({ shortlisted: on })
      .eq('id', entryId)
      .eq('giveaway_id', giveawayId)
      .neq('status', GiveawayEntryStatus.DISQUALIFIED);
    if (error) throw new BadRequestException(error.message);
  }

  /** Choose what the VRF draws from. Locked once the giveaway closes so it can't be changed after the fact. */
  async setDrawPool(giveawayId: string, creatorId: string, pool: 'all' | 'shortlist'): Promise<void> {
    const giveaway = await this.assertCreatorOwnsQuick(giveawayId, creatorId);
    if (giveaway.status !== GiveawayStatus.OPEN) {
      throw new BadRequestException('The draw pool is locked once the giveaway closes.');
    }
    const { error } = await this.supabaseService.giveaways.update({ quick_draw_pool: pool }).eq('id', giveawayId);
    if (error) throw new BadRequestException(error.message);
  }
}
