import { Injectable, Logger, ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';

const PUSH_URL = 'https://quests.magicblock.app/api/validators/push';
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RESET_TIMEZONE = 'Europe/Paris'; // CET/CEST
// Don't re-attempt a failed push more often than this — retryFailedPushes is triggered on every
// GET /me (i.e. every page load/poll), so this bounds how often we actually hit MagicBlock.
const RETRY_COOLDOWN_MS = 15_000;
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type MagicblockQuestType = 'lottery_ticket' | 'private_payment';

export interface MagicblockQuestStatusItem {
  questType: MagicblockQuestType;
  questId: number;
  completions: number;
  lastPushedAt: string | null;
  lastError: string | null;
}

export interface MagicblockQuestStatus {
  wallet: string | null;
  quests: MagicblockQuestStatusItem[];
  /** ISO instant the current quest week ends and completion counts reset (next Friday 10:00 CET/CEST). */
  resetsAt: string;
}

/** Wall-clock Y/M/D/H/M/S + weekday of `date` in RESET_TIMEZONE. */
function getZonedParts(date: Date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: RESET_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
  };
}

/** Converts a Y/M/D/H/M wall-clock instant in RESET_TIMEZONE to the real UTC Date it represents. */
function zonedWallTimeToUtc(y: number, m: number, d: number, h: number, min: number): Date {
  const guessUtcMs = Date.UTC(y, m - 1, d, h, min);
  const reparsed = getZonedParts(new Date(guessUtcMs));
  const reparsedUtcMs = Date.UTC(reparsed.year, reparsed.month - 1, reparsed.day, reparsed.hour, reparsed.minute, reparsed.second);
  return new Date(guessUtcMs - (reparsedUtcMs - guessUtcMs));
}

/** Most recent Friday 10:00 CET/CEST at or before `now` — the weekly quest-count reset boundary. */
function currentQuestWeekStart(now: Date = new Date()): Date {
  const p = getZonedParts(now);
  const weekday = WEEKDAY_INDEX[p.weekday];
  const secondsIntoDay = p.hour * 3600 + p.minute * 60 + p.second;
  const isFridayBeforeReset = weekday === 5 && secondsIntoDay < 10 * 3600;
  const daysSinceReset = weekday === 5 ? (isFridayBeforeReset ? 7 : 0) : (weekday - 5 + 7) % 7;

  const anchor = new Date(Date.UTC(p.year, p.month - 1, p.day - daysSinceReset));
  const anchorParts = getZonedParts(anchor);
  return zonedWallTimeToUtc(anchorParts.year, anchorParts.month, anchorParts.day, 10, 0);
}

