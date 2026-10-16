import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { LotteryService } from './lottery.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const TICKET_PRICE_USDC = 1;
// Payments that actually moved money out. Unpaid OPEN links must not count.
const PAID_STATUSES = ['SUCCESS', 'PRIVATE_TRANSFER_PENDING'];

export interface WeeklyQuestSettings {
  enabled: boolean;
  targetUsd: number;
  /** Hard cap on free entries one user can earn in a week. */
  maxTicketsPerWinner: number;
  weeklyBudgetUsd: number;
}

/** One free entry per full multiple of the target, at least 1 for a qualifier, capped per user. */
export function ticketsForVolume(volumeUsd: number, s: Pick<WeeklyQuestSettings, 'targetUsd' | 'maxTicketsPerWinner'>): number {
  if (volumeUsd < s.targetUsd) return 0;
  return Math.min(s.maxTicketsPerWinner, Math.max(1, Math.floor(volumeUsd / s.targetUsd)));
}

/** Monday 00:00 UTC of the week containing `d`, as a Date. */
export function weekStartOf(d = new Date()): Date {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day;
}
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class WeeklyQuestService {
  private readonly logger = new Logger(WeeklyQuestService.name);
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly lottery: LotteryService,
  ) {}

  async getSettings(): Promise<WeeklyQuestSettings> {
    const { data } = await this.supabase.getClient().from('weekly_quest_settings').select('*').eq('id', 1).maybeSingle();
    return {
      enabled: data?.enabled ?? false,
      targetUsd: Number(data?.target_usd ?? 150),
      maxTicketsPerWinner: Number(data?.max_tickets_per_winner ?? 5),
      weeklyBudgetUsd: Number(data?.weekly_budget_usd ?? 10),
    };
  }

  async updateSettings(patch: Partial<WeeklyQuestSettings>): Promise<WeeklyQuestSettings> {
    const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
    if (patch.enabled !== undefined) row.enabled = !!patch.enabled;
    if (patch.targetUsd !== undefined) {
      if (!(patch.targetUsd > 0)) throw new BadRequestException('targetUsd must be greater than 0');
      row.target_usd = patch.targetUsd;
    }
    if (patch.maxTicketsPerWinner !== undefined) {
      if (!Number.isInteger(patch.maxTicketsPerWinner) || patch.maxTicketsPerWinner < 1 || patch.maxTicketsPerWinner > 50) {
        throw new BadRequestException('maxTicketsPerWinner must be an integer from 1 to 50');
      }
      row.max_tickets_per_winner = patch.maxTicketsPerWinner;
    }
    if (patch.weeklyBudgetUsd !== undefined) {
      if (!(patch.weeklyBudgetUsd >= 0)) throw new BadRequestException('weeklyBudgetUsd must be 0 or more');
      row.weekly_budget_usd = patch.weeklyBudgetUsd;
    }
    const { error } = await this.supabase.getClient().from('weekly_quest_settings').upsert(row);
    if (error) throw new Error(`Failed to save settings: ${error.message}`);
    return this.getSettings();
  }

  /** USD moved per user since `from` (sends that were paid, completed withdrawals, completed cash outs). Mainnet only. */
  private async volumesSince(from: Date, onlyUser?: string): Promise<Map<string, number>> {
    const db = this.supabase.getClient();
    const iso = from.toISOString();
    const totals = new Map<string, number>();
    const add = (id: string | null | undefined, amt: unknown) => {
      const n = Number(amt);
      if (!id || !Number.isFinite(n) || n <= 0) return;
      totals.set(id, (totals.get(id) ?? 0) + n);
    };

    let pay = db.from('payments').select('sender_user_id, amount, status, paid_at').eq('is_devnet', false).in('status', PAID_STATUSES).gte('created_at', iso).limit(100000);
    if (onlyUser) pay = pay.eq('sender_user_id', onlyUser);
    const { data: payments } = await pay;
    for (const p of payments ?? []) {
      if (p.status === 'PRIVATE_TRANSFER_PENDING' && !p.paid_at) continue;
      add(p.sender_user_id, p.amount);
    }

    let wd = db.from('withdrawals').select('user_id, amount_usdc, is_near_intents, near_intents_complete').eq('is_devnet', false).gte('created_at', iso).limit(100000);
    if (onlyUser) wd = wd.eq('user_id', onlyUser);
    const { data: withdrawals } = await wd;
    for (const w of withdrawals ?? []) {
      if (w.is_near_intents && !w.near_intents_complete) continue;
      add(w.user_id, w.amount_usdc);
    }

    let off = db.from('offramp_requests').select('user_id, amount_usdc').eq('status', 'COMPLETE').gte('created_at', iso).limit(100000);
    if (onlyUser) off = off.eq('user_id', onlyUser);
    const { data: cashouts } = await off;
    for (const c of cashouts ?? []) add(c.user_id, c.amount_usdc);

    let paj = db.from('paj_cash_orders').select('user_id, amount_usdc').eq('direction', 'OFF_RAMP').eq('status', 'COMPLETE').gte('created_at', iso).limit(100000);
    if (onlyUser) paj = paj.eq('user_id', onlyUser);
    const { data: naira } = await paj;
    for (const c of naira ?? []) add(c.user_id, c.amount_usdc);

    return totals;
  }

  /** What the dashboard bar shows for one user. Budget is intentionally never returned. */
  async getMyStatus(userId: string) {
    const settings = await this.getSettings();
    const start = weekStartOf();
    const next = new Date(start.getTime() + 7 * DAY_MS);
    const volumes = await this.volumesSince(start, userId);
    const volumeUsd = Math.round((volumes.get(userId) ?? 0) * 100) / 100;
    const db = this.supabase.getClient();
    const { data: rows } = await db.from('weekly_quest_awards')
      .select('id, week_start, volume_usd, tickets, status, seen_at, awarded_at')
      .eq('user_id', userId).order('week_start', { ascending: false }).limit(12);
    const history = (rows ?? []).filter((r: any) => r.status === 'awarded').map((r: any) => ({
      id: r.id, weekStart: r.week_start, volumeUsd: Number(r.volume_usd), tickets: Number(r.tickets), awardedAt: r.awarded_at,
    }));
    const unseen = (rows ?? []).find((r: any) => r.status === 'awarded' && !r.seen_at);
    return {
      projectedTickets: ticketsForVolume(volumeUsd, settings),
      history,
      unseenAward: unseen ? { id: unseen.id, weekStart: unseen.week_start, volumeUsd: Number(unseen.volume_usd), tickets: Number(unseen.tickets) } : null,
      weekStart: start.toISOString(),
      nextWeekStart: next.toISOString(),
      daysUntilNext: Math.max(0, Math.ceil((next.getTime() - Date.now()) / DAY_MS)),
      targetUsd: settings.targetUsd,
      volumeUsd,
      qualified: volumeUsd >= settings.targetUsd,
      enabled: settings.enabled,
    };
  }

  /**
   * Hourly job. Awards happen once a week has ENDED (so volume is final and entries scale with it),
   * for the last two completed weeks to catch any downtime across the Monday boundary.
   */
  async processWeeklyQuest(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = await this.getSettings();
      if (!settings.enabled) return;
      const thisWeek = weekStartOf();
      for (const weeksAgo of [2, 1]) {
        const start = new Date(thisWeek.getTime() - weeksAgo * 7 * DAY_MS);
        const end = new Date(start.getTime() + 7 * DAY_MS);
        await this.processWeek(start, end, settings);
      }
    } finally {
      this.running = false;
    }
  }

  private async processWeek(start: Date, end: Date, settings: WeeklyQuestSettings): Promise<void> {
    const db = this.supabase.getClient();
    const week = dateStr(start);
    // Volume inside [start, end): everything since start minus everything since end.
    const [sinceStart, sinceEnd] = await Promise.all([this.volumesSince(start), this.volumesSince(end)]);
    const qualifiers = [...sinceStart.entries()]
      .map(([id, v]) => [id, v - (sinceEnd.get(id) ?? 0)] as [string, number])
      .filter(([, v]) => v >= settings.targetUsd)
      .sort((a, b) => b[1] - a[1]);
    if (!qualifiers.length) return;

    const { data: existing } = await db.from('weekly_quest_awards').select('user_id, tickets, status').eq('week_start', week);
    const have = new Set((existing ?? []).map((r: any) => r.user_id));
    let spent = (existing ?? []).filter((r: any) => ['awarding', 'awarded'].includes(r.status)).reduce((a: number, r: any) => a + Number(r.tickets) * TICKET_PRICE_USDC, 0);
    const todo = qualifiers.filter(([id]) => !have.has(id));
    if (!todo.length) return;

    // Fair split under a fixed budget: everyone who qualified gets their first entry before anyone gets extras;
    // extras (scaling with volume) then go to the highest volume first until the budget is used.
    const budgetLeft = () => Math.floor((settings.weeklyBudgetUsd - spent) / TICKET_PRICE_USDC);
    const plan = new Map<string, number>();
    for (const [id] of todo) {
      if (budgetLeft() - [...plan.values()].reduce((a, b) => a + b, 0) >= 1) plan.set(id, 1);
    }
    let pool = budgetLeft() - [...plan.values()].reduce((a, b) => a + b, 0);
    for (const [id, vol] of todo) {
      if (!plan.has(id)) continue;
      const want = ticketsForVolume(vol, settings) - 1;
      const extra = Math.max(0, Math.min(want, pool));
      plan.set(id, 1 + extra);
      pool -= extra;
    }

    for (const [userId, volume] of todo) {
      const tickets = plan.get(userId) ?? 0;
      // Claim the (user, week) slot first. A unique-violation means another run already took it.
      const { data: row, error } = await db.from('weekly_quest_awards').insert({
        user_id: userId,
        week_start: week,
        volume_usd: Math.round(volume * 100) / 100,
        tickets: tickets || ticketsForVolume(volume, settings),
        status: tickets ? 'awarding' : 'skipped_budget',
      }).select('id').single();
      if (error || !row || !tickets) continue;
      await this.award(row.id, userId, tickets);
    }
  }

  private async award(awardId: string, userId: string, tickets: number): Promise<void> {
    const db = this.supabase.getClient();
    try {
      const { ticketId } = await this.lottery.purchaseTicketsForUser(userId, tickets);
      await db.from('weekly_quest_awards').update({ status: 'awarded', lottery_ticket_id: ticketId, awarded_at: new Date().toISOString(), failure_reason: null }).eq('id', awardId);
      this.logger.log(`Weekly quest: awarded ${tickets} ticket(s) to ${userId} (ticket ${ticketId})`);
    } catch (e: any) {
      // Not retried automatically: the purchase may have moved treasury funds before throwing, so an
      // admin checks the ticket and retries by hand. This is what keeps a failure from ever double-spending.
      this.logger.error(`Weekly quest: award for ${userId} failed: ${e?.message ?? e}`);
      await db.from('weekly_quest_awards').update({ status: 'failed', failure_reason: String(e?.message ?? e).slice(0, 500) }).eq('id', awardId);
    }
  }

  /** The user acknowledged the "you received X entries" toast. */
  async markSeen(userId: string, awardId: string): Promise<void> {
    await this.supabase.getClient().from('weekly_quest_awards').update({ seen_at: new Date().toISOString() }).eq('id', awardId).eq('user_id', userId);
  }

  /** Admin: award a qualified user their free entry right now (works even while auto-award is off). Still once per user per week. */
  async awardNow(userId: string): Promise<{ awardId: string }> {
    const settings = await this.getSettings();
    const start = weekStartOf();
    const volumes = await this.volumesSince(start, userId);
    const volume = volumes.get(userId) ?? 0;
    if (volume < settings.targetUsd) throw new BadRequestException(`User has not reached the target this week ($${volume.toFixed(2)} of $${settings.targetUsd})`);
    const tickets = ticketsForVolume(volume, settings);
    const db = this.supabase.getClient();
    const week = dateStr(start);
    const { data: row, error } = await db.from('weekly_quest_awards').insert({
      user_id: userId,
      week_start: week,
      volume_usd: Math.round(volume * 100) / 100,
      tickets,
      status: 'awarding',
    }).select('id').single();
    if (error || !row) throw new BadRequestException('This user already has an award for this week');
    await this.award(row.id, userId, tickets);
    return { awardId: row.id };
  }

  /** Admin: manual retry of a failed award (admin has confirmed no ticket was bought). */
  async retryAward(awardId: string): Promise<void> {
    const db = this.supabase.getClient();
    const { data: row } = await db.from('weekly_quest_awards').select('id, user_id, tickets, status, lottery_ticket_id').eq('id', awardId).maybeSingle();
    if (!row) throw new BadRequestException('Award not found');
    if (row.status !== 'failed' && row.status !== 'skipped_budget') throw new BadRequestException('Only failed or budget-skipped awards can be retried');
    if (row.lottery_ticket_id) throw new BadRequestException('This award already has a ticket');
    const { data: claimed } = await db.from('weekly_quest_awards').update({ status: 'awarding', failure_reason: null }).eq('id', awardId).in('status', ['failed', 'skipped_budget']).select('id').maybeSingle();
    if (!claimed) throw new BadRequestException('Award is already being processed');
    await this.award(awardId, row.user_id, Number(row.tickets));
  }

  /** Admin view: this week's progress (everyone with volume), the awards, and last week's awards. */
  async getAdminOverview() {
    const db = this.supabase.getClient();
    const settings = await this.getSettings();
    const start = weekStartOf();
    const next = new Date(start.getTime() + 7 * DAY_MS);
    const volumes = await this.volumesSince(start);
    const { data: awards } = await db.from('weekly_quest_awards').select('*').gte('week_start', dateStr(new Date(start.getTime() - 7 * DAY_MS))).order('qualified_at', { ascending: false }).limit(1000);
    const ids = new Set<string>([...volumes.keys(), ...(awards ?? []).map((a: any) => a.user_id)]);
    const { data: users } = ids.size
      ? await db.from('app_users').select('privy_user_id, username, email').in('privy_user_id', [...ids].slice(0, 1000))
      : { data: [] as any[] };
    const byId = new Map((users ?? []).map((u: any) => [u.privy_user_id, u]));
    const awardByUserWeek = new Map((awards ?? []).map((a: any) => [`${a.user_id}|${a.week_start}`, a]));
    const thisWeekKey = dateStr(start);
    const progress = [...volumes.entries()]
      .map(([userId, volume]) => ({
        userId,
        username: byId.get(userId)?.username ?? null,
        email: byId.get(userId)?.email ?? null,
        volumeUsd: Math.round(volume * 100) / 100,
        qualified: volume >= settings.targetUsd,
        projectedTickets: ticketsForVolume(volume, settings),
        award: awardByUserWeek.get(`${userId}|${thisWeekKey}`) ?? null,
      }))
      .sort((a, b) => b.volumeUsd - a.volumeUsd)
      .slice(0, 200);
    return {
      settings,
      weekStart: start.toISOString(),
      nextWeekStart: next.toISOString(),
      daysUntilNext: Math.max(0, Math.ceil((next.getTime() - Date.now()) / DAY_MS)),
      qualifiedCount: progress.filter((p) => p.qualified).length,
      progress,
      awards: (awards ?? []).map((a: any) => ({ ...a, username: byId.get(a.user_id)?.username ?? null, email: byId.get(a.user_id)?.email ?? null })),
    };
  }
}
