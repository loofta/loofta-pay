import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrivyVerificationService } from '@/auth/privy-verification.service';
import { SupabaseService } from '@/database/supabase.service';
import { XVerificationService } from './x-verification.service';
import { GiveawaysService } from './giveaways.service';
import {
  Giveaway,
  GiveawayStatus,
  GiveawayEntry,
  GiveawayEntryStatus,
  GiveawayTask,
  GiveawayTaskCompletion,
  GiveawayTaskCompletionStatus,
  GiveawayTaskVerificationMode,
  GiveawayTaskType,
} from './entities/giveaway.entity';

const TWITTER_ACCOUNT_TYPES = ['twitter_oauth', 'twitter_oauth2', 'twitter', 'x'];

// Caps how many times a single entrant can trigger a live X API check for one task — each click
// costs a real API call (fetch the tweet's retweeter/liker/follower list), so this bounds cost
// exposure per (entry, task) instead of relying on goodwill. Tracked in the completion row's own
// verification_detail.attempts (rolling window), no separate table/migration needed.
const MAX_VERIFY_ATTEMPTS_PER_WINDOW = 4;
const VERIFY_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class GiveawayEntriesService {
  private readonly logger = new Logger(GiveawayEntriesService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly privy: PrivyVerificationService,
    private readonly xVerification: XVerificationService,
    private readonly giveawaysService: GiveawaysService,
  ) {}

  /** Resolves the caller's linked X handle via Privy, same lookup twitter-payments.service.ts uses. */
  private async resolveLinkedXHandle(userId: string): Promise<string> {
    const privyUser = await this.privy.getPrivyUser(userId);
    const twitterAccount = privyUser?.linked_accounts?.find(
      (a: any) => TWITTER_ACCOUNT_TYPES.includes((a.type ?? '').toLowerCase()),
    );
    const handle = (twitterAccount?.username || twitterAccount?.name || twitterAccount?.address || '').trim();
    if (!handle) {
      throw new BadRequestException('No X (Twitter) account linked. Connect X in settings before entering a giveaway.');
    }
    return handle;
  }

  async enter(giveawayId: string, userId: string): Promise<GiveawayEntry> {
    const giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    if (giveaway.status !== GiveawayStatus.OPEN) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, not open for entries`);
    }
    if (new Date(giveaway.entries_close_at).getTime() <= Date.now()) {
      throw new BadRequestException('Entries have closed for this giveaway');
    }

    const { data: existing } = await this.supabaseService.giveawayEntries
      .select('id')
      .eq('giveaway_id', giveawayId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) throw new ConflictException('Already entered this giveaway');

    const handle = await this.resolveLinkedXHandle(userId);
    const profile = await this.xVerification.resolveXProfile(handle);
    if (!profile) {
      throw new BadRequestException('Could not verify your X account right now. Please try again shortly.');
    }

    const minFollowers = giveaway.eligibility?.min_followers;
    if (typeof minFollowers === 'number' && profile.followersCount < minFollowers) {
      throw new ForbiddenException(`This giveaway requires at least ${minFollowers} X followers`);
    }
    const minAgeDays = giveaway.eligibility?.min_account_age_days;
    if (typeof minAgeDays === 'number') {
      const ageDays = (Date.now() - new Date(profile.createdAt).getTime()) / 86_400_000;
      if (ageDays < minAgeDays) {
        throw new ForbiddenException(`This giveaway requires an X account at least ${minAgeDays} days old`);
      }
    }

    // entry_index: simple read-then-insert with one retry on the unique-index conflict — entry
    // volume for a single giveaway doesn't warrant a DB sequence, and the unique index is the
    // actual source of truth either way (this just avoids wasting most retries on a cold start).
    for (let attempt = 0; attempt < 3; attempt++) {
      const { count } = await this.supabaseService.giveawayEntries
        .select('id', { count: 'exact', head: true })
        .eq('giveaway_id', giveawayId);
      const { data: entry, error } = await this.supabaseService.giveawayEntries
        .insert({
          giveaway_id: giveawayId,
          user_id: userId,
          entry_index: (count ?? 0) + 1,
          x_user_id: profile.id,
          x_handle: profile.username,
          eligibility_snapshot: { followers_count: profile.followersCount, account_created_at: profile.createdAt },
          status: GiveawayEntryStatus.ENTERED,
        })
        .select()
        .single();
      if (!error && entry) {
        await this.createTaskCompletionStubs(entry.id, giveawayId);
        return entry as GiveawayEntry;
      }
      if (error && !error.message.includes('duplicate key')) {
        throw new BadRequestException(`Failed to enter giveaway: ${error.message}`);
      }
      // entry_index collision — retry with a freshly-read count
    }
    throw new BadRequestException('Failed to enter giveaway after retries — please try again');
  }

  private async createTaskCompletionStubs(entryId: string, giveawayId: string): Promise<void> {
    const tasks = await this.giveawaysService.getTasks(giveawayId);
    if (!tasks.length) return;
    const rows = tasks.map((t) => ({
      giveaway_entry_id: entryId,
      giveaway_task_id: t.id,
      verification_status: GiveawayTaskCompletionStatus.PENDING,
    }));
    const { error } = await this.supabaseService.giveawayTaskCompletions.insert(rows);
    if (error) this.logger.warn(`[GiveawayEntries] failed to create task completion stubs for entry ${entryId}: ${error.message}`);
  }

  async findMyEntry(giveawayId: string, userId: string): Promise<(GiveawayEntry & { completions: GiveawayTaskCompletion[] }) | null> {
    const { data: entry, error } = await this.supabaseService.giveawayEntries
      .select('*')
      .eq('giveaway_id', giveawayId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!entry) return null;
    const { data: completions, error: compError } = await this.supabaseService.giveawayTaskCompletions
      .select('*')
      .eq('giveaway_entry_id', entry.id);
    if (compError) throw new BadRequestException(compError.message);
    return { ...(entry as GiveawayEntry), completions: (completions ?? []) as GiveawayTaskCompletion[] };
  }

  /** Participant marking a task done. For auto_api tasks (x_follow/x_retweet/x_like/x_comment),
   *  this also tries to verify right away against the live X API — instant "Verified" instead of
   *  waiting on GiveawayCronService.verifyXTasks's 2-minute batch pass (which is also prod-gated,
   *  so it never runs on a local/staging instance at all). Reuses the exact same
   *  XVerificationService.verifyPendingCompletions the cron calls, just with a single-entry list
   *  instead of every giveaway's pending backlog — one extra X API call per click on click-through
   *  tasks, capped at MAX_VERIFY_ATTEMPTS_PER_WINDOW per rolling hour (a "Try again" after a
   *  rejection is still a real API call). The batched cron remains the backstop in production for
   *  anyone who clicks before actually doing the task, or if this inline check fails/errors. For
   *  self_report tasks, submission_data is the actual proof and nothing here changes — a human
   *  still reviews it, no rate limit needed since there's no API call to bound. */
  async submitTaskCompletion(
    giveawayId: string,
    userId: string,
    taskId: string,
    submissionData: Record<string, unknown> | undefined,
  ): Promise<GiveawayTaskCompletion> {
    const entry = await this.findMyEntry(giveawayId, userId);
    if (!entry) throw new NotFoundException('You have not entered this giveaway');
    const completion = entry.completions.find((c) => c.giveaway_task_id === taskId);
    if (!completion) throw new NotFoundException('Task not found on this giveaway');

    const tasks = await this.giveawaysService.getTasks(giveawayId);
    const task = tasks.find((t) => t.id === taskId);

    // Trust-on-click for the two X actions we can never verify against a real API result:
    // - X_LIKE: TEMPORARY (2026-08-05) — X's "Like Lookup" endpoint is gated behind a tier this
    //   app doesn't have, so it always returns an empty liker list regardless of who actually
    //   liked the tweet, which was auto-rejecting every genuine like. Remove this half once Like
    //   Lookup access is confirmed working again.
    // - X_BOOKMARK: PERMANENT — confirmed 2026-08-06 there is no X API endpoint that exposes who
    //   bookmarked a tweet (bookmarks are private per-user data; the bookmarks endpoint only
    //   returns the calling user's own bookmarks). There is no future "fix" to revert this to —
    //   trusting the click is the only option this task type will ever have.
    // Both trust the click instead of parking it in the self-report review queue: leaving it
    // there previously meant an entrant's eligibility silently blocked on a creator manually
    // reviewing something no one can actually confirm one way or the other.
    if (task?.task_type === GiveawayTaskType.X_LIKE || task?.task_type === GiveawayTaskType.X_BOOKMARK) {
      const note =
        task.task_type === GiveawayTaskType.X_LIKE
          ? 'Auto-approved — X Like Lookup unavailable on current API tier'
          : 'Auto-approved — X has no public API for who bookmarked a post, so this is trusted on click';
      const { data: trusted, error: trustedError } = await this.supabaseService.giveawayTaskCompletions
        .update({
          submission_data: submissionData ?? null,
          verification_status: GiveawayTaskCompletionStatus.VERIFIED,
          verification_detail: { note },
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', completion.id)
        .select()
        .single();
      if (trustedError || !trusted) throw new BadRequestException(trustedError?.message ?? 'Failed to submit task');
      return trusted as GiveawayTaskCompletion;
    }

    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .update({ submission_data: submissionData ?? null })
      .eq('id', completion.id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to submit task');

    if (task?.verification_mode === GiveawayTaskVerificationMode.AUTO_API && this.xVerification.isAvailable()) {
      const existingDetail = (data.verification_detail ?? {}) as { attempts?: string[] };
      const now = Date.now();
      const recentAttempts = (existingDetail.attempts ?? []).filter((ts) => now - new Date(ts).getTime() < VERIFY_ATTEMPT_WINDOW_MS);
      if (recentAttempts.length >= MAX_VERIFY_ATTEMPTS_PER_WINDOW) {
        const oldestMs = Math.min(...recentAttempts.map((ts) => new Date(ts).getTime()));
        const minutesLeft = Math.max(1, Math.ceil((oldestMs + VERIFY_ATTEMPT_WINDOW_MS - now) / 60_000));
        throw new BadRequestException(
          `You've already tried verifying this task ${MAX_VERIFY_ATTEMPTS_PER_WINDOW} times in the last hour. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
        );
      }

      try {
        const giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
        await this.xVerification.verifyPendingCompletions(giveaway, task, [{ completion: data as GiveawayTaskCompletion, entry }]);
      } catch (e) {
        this.logger.warn(`[GiveawayEntries] inline verify failed for completion ${completion.id} (cron will retry): ${String(e)}`);
      }

      // Record this attempt regardless of outcome — verifyPendingCompletions overwrites
      // verification_detail wholesale (rejection reason / api_error), so the attempts array is
      // merged back in AFTER, never before, or it'd just get clobbered.
      const { data: afterVerify } = await this.supabaseService.giveawayTaskCompletions.select('*').eq('id', completion.id).single();
      const mergedDetail = { ...((afterVerify?.verification_detail as Record<string, unknown>) ?? {}), attempts: [...recentAttempts, new Date(now).toISOString()] };
      const { data: withAttempts } = await this.supabaseService.giveawayTaskCompletions
        .update({ verification_detail: mergedDetail })
        .eq('id', completion.id)
        .select()
        .single();
      if (withAttempts) return withAttempts as GiveawayTaskCompletion;
      if (afterVerify) return afterVerify as GiveawayTaskCompletion;
    }
    return data as GiveawayTaskCompletion;
  }

  // ─────────────────────────────────────────────────────────────────
  // Creator/admin review + draw support
  // ─────────────────────────────────────────────────────────────────

  async listEntries(giveawayId: string): Promise<GiveawayEntry[]> {
    const { data, error } = await this.supabaseService.giveawayEntries
      .select('*')
      .eq('giveaway_id', giveawayId)
      .order('entry_index', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as GiveawayEntry[];
  }

  /** Completions awaiting a human decision — self-report submissions plus anything the X-API
   *  checker couldn't resolve. Permanent fallback per plan §Task verification. */
  async listReviewQueue(giveawayId: string): Promise<Array<GiveawayTaskCompletion & { entry: GiveawayEntry; task: GiveawayTask }>> {
    const entries = await this.listEntries(giveawayId);
    const entryIds = entries.map((e) => e.id);
    if (!entryIds.length) return [];
    const tasks = await this.giveawaysService.getTasks(giveawayId);
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    const entriesById = new Map(entries.map((e) => [e.id, e]));

    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .select('*')
      .in('giveaway_entry_id', entryIds)
      .in('verification_status', [GiveawayTaskCompletionStatus.PENDING, GiveawayTaskCompletionStatus.API_ERROR]);
    if (error) throw new BadRequestException(error.message);
    return (data ?? [])
      .map((c) => {
        const completion = c as GiveawayTaskCompletion;
        const task = tasksById.get(completion.giveaway_task_id);
        const entry = entriesById.get(completion.giveaway_entry_id);
        if (!task || !entry) return null;
        return { ...completion, entry, task };
      })
      .filter((x): x is GiveawayTaskCompletion & { entry: GiveawayEntry; task: GiveawayTask } => x !== null);
  }

  /** Cross-giveaway escalation queue — completions the X-API checker itself couldn't resolve
   *  (api_error), regardless of which giveaway they belong to. Self-report `pending` items stay
   *  scoped to each giveaway's own creator review queue (listReviewQueue) since those are opinion
   *  calls about that specific giveaway's rules, not a system fault an admin needs to unblock. */
  async listApiErrorEscalations(): Promise<GiveawayTaskCompletion[]> {
    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .select('*')
      .eq('verification_status', GiveawayTaskCompletionStatus.API_ERROR)
      .order('updated_at', { ascending: true })
      .limit(200);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as GiveawayTaskCompletion[];
  }

  async reviewCompletion(
    completionId: string,
    reviewerId: string,
    decision: 'verified' | 'rejected',
  ): Promise<GiveawayTaskCompletion> {
    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .update({ verification_status: decision, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq('id', completionId)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to review task completion');
    return data as GiveawayTaskCompletion;
  }

  /** Every completion still `pending`, grouped by task — used by the cron to drive XVerificationService in one batch per task instead of one call per entry. */
  async listPendingByTask(giveawayId: string): Promise<Map<string, Array<{ completion: GiveawayTaskCompletion; entry: GiveawayEntry }>>> {
    const entries = await this.listEntries(giveawayId);
    const entriesById = new Map(entries.map((e) => [e.id, e]));
    const entryIds = entries.map((e) => e.id);
    if (!entryIds.length) return new Map();

    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .select('*')
      .in('giveaway_entry_id', entryIds)
      .eq('verification_status', GiveawayTaskCompletionStatus.PENDING);
    if (error) throw new BadRequestException(error.message);

    const byTask = new Map<string, Array<{ completion: GiveawayTaskCompletion; entry: GiveawayEntry }>>();
    for (const row of data ?? []) {
      const completion = row as GiveawayTaskCompletion;
      const entry = entriesById.get(completion.giveaway_entry_id);
      if (!entry) continue;
      const list = byTask.get(completion.giveaway_task_id) ?? [];
      list.push({ completion, entry });
      byTask.set(completion.giveaway_task_id, list);
    }
    return byTask;
  }

  /** Final catch-all X-verification pass, run exactly once per giveaway at its actual end date —
   *  called from GiveawayDrawService right as entries close, before the eligibility snapshot
   *  freezes. Replaces the old fixed-schedule cron (removed 2026-08-06, Lisa: "we don't have
   *  budget to automatically do it, they need to click verify"): during the giveaway, verification
   *  is click-only via submitTaskCompletion's inline path above. This sweep exists so an entrant
   *  who genuinely did the X task but never clicked "Verify" in-app isn't unfairly excluded from
   *  the draw — same cache-shared fetch as every other verification call (XVerificationService's
   *  FETCH_CACHE_TTL_MS), so it costs at most one real X call per still-pending task, not per
   *  entrant. */
  async runFinalXVerificationSweep(giveaway: Giveaway): Promise<void> {
    if (!this.xVerification.isAvailable()) return;
    try {
      const pendingByTask = await this.listPendingByTask(giveaway.id);
      if (!pendingByTask.size) return;
      const tasks = await this.giveawaysService.getTasks(giveaway.id);
      const tasksById = new Map(tasks.map((t) => [t.id, t]));
      for (const [taskId, pending] of pendingByTask) {
        const task = tasksById.get(taskId);
        if (!task) continue;
        await this.xVerification.verifyPendingCompletions(giveaway, task, pending);
      }
    } catch (e: any) {
      this.logger.error(`[GiveawayEntries] runFinalXVerificationSweep ${giveaway.id}: ${e?.message ?? e}`);
    }
  }

  /** Entries where every task completion is verified/auto_verified — the pool the draw selects
   *  winners from. Disqualified/incomplete entries are simply excluded, not error cases. */
  async getEligibleVerifiedEntries(giveawayId: string): Promise<GiveawayEntry[]> {
    const entries = await this.listEntries(giveawayId);
    const entryIds = entries.map((e) => e.id);
    if (!entryIds.length) return [];

    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .select('giveaway_entry_id, verification_status')
      .in('giveaway_entry_id', entryIds);
    if (error) throw new BadRequestException(error.message);

    const verifiedStatuses = new Set([GiveawayTaskCompletionStatus.VERIFIED, GiveawayTaskCompletionStatus.AUTO_VERIFIED]);
    const allVerifiedByEntry = new Map<string, boolean>();
    for (const row of data ?? []) {
      const entryId = row.giveaway_entry_id as string;
      const ok = verifiedStatuses.has(row.verification_status as GiveawayTaskCompletionStatus);
      allVerifiedByEntry.set(entryId, (allVerifiedByEntry.get(entryId) ?? true) && ok);
    }

    return entries.filter(
      (e) => e.status === GiveawayEntryStatus.ENTERED && allVerifiedByEntry.get(e.id) === true,
    );
  }

  /** Count of completions still awaiting a decision (unresolved X-verification, or an
   *  un-reviewed self-report submission) among currently-ENTERED entries. Used to block
   *  finalizing the draw while real work is still outstanding — without this, a self-report task
   *  the creator just hasn't reviewed yet would silently exclude that entrant from the draw
   *  instead of the draw waiting for the review queue to clear. Disqualified entries are excluded
   *  from the count since their pending work (if any) can never become eligible anyway. */
  async countPendingCompletions(giveawayId: string): Promise<number> {
    const entries = await this.listEntries(giveawayId);
    const activeEntryIds = entries.filter((e) => e.status === GiveawayEntryStatus.ENTERED).map((e) => e.id);
    if (!activeEntryIds.length) return 0;

    const { count, error } = await this.supabaseService.giveawayTaskCompletions
      .select('id', { count: 'exact', head: true })
      .in('giveaway_entry_id', activeEntryIds)
      .eq('verification_status', GiveawayTaskCompletionStatus.PENDING);
    if (error) throw new BadRequestException(error.message);
    return count ?? 0;
  }
}
