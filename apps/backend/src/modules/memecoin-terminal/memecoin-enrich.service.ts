import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '@/database/supabase.service';
import { isCronEnabled } from '@/common/cron-gate';
import { FILTERS } from './memecoin-filters';
import { allowanceToday } from './memecoin-budget';
import { fetchDexPaid, fetchMarket, fetchRisk, memecoinIngestOn } from './memecoin-providers';

const BATCH = 20;
const CONCURRENCY = 4;
const FRESH_WINDOW_MS = 24 * 3600_000; // migrated in the last day: refresh often
const FRESH_REFRESH_MS = 10 * 60_000;
const OLD_WINDOW_MS = 30 * 24 * 3600_000;
const OLD_REFRESH_MS = 6 * 3600_000;
const MAX_FAILURES = 5; // a coin the providers cannot resolve is dropped from the queue
const DEFAULT_DAILY_CAP = 20_000; // free DexScreener calls only
// Solana Tracker is metered (2,500 a month on our plan): one call per coin, only for coins that already
// pass the free volume check, spread over the month, with a counter read from the database and a pause on errors.
const TRACKER = 'solana_tracker';
const DEFAULT_TRACKER_MONTHLY_CAP = 2000; // leaves ~500 spare for manual checks
const TRACKER_PER_TICK = 5;
const TRACKER_PAUSE_MS = 30 * 60_000;
const USAGE_CACHE_MS = 60_000;

/**
 * Keeps each migrated coin's market + risk numbers current. Cost-sensitive by design (see the
 * giveaway X API incidents): a hard daily cap on provider calls, small batches, and a coin that
 * keeps failing stops being retried.
 */
