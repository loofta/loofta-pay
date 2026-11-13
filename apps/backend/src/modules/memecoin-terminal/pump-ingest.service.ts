import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { isCronEnabled } from '@/common/cron-gate';
import { MINT_RE, memecoinIngestOn } from './memecoin-providers';

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';
const SILENCE_RECONNECT_MS = 120_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Listens to PumpPortal's free streams: every new launch is only counted (there are far too many
 * to store and almost all are junk), every migration (graduation) is stored for the feed.
 *
 * Opt-in on top of the usual cron gate: needs MEMECOIN_INGEST_ENABLED=true and PUMPPORTAL_API_KEY.
 * A second instance would just insert the same mints (ignored as duplicates) but would double the
 * launch counts, so run this on one instance only.
 */
@Injectable()
export class PumpIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PumpIngestService.name);
  private ws: any = null;
  private stopped = false;
  private backoffMs = 1000;
  private lastMessageAt = 0;
  private launchBuffer = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private flusher: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!memecoinIngestOn(this.config, isCronEnabled(this.config))) {
      this.logger.log('Pump ingest disabled (needs production + MEMECOIN_INGEST_ENABLED=true).');
      return;
    }
    if (!this.config.get<string>('PUMPPORTAL_API_KEY')) {
      this.logger.warn('MEMECOIN_INGEST_ENABLED is true but PUMPPORTAL_API_KEY is missing; ingest not started.');
      return;
    }
    if (typeof (globalThis as any).WebSocket !== 'function') {
      this.logger.error('No global WebSocket (needs Node 22+); ingest not started.');
      return;
    }
    this.connect();
    this.watchdog = setInterval(() => this.checkSilence(), 30_000);
    this.flusher = setInterval(() => void this.flushLaunches(), 60_000);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.flusher) clearInterval(this.flusher);
    try { this.ws?.close(); } catch { /* already closed */ }
    await this.flushLaunches();
  }

  private connect(): void {
    if (this.stopped) return;
    const key = this.config.get<string>('PUMPPORTAL_API_KEY') as string;
    // The URL carries the API key, so it is never logged.
    const ws = new (globalThis as any).WebSocket(`${PUMPPORTAL_WS}?api-key=${encodeURIComponent(key)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.backoffMs = 1000;
      this.lastMessageAt = Date.now();
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
      this.logger.log('Connected to PumpPortal (new launches + migrations).');
    };
    ws.onmessage = (ev: { data: unknown }) => {
      this.lastMessageAt = Date.now();
      void this.handle(typeof ev.data === 'string' ? ev.data : String(ev.data)).catch(e => this.logger.error(`handle: ${e.message}`));
    };
    ws.onerror = () => this.logger.warn('PumpPortal socket error.');
    ws.onclose = () => {
      if (this.stopped || this.ws !== ws) return;
      this.logger.warn(`PumpPortal socket closed; reconnecting in ${this.backoffMs}ms.`);
      this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    };
  }

  private checkSilence(): void {
    if (this.stopped || !this.lastMessageAt) return;
    if (Date.now() - this.lastMessageAt > SILENCE_RECONNECT_MS) {
      this.logger.warn('No PumpPortal messages for 2 minutes; forcing a reconnect.');
      this.lastMessageAt = Date.now();
      try { this.ws?.close(); } catch { /* onclose handles the retry */ }
    }
  }

  async handle(raw: string): Promise<void> {
    let msg: Record<string, any>;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.txType === 'create') {
      this.launchBuffer++;
      return;
    }
    if (msg.txType !== 'migrate') return;

    const mint = typeof msg.mint === 'string' ? msg.mint : '';
    if (!MINT_RE.test(mint)) return;
    // ignoreDuplicates: a replayed event must never reset a coin's metrics or migrated_at.
    const { error } = await this.supabase.getClient().from('memecoin_tokens').upsert(
      {
        mint,
        status: 'migrated',
        migrated_at: new Date().toISOString(),
        name: typeof msg.name === 'string' ? msg.name.slice(0, 100) : null,
        symbol: typeof msg.symbol === 'string' ? msg.symbol.slice(0, 30) : null,
      },
      { onConflict: 'mint', ignoreDuplicates: true },
    );
    if (error) this.logger.error(`Saving migration ${mint}: ${error.message}`);
  }

  private async flushLaunches(): Promise<void> {
    const n = this.launchBuffer;
    if (n === 0) return;
    this.launchBuffer = 0;
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    const { error } = await this.supabase.getClient().rpc('memecoin_add_launches', { p_hour: hour.toISOString(), p_n: n });
    if (error) {
      this.launchBuffer += n; // keep the count for the next flush
      this.logger.error(`Flushing launch count: ${error.message}`);
    }
  }
}
