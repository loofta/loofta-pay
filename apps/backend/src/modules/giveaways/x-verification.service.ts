import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwitterApi, ApiResponseError } from 'twitter-api-v2';
import { SupabaseService } from '@/database/supabase.service';
import { RedisService } from '@/redis/redis.service';
import {
  Giveaway,
  GiveawayTask,
  GiveawayTaskType,
  GiveawayTaskCompletion,
  GiveawayTaskCompletionStatus,
  GiveawayEntry,
} from './entities/giveaway.entity';

export interface XProfile {
  id: string;
  username: string;
  createdAt: string;
  followersCount: number;
  profileImageUrl: string | null;
}

/** Unwraps the real reason X rejected a request — `String(e)` on a twitter-api-v2 ApiResponseError
 *  just gives a generic "Request failed with code 403", which is useless for telling "out of
 *  quota" apart from "wrong access level" apart from "bad credentials". X's actual error body
 *  (title/detail/type, per api.x.com's documented error shape) says which. */
function describeXApiError(e: unknown): string {
  if (e instanceof ApiResponseError) {
    const detail = e.data?.detail || e.data?.title || e.data?.error;
    const errors = e.data?.errors?.map((err: any) => err.detail || err.message || err.title).filter(Boolean).join('; ');
    return `HTTP ${e.code}${e.isAuthError ? ' (auth)' : ''}${e.rateLimitError ? ' (rate limit)' : ''}: ${detail || errors || e.message}`;
  }
  return String(e);
}

/** Bound on how many retweeters/likers/followers we'll page through for a single task —
 *  a "fetch once per giveaway, check locally" pass still has to end somewhere. Logged loudly
 *  when hit, since a truncated list means some real completions could be missed. */
const MAX_PAGINATED_USERS = 5_000;

/** X API calls are metered/expensive (confirmed real cost, ~$3/67 entries on 2026-08-06, a
 *  separate $19.60/day spike on 2026-08-11 traced to a giveaway stuck in ENTRIES_CLOSED re-running
 *  the final sweep on every cron tick, and a third incident on 2026-08-15 where a 3-minute TTL
 *  combined with an in-memory-only cache — wiped on every backend redeploy, which happens many
 *  times a day during active work — meant this "cache" barely ever hit in practice: ~120 real
 *  entrants somehow produced 10.68k raw X API calls in a day, because nearly every retweeter/liker/
 *  follower-list fetch (each up to MAX_PAGINATED_USERS-worth of paginated requests) started from
 *  scratch. Raised substantially and moved to Redis (see fetchIdSetCacheKey/getCachedIds below) so
 *  it actually survives process restarts — a stale follower/engagement list for up to an hour costs
 *  nothing functionally (the design is already "batched, not real-time", see class doc below), a
 *  cache that doesn't survive a redeploy costs real money. */
const FETCH_CACHE_TTL_MS = 60 * 60 * 1000;

// resolveXProfile is called on every enter() attempt, including ones that fail eligibility (no DB
// row gets created for those, so nothing else stops a rejected user from immediately retrying).
// Eligibility data (follower count, account age) doesn't move fast enough to need a fresh fetch on
// every retry — Lisa: 24h is fine. Worst case a borderline follower-count entrant waits up to a day
// to re-check after growing their account, which is an edge case, not a functional regression.
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Hard backstop, independent of any single code path being bug-free. Real cost incidents so far:
// ~$3/67 entries (2026-08-06, the old always-on 2-min cron) and ~$19.60/day (2026-08-11, the
// sweep-without-idempotency bug that redesign left behind — see giveaway-draw.service.ts). Two
// logic bugs in one area in a week is a pattern, not a fluke — this caps worst-case daily spend
// regardless of whatever the next bug turns out to be. Counts fetch *units* (one per getCachedIds
// miss or resolveXProfile call), not raw HTTP calls, since a single unit can internally page/batch
// — a deliberately conservative proxy, not an exact request count. Override via
// GIVEAWAY_X_API_DAILY_CALL_CAP if legitimate traffic ever needs more.
const DEFAULT_DAILY_CALL_CAP = 300;

