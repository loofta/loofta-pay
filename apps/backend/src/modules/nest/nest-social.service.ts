import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { NestService } from './nest.service';
import { XStocksService } from './xstocks.service';
import { ledgerUserId, isDemoLedgerUserId, realUserIdOf } from './nest-ledger-id';

export interface NestRoundups {
  enabled: boolean;
  unit: number | null;
  pendingUsd: number;
  paymentCount: number;
  since: string | null;
}

export interface FlockMember {
  username: string;
  displayName: string | null;
  level: string;
  streakWeeks: number;
  categories: Array<{ label: string; weight: number }>;
  kudosSentToday: boolean;
  kudosReceived: number;
}

export interface NestFlock {
  isPublic: boolean;
  username: string | null;
  following: FlockMember[];
  /** Public nests the caller doesn't follow yet — so the tab is never an empty room. */
  suggested: FlockMember[];
  followers: number;
  kudosReceived: number;
}

const ROUNDUP_UNITS = [1, 5];
/** Showcase nests seeded so the flock has someone to follow before real friends join. They live
 *  only in nest_* tables (no app_users row) under ids `nest-demo:<handle>`; the handle doubles
 *  as their username. Holdings are simulated like every other demo-ledger position. */
const SEED_PREFIX = 'nest-demo:';
const MAX_SUGGESTED = 6;
const MAX_ROUNDUP_PAYMENTS = 500;

// Mirrors nestLevel() on the frontend — tenure + funding + positions, never returns.
function levelFor(depositsUsd: number, firstDepositAt: string | null, positions: number): string {
  if (!firstDepositAt) return 'Egg';
  const weeks = Math.floor((Date.now() - new Date(firstDepositAt).getTime()) / (7 * 24 * 60 * 60_000));
  if (depositsUsd < 200 || weeks < 2) return 'Hatchling';
  if (depositsUsd < 1000 || weeks < 8 || positions < 10) return 'Fledgling';
  return 'Flyer';
}

/**
 * The two social-ish mechanics from the gamification research, built to avoid what got
 * Robinhood fined: crumbs celebrate *deposits* (never trades) and never move money on their
 * own; the flock shows category percentages, levels and streaks — never balances, never returns,
 * no leaderboard, no copy button. Follows/kudos are keyed by the real Privy user id; the nest
 * being shown is resolved per request to whichever ledger (real/demo) the caller is on.
 */
@Injectable()
export class NestSocialService {
  private readonly logger = new Logger(NestSocialService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly nest: NestService,
    private readonly xstocks: XStocksService,
  ) {}

  // ---- Crumbs (round-ups) ---------------------------------------------------------------------

