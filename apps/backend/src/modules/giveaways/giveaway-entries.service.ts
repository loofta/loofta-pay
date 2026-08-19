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

  /** Resolves the caller's linked X account via Privy, same lookup twitter-payments.service.ts
   *  uses — and, critically, entirely without a real X API call. Privy's own Twitter OAuth record
   *  already carries the numeric id (the `subject`/`sub` claim from Twitter's JWT), username, and
   *  profile picture; only followers_count and account age genuinely require a live X API lookup
   *  (see resolveXProfile), so callers that don't need those should use this directly instead. */
  private async resolveLinkedXAccount(userId: string): Promise<{ id: string; username: string; profileImageUrl: string | null }> {
    const privyUser = await this.privy.getPrivyUser(userId);
    const twitterAccount = privyUser?.linked_accounts?.find(
      (a: any) => TWITTER_ACCOUNT_TYPES.includes((a.type ?? '').toLowerCase()),
    );
    const username = (twitterAccount?.username || twitterAccount?.name || twitterAccount?.address || '').trim();
    const id = (twitterAccount?.subject || '').trim();
    if (!username || !id) {
      throw new BadRequestException('No X (Twitter) account linked. Connect X in settings before entering a giveaway.');
    }
    return { id, username, profileImageUrl: twitterAccount?.profilePictureUrl || null };
  }

  async enter(giveawayId: string, userId: string): Promise<GiveawayEntry> {
    const giveaway = await this.giveawaysService.findOneOrThrow(giveawayId);
    if (giveaway.created_by === userId) {
      throw new ForbiddenException('You can\'t enter your own giveaway.');
    }
    if (giveaway.status !== GiveawayStatus.OPEN) {
      throw new BadRequestException(`Giveaway is ${giveaway.status}, not open for entries`);
    }
    if (new Date(giveaway.entries_close_at).getTime() <= Date.now()) {
      throw new BadRequestException('Entries have closed for this giveaway');
    }

    const { data: existing } = await this.supabaseService.giveawayEntries
      .select('id, status')
      .eq('giveaway_id', giveawayId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing?.status === GiveawayEntryStatus.DISQUALIFIED) {
      // Checked once, remembered from here on — no re-check, no further X API call, ever, for
      // this account on this giveaway. Previously a failed eligibility check persisted nothing at
      // all, so nothing stopped (or even slowed down) an immediate retry from re-triggering a real
      // X API lookup — with enough repeat attempts across enough entrants that's a real cost driver
      // on its own, on top of the caching bugs fixed above.
      throw new ForbiddenException("You don't meet this giveaway's eligibility requirements.");
    }
    if (existing) throw new ConflictException('Already entered this giveaway');

    const account = await this.resolveLinkedXAccount(userId);

    // followers_count/account age aren't in Privy's linked-account data — only pay for a real X
    // API lookup when a giveaway actually gates on one of them. This is the common case's entire
    // X API cost for entering: previously every single entry paid for one regardless of whether
    // the giveaway had any eligibility rules at all.
    const minFollowers = giveaway.eligibility?.min_followers;
    const minAgeDays = giveaway.eligibility?.min_account_age_days;
    const verifiedOnly = giveaway.eligibility?.verified_only === true;
    let xUserId = account.id;
    let xHandle = account.username;
    let avatarUrl = account.profileImageUrl;
    let eligibilitySnapshot: Record<string, unknown> = {};

    if (typeof minFollowers === 'number' || typeof minAgeDays === 'number' || verifiedOnly) {
      const profile = await this.xVerification.resolveXProfile(account.username);
      if (!profile) {
        throw new BadRequestException('Could not verify your X account right now. Please try again shortly.');
      }
      xUserId = profile.id;
      xHandle = profile.username;
      // avatarUrl stays whatever resolveLinkedXAccount (Privy) already gave us — resolveXProfile
      // no longer fetches profile_image_url from X at all, see its doc comment.
      eligibilitySnapshot = { followers_count: profile.followersCount, account_created_at: profile.createdAt, verified: profile.verified };

      const failReason =
        typeof minFollowers === 'number' && profile.followersCount < minFollowers
          ? `This giveaway requires at least ${minFollowers} X followers`
          : typeof minAgeDays === 'number' && (Date.now() - new Date(profile.createdAt).getTime()) / 86_400_000 < minAgeDays
            ? `This giveaway requires an X account at least ${minAgeDays} days old`
            : verifiedOnly && !profile.verified
              ? 'This giveaway requires a verified X account'
              : null;
      if (failReason) {
        await this.insertEntryRow(giveawayId, userId, GiveawayEntryStatus.DISQUALIFIED, { xUserId, xHandle, avatarUrl, eligibilitySnapshot });
        throw new ForbiddenException(failReason);
      }
    }

    const entry = await this.insertEntryRow(giveawayId, userId, GiveawayEntryStatus.ENTERED, { xUserId, xHandle, avatarUrl, eligibilitySnapshot });
    if (entry) {
      await this.createTaskCompletionStubs(entry.id, giveawayId);
      return entry;
    }
    throw new BadRequestException('Failed to enter giveaway after retries — please try again');
  }

  /** entry_index: simple read-then-insert with one retry on the unique-index conflict — entry
   *  volume for a single giveaway doesn't warrant a DB sequence, and the unique index is the
   *  actual source of truth either way (this just avoids wasting most retries on a cold start).
   *  Shared by both a real entry and a disqualified (ineligible) record — the row itself is what
   *  makes "checked once, remembered forever" possible, so a disqualified attempt needs a durable
   *  row exactly as much as a real one does. Returns null only if every retry hit a genuine
   *  index collision (vanishingly rare); any other DB error throws directly. */
  private async insertEntryRow(
    giveawayId: string,
    userId: string,
    status: GiveawayEntryStatus,
    data: { xUserId: string; xHandle: string; avatarUrl: string | null; eligibilitySnapshot: Record<string, unknown> },
  ): Promise<GiveawayEntry | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { count } = await this.supabaseService.giveawayEntries
        .select('id', { count: 'exact', head: true })
        .eq('giveaway_id', giveawayId);
      const { data: entry, error } = await this.supabaseService.giveawayEntries
        .insert({
          giveaway_id: giveawayId,
          user_id: userId,
          entry_index: (count ?? 0) + 1,
          x_user_id: data.xUserId,
          x_handle: data.xHandle,
          avatar_url: data.avatarUrl,
          eligibility_snapshot: data.eligibilitySnapshot,
          status,
        })
        .select()
        .single();
      if (!error && entry) return entry as GiveawayEntry;
      if (error && !error.message.includes('duplicate key')) {
        throw new BadRequestException(`Failed to enter giveaway: ${error.message}`);
      }
      // entry_index collision — retry with a freshly-read count
    }
    return null;
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

    const giveawayForStatus = await this.giveawaysService.findOneOrThrow(giveawayId);
    if (giveawayForStatus.status !== GiveawayStatus.OPEN) {
      throw new BadRequestException('This giveaway has ended — tasks can no longer be verified.');
    }

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

  /** payout_status: 'succeeded' only means a claim link was created — it says nothing about
   *  whether the winner actually claimed it. Joins in the real payments.status/paid_at so a
   *  creator can tell "sent, waiting on winner" apart from "winner actually claimed it." Only the
   *  creator-facing manage page needs this join, so it's kept separate from listEntries (used by
   *  the draw/eligibility internals on every cron tick, where the extra payments query would be
   *  pure overhead). */
  async listEntriesWithClaimStatus(giveawayId: string): Promise<Array<GiveawayEntry & { payment_status: string | null; payment_paid_at: string | null }>> {
    const entries = await this.listEntries(giveawayId);

    const paymentIds = entries.map((e) => e.claim_payment_id).filter((id): id is string => Boolean(id));
    let paymentsById = new Map<string, { status: string; paid_at: string | null }>();
    if (paymentIds.length) {
      const { data: payments, error: paymentsError } = await this.supabaseService.payments
        .select('id, status, paid_at')
        .in('id', paymentIds);
      if (paymentsError) throw new BadRequestException(paymentsError.message);
      paymentsById = new Map((payments ?? []).map((p) => [p.id as string, { status: p.status as string, paid_at: p.paid_at as string | null }]));
    }

    return entries.map((e) => {
      const payment = e.claim_payment_id ? paymentsById.get(e.claim_payment_id) : undefined;
      return { ...e, payment_status: payment?.status ?? null, payment_paid_at: payment?.paid_at ?? null };
    });
  }

  /** Completions awaiting a human decision — self-report tasks only. AUTO_API tasks (X follow/
   *  retweet/comment) resolve programmatically via XVerificationService and never need a human
   *  here; a genuine API failure for one of those lands in listApiErrorEscalations instead, not
   *  this queue. A self-report completion is only ever PENDING or already reviewed — it can never
   *  reach api_error (that status only comes from XVerificationService), so filtering to PENDING
   *  is exactly "still needs a decision," not an approximation of it. */
  async listReviewQueue(
    giveawayId: string,
    opts: { page?: number; pageSize?: number } = {},
  ): Promise<{ items: Array<GiveawayTaskCompletion & { entry: GiveawayEntry; task: GiveawayTask }>; total: number }> {
    const entries = await this.listEntries(giveawayId);
    const entryIds = entries.map((e) => e.id);
    if (!entryIds.length) return { items: [], total: 0 };
    const tasks = await this.giveawaysService.getTasks(giveawayId);
    const selfReportTaskIds = new Set(tasks.filter((t) => t.verification_mode === GiveawayTaskVerificationMode.SELF_REPORT).map((t) => t.id));
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    const entriesById = new Map(entries.map((e) => [e.id, e]));
    if (!selfReportTaskIds.size) return { items: [], total: 0 };

    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .select('*')
      .in('giveaway_entry_id', entryIds)
      .in('giveaway_task_id', Array.from(selfReportTaskIds))
      .eq('verification_status', GiveawayTaskCompletionStatus.PENDING)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const all = (data ?? [])
      .map((c) => {
        const completion = c as GiveawayTaskCompletion;
        const task = tasksById.get(completion.giveaway_task_id);
        const entry = entriesById.get(completion.giveaway_entry_id);
        if (!task || !entry) return null;
        return { ...completion, entry, task };
      })
      .filter((x): x is GiveawayTaskCompletion & { entry: GiveawayEntry; task: GiveawayTask } => x !== null);

    // Entering a giveaway creates a PENDING stub for every task up front (createTaskCompletionStubs),
    // so this queue is full of stubs nobody has actually submitted proof for yet alongside real
    // submissions awaiting a decision. Proof-having items first (oldest first within each group) so a
    // reviewer isn't stuck paging past empty stubs to find the ones that actually need a decision.
    const hasProof = (c: GiveawayTaskCompletion) => Boolean(c.submission_data?.proof || c.submission_data?.proof_image_url);
    all.sort((a, b) => Number(hasProof(b)) - Number(hasProof(a)));

    const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 100);
    const page = Math.max(opts.page ?? 1, 1);
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return { items, total: all.length };
  }

  /** Every task completion for one entry, any status, joined with task info — what the creator's
   *  entries-search dialog expands into when they click an entrant's name, so they can see what
   *  that person actually submitted without hunting for it in the review queue (which only shows
   *  still-pending self-report items). */
  async listEntryCompletions(giveawayId: string, entryId: string): Promise<Array<GiveawayTaskCompletion & { task: GiveawayTask }>> {
    const entries = await this.listEntries(giveawayId);
    if (!entries.some((e) => e.id === entryId)) throw new NotFoundException('Entry not found on this giveaway');

    const tasks = await this.giveawaysService.getTasks(giveawayId);
    const tasksById = new Map(tasks.map((t) => [t.id, t]));

    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .select('*')
      .eq('giveaway_entry_id', entryId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    return (data ?? [])
      .map((c) => {
        const completion = c as GiveawayTaskCompletion;
        const task = tasksById.get(completion.giveaway_task_id);
        if (!task) return null;
        return { ...completion, task };
      })
      .filter((x): x is GiveawayTaskCompletion & { task: GiveawayTask } => x !== null);
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

  /** Confirms completionId actually belongs to giveawayId (via its entry) and that its task is
   *  eligible for manual review — a caller authorized for giveawayId must not be able to touch a
   *  completion under a DIFFERENT giveaway, or override an AUTO_API task Sorsa already resolved,
   *  just by guessing/enumerating a completionId. Shared by both the authenticated
   *  creator-dashboard path and the password-protected public review-link path. */
  private async assertCompletionBelongsToGiveaway(
    giveawayId: string,
    completionId: string,
  ): Promise<GiveawayTaskCompletion> {
    const { data: completion, error: fetchError } = await this.supabaseService.giveawayTaskCompletions
      .select('*')
      .eq('id', completionId)
      .maybeSingle();
    if (fetchError) throw new BadRequestException(fetchError.message);
    if (!completion) throw new NotFoundException('Task completion not found');

    const { data: entry, error: entryError } = await this.supabaseService.giveawayEntries
      .select('giveaway_id')
      .eq('id', (completion as GiveawayTaskCompletion).giveaway_entry_id)
      .maybeSingle();
    if (entryError) throw new BadRequestException(entryError.message);
    if (!entry || (entry as { giveaway_id: string }).giveaway_id !== giveawayId) {
      throw new ForbiddenException('This task does not belong to that giveaway');
    }

    const tasks = await this.giveawaysService.getTasks(giveawayId);
    const task = tasks.find((t) => t.id === (completion as GiveawayTaskCompletion).giveaway_task_id);
    if (!task || task.verification_mode !== GiveawayTaskVerificationMode.SELF_REPORT) {
      throw new ForbiddenException('This task is not eligible for manual review');
    }
    return completion as GiveawayTaskCompletion;
  }

  /** Authenticated creator-dashboard path — caller must already be verified (by the controller)
   *  as giveawayId's creator; this additionally confirms completionId actually belongs to
   *  giveawayId, closing the IDOR a creator-scoped-only check would otherwise leave open (see
   *  assertCompletionBelongsToGiveaway). */
  async reviewCompletion(
    giveawayId: string,
    completionId: string,
    reviewerId: string,
    decision: 'verified' | 'rejected',
  ): Promise<GiveawayTaskCompletion> {
    await this.assertCompletionBelongsToGiveaway(giveawayId, completionId);
    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .update({ verification_status: decision, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
      .eq('id', completionId)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to review task completion');
    return data as GiveawayTaskCompletion;
  }

  /** Admin override — the route this backs is AdminGuard-gated and deliberately "any completion,
   *  any giveaway" (see GiveawaysAdminController), so there's no giveawayId to scope against and
   *  none is needed: AdminGuard is already the full authorization here, unlike the
   *  creator-dashboard path above. */
  async reviewCompletionAdmin(
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

  /** Same action as reviewCompletion, but for the password-protected public review link path,
   *  which has no real user identity to authorize with — a valid session only proves "allowed to
   *  act on giveawayId," not "allowed to touch this specific completionId." reviewed_by stays
   *  null — there is no account behind a public-link decision, only the fact that it happened
   *  (reviewed_at). */
  async reviewCompletionScoped(
    giveawayId: string,
    completionId: string,
    decision: 'verified' | 'rejected',
  ): Promise<GiveawayTaskCompletion> {
    await this.assertCompletionBelongsToGiveaway(giveawayId, completionId);
    const { data: updated, error: updateError } = await this.supabaseService.giveawayTaskCompletions
      .update({ verification_status: decision, reviewed_by: null, reviewed_at: new Date().toISOString() })
      .eq('id', completionId)
      .select()
      .single();
    if (updateError || !updated) throw new BadRequestException(updateError?.message ?? 'Failed to review task completion');
    return updated as GiveawayTaskCompletion;
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

  /** Final catch-all X-verification pass, called from GiveawayDrawService while a giveaway sits in
   *  ENTRIES_CLOSED with pending completions. Replaces the old fixed-schedule cron (removed
   *  2026-08-06, Lisa: "we don't have budget to automatically do it, they need to click verify"):
   *  during the giveaway, verification is click-only via submitTaskCompletion's inline path above.
   *  This sweep exists so an entrant who genuinely did the X task but never clicked "Verify" in-app
   *  isn't unfairly excluded from the draw. The caller (freezeSnapshotAndStartDrawing) guards this
   *  to run exactly once per giveaway (via a 'final_sweep_ran' giveaway_event) — a giveaway can sit
   *  in ENTRIES_CLOSED for a long time waiting on a human review queue, and without that guard this
   *  would otherwise fire (and hit the real X API) on every single cron tick indefinitely. */
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
