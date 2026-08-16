import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  /** X's own "verified" flag (blue check / legacy verification) — not to be confused with
   *  is_identity_verified or verified_type, which this app doesn't need. */
  verified: boolean;
}

const SORSA_BASE_URL = 'https://api.sorsa.io/v3';
const SORSA_REQUEST_TIMEOUT_MS = 15_000;

export class SorsaApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'SorsaApiError';
  }
}

/** Unwraps the real reason a Sorsa call failed — Sorsa's error body is just `{"message": "..."}`,
 *  so the HTTP status carries the rest of the signal (401 = bad key, 429 = rate limit, etc). */
function describeXApiError(e: unknown): string {
  if (e instanceof SorsaApiError) return `HTTP ${e.status}: ${e.message}`;
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
 * X/Twitter data for giveaway task verification, via Sorsa (api.sorsa.io) — switched from the
 * direct X API v2 on 2026-08-16 after repeated cost incidents (X's own metering made a handful of
 * logic bugs disproportionately expensive; see giveaway-draw.service.ts's comment history).
 *
 * Fetches a tweet's retweeter/quoter list (or an account's follower list) ONCE per giveaway and
 * checks every pending entrant against it locally — never one live call per participant, which
 * would multiply cost/rate-limit exposure with entrant count for no benefit. Sorsa has no "who
 * liked this tweet" endpoint at all, which is moot here: X_LIKE/X_BOOKMARK are already permanent
 * self-report (see GIVEAWAY_TASK_VERIFICATION_MODE), so no code path needs one.
 */
@Injectable()
export class XVerificationService {
  private readonly logger = new Logger(XVerificationService.name);
  private sorsaApiKey: string | null = null;
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
    const sorsaApiKey = this.configService.get<string>('SORSA_API_KEY');
    if (sorsaApiKey) {
      this.sorsaApiKey = sorsaApiKey;
    } else {
      this.logger.warn('SORSA_API_KEY not configured — giveaway X verification disabled.');
    }
    this.dailyCallCap = Number(this.configService.get<string>('GIVEAWAY_X_API_DAILY_CALL_CAP')) || DEFAULT_DAILY_CALL_CAP;
  }

  isAvailable(): boolean {
    return this.sorsaApiKey !== null;
  }

  /** Thin wrapper over Sorsa's REST API — ApiKey header auth, GET params as query string, POST
   *  params as a JSON body (matches sorsa_api_v3_documentation_en.txt). Mirrors the fetch+timeout+
   *  {message} error-shape pattern already used for PajCashService. */
  private async sorsaRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | undefined> = {},
  ): Promise<T> {
    if (!this.sorsaApiKey) throw new Error('SORSA_API_KEY not configured');
    const entries = Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][];
    const query = method === 'GET' && entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
    const res = await fetch(`${SORSA_BASE_URL}${path}${query}`, {
      method,
      headers: { 'Content-Type': 'application/json', ApiKey: this.sorsaApiKey },
      body: method === 'POST' ? JSON.stringify(Object.fromEntries(entries)) : undefined,
      signal: AbortSignal.timeout(SORSA_REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    let json: unknown;
    if (text) {
      try { json = JSON.parse(text); } catch { json = text; }
    }
    if (!res.ok) {
      const message = (json && typeof json === 'object' && 'message' in json)
        ? String((json as { message: unknown }).message)
        : `Sorsa request failed (${res.status})`;
      throw new SorsaApiError(message, res.status);
    }
    return json as T;
  }

  /** Cursor-paginates a Sorsa list endpoint (/retweeters, /quotes, /comments, /followers — all
   *  share the same `{ <arrayKey>: [...], next_cursor }` envelope) and collects ids, stopping at
   *  MAX_PAGINATED_USERS. `idOf` returning undefined for an item (e.g. a reply that doesn't match
   *  comment_requirement) skips it without ending pagination. */
  private async paginateSorsaIds(
    method: 'GET' | 'POST',
    path: string,
    baseParams: Record<string, string>,
    arrayKey: 'users' | 'tweets',
    idOf: (item: any) => string | undefined,
    context: string,
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await this.sorsaRequest<Record<string, any>>(method, path, { ...baseParams, next_cursor: cursor });
      const items: any[] = page?.[arrayKey] ?? [];
      for (const item of items) {
        const id = idOf(item);
        if (id) ids.add(id);
        if (ids.size >= MAX_PAGINATED_USERS) {
          this.logger.warn(`[XVerification] ${context}: hit MAX_PAGINATED_USERS (${MAX_PAGINATED_USERS}) cap — list may be truncated`);
          return ids;
        }
      }
      cursor = page?.next_cursor ?? undefined;
      if (!cursor) return ids;
    }
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
    if (!this.sorsaApiKey) return null;
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
      // profileImageUrl is deliberately not requested — Privy's own linked-account record already
      // carries the entrant's profile picture (see GiveawayEntriesService.resolveLinkedXAccount)
      // at zero API cost, so asking Sorsa for a second copy would be pure downside.
      const result = await this.sorsaRequest<Record<string, any>>('GET', '/info', { username: cleanHandle });
      if (!result?.id) return null;
      const profile: XProfile = {
        id: String(result.id),
        username: result.username,
        createdAt: result.created_at ?? new Date(0).toISOString(),
        followersCount: result.followers_count ?? 0,
        profileImageUrl: null,
        verified: !!result.verified,
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

  /** A quote tweet is a distinct relationship from a plain retweet (Sorsa exposes them via
   *  separate /retweeters and /quotes endpoints, same as X's own "Retweet Lookup" vs "Quote Tweets
   *  Lookup"), but counts the same for our purposes — confirmed live 2026-08-05: a genuine entrant
   *  quote-tweeted exactly as instructed and was still rejected, since only plain retweets were
   *  being checked. Union both. */
  private async fetchRetweeterIds(tweetId: string): Promise<Set<string>> {
    if (!this.sorsaApiKey) return new Set();
    return this.getCachedIds(`retweet:${tweetId}`, async () => {
      const [retweeterIds, quoteAuthorIds] = await Promise.all([
        this.paginateSorsaIds('POST', '/retweeters', { tweet_link: tweetId }, 'users', (u) => u?.id && String(u.id), `retweeters(${tweetId})`),
        this.fetchQuoteTweetAuthorIds(tweetId),
      ]);
      return new Set([...retweeterIds, ...quoteAuthorIds]);
    });
  }

  private async fetchQuoteTweetAuthorIds(tweetId: string): Promise<Set<string>> {
    if (!this.sorsaApiKey) return new Set();
    return this.paginateSorsaIds('POST', '/quotes', { tweet_link: tweetId }, 'tweets', (t) => t?.user?.id && String(t.user.id), `quotes(${tweetId})`);
  }

  private async fetchFollowerIds(targetHandle: string): Promise<Set<string>> {
    if (!this.sorsaApiKey) return new Set();
    return this.getCachedIds(`follow:${targetHandle.toLowerCase()}`, () =>
      this.paginateSorsaIds('GET', '/followers', { username: targetHandle }, 'users', (u) => u?.id && String(u.id), `followers(${targetHandle})`),
    );
  }

  /** Replies to the tweet whose text matches `comment_requirement` — used for x_comment. The text
   *  match is a loose substring check (real-world phrasing varies); a false-positive here just
   *  means one more entry falls into the review queue on `rejected`, not a silent security hole. */
  private async fetchReplyAuthors(tweetId: string, commentRequirement?: string): Promise<Set<string>> {
    if (!this.sorsaApiKey) return new Set();
    return this.getCachedIds(`comment:${tweetId}:${commentRequirement ?? ''}`, () =>
      this.paginateSorsaIds('POST', '/comments', { tweet_link: tweetId }, 'tweets', (t) => {
        if (commentRequirement && !String(t?.full_text ?? '').toLowerCase().includes(commentRequirement.toLowerCase())) return undefined;
        return t?.user?.id && String(t.user.id);
      }, `comments(${tweetId})`),
    );
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
    if (!this.sorsaApiKey || pending.length === 0) return;
    const config = task.config as { target?: string; comment_requirement?: string };
    if (!config.target) return;

    // X_LIKE/X_BOOKMARK are SELF_REPORT (see GIVEAWAY_TASK_VERIFICATION_MODE) — there is no live X
    // API call that can resolve them (Like Lookup always returns empty on this app's tier; bookmarks
    // have no public endpoint at all), so submitTaskCompletion trusts them on click. This sweep must
    // do the same instead of hitting a real (paginated, billed) endpoint that can never return a
    // useful result — that was silently burning API calls AND wrongly rejecting genuine likes.
    if (task.task_type === GiveawayTaskType.X_LIKE || task.task_type === GiveawayTaskType.X_BOOKMARK) {
      const note =
        task.task_type === GiveawayTaskType.X_LIKE
          ? 'Auto-approved by final sweep — X Like Lookup unavailable on current API tier'
          : 'Auto-approved by final sweep — X has no public API for who bookmarked a post, so this is trusted';
      await this.markAll(pending.map((p) => p.completion.id), GiveawayTaskCompletionStatus.VERIFIED, { note });
      return;
    }

    let matchedIds: Set<string>;
    try {
      switch (task.task_type) {
        case GiveawayTaskType.X_RETWEET: {
          const tweetId = this.extractTweetId(config.target);
          if (!tweetId) throw new Error(`Could not parse tweet id from target "${config.target}"`);
          matchedIds = await this.fetchRetweeterIds(tweetId);
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