/**
 * Real X API v2 verification for X-based giveaway tasks, reusing the same OAuth1 user-context
 * credentials apps/twitter-bot already runs on (TWITTER_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET)
 * — Lisa confirmed the X API is already on a pay-as-you-go tier, so this is a second consumer of
 * the same app, not a new provisioning decision.
 *
 * Fetches a tweet's retweeter/liker list (or an account's follower list) ONCE per giveaway and
 * checks every pending entrant against it locally — never one live call per participant, which
 * would multiply cost/rate-limit exposure with entrant count for no benefit.
 */
@Injectable()
export class XVerificationService {
  private readonly logger = new Logger(XVerificationService.name);
  private client: TwitterApi | null = null;
  private readonly fetchCache = new Map<string, { promise: Promise<Set<string>>; expiresAt: number }>();
  private readonly profileCache = new Map<string, { profile: XProfile; expiresAt: number }>();
  private dailyCallCount = 0;
  private dailyCallCountDate = '';
  private readonly dailyCallCap: number;

  /** Shared cache wrapper for every fetch*Ids helper below — see FETCH_CACHE_TTL_MS. Throws (into
   *  verifyPendingCompletions' existing api_error path) rather than returning an empty set on cap
   *  hit, so a capped-out fetch never gets misread as "nobody matched" and falsely rejects
   *  genuine entrants.
   *
   *  Caches the in-flight PROMISE, not just the resolved ids: confirmed live 2026-08-13 that several
   *  entrants clicking "Verify" within the same second all saw a cache miss and each fired their own
   *  live X API call for the same tweet — a stampede that alone can burn through X's 75-req/15min
   *  budget and 429 everyone, including genuine retweeters. Sharing one in-flight fetch across
   *  concurrent callers fixes that at the source. A failed fetch is evicted immediately (not left
   *  cached for the full TTL) so the next click can retry cleanly once the rate limit clears, instead
   *  of replaying the same error to everyone for 3 more minutes. */
  private async getCachedIds(key: string, fetch: () => Promise<Set<string>>): Promise<Set<string>> {
    const cached = this.fetchCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;

    // Redis layer underneath the in-memory one — the in-memory Map alone is wiped on every backend
    // restart (frequent during active dev), which was silently defeating this cache almost entirely
    // (see FETCH_CACHE_TTL_MS's doc comment, 2026-08-15 incident). A hit here still counts as a
    // cache hit, not a fresh fetch — it does NOT consume the daily cap.
    const redisKey = `xverify:idset:${key}`;
    const redisCached = await this.redis.get(redisKey);
    if (redisCached) {
      try {
        const ids = new Set<string>(JSON.parse(redisCached));
        const promise = Promise.resolve(ids);
        this.fetchCache.set(key, { promise, expiresAt: Date.now() + FETCH_CACHE_TTL_MS });
        return promise;
      } catch {
        // corrupt cache entry — fall through to a live fetch
      }
    }

    await this.consumeDailyCapOrThrow(key);
    const promise = fetch();
    this.fetchCache.set(key, { promise, expiresAt: Date.now() + FETCH_CACHE_TTL_MS });
    promise.catch(() => this.fetchCache.delete(key));
    promise.then((ids) => {
      this.redis.set(redisKey, JSON.stringify([...ids]), FETCH_CACHE_TTL_MS / 1000).catch(() => {});
    }).catch(() => {
      // fetch failed — nothing to persist, already evicted from the in-memory cache above
    });
    return promise;
  }

