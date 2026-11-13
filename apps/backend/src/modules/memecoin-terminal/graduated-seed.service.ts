import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { seedGraduated } from '@/modules/mini-app/lib/pumpStream';

const REFRESH_MS = 10 * 60_000;
const WINDOW_MS = 48 * 60 * 60_000;
const LIMIT = 600;

/**
 * Keeps the mini app's Graduated list full. The live stream only knows coins that graduated while this process was running,
 * so after every restart that list started empty. The ingest already records each graduation in memecoin_tokens, so this
 * reads the last 48 hours of them back in on startup and every 10 minutes. One cheap query, no extra provider.
 */
@Injectable()
export class GraduatedSeedService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraduatedSeedService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit() {
    void this.load();
    this.timer = setInterval(() => void this.load(), REFRESH_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async load() {
    try {
      const since = new Date(Date.now() - WINDOW_MS).toISOString();
      const { data, error } = await this.supabase
        .getClient()
        .from('memecoin_tokens')
        .select('mint, name, symbol, image_url, website, twitter, telegram, migrated_at')
        .eq('status', 'migrated')
        .like('mint', '%pump')
        .gt('migrated_at', since)
        .order('migrated_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw new Error(error.message);
      const rows = (data ?? []).filter((r: { mint?: string }) => typeof r.mint === 'string');
      seedGraduated(
        rows.map((r: any) => ({
          mint: r.mint,
          name: r.name,
          symbol: r.symbol,
          image: r.image_url,
          website: r.website,
          twitter: r.twitter,
          telegram: r.telegram,
          graduatedAt: r.migrated_at ? Date.parse(r.migrated_at) : undefined,
        })),
      );
      this.logger.log(`Seeded ${rows.length} graduated coins from the last 48 hours.`);
    } catch (e) {
      this.logger.warn(`Could not seed graduated coins: ${(e as Error).message}`);
    }
  }
}
