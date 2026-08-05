import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TwitterApi } from 'twitter-api-v2';
import { SupabaseService } from '@/database/supabase.service';
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
}

/** Bound on how many retweeters/likers/followers we'll page through for a single task —
 *  a "fetch once per giveaway, check locally" pass still has to end somewhere. Logged loudly
 *  when hit, since a truncated list means some real completions could be missed. */
const MAX_PAGINATED_USERS = 5_000;

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

  constructor(private readonly configService: ConfigService, private readonly supabaseService: SupabaseService) {
    const apiKey = this.configService.get<string>('TWITTER_API_KEY');
    const apiSecret = this.configService.get<string>('TWITTER_API_SECRET');
    const accessToken = this.configService.get<string>('TWITTER_ACCESS_TOKEN');
    const accessSecret = this.configService.get<string>('TWITTER_ACCESS_SECRET');
    if (apiKey && apiSecret && accessToken && accessSecret) {
      this.client = new TwitterApi({ appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret });
    } else {
      this.logger.warn('X API credentials not configured (TWITTER_API_KEY/SECRET/ACCESS_TOKEN/ACCESS_SECRET) — giveaway X verification disabled.');
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /** Single cheap lookup — used at entry time for eligibility (follower count + account age), not part of the batched per-giveaway task verification below. */
  async resolveXProfile(handle: string): Promise<XProfile | null> {
    if (!this.client) return null;
    const cleanHandle = handle.replace(/^@/, '').trim();
    try {
      const result = await this.client.v2.userByUsername(cleanHandle, { 'user.fields': ['created_at', 'public_metrics'] });
      if (!result.data) return null;
      return {
        id: result.data.id,
        username: result.data.username,
        createdAt: result.data.created_at ?? new Date(0).toISOString(),
        followersCount: result.data.public_metrics?.followers_count ?? 0,
      };
    } catch (e) {
      this.logger.warn(`[XVerification] resolveXProfile(${cleanHandle}) failed: ${String(e)}`);
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

  private async fetchRetweeterIds(tweetId: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    const paginator = await this.client.v2.tweetRetweetedBy(tweetId, { asPaginator: true, max_results: 100 });
    return this.collectUserIds(paginator, `retweetedBy(${tweetId})`);
  }

  private async fetchLikerIds(tweetId: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    const paginator = await this.client.v2.tweetLikedBy(tweetId, { asPaginator: true, max_results: 100 });
    return this.collectUserIds(paginator, `likedBy(${tweetId})`);
  }

  private async fetchFollowerIds(targetHandle: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    const target = await this.client.v2.userByUsername(targetHandle);
    if (!target.data) return new Set();
    const paginator = await this.client.v2.followers(target.data.id, { asPaginator: true, max_results: 1000 });
    return this.collectUserIds(paginator, `followers(${targetHandle})`);
  }

  /** Replies (conversation_id search) whose author is in `entrantIds` — used for x_comment. Text
   *  match against `comment_requirement` is a substring check, deliberately loose (real-world
   *  phrasing varies); a false-positive here just means one more entry falls into the review
   *  queue on `rejected`, not a silent security hole. */
  private async fetchReplyAuthors(tweetId: string, commentRequirement?: string): Promise<Set<string>> {
    if (!this.client) return new Set();
    const paginator = await this.client.v2.search(`conversation_id:${tweetId} is:reply`, {
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
      this.logger.warn(`[XVerification] ${giveaway.id} task ${task.id} (${task.task_type}): fetch failed, marking all pending as api_error: ${String(e)}`);
      await this.markAll(pending.map((p) => p.completion.id), GiveawayTaskCompletionStatus.API_ERROR, { error: String(e) });
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
