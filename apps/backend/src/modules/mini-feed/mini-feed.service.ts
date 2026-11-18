import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { cached, sharedGet, sharedSet } from '@/modules/mini-app/lib/sharedCache';
import { dexInfo } from '@/modules/mini-app/lib/dex';
import { MiniProfileService, PublicAvatar, anonName } from './mini-profile.service';

const PAGE = 30;
/** USDC and wrapped SOL are what people pay with, not coins they called. Buying them is not a feed item. */
const NOT_FEED_MINTS = ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'So11111111111111111111111111111111111111112'];

interface Author {
  name: string;
  avatar: PublicAvatar;
}
type CoinCard = { mint: string; symbol: string; name: string; icon: string | null; decimals: number; usd: number | null; mcap: number | null; change24h: number | null };

export interface CommentItem extends Author {
  type: 'comment';
  id: string;
  coin: CoinCard;
  text: string;
  /** Share of the supply the poster held when they wrote it. */
  holdingPct: number | null;
  /** What they hold of it now. Only when they chose to show it. */
  /** Replies under this post, updates by the poster included. */
  replyCount: number;
  /** The poster's newest update on this post, if they wrote one. The card then shows the original post and this. */
  update: { text: string; createdAt: string } | null;
  position: { amount: number; usd: number | null } | null;
  /** Profit or loss on Loofta trades of this coin, in dollars and percent of what they bought. Only when they chose to show it and it can be worked out. */
  pnl: { usd: number; pct: number } | null;
  createdAt: string;
}
export interface PredictionItem extends Author {
  type: 'prediction';
  id: string;
  /** The event, or "Combo of 3 picks". */
  title: string;
  /** What they picked, for example "Over 2.5 + Ciryl Gane". */
  detail: string;
  amountUsd: number;
  eventId: string | null;
  image: string | null;
  createdAt: string;
}
export interface TradeItem extends Author {
  type: 'trade';
  id: string;
  coin: CoinCard;
  amountUsd: number;
  createdAt: string;
}
export type FeedItem = CommentItem | PredictionItem | TradeItem;

