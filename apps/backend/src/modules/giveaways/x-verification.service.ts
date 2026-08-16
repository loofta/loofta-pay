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

/** Thrown by either cap guard (per-minute or daily) — a distinct type so callers can tell "we
 *  deliberately refused to call Sorsa" apart from Sorsa itself erroring, without fragile string
 *  matching on the message. */
export class XVerificationCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XVerificationCapError';
  }
}

/** Unwraps the real reason a Sorsa call failed — Sorsa's error body is just `{"message": "..."}`,
 *  so the HTTP status carries the rest of the signal (401 = bad key, 429 = rate limit, etc). */
function describeXApiError(e: unknown): string {
  if (e instanceof SorsaApiError) return `HTTP ${e.status}: ${e.message}`;
  return String(e);
}

/** Hard circuit breaker, independent of the daily cap — confirmed live 2026-08-16 that a single
 *  bug (unbounded pagination) can blow through more requests in a couple minutes than the daily
 *  cap would even notice until it's already too late. This trips fast and locally: >100 Sorsa
 *  requests in any rolling 60s window kills every further call until the next window, regardless
 *  of which giveaway/task/entrant they're for. Override via GIVEAWAY_X_API_PER_MINUTE_CAP. */
const DEFAULT_PER_MINUTE_CAP = 100;

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
 * direct X API v2 on 2026-08-16 after repeated cost incidents.
 *
 * Checks each pending entrant individually against Sorsa's per-user verification endpoints
 * (/check-retweet, /check-quoted, /check-follow, /check-comment) rather than paginating a tweet's
 * full retweeter/follower list and checking membership locally. The list-pagination design (used
 * here for about two hours on 2026-08-16) was replaced after it burned 87 raw requests checking a
 * single retweet in one real test — Sorsa's next_cursor doesn't reliably signal "no more results,"
 * so an unbounded pagination loop trusting it is unsafe. A single bounded check-per-user call has
 * no list to page through, so it's structurally incapable of that failure mode. Sorsa has no "who
 * liked this tweet" endpoint at all, which is moot here: X_LIKE/X_BOOKMARK are already permanent
 * self-report (see GIVEAWAY_TASK_VERIFICATION_MODE), so no code path needs one.
 */