  /** Increments today's fetch-unit count and throws once DAILY_CALL_CAP is hit, resetting at UTC
   *  midnight. See DEFAULT_DAILY_CALL_CAP's doc comment for why this exists.
   *
   *  Backed by Redis (INCR + EXPIRE on a per-UTC-day key) instead of a process-local counter:
   *  confirmed 2026-08-15 that an in-memory counter resets on every backend redeploy, and this repo
   *  redeploys many times a day during active work — the "hard backstop" was quietly re-arming
   *  itself back to 0 on each deploy instead of holding for the full day. Falls back to the old
   *  in-memory counter only when Redis is unavailable (e.g. local dev without REDIS_URL), so
   *  behavior there is unchanged. */
  private async consumeDailyCapOrThrow(context: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const client = this.redis.getClient();
    if (client) {
      const key = `xverify:dailycap:${today}`;
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, 26 * 60 * 60);
      if (count > this.dailyCallCap) {
        this.logger.error(`[XVerification] daily X API call cap (${this.dailyCallCap}) reached — refusing further calls today (blocked: ${context})`);
        throw new Error(`X API daily call cap (${this.dailyCallCap}) reached`);
      }
      return;
    }
    if (today !== this.dailyCallCountDate) {
      this.dailyCallCountDate = today;
      this.dailyCallCount = 0;
    }
    if (this.dailyCallCount >= this.dailyCallCap) {
      this.logger.error(`[XVerification] daily X API call cap (${this.dailyCallCap}) reached — refusing further calls today (blocked: ${context})`);
      throw new Error(`X API daily call cap (${this.dailyCallCap}) reached`);
    }
    this.dailyCallCount++;
  }

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly redis: RedisService,
  ) {
    const apiKey = this.configService.get<string>('TWITTER_API_KEY');
    const apiSecret = this.configService.get<string>('TWITTER_API_SECRET');
    const accessToken = this.configService.get<string>('TWITTER_ACCESS_TOKEN');
    const accessSecret = this.configService.get<string>('TWITTER_ACCESS_SECRET');
    if (apiKey && apiSecret && accessToken && accessSecret) {
      this.client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret });
    } else {
      this.logger.warn('X API credentials not configured (TWITTER_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET) — giveaway X verification disabled.');
    }
    this.dailyCallCap = Number(this.configService.get<string>('GIVEAWAY_X_API_DAILY_CALL_CAP')) || DEFAULT_DAILY_CALL_CAP;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /** Lookup used at entry time for eligibility (follower count + account age), not part of the
   *  batched per-giveaway task verification below. Cached per-handle — see PROFILE_CACHE_TTL_MS.
   *
   *  Two-tier cache: the in-memory Map is checked first (zero latency for repeat calls within the
   *  same process), then Redis (survives the backend redeploying — confirmed 2026-08-15 that with
   *  only 119 real entrants, the process-local Map alone still produced way more than 119 X API
   *  calls, because every redeploy during active work wiped it and the same handles got re-fetched
   *  from scratch on the next entry attempt). Privy's linked_accounts does NOT carry followers_count
   *  or account creation date — only username — so there's no way to skip the X API call entirely;
   *  this just makes sure we only ever pay for it once per handle per PROFILE_CACHE_TTL_MS window,
   *  no matter how many times the backend restarts in between. */
  async resolveXProfile(handle: string): Promise<XProfile | null> {
    if (!this.client) return null;
    const cleanHandle = handle.replace(/^@/, '').trim();
    const cacheKey = cleanHandle.toLowerCase();
    const memCached = this.profileCache.get(cacheKey);
    if (memCached && memCached.expiresAt > Date.now()) return memCached.profile;

    const redisKey = `xverify:profile:${cacheKey}`;
    const redisCached = await this.redis.get(redisKey);
    if (redisCached) {
      try {
        const profile = JSON.parse(redisCached) as XProfile;
        this.profileCache.set(cacheKey, { profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
        return profile;
      } catch {
        // corrupt cache entry — fall through to a live fetch
      }
    }

    try {
      await this.consumeDailyCapOrThrow(`resolveXProfile:${cleanHandle}`);
      // profile_image_url is deliberately NOT requested here anymore — Privy's own linked-account
      // record already carries the entrant's profile picture (see GiveawayEntriesService.
      // resolveLinkedXAccount) at zero API cost, so asking X for a second copy was pure downside:
      // one more field that could need access this app's plan doesn't have (suspected cause of a
      // 403 on 2026-08-15, right after a credit top-up ruled out a plain quota/payment issue).
      const result = await this.client.v2.userByUsername(cleanHandle, { 'user.fields': ['created_at', 'public_metrics'] });
      if (!result.data) return null;
      const profile: XProfile = {
        id: result.data.id,
        username: result.data.username,
        createdAt: result.data.created_at ?? new Date(0).toISOString(),
        followersCount: result.data.public_metrics?.followers_count ?? 0,
        profileImageUrl: null,
      };
      this.profileCache.set(cacheKey, { profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
      await this.redis.set(redisKey, JSON.stringify(profile), PROFILE_CACHE_TTL_MS / 1000);
      return profile;
    } catch (e) {
      this.logger.warn(`[XVerification] resolveXProfile(${cleanHandle}) failed: ${describeXApiError(e)}`);
      return null;
    }
  }

  private extractTweetId(target: string): string | null {
    const match = target.match(/status(?:es)?\/(\d+)/);
    if (match) return match[1];
    if (/^\d+$/.test(target.trim())) return target.trim();
    return null;
  }

  private extractHandle(target: string): string {
    const match = target.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i);
    return (match ? match[1] : target).replace(/^@/, '').trim();
  }

  private async collectUserIds(
    paginator: AsyncIterable<{ id: string }>,
    context: string,
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    for await (const user of paginator) {
      ids.add(user.id);
      if (ids.size >= MAX_PAGINATED_USERS) {
        this.logger.warn(`[XVerification] ${context}: hit MAX_PAGINATED_USERS (${MAX_PAGINATED_USERS}) cap — list may be truncated`);
        break;
      }
    }
    return ids;
  }

  /** A quote tweet is a distinct relationship from a plain retweet in X's own data model (it shows
   *  up under "Quote Tweets Lookup", never in "Retweet Lookup"), but counts the same for our
   *  purposes — confirmed live 2026-08-05: a genuine entrant quote-tweeted exactly as instructed
   *  and was still rejected, since only plain retweets were being checked. Union both. */
  private async fetchRetweeterIds(tweetId: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    return this.getCachedIds(`retweet:${tweetId}`, async () => {
      const [retweeterIds, quoteAuthorIds] = await Promise.all([
        (async () => {
          const paginator = await this.client!.v2.tweetRetweetedBy(tweetId, { asPaginator: true, max_results: 100 });
          return this.collectUserIds(paginator, `retweetedBy(${tweetId})`);
        })(),
        this.fetchQuoteTweetAuthorIds(tweetId),
      ]);
      return new Set([...retweeterIds, ...quoteAuthorIds]);
    });
  }

  private async fetchQuoteTweetAuthorIds(tweetId: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    const paginator = await this.client.v2.quotes(tweetId, { max_results: 100, 'tweet.fields': ['author_id'] });
    const ids = new Set<string>();
    for await (const tweet of paginator) {
      if (tweet.author_id) ids.add(tweet.author_id);
      if (ids.size >= MAX_PAGINATED_USERS) {
        this.logger.warn(`[XVerification] quotes(${tweetId}): hit MAX_PAGINATED_USERS (${MAX_PAGINATED_USERS}) cap — list may be truncated`);
        break;
      }
    }
    return ids;
  }

  private async fetchLikerIds(tweetId: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    return this.getCachedIds(`like:${tweetId}`, async () => {
      const paginator = await this.client!.v2.tweetLikedBy(tweetId, { asPaginator: true, max_results: 100 });
      return this.collectUserIds(paginator, `likedBy(${tweetId})`);
    });
  }

  private async fetchFollowerIds(targetHandle: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    return this.getCachedIds(`follow:${targetHandle.toLowerCase()}`, async () => {
      const target = await this.client!.v2.userByUsername(targetHandle);
      if (!target.data) return new Set();
      const paginator = await this.client!.v2.followers(target.data.id, { asPaginator: true, max_results: 1000 });
      return this.collectUserIds(paginator, `followers(${targetHandle})`);
    });
  }

  /** Replies (conversation_id search) whose author is in `entrantIds` — used for x_comment. Text
   *  match against `comment_requirement` is a substring check, deliberately loose (real-world
   *  phrasing varies); a false-positive here just means one more entry falls into the review
   *  queue on `rejected`, not a silent security hole. */
  private async fetchReplyAuthors(tweetId: string, commentRequirement?: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    return this.getCachedIds(`comment:${tweetId}:${commentRequirement ?? ''}`, async () => {
      const paginator = await this.client!.v2.search(`conversation_id:${tweetId} is:reply`, {
        max_results: 100,
        'tweet.fields': ['author_id', 'text'],
      });
      const authorIds = new Set<string>();
      for await (const tweet of paginator) {
        if (commentRequirement && !tweet.text?.toLowerCase().includes(commentRequirement.toLowerCase())) continue;
        if (tweet.author_id) authorIds.add(tweet.author_id);
        if (authorIds.size >= MAX_PAGINATED_USERS) break;
      }
      return authorIds;
    });
  }

  /**
   * Batched per-task verification: called once per open/entries-closed giveaway by the cron.
   * For each x_* task on the giveaway, fetch the relevant id set once, then resolve every
   * `pending` completion for that task against it. Never throws for an individual entry — marks
   * that one `api_error` (falls into the review queue) and keeps going.
   */
  async verifyPendingCompletions(
    giveaway: Giveaway,
    task: GiveawayTask,
    pending: Array<{ completion: GiveawayTaskCompletion; entry: GiveawayEntry }>,
  ): Promise<void> {
    if (!this.client || pending.length === 0) return;
    const config = task.config as { target?: string; comment_requirement?: string };
    if (!config.target) return;

    let matchedIds: Set<string>;
    try {
      switch (task.task_type) {
        case GiveawayTaskType.X_RETWEET: {
          const tweetId = this.extractTweetId(config.target);
          if (!tweetId) throw new Error(`Could not parse tweet id from target "${config.target}"`);
          matchedIds = await this.fetchRetweeterIds(tweetId);
          break;
        }
        case GiveawayTaskType.X_LIKE: {
          const tweetId = this.extractTweetId(config.target);
          if (!tweetId) throw new Error(`Could not parse tweet id from target "${config.target}"`);
          matchedIds = await this.fetchLikerIds(tweetId);
          break;
        }
        case GiveawayTaskType.X_FOLLOW: {
          matchedIds = await this.fetchFollowerIds(this.extractHandle(config.target));
          break;
        }
        case GiveawayTaskType.X_COMMENT: {
          const tweetId = this.extractTweetId(config.target);
          if (!tweetId) throw new Error(`Could not parse tweet id from target "${config.target}"`);
          matchedIds = await this.fetchReplyAuthors(tweetId, config.comment_requirement);
          break;
        }
        default:
          return; // not an X task
      }
    } catch (e) {
      const reason = describeXApiError(e);
      this.logger.warn(`[XVerification] ${giveaway.id} task ${task.id} (${task.task_type}): fetch failed, marking all pending as api_error: ${reason}`);
      await this.markAll(pending.map((p) => p.completion.id), GiveawayTaskCompletionStatus.API_ERROR, { error: reason });
      return;
    }

    const verifiedIds: string[] = [];
    const rejectedIds: string[] = [];
    for (const { completion, entry } of pending) {
      if (matchedIds.has(entry.x_user_id)) verifiedIds.push(completion.id);
      else rejectedIds.push(completion.id);
    }
    if (verifiedIds.length) await this.markAll(verifiedIds, GiveawayTaskCompletionStatus.AUTO_VERIFIED);
    if (rejectedIds.length) await this.markAll(rejectedIds, GiveawayTaskCompletionStatus.REJECTED, { reason: 'not found in X API result set' });
    this.logger.log(`[XVerification] ${giveaway.id} task ${task.id} (${task.task_type}): ${verifiedIds.length} verified, ${rejectedIds.length} rejected`);
  }

  private async markAll(completionIds: string[], status: GiveawayTaskCompletionStatus, detail?: Record<string, unknown>): Promise<void> {
    if (!completionIds.length) return;
    const { error } = await this.supabaseService.giveawayTaskCompletions
      .update({ verification_status: status, verification_detail: detail ?? null, reviewed_at: new Date().toISOString() })
      .in('id', completionIds);
    if (error) this.logger.warn(`[XVerification] failed to persist verification results: ${error.message}`);
  }
}