/** The newest posts across every coin, with who wrote them, what they hold and how that trade is doing. */
@Injectable()
export class MiniFeedService {
  private readonly logger = new Logger(MiniFeedService.name);
  private conn: Connection | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
    private readonly profiles: MiniProfileService,
    private readonly config: ConfigService,
  ) {}

  private connection(): Connection {
    if (!this.conn) this.conn = new Connection(getMainnetSolanaRpcUrl(this.config), 'confirmed');
    return this.conn;
  }

  private db() {
    return this.supabase.getClient();
  }

  /** Decimals never change, so they are kept for a month. */
  private async decimals(mints: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const missing: string[] = [];
    await Promise.all(
      mints.map(async (m) => {
        const hit = await sharedGet<number>(`mini:dec:${m}`);
        if (hit != null) out.set(m, hit);
        else missing.push(m);
      }),
    );
    if (missing.length) {
      try {
        const infos = await this.connection().getMultipleAccountsInfo(missing.map((m) => new PublicKey(m)));
        infos.forEach((acc, i) => {
          // Both token programs keep the decimals as the byte at offset 44 of the mint account.
          if (acc && acc.data.length > 44) {
            out.set(missing[i], acc.data[44]);
            void sharedSet(`mini:dec:${missing[i]}`, acc.data[44], 30 * 86400);
          }
        });
      } catch (e) {
        this.logger.debug(`decimals failed: ${(e as Error).message}`);
      }
    }
    return out;
  }

  private wallet(userId: string): Promise<string | null> {
    return cached<string | null>(`mini:wallet:${userId}`, 3600, async () => this.users.getSolanaWalletAddress(userId).catch(() => null), (v) => !!v);
  }

  /** What the person holds of one coin right now and how their Loofta trades of it are doing. Null for anything that cannot be known. */
  private position(userId: string, mint: string, price: number | null): Promise<{ position: CommentItem['position']; pnl: CommentItem['pnl'] }> {
    return cached(`mini:pos:${userId}:${mint}`, 60, async () => {
      const none = { position: null, pnl: null };
      try {
        const w = await this.wallet(userId);
        if (!w) return none;
        const accounts = await this.connection().getParsedTokenAccountsByOwner(new PublicKey(w), { mint: new PublicKey(mint) });
        const amount = accounts.value.reduce((s, a) => s + (a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
        if (!(amount > 0)) return { position: null, pnl: null };
        const usd = price != null ? amount * price : null;
        // Cost basis only exists for trades made through the app. Buys and sells are summed from confirmed trades.
        const { data: trades } = await this.db().from('mini_trades').select('side, volume_usd').eq('privy_user_id', userId).eq('mint', mint).eq('status', 'confirmed').neq('kind', 'predict').limit(2000);
        let bought = 0;
        let sold = 0;
        for (const t of trades ?? []) {
          if (t.side === 'buy') bought += Number(t.volume_usd) || 0;
          else if (t.side === 'sell') sold += Number(t.volume_usd) || 0;
        }
        const pnl = bought > 0 && usd != null ? { usd: usd + sold - bought, pct: ((usd + sold - bought) / bought) * 100 } : null;
        return { position: { amount, usd }, pnl };
      } catch (e) {
        this.logger.debug(`position failed: ${(e as Error).message}`);
        return none;
      }
    });
  }

  /**
   * Comments from holders, predictions people placed and coins they bought, newest first. Predictions and buys only
   * appear for people who share their activity. Each source is read separately and merged by time.
   */
  async feed(before?: string): Promise<{ posts: FeedItem[]; next: string | null }> {
    const cursor = before && !Number.isNaN(Date.parse(before)) ? before : null;
    let qc = this.db().from('coin_chat_messages').select('id, mint, privy_user_id, text, holding_pct, created_at').gt('holding_amount', 0).is('parent_id', null).order('created_at', { ascending: false }).limit(PAGE);
    let qr = this.db().from('coin_chat_messages').select('parent_id, privy_user_id, created_at').not('parent_id', 'is', null).order('created_at', { ascending: false }).limit(PAGE);
    let qp = this.db().from('mini_activity').select('id, privy_user_id, kind, event_id, title, detail, amount_usd, image, created_at').order('created_at', { ascending: false }).limit(PAGE);
    let qt = this.db().from('mini_trades').select('id, privy_user_id, mint, volume_usd, confirmed_at').eq('status', 'confirmed').eq('side', 'buy').neq('kind', 'predict').not('mint', 'in', `(${NOT_FEED_MINTS.join(',')})`).gte('volume_usd', 1).order('confirmed_at', { ascending: false }).limit(PAGE);
    if (cursor) {
      qc = qc.lt('created_at', cursor);
      qr = qr.lt('created_at', cursor);
      qp = qp.lt('created_at', cursor);
      qt = qt.lt('confirmed_at', cursor);
    }
    const [rc, rp, rt, rr] = await Promise.all([qc, qp, qt, qr]);
    if (rc.error) {
      this.logger.warn(`feed failed: ${rc.error.message}`);
      throw new HttpException('The feed is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    }
    // Activity tables may not exist yet (migration not applied): the feed still shows comments.
    let comments = rc.data ?? [];
    // Posts that were answered by their own author lift to the time of that update, so a follow-up shows up in the feed
    // as the original post with the update on it, not as a new post.
    const known = new Set(comments.map((c) => c.id as string));
    const lifted = new Map<string, string>();
    const parents = [...new Set((rr.error ? [] : rr.data ?? []).map((r) => r.parent_id as string))];
    if (parents.length) {
      const { data: roots } = await this.db().from('coin_chat_messages').select('id, mint, privy_user_id, text, holding_pct, holding_amount, created_at').in('id', parents).gt('holding_amount', 0);
      const byId = new Map((roots ?? []).map((r) => [r.id as string, r]));
      for (const r of rr.data ?? []) {
        const root = byId.get(r.parent_id as string);
        if (!root || root.privy_user_id !== r.privy_user_id) continue;
        if (!lifted.has(root.id)) lifted.set(root.id, r.created_at as string);
        if (!known.has(root.id)) {
          known.add(root.id);
          comments = [...comments, root];
        }
      }
    }
    const replyRows = comments.length ? (await this.db().from('coin_chat_messages').select('parent_id, privy_user_id, text, created_at').in('parent_id', comments.map((c) => c.id as string)).order('created_at', { ascending: false }).limit(3000)).data ?? [] : [];
    const replyCount = new Map<string, number>();
    const newestUpdate = new Map<string, { text: string; createdAt: string }>();
    const authorOf = new Map(comments.map((c) => [c.id as string, c.privy_user_id as string]));
    for (const r of replyRows) {
      const pid = r.parent_id as string;
      replyCount.set(pid, (replyCount.get(pid) ?? 0) + 1);
      if (!newestUpdate.has(pid) && authorOf.get(pid) === r.privy_user_id) newestUpdate.set(pid, { text: r.text as string, createdAt: r.created_at as string });
    }
    const preds = rp.error ? [] : rp.data ?? [];
    const trades = rt.error ? [] : rt.data ?? [];

    const merged = [
      ...comments.map((r) => ({ t: 'c' as const, at: lifted.get(r.id as string) ?? (r.created_at as string), r })),
      ...preds.map((r) => ({ t: 'p' as const, at: r.created_at as string, r })),
      ...trades.map((r) => ({ t: 't' as const, at: r.confirmed_at as string, r })),
    ]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, PAGE);

    const mints = [...new Set(merged.filter((m) => m.t !== 'p').map((m) => (m.r as any).mint as string))];
    const authors = [...new Set(merged.map((m) => (m.r as any).privy_user_id as string))];
    const [dex, decimals, profs] = await Promise.all([dexInfo(mints).catch(() => new Map()), this.decimals(mints), this.profiles.many(authors)]);

    const author = (id: string): Author & { show: boolean; share: boolean } => {
      const p = profs.get(id);
      return { name: p?.hideName || !p?.handle ? anonName(id) : p.handle, avatar: p!.avatar, show: p?.showPnl ?? true, share: p?.shareActivity ?? true };
    };
    const coinCard = (mint: string): CoinCard => {
      const d = dex.get(mint);
      return {
        mint,
        symbol: d?.symbol ?? `${mint.slice(0, 4)}...`,
        name: d?.name ?? d?.symbol ?? `${mint.slice(0, 4)}...${mint.slice(-4)}`,
        icon: d?.image ?? null,
        decimals: decimals.get(mint) ?? 6,
        usd: d?.priceUsd ?? null,
        mcap: d?.mcapUsd ?? null,
        change24h: d?.change24h ?? null,
      };
    };

    const out = await Promise.all(
      merged.map(async (m): Promise<FeedItem | null> => {
        const r: any = m.r;
        const a = author(r.privy_user_id);
        if (m.t === 'c') {
          const coin = coinCard(r.mint);
          const pos = a.show ? await this.position(r.privy_user_id, r.mint, coin.usd) : { position: null, pnl: null };
          return { type: 'comment', id: r.id, name: a.name, avatar: a.avatar, coin, text: r.text, holdingPct: r.holding_pct == null ? null : Number(r.holding_pct), replyCount: replyCount.get(r.id) ?? 0, update: newestUpdate.get(r.id) ?? null, position: pos.position, pnl: pos.pnl, createdAt: r.created_at };
        }
        if (!a.share) return null;
        if (m.t === 'p') {
          return { type: 'prediction', id: r.id, name: a.name, avatar: a.avatar, title: r.title, detail: r.detail, amountUsd: Number(r.amount_usd) || 0, eventId: r.event_id ?? null, image: r.image ?? null, createdAt: r.created_at };
        }
        return { type: 'trade', id: r.id, name: a.name, avatar: a.avatar, coin: coinCard(r.mint), amountUsd: Number(r.volume_usd) || 0, createdAt: r.confirmed_at };
      }),
    );
    const posts = out.filter((x): x is FeedItem => x !== null);
    const more = rc.data?.length === PAGE || preds.length === PAGE || trades.length === PAGE;
    return { posts, next: more && merged.length > 0 ? merged[merged.length - 1].at : null };
  }

  /**
   * A public profile page: what someone traded through Loofta and what they said. Only what they chose to share:
   * trade numbers need "share activity", per-coin position and PnL need "show PnL". Hidden names cannot be looked up.
   */
  async publicProfile(handle: string) {
    const p = await this.profiles.byHandle(handle);
    if (!p) throw new NotFoundException('No one with that name');
    const base = { handle: p.handle, avatar: p.avatar, joinedAt: p.joinedAt, shareActivity: p.shareActivity, showPnl: p.showPnl };
    const takesQ = await this.db().from('coin_chat_messages').select('id, mint, text, created_at').eq('privy_user_id', p.id).gt('holding_amount', 0).order('created_at', { ascending: false }).limit(10);
    const takes = takesQ.data ?? [];
    let stats: { volumeUsd: number; trades: number; buys: number; sells: number; coins: number; predictions: number; predictedUsd: number; biggestUsd: number } | null = null;
    let topCoins: Array<{ mint: string; symbol: string; icon: string | null; volumeUsd: number }> = [];
    if (p.shareActivity) {
      const [tr, pr] = await Promise.all([
        this.db().from('mini_trades').select('side, mint, volume_usd').eq('privy_user_id', p.id).eq('status', 'confirmed').neq('kind', 'predict').limit(5000),
        this.db().from('mini_activity').select('amount_usd').eq('privy_user_id', p.id).limit(2000),
      ]);
      const rows = tr.data ?? [];
      const perCoin = new Map<string, number>();
      let volume = 0;
      let buys = 0;
      let sells = 0;
      let biggest = 0;
      for (const r of rows) {
        const v = Number(r.volume_usd) || 0;
        volume += v;
        biggest = Math.max(biggest, v);
        if (r.side === 'buy') buys++;
        else if (r.side === 'sell') sells++;
        if (r.mint) perCoin.set(r.mint, (perCoin.get(r.mint) ?? 0) + v);
      }
      const preds = pr.error ? [] : pr.data ?? [];
      stats = { volumeUsd: Math.round(volume * 100) / 100, trades: rows.length, buys, sells, coins: perCoin.size, predictions: preds.length, predictedUsd: Math.round(preds.reduce((n, r) => n + (Number(r.amount_usd) || 0), 0) * 100) / 100, biggestUsd: Math.round(biggest * 100) / 100 };
      const top = [...perCoin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      const dexTop = await dexInfo(top.map(([m]) => m)).catch(() => new Map());
      topCoins = top.map(([mint, v]) => ({ mint, symbol: dexTop.get(mint)?.symbol ?? `${mint.slice(0, 4)}...`, icon: dexTop.get(mint)?.image ?? null, volumeUsd: Math.round(v * 100) / 100 }));
    }
    const dex = await dexInfo([...new Set(takes.map((t) => t.mint as string))]).catch(() => new Map());
    return {
      ...base,
      stats,
      topCoins,
      takes: takes.map((t) => ({ id: t.id as string, mint: t.mint as string, symbol: dex.get(t.mint)?.symbol ?? `${String(t.mint).slice(0, 4)}...`, icon: dex.get(t.mint)?.image ?? null, text: t.text as string, createdAt: t.created_at as string })),
    };
  }

  /** What a shared call looks like in a link preview. Public, so it shows only the name, the coin, the words and the bag at the time. */
  async callPreview(postId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(postId)) throw new BadRequestException('Bad call');
    const { data: r } = await this.db().from('coin_chat_messages').select('id, mint, privy_user_id, text, holding_pct, holding_amount, created_at').eq('id', postId).maybeSingle();
    if (!r || !(Number(r.holding_amount) > 0)) throw new NotFoundException('Call not found');
    const [dex, profs] = await Promise.all([dexInfo([r.mint]).catch(() => new Map()), this.profiles.many([r.privy_user_id])]);
    const d = dex.get(r.mint);
    const pr = profs.get(r.privy_user_id);
    const usd = d?.priceUsd != null ? Number(r.holding_amount) * d.priceUsd : null;
    return {
      id: r.id as string,
      mint: r.mint as string,
      name: pr?.hideName || !pr?.handle ? anonName(r.privy_user_id) : pr.handle,
      avatar: pr!.avatar,
      text: r.text as string,
      symbol: d?.symbol ?? `${String(r.mint).slice(0, 4)}...`,
      coinName: d?.name ?? d?.symbol ?? null,
      icon: d?.image ?? null,
      change24h: d?.change24h ?? null,
      heldUsd: usd,
      createdAt: r.created_at as string,
    };
  }

  validateBefore(before?: string) {
    if (before && Number.isNaN(Date.parse(before))) throw new BadRequestException('Bad cursor');
  }
}
