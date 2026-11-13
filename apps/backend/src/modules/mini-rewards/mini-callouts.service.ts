import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { dexInfo } from '@/modules/mini-app/lib/dex';

/** What the poster earns of each tailed buy, in basis points of the tailer's trade size. Paid out of Loofta's own fee, the tailer pays nothing extra. */
export const CALLOUT_SHARE_BPS = 10;
/** A tap on Tail covers buys of that coin for this long. */
const WINDOW_MS = 24 * 3600 * 1000;
/** Most a poster can earn from tails in a day, so one account cannot be milked. Anything above waits for the next day and is not lost. */
const DAILY_CAP_USD = 50;
const MIN_TRADE_USD = 1;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Callout rewards. Someone taps Tail on a holder's post, then buys that coin: the poster earns 0.10% of the buy.
 * Because the tailer pays Loofta 0.28 to 0.30% for the trade and the poster gets 0.10% of it, tailing your own post
 * with a second account always loses money, so there is nothing to farm.
 */
@Injectable()
export class MiniCalloutsService {
  private readonly logger = new Logger(MiniCalloutsService.name);
  private conn: Connection | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
  ) {}

  private db() {
    return this.supabase.getClient();
  }

  private connection(): Connection {
    if (!this.conn) this.conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
    return this.conn;
  }

  private async holds(userId: string, mint: string): Promise<boolean> {
    try {
      const w = await this.users.getSolanaWalletAddress(userId);
      const r = await this.connection().getParsedTokenAccountsByOwner(new PublicKey(w), { mint: new PublicKey(mint) });
      return r.value.some((a) => (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0) > 0);
    } catch {
      return false;
    }
  }

  /** Tap on Tail. The poster has to be a holder, still holding it, and someone else. */
  async tail(userId: string, postId: string): Promise<{ tailId: string; mint: string; expiresAt: string; caller: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new BadRequestException('Bad post.');
    const { data: post } = await this.db().from('coin_chat_messages').select('id, mint, privy_user_id, created_at, holding_amount').eq('id', postId).maybeSingle();
    if (!post || !MINT_RE.test(post.mint) || !(Number(post.holding_amount) > 0)) throw new BadRequestException('That post cannot be tailed.');
    if (post.privy_user_id === userId) throw new BadRequestException('You cannot tail your own post.');
    if (Date.now() - Date.parse(post.created_at) > WINDOW_MS) throw new BadRequestException('That post is over a day old. Tailing is open for 24 hours.');

    const [mine, theirs] = await Promise.all([this.users.getSolanaWalletAddress(userId).catch(() => null), this.users.getSolanaWalletAddress(post.privy_user_id).catch(() => null)]);
    if (mine && theirs && mine === theirs) throw new BadRequestException('You cannot tail your own wallet.');
    if (!(await this.holds(post.privy_user_id, post.mint))) throw new BadRequestException('The poster no longer holds this coin, so this one cannot be tailed.');

    const expiresAt = new Date(Date.now() + WINDOW_MS).toISOString();
    const { data: existing } = await this.db().from('mini_tails').select('id, expires_at').eq('tailer_privy_id', userId).eq('post_id', postId).maybeSingle();
    let tailId = existing?.id as string | undefined;
    if (!tailId) {
      const { data, error } = await this.db().from('mini_tails').insert({ tailer_privy_id: userId, caller_privy_id: post.privy_user_id, post_id: postId, mint: post.mint, expires_at: expiresAt }).select('id').single();
      if (error || !data) throw new ConflictException('Could not tail this post. Try again.');
      tailId = data.id as string;
    }
    return { tailId, mint: post.mint, expiresAt: existing?.expires_at ?? expiresAt, caller: post.privy_user_id };
  }

  /** The open tail for a coin this person is about to buy, if there is one. The newest tap wins. */
  async activeTailFor(userId: string, mint: string): Promise<string | null> {
    try {
      const { data } = await this.db().from('mini_tails').select('id').eq('tailer_privy_id', userId).eq('mint', mint).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
      return (data?.id as string) ?? null;
    } catch {
      return null;
    }
  }

  /** Called once a tailed buy is confirmed on chain. One earning per trade. Never throws, a failure here must not touch the trade. */
  async accrue(tradeId: string): Promise<void> {
    try {
      const { data: t } = await this.db().from('mini_trades').select('id, mint, volume_usd, tail_id, status').eq('id', tradeId).maybeSingle();
      if (!t || t.status !== 'confirmed' || !t.tail_id) return;
      const volume = Number(t.volume_usd) || 0;
      if (volume < MIN_TRADE_USD) return;
      const { data: tail } = await this.db().from('mini_tails').select('id, caller_privy_id').eq('id', t.tail_id).maybeSingle();
      if (!tail) return;

      const amount = Math.round(((volume * CALLOUT_SHARE_BPS) / 10_000) * 1e6) / 1e6;
      let status: 'pending' | 'void' = 'pending';
      let note: string | null = null;
      if (!(await this.holds(tail.caller_privy_id, t.mint))) {
        status = 'void';
        note = 'The poster no longer held the coin.';
      } else {
        const dayStart = new Date();
        dayStart.setUTCHours(0, 0, 0, 0);
        const { data: today } = await this.db().from('mini_callout_earnings').select('amount_usd').eq('caller_privy_id', tail.caller_privy_id).neq('status', 'void').gte('created_at', dayStart.toISOString()).limit(5000);
        const sum = (today ?? []).reduce((n, r) => n + Number(r.amount_usd), 0);
        if (sum + amount > DAILY_CAP_USD) {
          status = 'void';
          note = 'Daily limit reached.';
        }
      }
      const { error } = await this.db().from('mini_callout_earnings').insert({ caller_privy_id: tail.caller_privy_id, tail_id: tail.id, trade_id: t.id, mint: t.mint, volume_usd: volume, amount_usd: amount, status, note });
      if (error && !/duplicate/i.test(error.message)) this.logger.warn(`accrue insert failed: ${error.message}`);
    } catch (e) {
      this.logger.warn(`accrue failed: ${(e as Error).message}`);
    }
  }

  /** What a poster has earned and how their calls are doing. */
  async summary(userId: string) {
    const [{ data: earn }, { data: tails }] = await Promise.all([
      this.db().from('mini_callout_earnings').select('mint, amount_usd, status, created_at, volume_usd').eq('caller_privy_id', userId).order('created_at', { ascending: false }).limit(2000),
      this.db().from('mini_tails').select('id, tailer_privy_id').eq('caller_privy_id', userId).limit(5000),
    ]);
    let pending = 0;
    let paid = 0;
    let volume = 0;
    for (const e of earn ?? []) {
      if (e.status === 'pending') pending += Number(e.amount_usd);
      else if (e.status === 'paid') paid += Number(e.amount_usd);
      if (e.status !== 'void') volume += Number(e.volume_usd);
    }
    const recentRows = (earn ?? []).filter((e) => e.status !== 'void').slice(0, 10);
    const dex = await dexInfo([...new Set(recentRows.map((r) => r.mint as string))]).catch(() => new Map());
    return {
      sharePercent: CALLOUT_SHARE_BPS / 100,
      pendingUsd: Math.round(pending * 100) / 100,
      paidUsd: Math.round(paid * 100) / 100,
      tails: (tails ?? []).length,
      tailers: new Set((tails ?? []).map((t) => t.tailer_privy_id)).size,
      tailedVolumeUsd: Math.round(volume),
      recent: recentRows.map((r) => ({ symbol: dex.get(r.mint)?.symbol ?? `${String(r.mint).slice(0, 4)}...`, icon: dex.get(r.mint)?.image ?? null, amountUsd: Number(r.amount_usd), at: r.created_at as string, status: r.status as string })),
    };
  }

  // ------------------------------------------------------------ payouts, for admins

  /** Who is owed what, with the wallet to pay. */
  async pendingByCaller() {
    const { data } = await this.db().from('mini_callout_earnings').select('caller_privy_id, amount_usd').eq('status', 'pending').limit(20000);
    const totals = new Map<string, number>();
    for (const r of data ?? []) totals.set(r.caller_privy_id, (totals.get(r.caller_privy_id) ?? 0) + Number(r.amount_usd));
    const rows = await Promise.all(
      [...totals.entries()].map(async ([id, usd]) => ({ callerId: id, wallet: await this.users.getSolanaWalletAddress(id).catch(() => null), pendingUsd: Math.round(usd * 100) / 100 })),
    );
    return rows.sort((a, b) => b.pendingUsd - a.pendingUsd);
  }

  /** After paying a poster, mark everything pending for them as paid with the transaction that paid it. */
  async markPaid(callerId: string, signature: string) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) throw new BadRequestException('Bad signature.');
    if (!callerId) throw new ForbiddenException();
    const { data, error } = await this.db().from('mini_callout_earnings').update({ status: 'paid', paid_signature: signature, paid_at: new Date().toISOString() }).eq('caller_privy_id', callerId).eq('status', 'pending').select('amount_usd');
    if (error) throw new ConflictException('Could not mark as paid.');
    return { rows: data?.length ?? 0, totalUsd: Math.round((data ?? []).reduce((n, r) => n + Number(r.amount_usd), 0) * 100) / 100 };
  }
}
