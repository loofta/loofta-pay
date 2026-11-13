import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '@/database/supabase.service';
import { isCronEnabled } from '@/common/cron-gate';
import { MINT_RE, memecoinIngestOn } from './memecoin-providers';

const PAGES = 3; // 20 pools a page, newest first; 3 calls a minute is far under GeckoTerminal's free limit
const URL_BASE = 'https://api.geckoterminal.com/api/v2/networks/solana/new_pools';

export interface GraduatedPool {
  mint: string;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  pairAddress: string;
  createdAt: string;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Picks the Pump.fun graduations out of GeckoTerminal's newest-pools list: a PumpSwap pool whose mint ends in
 * "pump" is a coin that just moved from the Pump.fun curve to its open market. Pure, so it can be tested.
 */
export function parseGraduations(json: any): GraduatedPool[] {
  const tokens = new Map<string, any>();
  for (const inc of json?.included ?? []) if (inc?.type === 'token') tokens.set(inc.id, inc.attributes);
  const out: GraduatedPool[] = [];
  for (const d of json?.data ?? []) {
    if (d?.relationships?.dex?.data?.id !== 'pumpswap') continue;
    const baseId: string = d?.relationships?.base_token?.data?.id ?? '';
    const mint = baseId.replace(/^solana_/, '');
    if (!MINT_RE.test(mint) || !mint.endsWith('pump')) continue;
    const a = d.attributes ?? {};
    const t = tokens.get(baseId) ?? {};
    out.push({
      mint,
      name: typeof t.name === 'string' ? t.name.slice(0, 100) : null,
      symbol: typeof t.symbol === 'string' ? t.symbol.slice(0, 30) : null,
      imageUrl: typeof t.image_url === 'string' && t.image_url.startsWith('https://') ? t.image_url : null,
      pairAddress: String(a.address ?? ''),
      createdAt: String(a.pool_created_at ?? ''),
      mcapUsd: num(a.market_cap_usd) ?? num(a.fdv_usd),
      liquidityUsd: num(a.reserve_in_usd),
      volume24hUsd: num(a.volume_usd?.h24),
      priceChange1h: num(a.price_change_percentage?.h1),
      priceChange24h: num(a.price_change_percentage?.h24),
    });
  }
  return out;
}

/**
 * Free source of Pump.fun graduations. PumpPortal only streams migrations to wallets holding a minimum balance,
 * so this polls GeckoTerminal's newest pools instead and records each PumpSwap pool as a graduated coin.
 * Rows are inserted once (never overwritten), so the enrich service's numbers are never reset.
 */
@Injectable()
export class GeckoIngestService {
  private readonly logger = new Logger(GeckoIngestService.name);
  private running = false;
  private known = new Set<string>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!memecoinIngestOn(this.config, isCronEnabled(this.config))) return;
    if (this.config.get<string>('MEMECOIN_GECKO_INGEST') === 'false') return;
    if (this.running) return;
    this.running = true;
    try {
      await this.poll();
    } catch (e: any) {
      this.logger.error(`gecko ingest: ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  private async poll(): Promise<void> {
    const found: GraduatedPool[] = [];
    for (let page = 1; page <= PAGES; page++) {
      const res = await fetch(`${URL_BASE}?page=${page}&include=base_token`, { headers: { Accept: 'application/json' } });
      if (res.status === 429) { this.logger.warn('GeckoTerminal rate limit; will retry next minute'); break; }
      if (!res.ok) { this.logger.warn(`GeckoTerminal returned ${res.status}`); break; }
      found.push(...parseGraduations(await res.json()));
    }
    const fresh = found.filter((g) => !this.known.has(g.mint));
    if (fresh.length === 0) return;
    for (const g of fresh) this.known.add(g.mint);
    if (this.known.size > 5000) this.known = new Set([...this.known].slice(-2500));

    const rows = fresh.map((g) => ({
      mint: g.mint,
      status: 'migrated',
      migrated_at: g.createdAt || new Date().toISOString(),
      name: g.name,
      symbol: g.symbol,
      image_url: g.imageUrl,
      pair_address: g.pairAddress,
      dex_id: 'pumpswap',
      mcap_usd: g.mcapUsd,
      liquidity_usd: g.liquidityUsd,
      volume_24h_usd: g.volume24hUsd,
      price_change_1h: g.priceChange1h,
      price_change_24h: g.priceChange24h,
    }));
    const { error } = await this.supabase.getClient().from('memecoin_tokens').upsert(rows, { onConflict: 'mint', ignoreDuplicates: true });
    if (error) this.logger.error(`Saving graduations: ${error.message}`);
    else this.logger.log(`Recorded ${rows.length} graduated coin(s) from GeckoTerminal`);
  }
}
