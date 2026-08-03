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
} from './entities/giveaway.entity';

const TWITTER_ACCOUNT_TYPES = ['twitter_oauth', 'twitter_oauth2', 'twitter', 'x'];

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

  /** Participant marking a task done. For auto_api tasks this just flips pending -> pending
   *  (no-op besides recording intent + optional link) so the batched X-verification cron has
   *  something to check; for self_report tasks, submission_data is the actual proof. */
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

    const { data, error } = await this.supabaseService.giveawayTaskCompletions
      .update({ submission_data: submissionData ?? null })
      .eq('id', completion.id)
      .select()
      .single();
    if (error || !data) throw new BadRequestException(error?.message ?? 'Failed to submit task');
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
}
