import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';
import { randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { fetchSolPriceUsd } from '@/common/magicblock-private-transfer';
import { getStocks } from '@/modules/mini-app/lib/stocks';
import { cached } from '@/modules/mini-app/lib/sharedCache';
import { MiniCalloutsService } from './mini-callouts.service';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';

/** Loofta's normal swap fee, in basis points. Kept equal to SWAP_FEE_BPS in the Jupiter service. */
export const BASE_FEE_BPS = 30;
/** Referral discount on the fee. 5% off 0.30% is 0.285%, and swap routes take whole basis points, so it rounds down to 28. */
export const DISCOUNT_PERCENT = 5;
export const DISCOUNTED_FEE_BPS = Math.floor((BASE_FEE_BPS * (100 - DISCOUNT_PERCENT)) / 100);

export type TradeKind = 'stock' | 'preipo' | 'meme' | 'coin' | 'predict';

export type RecordTradeInput = {
  userId: string;
  kind: TradeKind;
  side: 'buy' | 'sell';
  mint: string;
  volumeUsd: number;
  feeBps: number;
  feeOwner: string | null;
  feeMint: string | null;
  feeAmount: string;
  gaslessId?: string | null;
};

type Stats = {
  trades: number;
  stock: number;
  preipo: number;
  meme: number;
  predict: number;
  qualifiedRefs: number;
  volumeUsd: number;
};

/** Badges are earned by doing the thing. Each has a test over the person's confirmed activity. */
export const BADGES: Array<{ id: string; title: string; hint: string; test: (s: Stats) => boolean; progress: (s: Stats) => [number, number] }> = [
  { id: 'first_trade', title: 'First trade', hint: 'Make your first trade', test: (s) => s.trades >= 1, progress: (s) => [Math.min(s.trades, 1), 1] },
  { id: 'stock_trader', title: 'Stock trader', hint: 'Buy or sell a tokenized stock', test: (s) => s.stock >= 1, progress: (s) => [Math.min(s.stock, 1), 1] },
  { id: 'preipo_pioneer', title: 'Pre-IPO pioneer', hint: 'Trade a company before it lists', test: (s) => s.preipo >= 1, progress: (s) => [Math.min(s.preipo, 1), 1] },
  { id: 'meme_hunter', title: 'Meme hunter', hint: 'Trade 3 meme coins', test: (s) => s.meme >= 3, progress: (s) => [Math.min(s.meme, 3), 3] },
  { id: 'predictor', title: 'Predictor', hint: 'Place a prediction', test: (s) => s.predict >= 1, progress: (s) => [Math.min(s.predict, 1), 1] },
  { id: 'recruiter', title: 'Recruiter', hint: 'Invite a friend who trades', test: (s) => s.qualifiedRefs >= 1, progress: (s) => [Math.min(s.qualifiedRefs, 1), 1] },
  { id: 'trader_1k', title: '$1,000 club', hint: 'Trade $1,000 in total', test: (s) => s.volumeUsd >= 1000, progress: (s) => [Math.min(Math.floor(s.volumeUsd), 1000), 1000] },
];

const WEEK_MS = 7 * 24 * 3600 * 1000;
/** Monday 00:00 UTC of the current week. */
const weekStart = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - sinceMonday * 24 * 3600 * 1000);
};

/** The mini app's own link: t.me/looftaapp/loofta. */
const TG_BOT = 'looftaapp';
const TG_APP = 'loofta';