@Injectable()
export class XVerificationService {
  private readonly logger = new Logger(XVerificationService.name);
  private sorsaApiKey: string | null = null;
  private readonly profileCache = new Map<string, { profile: XProfile; expiresAt: number }>();
  private dailyCallCount = 0;
  private dailyCallCountDate = '';
  private readonly dailyCallCap: number;
  private perMinuteCount = 0;
  private perMinuteBucket = -1;
  private readonly perMinuteCap: number;

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
        throw new XVerificationCapError(`X API daily call cap (${this.dailyCallCap}) reached`);
      }
      return;
    }
    if (today !== this.dailyCallCountDate) {
      this.dailyCallCountDate = today;
      this.dailyCallCount = 0;
    }
    if (this.dailyCallCount >= this.dailyCallCap) {
      this.logger.error(`[XVerification] daily X API call cap (${this.dailyCallCap}) reached — refusing further calls today (blocked: ${context})`);
      throw new XVerificationCapError(`X API daily call cap (${this.dailyCallCap}) reached`);
    }
    this.dailyCallCount++;
  }

  /** Circuit breaker checked on EVERY Sorsa HTTP call, inside sorsaRequest itself — not at each
   *  call site — so no future check-* method can accidentally skip it. Fixed 60s buckets (not a
   *  true sliding window): simple, and precise enough for "stop before this spirals," which is the
   *  actual job here. Same Redis-with-in-memory-fallback shape as consumeDailyCapOrThrow, for the
   *  same reason (2026-08-15: an in-memory-only counter resets on every redeploy). */
  private async checkPerMinuteGuardOrThrow(): Promise<void> {
    const bucket = Math.floor(Date.now() / 60_000);
    const client = this.redis.getClient();
    if (client) {
      const key = `xverify:ratelimit:sorsa:${bucket}`;
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, 120);
      if (count > this.perMinuteCap) {
        this.logger.error(`[XVerification] per-minute request guard tripped (${count} > ${this.perMinuteCap} Sorsa requests in the last 60s) — refusing further calls until the next minute`);
        throw new XVerificationCapError(`Sorsa per-minute request guard tripped (>${this.perMinuteCap}/min)`);
      }
      return;
    }
    if (bucket !== this.perMinuteBucket) {
      this.perMinuteBucket = bucket;
      this.perMinuteCount = 0;
    }
    if (this.perMinuteCount >= this.perMinuteCap) {
      this.logger.error(`[XVerification] per-minute request guard tripped (${this.perMinuteCount} >= ${this.perMinuteCap} Sorsa requests in the last 60s, in-memory fallback) — refusing further calls until the next minute`);
      throw new XVerificationCapError(`Sorsa per-minute request guard tripped (>${this.perMinuteCap}/min)`);
    }
    this.perMinuteCount++;
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
    this.perMinuteCap = Number(this.configService.get<string>('GIVEAWAY_X_API_PER_MINUTE_CAP')) || DEFAULT_PER_MINUTE_CAP;
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
    await this.checkPerMinuteGuardOrThrow();
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

  /** /check-quoted's own documented purpose is "did user quote OR retweet" (status includes both
   *  "quoted" and "retweet"), so one call covers the same ground the old design needed two
   *  paginated list-fetches for (plain retweet ∪ quote tweet) — confirmed real need for the union
   *  live 2026-08-05, a genuine entrant quote-tweeted exactly as instructed and was rejected because
   *  only plain retweets were checked at the time. No pagination here: single bounded call. */
  private async checkRetweetedOrQuoted(tweetId: string, userId: string): Promise<boolean> {
    await this.consumeDailyCapOrThrow(`check-quoted:${tweetId}:${userId}`);
    const res = await this.sorsaRequest<{ status?: string }>('POST', '/check-quoted', { tweet_link: tweetId, user_id: userId });
    return res?.status === 'quoted' || res?.status === 'retweet';
  }

  private async checkFollows(targetHandle: string, userId: string): Promise<boolean> {
    await this.consumeDailyCapOrThrow(`check-follow:${targetHandle}:${userId}`);
    const res = await this.sorsaRequest<{ follow?: boolean }>('POST', '/check-follow', { username_1: targetHandle, user_id_2: userId });
    return !!res?.follow;
  }

  /** Returns the reply's text if the user commented, so the caller can still apply the
   *  `comment_requirement` substring match — same semantics as before, just resolved server-side
   *  by Sorsa instead of us scanning a reply list ourselves. */
  private async checkCommented(tweetId: string, userId: string): Promise<{ commented: boolean; text: string | null }> {
    await this.consumeDailyCapOrThrow(`check-comment:${tweetId}:${userId}`);
    const res = await this.sorsaRequest<{ commented?: boolean; tweet?: { full_text?: string } }>('GET', '/check-comment', { tweet_link: tweetId, user_id: userId });
    return { commented: !!res?.commented, text: res?.tweet?.full_text ?? null };
  }

  /** Called once per open/entries-closed giveaway by the cron (see runFinalXVerificationSweep) or
   *  once per click (submitTaskCompletion, with a single-entry `pending`). Checks each entrant
   *  individually against Sorsa — bounded, one (or two, for x_comment's text match) request per
   *  entry, never a paginated list scan. A failure for one entrant only marks that one `api_error`
   *  and keeps going; if the daily cap gets hit partway through a batch, every remaining
   *  not-yet-checked entry in this call is marked `api_error` too rather than silently skipped. */
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
    // do the same instead of hitting a real (billed) endpoint that can never return a useful result.
    if (task.task_type === GiveawayTaskType.X_LIKE || task.task_type === GiveawayTaskType.X_BOOKMARK) {
      const note =
        task.task_type === GiveawayTaskType.X_LIKE
          ? 'Auto-approved by final sweep — X Like Lookup unavailable on current API tier'
          : 'Auto-approved by final sweep — X has no public API for who bookmarked a post, so this is trusted';
      await this.markAll(pending.map((p) => p.completion.id), GiveawayTaskCompletionStatus.VERIFIED, { note });
      return;
    }

    if (task.task_type !== GiveawayTaskType.X_RETWEET && task.task_type !== GiveawayTaskType.X_FOLLOW && task.task_type !== GiveawayTaskType.X_COMMENT) {
      return; // not an X task
    }

    const tweetId = task.task_type !== GiveawayTaskType.X_FOLLOW ? this.extractTweetId(config.target) : null;
    const targetHandle = task.task_type === GiveawayTaskType.X_FOLLOW ? this.extractHandle(config.target) : null;
    if (task.task_type !== GiveawayTaskType.X_FOLLOW && !tweetId) {
      const reason = `Could not parse tweet id from target "${config.target}"`;
      this.logger.warn(`[XVerification] ${giveaway.id} task ${task.id} (${task.task_type}): ${reason}`);
      await this.markAll(pending.map((p) => p.completion.id), GiveawayTaskCompletionStatus.API_ERROR, { error: reason });
      return;
    }

    let verifiedCount = 0;
    let rejectedCount = 0;
    for (const { completion, entry } of pending) {
      try {
        let ok: boolean;
        if (task.task_type === GiveawayTaskType.X_RETWEET) {
          ok = await this.checkRetweetedOrQuoted(tweetId!, entry.x_user_id);
        } else if (task.task_type === GiveawayTaskType.X_FOLLOW) {
          ok = await this.checkFollows(targetHandle!, entry.x_user_id);
        } else {
          const { commented, text } = await this.checkCommented(tweetId!, entry.x_user_id);
          ok = commented && (!config.comment_requirement || !!text?.toLowerCase().includes(config.comment_requirement.toLowerCase()));
        }
        if (ok) {
          verifiedCount++;
          await this.markAll([completion.id], GiveawayTaskCompletionStatus.AUTO_VERIFIED);
        } else {
          rejectedCount++;
          await this.markAll([completion.id], GiveawayTaskCompletionStatus.REJECTED, { reason: 'not confirmed by Sorsa check' });
        }
      } catch (e) {
        const reason = describeXApiError(e);
        const capReached = e instanceof XVerificationCapError;
        await this.markAll([completion.id], GiveawayTaskCompletionStatus.API_ERROR, { error: reason });
        if (capReached) {
          // No point burning further attempts once capped — mark the rest of this batch the same
          // way instead of silently leaving them PENDING (which would look like nothing ran).
          const remaining = pending.slice(pending.findIndex((p) => p.completion.id === completion.id) + 1);
          if (remaining.length) await this.markAll(remaining.map((p) => p.completion.id), GiveawayTaskCompletionStatus.API_ERROR, { error: reason });
          this.logger.warn(`[XVerification] ${giveaway.id} task ${task.id} (${task.task_type}): daily cap hit mid-batch, ${remaining.length} remaining marked api_error`);
          break;
        }
      }
    }
    this.logger.log(`[XVerification] ${giveaway.id} task ${task.id} (${task.task_type}): ${verifiedCount} verified, ${rejectedCount} rejected`);
  }

  private async markAll(completionIds: string[], status: GiveawayTaskCompletionStatus, detail?: Record<string, unknown>): Promise<void> {
    if (!completionIds.length) return;
    const { error } = await this.supabaseService.giveawayTaskCompletions
      .update({ verification_status: status, verification_detail: detail ?? null, reviewed_at: new Date().toISOString() })
      .in('id', completionIds);
    if (error) this.logger.warn(`[XVerification] failed to persist verification results: ${error.message}`);
  }
}
