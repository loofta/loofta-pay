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

export interface FeedPost {
  id: string;
  name: string;
  avatar: PublicAvatar;
  coin: { mint: string; symbol: string; name: string; icon: string | null; decimals: number; usd: number | null; mcap: number | null; change24h: number | null };
  text: string;
  /** Share of the supply the poster held when they wrote it. */
  holdingPct: number | null;
  /** What they hold of it now. Only when they chose to show it. */
  position: { amount: number; usd: number | null } | null;
  /** Profit or loss on Loofta trades of this coin, in dollars and percent of what they bought. Only when they chose to show it and it can be worked out. */
  pnl: { usd: number; pct: number } | null;
  createdAt: string;
}

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
  private position(userId: string, mint: string, price: number | null): Promise<{ position: FeedPost['position']; pnl: FeedPost['pnl'] }> {
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

  async feed(before?: string): Promise<{ posts: FeedPost[]; next: string | null }> {
    let q = this.db()
      .from('coin_chat_messages')
      .select('id, mint, privy_user_id, display_name, text, holding_pct, created_at')
      // Only holders' posts: older messages written without owning the coin are left out.
      .gt('holding_amount', 0)
      .order('created_at', { ascending: false })
      .limit(PAGE);
    if (before && !Number.isNaN(Date.parse(before))) q = q.lt('created_at', before);
    const { data, error } = await q;
    if (error) {
      this.logger.warn(`feed failed: ${error.message}`);
      throw new HttpException('The feed is not available right now', HttpStatus.SERVICE_UNAVAILABLE);
    }
    const rows = data ?? [];
    const mints = [...new Set(rows.map((r) => r.mint as string))];
    const authors = [...new Set(rows.map((r) => r.privy_user_id as string))];
    const [dex, decimals, profs] = await Promise.all([dexInfo(mints).catch(() => new Map()), this.decimals(mints), this.profiles.many(authors)]);

    const posts: FeedPost[] = await Promise.all(
      rows.map(async (r) => {
        const d = dex.get(r.mint);
        const prof = profs.get(r.privy_user_id);
        const price = d?.priceUsd ?? null;
        const show = prof?.showPnl ?? true;
        const pos = show ? await this.position(r.privy_user_id, r.mint, price) : { position: null, pnl: null };
        return {
          id: r.id,
          name: prof?.hideName ? anonName(r.privy_user_id) : (r.display_name as string),
          avatar: prof!.avatar,
          coin: {
            mint: r.mint,
            symbol: d?.symbol ?? `${r.mint.slice(0, 4)}...`,
            name: d?.name ?? d?.symbol ?? `${r.mint.slice(0, 4)}...${r.mint.slice(-4)}`,
            icon: d?.image ?? null,
            decimals: decimals.get(r.mint) ?? 6,
            usd: price,
            mcap: d?.mcapUsd ?? null,
            change24h: d?.change24h ?? null,
          },
          text: r.text,
          holdingPct: r.holding_pct == null ? null : Number(r.holding_pct),
          position: pos.position,
          pnl: pos.pnl,
          createdAt: r.created_at,
        };
      }),
    );
    return { posts, next: rows.length === PAGE ? (rows[rows.length - 1].created_at as string) : null };
  }

  validateBefore(before?: string) {
    if (before && Number.isNaN(Date.parse(before))) throw new BadRequestException('Bad cursor');
  }
}