/** The following Friday 10:00 CET/CEST — when the current quest week's counts reset. */
function nextQuestWeekStart(now: Date = new Date()): Date {
  const weekStart = currentQuestWeekStart(now);
  return new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * Pushes repeatable MagicBlock quest completions (private lottery ticket purchase, private
 * payment) server-to-server as those actions confirm elsewhere in the app — see confirmSend
 * (lottery.service.ts), confirmMultiSend (send-payment.service.ts) and updateStatus
 * (claims.service.ts), which all call maybePush*Quest as a fire-and-forget side effect.
 *
 * Every maybePush*Quest call re-verifies the qualifying condition from the DB itself rather than
 * trusting the caller, since this sits downstream of real money-movement code and must never be
 * the thing that makes a purchase/payment fail.
 */
@Injectable()
export class MagicblockQuestService {
  private readonly logger = new Logger(MagicblockQuestService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  // Hardcoded, not env vars — these are fixed MagicBlock questline IDs, not secrets or
  // per-environment config, and env drift between local/Railway already caused this to silently
  // no-op in production once today (2026-07-24).
  private questId(type: MagicblockQuestType): number {
    return type === 'lottery_ticket' ? 43 : 44;
  }

  async getWallet(userId: string): Promise<string | null> {
    const db = this.supabase.getClient();
    const { data } = await db.from('magicblock_wallets').select('wallet').eq('user_id', userId).maybeSingle();
    return data?.wallet ?? null;
  }

  /** Write-once: throws ConflictException if this user already connected a different wallet. */
  async setWallet(userId: string, wallet: string): Promise<{ wallet: string }> {
    const trimmed = wallet.trim();
    if (!SOLANA_ADDRESS_RE.test(trimmed)) {
      throw new BadRequestException('Invalid Solana address');
    }

    const existing = await this.getWallet(userId);
    if (existing) {
      if (existing === trimmed) return { wallet: existing }; // idempotent retry of the same value
      throw new ConflictException('MagicBlock wallet already connected — contact support to change it');
    }

    const db = this.supabase.getClient();
    const { error } = await db.from('magicblock_wallets').insert({ user_id: userId, wallet: trimmed });
    if (error) {
      // Unique-violation race: a concurrent request connected first — surface as conflict, not a 500.
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('MagicBlock wallet already connected — contact support to change it');
      }
      throw new Error(`setWallet failed: ${error.message}`);
    }
    // Backfill: push any qualifying purchase/payment made BEFORE the wallet was connected — the
    // purchase-time push (confirmSend/updateStatus) requires a connected wallet and otherwise
    // returns early with no row created at all, so there'd be nothing for retryFailedPushes to
    // ever retry (repeated real-world incident, 2026-07-24 — several users bought privately, then
    // connected their wallet after, and their quest silently never got a first attempt).
    this.backfillQuestsForNewWallet(userId).catch((e) =>
      this.logger.warn(`backfillQuestsForNewWallet(${userId}) failed: ${(e as Error)?.message ?? e}`),
    );
    return { wallet: trimmed };
  }

  /** Fire-and-forget: re-runs the same qualifying push for every pre-existing purchase/payment
   *  this user made before connecting a MagicBlock wallet. Safe to call repeatedly — pushForAction's
   *  own (quest_type, source_id) reservation silently no-ops anything already pushed. */
  private async backfillQuestsForNewWallet(userId: string): Promise<void> {
    const db = this.supabase.getClient();

    const { data: tickets } = await db
      .from('lottery_tickets')
      .select('id')
      .eq('user_id', userId)
      .eq('funded_privately', true);
    for (const t of tickets ?? []) {
      await this.maybePushLotteryTicketQuest((t as { id: string }).id).catch((e) =>
        this.logger.warn(`backfill lottery_ticket ${(t as { id: string }).id} failed: ${(e as Error)?.message ?? e}`),
      );
    }

    const { data: payments } = await db
      .from('payments')
      .select('id')
      .eq('sender_user_id', userId)
      .eq('status', 'SUCCESS')
      .eq('is_private', true)
      .eq('is_devnet', false)
      .neq('direction', 'from_recipient');
    for (const p of payments ?? []) {
      await this.maybePushPrivatePaymentQuest((p as { id: string }).id).catch((e) =>
        this.logger.warn(`backfill private_payment ${(p as { id: string }).id} failed: ${(e as Error)?.message ?? e}`),
      );
    }
  }

  /** Completion counts/status are scoped to the current quest week — they reset every Friday 10:00 CET/CEST. */
  async getQuestStatus(userId: string): Promise<MagicblockQuestStatus> {
    const weekStart = currentQuestWeekStart();
    const resetsAt = nextQuestWeekStart();

    const db = this.supabase.getClient();
    const [wallet, { data: rows }] = await Promise.all([
      this.getWallet(userId),
      db
        .from('magicblock_quest_pushes')
        .select('quest_type, success, response, pushed_at')
        .eq('user_id', userId)
        .gte('pushed_at', weekStart.toISOString())
        .order('pushed_at', { ascending: false }),
    ]);

    const types: MagicblockQuestType[] = ['lottery_ticket', 'private_payment'];
    const quests: MagicblockQuestStatusItem[] = types.map((questType) => {
      const forType = (rows ?? []).filter((r: any) => r.quest_type === questType);
      const successRows = forType.filter((r: any) => r.success);
      const lastFailed = forType.find((r: any) => !r.success);
      return {
        questType,
        questId: this.questId(questType),
        completions: successRows.length,
        lastPushedAt: successRows[0]?.pushed_at ?? null,
        lastError: successRows.length === 0 && lastFailed ? this.extractError(lastFailed.response) : null,
      };
    });

    return { wallet, quests, resetsAt: resetsAt.toISOString() };
  }

  /**
   * Fire-and-forget: called on every GET /me so a page load/poll re-attempts any push that
   * previously failed (e.g. missing API key at the time, or the MagicBlock quest not yet
   * started). Never throws — a retry failure must not break the status endpoint.
   */
  async retryFailedPushes(userId: string): Promise<void> {
    try {
      const weekStart = currentQuestWeekStart();
      const cutoff = new Date(Date.now() - RETRY_COOLDOWN_MS).toISOString();
      const db = this.supabase.getClient();
      const { data: rows } = await db
        .from('magicblock_quest_pushes')
        .select('id, quest_id, wallet')
        .eq('user_id', userId)
        .eq('success', false)
        .gte('pushed_at', weekStart.toISOString())
        .lt('pushed_at', cutoff);
      if (!rows?.length) return;

      for (const row of rows as { id: string; quest_id: number; wallet: string }[]) {
        try {
          const response = await this.pushToMagicBlock(row.quest_id, row.wallet);
          await db
            .from('magicblock_quest_pushes')
            .update({ success: true, response, pushed_at: new Date().toISOString() })
            .eq('id', row.id);
          this.logger.log(`MagicBlock quest ${row.quest_id} retry succeeded (push ${row.id})`);
        } catch (e) {
          const message = (e as Error)?.message ?? String(e);
          await db
            .from('magicblock_quest_pushes')
            .update({ response: { error: message }, pushed_at: new Date().toISOString() })
            .eq('id', row.id);
          this.logger.warn(`MagicBlock quest retry failed (push ${row.id}): ${message}`);
        }
      }
    } catch (e) {
      this.logger.warn(`retryFailedPushes errored for user ${userId}: ${(e as Error)?.message ?? e}`);
    }
  }

  private extractError(response: unknown): string | null {
    if (!response) return null;
    if (typeof response === 'string') return response;
    const r = response as Record<string, unknown>;
    return (r.error as string) ?? (r.message as string) ?? JSON.stringify(r);
  }

  /** Fire-and-forget: call after a lottery_tickets row confirms 'sent'. No-op if not a private purchase. */
  async maybePushLotteryTicketQuest(ticketId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: ticket } = await db
      .from('lottery_tickets')
      .select('user_id, funded_privately')
      .eq('id', ticketId)
      .maybeSingle();
    // funded_privately is the real signal — burner_sol_address is set for public purchases and
    // admin_treasury-funded gifts too, so it can't distinguish an actual private payment on its own.
    if (!ticket?.funded_privately) return;

    await this.pushForAction({ userId: ticket.user_id, questType: 'lottery_ticket', sourceId: ticketId });
  }

  /** Fire-and-forget: call after a payments row confirms SUCCESS. No-op if not a qualifying private payment. */
  async maybePushPrivatePaymentQuest(paymentId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: payment } = await db
      .from('payments')
      .select('sender_user_id, status, from_chain, is_devnet, direction, is_private')
      .eq('id', paymentId)
      .maybeSingle();
    if (!payment) return;

    const qualifies =
      payment.status === 'SUCCESS' &&
      !!payment.from_chain &&
      payment.is_devnet === false &&
      payment.direction !== 'from_recipient' &&
      payment.is_private === true;
    if (!qualifies || !payment.sender_user_id) return;

    await this.pushForAction({ userId: payment.sender_user_id, questType: 'private_payment', sourceId: paymentId });
  }

  private async pushForAction(opts: { userId: string; questType: MagicblockQuestType; sourceId: string }): Promise<void> {
    const wallet = await this.getWallet(opts.userId);
    if (!wallet) return; // user hasn't connected a MagicBlock wallet — nothing to push

    const questId = this.questId(opts.questType);
    if (!questId) {
      this.logger.warn(`No quest_id configured for ${opts.questType} — skipping push`);
      return;
    }

    const db = this.supabase.getClient();

    // Reserve this (quest_type, source_id) up front — the unique constraint means a concurrent
    // or retried call for the same action can never push twice.
    const { error: insertError } = await db.from('magicblock_quest_pushes').insert({
      user_id: opts.userId,
      quest_type: opts.questType,
      quest_id: questId,
      source_id: opts.sourceId,
      wallet,
      success: false,
    });
    if (insertError) {
      if ((insertError as { code?: string }).code === '23505') return; // already pushed for this action
      this.logger.warn(`Failed to reserve quest push row (${opts.questType}/${opts.sourceId}): ${insertError.message}`);
      return;
    }

    try {
      const response = await this.pushToMagicBlock(questId, wallet);
      await db
        .from('magicblock_quest_pushes')
        .update({ success: true, response })
        .eq('quest_type', opts.questType)
        .eq('source_id', opts.sourceId);
      this.logger.log(`MagicBlock quest ${questId} pushed for ${opts.questType}/${opts.sourceId}`);
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      await db
        .from('magicblock_quest_pushes')
        .update({ response: { error: message } })
        .eq('quest_type', opts.questType)
        .eq('source_id', opts.sourceId);
      this.logger.warn(`MagicBlock quest push failed (${opts.questType}/${opts.sourceId}): ${message}`);
    }
  }

  private async pushToMagicBlock(questId: number, walletPubkey: string): Promise<unknown> {
    const apiKey = this.config.get<string>('MAGICBLOCK_QUEST_PUSH_API_KEY', '');
    if (!apiKey) throw new Error('MAGICBLOCK_QUEST_PUSH_API_KEY not configured');

    const res = await fetch(PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ payload: { quest: questId, user: walletPubkey, timestamp: Date.now() } }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`MagicBlock push failed (${res.status}): ${JSON.stringify(body)}`);
    }
    return body;
  }
}