@Injectable()
export class MemecoinEnrichService {
  private readonly logger = new Logger(MemecoinEnrichService.name);
  private running = false;
  private capDay = '';
  private callsToday = 0;
  private trackerLeft = 0;
  private trackerFailed = 0; // failed paid calls this process made (they save no holders, so are counted here)
  private trackerPausedUntil = 0;
  private usage: { at: number; month: number; today: number } | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!memecoinIngestOn(this.config, isCronEnabled(this.config))) return;
    if (this.running) return;
    this.running = true;
    try {
      await this.runBatch();
    } catch (e: any) {
      this.logger.error(`enrich batch: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  private get dailyCap(): number {
    const n = Number(this.config.get('MEMECOIN_ENRICH_DAILY_CAP'));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
  }

  private get trackerMonthlyCap(): number {
    const n = Number(this.config.get('MEMECOIN_TRACKER_MONTHLY_CAP'));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TRACKER_MONTHLY_CAP;
  }

  /**
   * This month's tracker calls, counted from the coins table (no extra table): every coin gets at most one
   * paid call and a successful call saves its holder count, so coins with holders set are the calls spent.
   * Failed calls this process made are added on top. Fails closed: unreadable means no tracker calls.
   */
  private async loadUsage(): Promise<{ month: number; today: number } | null> {
    const now = Date.now();
    if (this.usage && now - this.usage.at < USAGE_CACHE_MS) return this.usage;
    const d = new Date();
    const monthStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    const db = this.supabase.getClient();
    const count = (since: string) => db.from('memecoin_tokens').select('mint', { count: 'exact', head: true }).not('holders', 'is', null).gte('metrics_updated_at', since);
    const [month, today] = await Promise.all([count(monthStart), count(dayStart)]);
    if (month.error || today.error) {
      this.logger.warn(`Tracker usage unreadable (${(month.error ?? today.error)?.message}); skipping Solana Tracker calls.`);
      return null;
    }
    this.usage = { at: now, month: (month.count ?? 0) + this.trackerFailed, today: (today.count ?? 0) + this.trackerFailed };
    return this.usage;
  }

  /** Counts one coin (2 free provider calls) against the free daily cap. */
  private spend(calls: number): boolean {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.capDay) { this.capDay = day; this.callsToday = 0; }
    if (this.callsToday + calls > this.dailyCap) return false;
    this.callsToday += calls;
    return true;
  }

  private async pickBatch(): Promise<Array<{ mint: string; dex_paid: boolean; holders: number | null }>> {
    const db = this.supabase.getClient();
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const base = () => db.from('memecoin_tokens').select('mint, dex_paid, holders').eq('status', 'migrated').lt('enrich_failures', MAX_FAILURES);

    // Coins that already pass the free volume check but still lack risk numbers go first, biggest first, so the
    // few paid calls we can afford are spent on the coins people are most likely to look at.
    const needRisk = this.trackerLeft > 0
      ? await base().is('holders', null).gte('volume_24h_usd', FILTERS.minVolumeUsd).gt('migrated_at', iso(now - FRESH_WINDOW_MS))
          .order('volume_24h_usd', { ascending: false }).limit(TRACKER_PER_TICK)
      : { data: [] as any[], error: null };
    if (needRisk.error) throw new Error(needRisk.error.message);

    const fresh = await base()
      .gt('migrated_at', iso(now - FRESH_WINDOW_MS))
      .or(`metrics_updated_at.is.null,metrics_updated_at.lt.${iso(now - FRESH_REFRESH_MS)}`)
      .order('metrics_updated_at', { ascending: true, nullsFirst: true })
      .limit(BATCH);
    if (fresh.error) throw new Error(fresh.error.message);
    const seen = new Set((needRisk.data ?? []).map((r: any) => r.mint));
    const rows = [...(needRisk.data ?? []), ...(fresh.data ?? []).filter((r: any) => !seen.has(r.mint))].slice(0, BATCH);
    if (rows.length >= BATCH) return rows;

    const old = await base()
      .gt('migrated_at', iso(now - OLD_WINDOW_MS))
      .lte('migrated_at', iso(now - FRESH_WINDOW_MS))
      .or(`metrics_updated_at.is.null,metrics_updated_at.lt.${iso(now - OLD_REFRESH_MS)}`)
      .order('metrics_updated_at', { ascending: true, nullsFirst: true })
      .limit(BATCH - rows.length);
    if (old.error) throw new Error(old.error.message);
    return [...rows, ...(old.data ?? [])];
  }

  private async runBatch(): Promise<void> {
    const trackerKey = this.config.get<string>('SOLANA_TRACKER_API_KEY') ?? '';
    const usage = trackerKey && Date.now() >= this.trackerPausedUntil ? await this.loadUsage() : null;
    this.trackerLeft = usage
      ? Math.min(TRACKER_PER_TICK, allowanceToday({ monthlyCap: this.trackerMonthlyCap, usedThisMonth: usage.month, usedToday: usage.today, now: new Date() }))
      : 0;
    const batch = await this.pickBatch();
    if (batch.length === 0) return;

    const queue = [...batch];
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        if (!this.spend(2)) {
          this.logger.warn(`Daily enrichment cap (${this.dailyCap}) reached; pausing until tomorrow.`);
          queue.length = 0;
          return;
        }
        await this.enrichOne(row.mint, row.dex_paid, row.holders, trackerKey);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    this.usage = null; // re-read next tick
  }

  private async enrichOne(mint: string, alreadyPaid: boolean, holders: number | null, trackerKey: string): Promise<void> {
    const db = this.supabase.getClient();
    const [market, paid] = await Promise.allSettled([
      fetchMarket(mint),
      alreadyPaid ? Promise.resolve(true) : fetchDexPaid(mint),
    ]);

    // The one paid call per coin: only if it has no risk numbers yet, the free data says it clears the volume
    // bar, and today's budget has room. The slot is taken before the request so concurrent workers cannot overspend.
    const volume = market.status === 'fulfilled' && market.value ? market.value.volume_24h_usd ?? 0 : 0;
    let risk: PromiseSettledResult<Awaited<ReturnType<typeof fetchRisk>> | null> = { status: 'fulfilled', value: null };
    if (trackerKey && holders == null && volume >= FILTERS.minVolumeUsd && this.trackerLeft > 0 && Date.now() >= this.trackerPausedUntil) {
      this.trackerLeft--;
      risk = await Promise.allSettled([fetchRisk(mint, trackerKey)]).then(([r]) => r);
      if (risk.status === 'rejected') {
        this.trackerFailed++;
        this.trackerPausedUntil = Date.now() + TRACKER_PAUSE_MS;
        this.logger.warn(`Solana Tracker call failed (${risk.reason?.message}); pausing tracker calls for 30 minutes.`);
      }
    }

    const columns: Record<string, unknown> = { metrics_updated_at: new Date().toISOString() };
    let useful = false;
    let marketNames: { name: string | null; symbol: string | null } | null = null;
    if (market.status === 'fulfilled' && market.value) {
      const { name, symbol, ...rest } = market.value;
      Object.assign(columns, rest);
      marketNames = { name, symbol };
      useful = true;
    }
    if (paid.status === 'fulfilled') columns.dex_paid = alreadyPaid || paid.value;
    if (risk.status === 'fulfilled' && risk.value) { Object.assign(columns, risk.value); useful = true; }

    const failed = [market, paid, risk].filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) this.logger.warn(`Enrich ${mint}: ${failed.map(f => f.reason?.message).join('; ')}`);

    // Only fill the name/symbol the migration event did not carry; never overwrite.
    if (marketNames && (marketNames.name || marketNames.symbol)) {
      const { data } = await db.from('memecoin_tokens').select('name, symbol').eq('mint', mint).maybeSingle();
      if (marketNames.name && !data?.name) columns.name = marketNames.name;
      if (marketNames.symbol && !data?.symbol) columns.symbol = marketNames.symbol;
    }
    if (!useful) {
      const { data } = await db.from('memecoin_tokens').select('enrich_failures').eq('mint', mint).maybeSingle();
      columns.enrich_failures = (data?.enrich_failures ?? 0) + 1;
    }
    const { error } = await db.from('memecoin_tokens').update(columns).eq('mint', mint);
    if (error) this.logger.error(`Saving metrics for ${mint}: ${error.message}`);
  }
}