  async getRoundups(realUserId: string, ledgerId: string): Promise<NestRoundups> {
    const db = this.supabase.getClient();
    const { data: profile } = await db.from('nest_profiles').select('roundup_unit, roundups_swept_at').eq('user_id', ledgerId).maybeSingle();
    const unit = profile?.roundup_unit === null || profile?.roundup_unit === undefined ? null : Number(profile.roundup_unit);
    if (!unit) return { enabled: false, unit: null, pendingUsd: 0, paymentCount: 0, since: null };

    const since: string | null = profile?.roundups_swept_at ?? null;
    let q = db.from('payments').select('amount, paid_at').eq('sender_user_id', realUserId).not('paid_at', 'is', null).order('paid_at', { ascending: false }).limit(MAX_ROUNDUP_PAYMENTS);
    if (since) q = q.gt('paid_at', since);
    const { data: payments, error } = await q;
    if (error) throw new Error(`getRoundups payments: ${error.message}`);

    let pending = 0;
    let count = 0;
    for (const p of payments ?? []) {
      const amount = Number(p.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const crumb = Math.ceil(amount / unit) * unit - amount;
      if (crumb <= 0.004) continue; // exact multiple — nothing to round
      pending += crumb;
      count++;
    }
    return { enabled: true, unit, pendingUsd: Math.round(pending * 100) / 100, paymentCount: count, since };
  }

  /** Enabling starts the clock now — months of old payments shouldn't materialise as one giant
   *  "crumbs" balance the moment someone flips the switch. */
  async setRoundups(realUserId: string, ledgerId: string, unit: number | null): Promise<NestRoundups> {
    if (unit !== null && !ROUNDUP_UNITS.includes(unit)) throw new BadRequestException(`unit must be one of ${ROUNDUP_UNITS.join(', ')} or null`);
    const db = this.supabase.getClient();
    const { data: existing } = await db.from('nest_profiles').select('roundup_unit').eq('user_id', ledgerId).maybeSingle();
    if (!existing) throw new NotFoundException('Set up your nest first');
    const patch: Record<string, unknown> = { roundup_unit: unit, updated_at: new Date().toISOString() };
    if (unit !== null && !existing.roundup_unit) patch.roundups_swept_at = new Date().toISOString();
    const { error } = await db.from('nest_profiles').update(patch).eq('user_id', ledgerId);
    if (error) throw new Error(`setRoundups: ${error.message}`);
    return this.getRoundups(realUserId, ledgerId);
  }

  async sweepRoundups(realUserId: string, ledgerId: string): Promise<NestRoundups> {
    const db = this.supabase.getClient();
    const { error } = await db.from('nest_profiles').update({ roundups_swept_at: new Date().toISOString() }).eq('user_id', ledgerId);
    if (error) throw new Error(`sweepRoundups: ${error.message}`);
    return this.getRoundups(realUserId, ledgerId);
  }

  // ---- Flock ----------------------------------------------------------------------------------

  private async userByUsername(username: string): Promise<{ privyUserId: string; username: string }> {
    const clean = username.trim().replace(/^@/, '').toLowerCase();
    if (!clean) throw new BadRequestException('username required');
    const db = this.supabase.getClient();
    const { data } = await db.from('app_users').select('privy_user_id, username').ilike('username', clean).maybeSingle();
    if (data?.privy_user_id) return { privyUserId: data.privy_user_id, username: data.username };
    // Showcase nests (see SEED_PREFIX) have no Loofta account; their handle is the id itself.
    const seedId = `${SEED_PREFIX}${clean}`;
    const { count } = await db.from('nest_profiles').select('*', { count: 'exact', head: true }).in('user_id', [seedId, ledgerUserId(seedId, true)]);
    if (count) return { privyUserId: seedId, username: clean };
    throw new NotFoundException(`No Loofta user @${clean}`);
  }

  /** Display handle for a real user id: their Loofta username, or the seed handle for showcase nests. */
  private handleOf(realUserId: string, usernameOf: Map<string, string>): string {
    return usernameOf.get(realUserId) ?? (realUserId.startsWith(SEED_PREFIX) ? realUserId.slice(SEED_PREFIX.length) : realUserId);
  }

  private async isPublic(ledgerId: string): Promise<boolean> {
    const { data } = await this.supabase.getClient().from('nest_profiles').select('flock_public').eq('user_id', ledgerId).maybeSingle();
    return !!data?.flock_public;
  }

  /** A followee's nest as the flock is allowed to see it: category fractions, level, streak. */
  private async memberView(viewerId: string, targetId: string, username: string, demo: boolean, today: string): Promise<FlockMember | null> {
    const ledger = ledgerUserId(targetId, demo);
    const db = this.supabase.getClient();
    const [{ data: profile }, { data: holdings }, deposits, streak, universe] = await Promise.all([
      db.from('nest_profiles').select('display_name, flock_public').eq('user_id', ledger).maybeSingle(),
      db.from('nest_holdings').select('symbol, units, avg_cost_usd').eq('user_id', ledger).gt('units', 0),
      this.nest.getDeposits(ledger),
      this.nest.getStreak(ledger),
      this.xstocks.getUniverse(),
    ]);
    if (!profile?.flock_public) return null;

    const rows = (holdings ?? []).filter(h => h.symbol !== 'USD');
    const prices = await this.xstocks.getPrices(rows.map(h => h.symbol));
    const tagOf = new Map(universe.map(a => [a.symbol, a.tags[0] ?? 'other']));
    const byCat = new Map<string, number>();
    let total = 0;
    for (const h of rows) {
      const value = Number(h.units) * (prices.get(h.symbol) ?? Number(h.avg_cost_usd));
      if (!(value > 0)) continue;
      const cat = tagOf.get(h.symbol) ?? 'other';
      byCat.set(cat, (byCat.get(cat) ?? 0) + value);
      total += value;
    }
    const categories = [...byCat.entries()]
      .map(([label, value]) => ({ label, weight: total > 0 ? value / total : 0 }))
      .sort((a, b) => b.weight - a.weight);

    const [{ data: kudosToday }, { count: kudosReceived }] = await Promise.all([
      db.from('nest_flock_kudos').select('day').eq('from_user_id', viewerId).eq('to_user_id', targetId).eq('day', today).maybeSingle(),
      db.from('nest_flock_kudos').select('*', { count: 'exact', head: true }).eq('to_user_id', targetId),
    ]);
    const depositsUsd = deposits.reduce((s, d) => s + d.amountUsdc, 0);
    const first = deposits.length ? deposits[deposits.length - 1].createdAt : null;
    return {
      username,
      displayName: profile.display_name ?? null,
      level: levelFor(depositsUsd, first, rows.length),
      streakWeeks: streak.weeks,
      categories,
      kudosSentToday: !!kudosToday,
      kudosReceived: kudosReceived ?? 0,
    };
  }

  async getFlock(realUserId: string, demo: boolean): Promise<NestFlock> {
    const db = this.supabase.getClient();
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: me }, isPublic, { data: follows }, { count: followers }, { count: kudosReceived }, { data: publicRows }] = await Promise.all([
      db.from('app_users').select('username').eq('privy_user_id', realUserId).maybeSingle(),
      this.isPublic(ledgerUserId(realUserId, demo)),
      db.from('nest_flock_follows').select('followee_user_id').eq('follower_user_id', realUserId),
      db.from('nest_flock_follows').select('*', { count: 'exact', head: true }).eq('followee_user_id', realUserId),
      db.from('nest_flock_kudos').select('*', { count: 'exact', head: true }).eq('to_user_id', realUserId),
      db.from('nest_profiles').select('user_id').eq('flock_public', true).order('created_at', { ascending: false }).limit(50),
    ]);
    const ids = (follows ?? []).map(f => f.followee_user_id);
    // Public nests on the caller's ledger (real or demo) that they don't follow yet, seeds first
    // so the tab has faces on day one. Ledger ids are mapped back to the real id follows are keyed by.
    const followed = new Set(ids);
    const candidateIds = (publicRows ?? [])
      .map(r => r.user_id as string)
      .filter(id => isDemoLedgerUserId(id) === demo)
      .map(realUserIdOf)
      .filter(id => id !== realUserId && !followed.has(id))
      .sort((a, b) => Number(b.startsWith(SEED_PREFIX)) - Number(a.startsWith(SEED_PREFIX)))
      .slice(0, MAX_SUGGESTED);
    const allIds = [...ids, ...candidateIds];
    const { data: users } = allIds.length ? await db.from('app_users').select('privy_user_id, username').in('privy_user_id', allIds) : { data: [] as any[] };
    const usernameOf = new Map((users ?? []).map(u => [u.privy_user_id, u.username as string]));
    const view = (id: string) =>
      this.memberView(realUserId, id, this.handleOf(id, usernameOf), demo, today).catch(e => {
        this.logger.warn(`flock memberView(${id}): ${e.message}`);
        return null;
      });
    const [members, suggested] = await Promise.all([Promise.all(ids.map(view)), Promise.all(candidateIds.map(view))]);
    return {
      isPublic,
      username: me?.username ?? null,
      following: members.filter((m): m is FlockMember => m !== null),
      suggested: suggested.filter((m): m is FlockMember => m !== null),
      followers: followers ?? 0,
      kudosReceived: kudosReceived ?? 0,
    };
  }

  async setPublic(ledgerId: string, isPublic: boolean): Promise<{ isPublic: boolean }> {
    const { error, data } = await this.supabase.getClient().from('nest_profiles').update({ flock_public: isPublic, updated_at: new Date().toISOString() }).eq('user_id', ledgerId).select('flock_public');
    if (error) throw new Error(`setPublic: ${error.message}`);
    if (!data?.length) throw new NotFoundException('Set up your nest first');
    return { isPublic: !!data[0].flock_public };
  }

  async follow(realUserId: string, username: string, demo: boolean): Promise<{ ok: true }> {
    const target = await this.userByUsername(username);
    if (target.privyUserId === realUserId) throw new BadRequestException("That's you");
    if (!(await this.isPublic(ledgerUserId(target.privyUserId, demo)))) throw new NotFoundException(`@${target.username} hasn't made their nest visible`);
    const { error } = await this.supabase.getClient().from('nest_flock_follows').upsert({ follower_user_id: realUserId, followee_user_id: target.privyUserId }, { onConflict: 'follower_user_id,followee_user_id' });
    if (error) throw new Error(`follow: ${error.message}`);
    return { ok: true };
  }

  async unfollow(realUserId: string, username: string): Promise<{ ok: true }> {
    const target = await this.userByUsername(username);
    const { error } = await this.supabase.getClient().from('nest_flock_follows').delete().eq('follower_user_id', realUserId).eq('followee_user_id', target.privyUserId);
    if (error) throw new Error(`unfollow: ${error.message}`);
    return { ok: true };
  }

  /** One kudos per pair per UTC day — a nudge of encouragement, not a like-count race. */
  async kudos(realUserId: string, username: string, demo: boolean): Promise<{ ok: true }> {
    const target = await this.userByUsername(username);
    if (target.privyUserId === realUserId) throw new BadRequestException("That's you");
    if (!(await this.isPublic(ledgerUserId(target.privyUserId, demo)))) throw new NotFoundException(`@${target.username} hasn't made their nest visible`);
    const day = new Date().toISOString().slice(0, 10);
    const { error } = await this.supabase.getClient().from('nest_flock_kudos').upsert({ from_user_id: realUserId, to_user_id: target.privyUserId, day }, { onConflict: 'from_user_id,to_user_id,day', ignoreDuplicates: true });
    if (error) throw new Error(`kudos: ${error.message}`);
    return { ok: true };
  }
}