@Injectable()
export class MiniRewardsService {
  private readonly logger = new Logger(MiniRewardsService.name);
  private readonly connection: Connection;
  private readonly feeCache = new Map<string, { bps: number; at: number }>();
  private lbCache: { at: number; rows: Array<{ privy_user_id: string; volume_usd: number; trades: number }> } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
    private readonly callouts: MiniCalloutsService,
  ) {
    this.connection = new Connection(getMainnetSolanaRpcUrl(config), 'confirmed');
  }

  private db() {
    return this.supabase.getClient();
  }

  // ---------------------------------------------------------------- fee discount

  /**
   * The fee this person pays, in whole basis points. Invited people have the discount from the start. Someone who
   * invited a friend has it once that friend has made a confirmed trade. It never fails a trade: any error means the normal fee.
   */
  async feeBpsFor(userId: string): Promise<number> {
    const hit = this.feeCache.get(userId);
    if (hit && Date.now() - hit.at < 60_000) return hit.bps;
    let bps = BASE_FEE_BPS;
    try {
      const [{ data: asReferee }, { data: asReferrer }] = await Promise.all([
        this.db().from('mini_referrals').select('referee_privy_id').eq('referee_privy_id', userId).maybeSingle(),
        this.db().from('mini_referrals').select('referee_privy_id').eq('referrer_privy_id', userId).not('qualified_at', 'is', null).limit(1),
      ]);
      if (asReferee || (asReferrer && asReferrer.length > 0)) bps = DISCOUNTED_FEE_BPS;
    } catch (e) {
      this.logger.warn(`feeBpsFor failed for ${userId}: ${(e as Error).message}`);
    }
    this.feeCache.set(userId, { bps, at: Date.now() });
    return bps;
  }

  // ---------------------------------------------------------------- referrals

  private async codeFor(userId: string): Promise<string> {
    const { data } = await this.db().from('mini_ref_codes').select('code').eq('privy_user_id', userId).maybeSingle();
    if (data?.code) return data.code;
    for (let i = 0; i < 5; i++) {
      const code = randomBytes(5).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 7).toLowerCase();
      if (code.length < 6) continue;
      const { error } = await this.db().from('mini_ref_codes').insert({ privy_user_id: userId, code });
      if (!error) return code;
      const { data: again } = await this.db().from('mini_ref_codes').select('code').eq('privy_user_id', userId).maybeSingle();
      if (again?.code) return again.code;
    }
    throw new ConflictException('Could not make your invite link. Try again.');
  }

  /** Saves who invited this person. Once, never yourself, and only before you have traded. */
  async claimReferral(userId: string, rawCode: unknown) {
    const code = String(rawCode ?? '').trim().toLowerCase();
    if (!/^[a-z0-9]{6,12}$/.test(code)) throw new BadRequestException('That invite link is not valid.');
    const { data: owner } = await this.db().from('mini_ref_codes').select('privy_user_id').eq('code', code).maybeSingle();
    if (!owner) throw new BadRequestException('That invite link is not valid.');
    if (owner.privy_user_id === userId) throw new BadRequestException('You cannot use your own invite link.');
    const { data: existing } = await this.db().from('mini_referrals').select('referrer_privy_id').eq('referee_privy_id', userId).maybeSingle();
    if (existing) return { ok: true, already: true };
    // An invite only counts for someone new: a person who has already traded did not come from the link.
    const { count } = await this.db().from('mini_trades').select('id', { count: 'exact', head: true }).eq('privy_user_id', userId).eq('status', 'confirmed');
    if ((count ?? 0) > 0) throw new BadRequestException('Invite links are for new members.');
    const { error } = await this.db().from('mini_referrals').insert({ referee_privy_id: userId, referrer_privy_id: owner.privy_user_id });
    if (error) throw new ConflictException('Could not save the invite. Try again.');
    this.feeCache.delete(userId);
    return { ok: true, already: false };
  }

  // ---------------------------------------------------------------- trades

  /** Called after the backend builds a trade. Returns the row id. Failures are logged and never block the trade. */
  async recordBuilt(input: RecordTradeInput): Promise<string | null> {
    try {
      // A buy of a coin the person tailed in the last 24 hours earns the poster a share.
      const tailId = input.side === 'buy' && input.kind !== 'predict' ? await this.callouts.activeTailFor(input.userId, input.mint) : null;
      const { data, error } = await this.db()
        .from('mini_trades')
        .insert({
          tail_id: tailId,
          privy_user_id: input.userId,
          kind: input.kind,
          side: input.side,
          mint: input.mint,
          volume_usd: Number.isFinite(input.volumeUsd) && input.volumeUsd > 0 ? input.volumeUsd : 0,
          fee_bps: input.feeBps,
          fee_owner: input.feeOwner,
          fee_mint: input.feeMint,
          fee_amount: input.feeAmount,
          gasless_id: input.gaslessId ?? null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id as string;
    } catch (e) {
      this.logger.warn(`recordBuilt failed: ${(e as Error).message}`);
      return null;
    }
  }

  private async kindOf(mint: string): Promise<TradeKind> {
    try {
      const { items } = await getStocks({ wait: false });
      const hit = items.find((t) => t.mint === mint);
      if (hit) return hit.kind === 'prestock' ? 'preipo' : 'stock';
    } catch {
      /* classification is best effort */
    }
    return mint.endsWith('pump') ? 'meme' : 'coin';
  }

  /**
   * Records a swap or curve trade the backend just built. The dollar size is priced here from the quote, never taken from the app.
   * Everything is best effort: a failure here must never stop someone from trading.
   */
  async trackBuilt(
    userId: string,
    t: { inputMint: string; outputMint: string; inAmount: string; outAmount: string; feeAmount: string; feeBps: number; feeOwner: string | null; feeMint: string; gaslessId?: string | null },
  ): Promise<string | null> {
    try {
      const side: 'buy' | 'sell' = t.inputMint === USDC || t.inputMint === WSOL ? 'buy' : 'sell';
      const coin = side === 'buy' ? t.outputMint : t.inputMint;
      let volumeUsd = 0;
      if (t.inputMint === USDC) volumeUsd = Number(t.inAmount) / 1e6;
      else if (t.outputMint === USDC) volumeUsd = (Number(t.outAmount) + (t.feeMint === USDC ? Number(t.feeAmount) : 0)) / 1e6;
      else if (t.inputMint === WSOL || t.outputMint === WSOL || t.feeMint === 'SOL') {
        const solUsd = await fetchSolPriceUsd();
        const lamports = t.inputMint === WSOL ? Number(t.inAmount) : Number(t.outAmount) + (t.feeMint === 'SOL' || t.feeMint === WSOL ? Number(t.feeAmount) : 0);
        if (solUsd) volumeUsd = (lamports / 1e9) * solUsd;
      }
      return await this.recordBuilt({ userId, kind: await this.kindOf(coin), side, mint: coin, volumeUsd, feeBps: t.feeBps, feeOwner: t.feeOwner, feeMint: t.feeMint, feeAmount: t.feeAmount, gaslessId: t.gaslessId });
    } catch (e) {
      this.logger.warn(`trackBuilt failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** The sponsored swap was sent by the server itself, so its signature is already known and checked. */
  async confirmGasless(userId: string, gaslessId: string, signature: string) {
    try {
      const { data } = await this.db().from('mini_trades').select('id').eq('gasless_id', gaslessId).eq('privy_user_id', userId).eq('status', 'built').maybeSingle();
      if (data) await this.markConfirmed(userId, data.id, signature);
    } catch (e) {
      this.logger.warn(`confirmGasless failed: ${(e as Error).message}`);
    }
  }

  /** Reads the transaction from the chain. Returns null unless it succeeded, is recent, and was signed by this person's own wallet. */
  private async readTx(userId: string, signature: string, notBefore: Date) {
    if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) throw new BadRequestException('Bad signature.');
    const wallet = await this.users.getSolanaWalletAddress(userId);
    const tx = await this.connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    if (!tx || tx.meta?.err) return null;
    if (tx.blockTime && tx.blockTime * 1000 < notBefore.getTime() - 30_000) return null;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses }).keySegments().flat();
    const numSigners = tx.transaction.message.header.numRequiredSignatures;
    const signers = keys.slice(0, numSigners).map((k) => k.toBase58());
    if (!signers.includes(wallet)) return null;
    return { tx, keys: keys.map((k) => k.toBase58()), wallet };
  }

  /** The fee really reached Loofta: the platform wallet's SOL or token balance went up by about what the quote said. */
  private feeArrived(row: { fee_owner: string | null; fee_mint: string | null; fee_amount: string | number | null }, read: NonNullable<Awaited<ReturnType<MiniRewardsService['readTx']>>>): boolean {
    const expected = Number(row.fee_amount ?? 0);
    if (!row.fee_owner || !(expected > 0)) return true; // no fee was due, nothing to check
    const meta = read.tx.meta!;
    if (row.fee_mint === 'SOL') {
      const i = read.keys.indexOf(row.fee_owner);
      if (i < 0) return false;
      return (meta.postBalances[i] ?? 0) - (meta.preBalances[i] ?? 0) >= expected * 0.9;
    }
    const sum = (list: typeof meta.postTokenBalances) =>
      (list ?? []).filter((b) => b.owner === row.fee_owner && b.mint === row.fee_mint).reduce((n, b) => n + Number(b.uiTokenAmount.amount), 0);
    return sum(meta.postTokenBalances) - sum(meta.preTokenBalances) >= expected * 0.9;
  }

  /** The app reports a signature for a trade the backend built. Counted only once it checks out on chain. */
  async confirmTrade(userId: string, tradeId: string, signature: string) {
    const { data: row } = await this.db().from('mini_trades').select('*').eq('id', tradeId).eq('privy_user_id', userId).maybeSingle();
    if (!row) throw new BadRequestException('Trade not found.');
    if (row.status === 'confirmed') return { ok: true };
    const read = await this.readTx(userId, signature, new Date(row.created_at));
    if (!read) return { ok: false, retry: true };
    if (!this.feeArrived(row, read)) {
      this.logger.warn(`confirmTrade: fee not found in ${signature.slice(0, 12)} for ${userId}`);
      return { ok: false };
    }
    await this.markConfirmed(userId, row.id, signature);
    return { ok: true };
  }

  private async markConfirmed(userId: string, id: string, signature: string) {
    const { error } = await this.db().from('mini_trades').update({ status: 'confirmed', signature, confirmed_at: new Date().toISOString() }).eq('id', id).eq('status', 'built');
    if (error) {
      this.logger.warn(`markConfirmed failed: ${error.message}`);
      return;
    }
    void this.callouts.accrue(id);
    // The inviter's discount starts with their friend's first confirmed trade.
    const { data: ref } = await this.db().from('mini_referrals').update({ qualified_at: new Date().toISOString() }).eq('referee_privy_id', userId).is('qualified_at', null).select('referrer_privy_id').maybeSingle();
    if (ref) this.feeCache.delete(ref.referrer_privy_id);
    await this.evaluateBadges(userId).catch(() => undefined);
    if (ref) await this.evaluateBadges(ref.referrer_privy_id).catch(() => undefined);
  }

  private async jupGet<T>(path: string): Promise<T | null> {
    return cached<T | null>(`mini:jup:${path}`, 3600, async () => {
      try {
        const key = this.config.get<string>('JUPITER_API_KEY');
        const r = await fetch(`https://api.jup.ag/prediction/v1${path}`, { headers: { accept: 'application/json', ...(key ? { 'x-api-key': key } : {}) }, signal: AbortSignal.timeout(5_000) });
        if (!r.ok) return null;
        const j: any = await r.json();
        return (j?.data ?? j) as T;
      } catch {
        return null;
      }
    }, (v) => v != null);
  }

  /** What a pick says, from Jupiter by market id: "Over 2.5", "Ciryl Gane" or "Yes: Fight won by KO/TKO?". Nothing the app sends is shown. */
  private async describePick(marketId: string, side: string): Promise<{ eventId: string; text: string } | null> {
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(marketId) || !['yes', 'no'].includes(side)) return null;
    const m: any = await this.jupGet(`/markets/${encodeURIComponent(marketId)}`);
    if (!m?.title || !m.eventId) return null;
    const option = String(m.marketOptions?.[0]?.label ?? '').replace(/^O\s/, 'Over ').replace(/^U\s/, 'Under ');
    const single = m.isTeamMarket || (m.marketOptions?.length ?? 0) === 1;
    return { eventId: String(m.eventId), text: single ? option || String(m.title) : `${side === 'yes' ? 'Yes' : 'No'}: ${String(m.title)}` };
  }

  /** What the signer's wallet spent in USDC in this transaction, read from the chain. */
  private usdcSpent(read: NonNullable<Awaited<ReturnType<MiniRewardsService['readTx']>>>): number {
    const meta = read.tx.meta!;
    const sum = (list: typeof meta.postTokenBalances) => (list ?? []).filter((b) => b.owner === read.wallet && b.mint === USDC).reduce((n, b) => n + Number(b.uiTokenAmount.amount), 0);
    return Math.max(0, (sum(meta.preTokenBalances) - sum(meta.postTokenBalances)) / 1e6);
  }

  /** A prediction is placed straight with Jupiter from the app, so the backend only checks the person signed it. Counts for the badge, not for volume. The pick ids make it a feed item. */
  async confirmPrediction(userId: string, signature: string, picks: Array<{ marketId?: string; side?: string }> = []) {
    const read = await this.readTx(userId, signature, new Date(Date.now() - 15 * 60_000));
    if (!read) return { ok: false, retry: true };
    const { error } = await this.db().from('mini_trades').insert({ privy_user_id: userId, kind: 'predict', status: 'confirmed', signature, confirmed_at: new Date().toISOString(), volume_usd: 0 });
    if (error && !/duplicate/i.test(error.message)) throw new ConflictException('Could not save that prediction.');
    if (!error) await this.recordActivity(userId, signature, read, picks.slice(0, 10)).catch((e) => this.logger.debug(`activity failed: ${(e as Error).message}`));
    await this.evaluateBadges(userId).catch(() => undefined);
    return { ok: true };
  }

  private async recordActivity(userId: string, signature: string, read: NonNullable<Awaited<ReturnType<MiniRewardsService['readTx']>>>, picks: Array<{ marketId?: string; side?: string }>) {
    const described = (await Promise.all(picks.map((p) => this.describePick(String(p.marketId ?? ''), String(p.side ?? ''))))).filter(Boolean) as Array<{ eventId: string; text: string }>;
    if (!described.length || described.length !== picks.length) return;
    const event: any = await this.jupGet(`/events/${encodeURIComponent(described[0].eventId)}`);
    const combo = described.length > 1;
    await this.db().from('mini_activity').insert({
      privy_user_id: userId,
      kind: combo ? 'combo' : 'prediction',
      event_id: combo ? null : described[0].eventId,
      title: combo ? `Combo of ${described.length} picks` : String(event?.metadata?.title ?? 'Prediction').slice(0, 200),
      detail: described.map((d) => d.text).join(' + ').slice(0, 300),
      amount_usd: this.usdcSpent(read),
      image: combo ? null : (event?.metadata?.imageUrl ?? null),
      signature,
    });
  }

  // ---------------------------------------------------------------- badges and summary

  private async stats(userId: string): Promise<Stats> {
    const [{ data: trades }, { count: qualifiedRefs }] = await Promise.all([
      this.db().from('mini_trades').select('kind, volume_usd').eq('privy_user_id', userId).eq('status', 'confirmed').limit(5000),
      this.db().from('mini_referrals').select('referee_privy_id', { count: 'exact', head: true }).eq('referrer_privy_id', userId).not('qualified_at', 'is', null),
    ]);
    const s: Stats = { trades: 0, stock: 0, preipo: 0, meme: 0, predict: 0, qualifiedRefs: qualifiedRefs ?? 0, volumeUsd: 0 };
    for (const t of trades ?? []) {
      if (t.kind === 'predict') {
        s.predict++;
        continue;
      }
      s.trades++;
      s.volumeUsd += Number(t.volume_usd) || 0;
      if (t.kind === 'stock') s.stock++;
      else if (t.kind === 'preipo') s.preipo++;
      else if (t.kind === 'meme') s.meme++;
    }
    return s;
  }

  private async evaluateBadges(userId: string) {
    const s = await this.stats(userId);
    const earned = BADGES.filter((b) => b.test(s)).map((b) => ({ privy_user_id: userId, badge: b.id }));
    if (earned.length) await this.db().from('mini_badges').upsert(earned, { onConflict: 'privy_user_id,badge', ignoreDuplicates: true });
  }

  private inviteLink(code: string) {
    return `https://t.me/${TG_BOT}/${TG_APP}?startapp=ref_${code}`;
  }

  async summary(userId: string) {
    await this.evaluateBadges(userId).catch(() => undefined);
    const since = weekStart();
    const [code, s, { data: owned }, { data: refRows }, { data: me }, feeBps, { data: asReferee }] = await Promise.all([
      this.codeFor(userId),
      this.stats(userId),
      this.db().from('mini_badges').select('badge, earned_at').eq('privy_user_id', userId),
      this.db().from('mini_referrals').select('qualified_at').eq('referrer_privy_id', userId),
      this.db().rpc('mini_rank', { uid: userId, since: since.toISOString() }),
      this.feeBpsFor(userId),
      this.db().from('mini_referrals').select('referee_privy_id').eq('referee_privy_id', userId).maybeSingle(),
    ]);
    const have = new Set((owned ?? []).map((b: { badge: string }) => b.badge));
    const week = Array.isArray(me) && me[0] ? me[0] : null;
    return {
      inviteLink: this.inviteLink(code),
      inviteCode: code,
      invited: asReferee ? true : false,
      invites: { total: refRows?.length ?? 0, traded: (refRows ?? []).filter((r: { qualified_at: string | null }) => r.qualified_at).length },
      discount: { percent: DISCOUNT_PERCENT, active: feeBps < BASE_FEE_BPS, feeBps, baseFeeBps: BASE_FEE_BPS },
      badges: BADGES.map((b) => {
        const [done, total] = b.progress(s);
        return { id: b.id, title: b.title, hint: b.hint, earned: have.has(b.id) || b.test(s), done, total };
      }),
      week: { startsAt: since.toISOString(), endsAt: new Date(since.getTime() + WEEK_MS).toISOString(), volumeUsd: Number(week?.volume_usd ?? 0), trades: Number(week?.trades ?? 0), rank: week ? Number(week.rank) : null },
    };
  }

  // ---------------------------------------------------------------- leaderboard

  private async names(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const { data } = await this.db().from('app_users').select('privy_user_id, username, loo_username').in('privy_user_id', ids);
    for (const r of data ?? []) {
      const n = String(r.username || r.loo_username || '').replace(/^@/, '').replace(/^loo-/, '');
      if (n) out.set(r.privy_user_id, n);
    }
    return out;
  }

  async leaderboard(userId: string) {
    const since = weekStart();
    if (!this.lbCache || Date.now() - this.lbCache.at > 60_000) {
      const { data, error } = await this.db().rpc('mini_leaderboard', { since: since.toISOString(), lim: 20 });
      if (error) throw new ConflictException('The leaderboard is not available right now.');
      this.lbCache = { at: Date.now(), rows: data ?? [] };
    }
    const names = await this.names(this.lbCache.rows.map((r) => r.privy_user_id));
    const rows = this.lbCache.rows.map((r, i) => ({
      rank: i + 1,
      name: names.get(r.privy_user_id) ?? `trader${r.privy_user_id.slice(-4)}`,
      volumeUsd: Math.round(Number(r.volume_usd)),
      trades: Number(r.trades),
      you: r.privy_user_id === userId,
    }));
    return { startsAt: since.toISOString(), endsAt: new Date(since.getTime() + WEEK_MS).toISOString(), rows };
  }
}
