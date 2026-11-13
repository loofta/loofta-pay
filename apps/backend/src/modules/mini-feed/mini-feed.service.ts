import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';
import { getMainnetSolanaRpcUrl } from '@/common/solana-cluster-env';
import { cached, sharedGet, sharedSet } from '@/modules/mini-app/lib/sharedCache';
import { dexInfo } from '@/modules/mini-app/lib/dex';
import { MiniProfileService, PublicAvatar, anonName } from './mini-profile.service';

const PAGE = 30;

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
    let qc = this.db().from('coin_chat_messages').select('id, mint, privy_user_id, text, holding_pct, created_at').gt('holding_amount', 0).order('created_at', { ascending: false }).limit(PAGE);
    let qp = this.db().from('mini_activity').select('id, privy_user_id, kind, event_id, title, detail, amount_usd, image, created_at').order('created_at', { ascending: false }).limit(PAGE);
    let qt = this.db().from('mini_trades').select('id, privy_user_id, mint, volume_usd, confirmed_at').eq('status', 'confirmed').eq('side', 'buy').neq('kind', 'predict').gte('volume_usd', 1).order('confirmed_at', { ascending: false }).limit(PAGE);
    if (cursor) {
      qc = qc.lt('created_at', cursor);
      qp = qp.lt('created_at', cursor);
      qt = qt.lt('confirmed_at', cursor);
    }
    const [rc, rp, rt] = await Promise.all([qc, qp, qt]);
    if (rc.error) {
      this.logger.warn(`feed failed: ${rc.error.message}`);
      throw new HttpException('The feed is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    }
    // Activity tables may not exist yet (migration not applied): the feed still shows comments.
    const comments = rc.data ?? [];
    const preds = rp.error ? [] : rp.data ?? [];
    const trades = rt.error ? [] : rt.data ?? [];

    const merged = [
      ...comments.map((r) => ({ t: 'c' as const, at: r.created_at as string, r })),
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
          return { type: 'comment', id: r.id, name: a.name, avatar: a.avatar, coin, text: r.text, holdingPct: r.holding_pct == null ? null : Number(r.holding_pct), position: pos.position, pnl: pos.pnl, createdAt: r.created_at };
        }
        if (!a.share) return null;
        if (m.t === 'p') {
          return { type: 'prediction', id: r.id, name: a.name, avatar: a.avatar, title: r.title, detail: r.detail, amountUsd: Number(r.amount_usd) || 0, eventId: r.event_id ?? null, image: r.image ?? null, createdAt: r.created_at };
        }
        return { type: 'trade', id: r.id, name: a.name, avatar: a.avatar, coin: coinCard(r.mint), amountUsd: Number(r.volume_usd) || 0, createdAt: r.confirmed_at };
      }),
    );
    const posts = out.filter((x): x is FeedItem => x !== null);
    const more = comments.length === PAGE || preds.length === PAGE || trades.length === PAGE;
    return { posts, next: more && merged.length > 0 ? merged[merged.length - 1].at : null };
  }

  validateBefore(before?: string) {
    if (before && Number.isNaN(Date.parse(before))) throw new BadRequestException('Bad cursor');
  }
}
