import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';

// Retry schedule in seconds after each failed attempt; after the last one the event is marked failed.
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600, 86400];

/**
 * The backend POSTs to whatever URL a partner registers, so refuse anything that could reach our
 * own network (SSRF): https only, no IP literals, no localhost/internal hostnames.
 */
function assertSafeWebhookUrl(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException('webhook url is not a valid URL');
  }
  const host = u.hostname.toLowerCase();
  const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[');
  if (u.protocol !== 'https:' || isIpLiteral || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    throw new BadRequestException('webhook url must be a public https URL with a domain name');
  }
}

@Injectable()
export class PartnerWebhooksService {
  private readonly logger = new Logger(PartnerWebhooksService.name);
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  /** Signature header value for a raw body, same scheme as payment-link webhooks (X-Loofta-Signature). */
  static sign(secret: string, body: string): string {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  /** Stored once on first use so a partner can set webhook_url without a separate secret step. */
  async ensureSecret(integratorId: string): Promise<string> {
    const { data } = await this.supabase.partnerSettings.select('webhook_secret').eq('integrator_id', integratorId).maybeSingle();
    if (data?.webhook_secret) return data.webhook_secret as string;
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    await this.supabase.partnerSettings.upsert({ integrator_id: integratorId, webhook_secret: secret }, { onConflict: 'integrator_id' });
    return secret;
  }

  async setWebhookUrl(integratorId: string, url: string | null): Promise<{ webhook_url: string | null; webhook_secret: string }> {
    if (url) assertSafeWebhookUrl(url);
    const secret = await this.ensureSecret(integratorId);
    await this.supabase.partnerSettings.update({ webhook_url: url }).eq('integrator_id', integratorId);
    return { webhook_url: url, webhook_secret: secret };
  }

  // Money-adjacent and polls the DB, so production only (see cron production gating).
  @Cron(CronExpression.EVERY_MINUTE)
  async deliverDue(): Promise<void> {
    if (process.env.NODE_ENV !== 'production' || this.running) return;
    this.running = true;
    try {
      const { data: due } = await this.supabase.payoutWebhookEvents
        .select('id, integrator_id, payload, attempts')
        .eq('status', 'pending')
        .lte('next_attempt_at', new Date().toISOString())
        .order('next_attempt_at', { ascending: true })
        .limit(50);
      for (const ev of due ?? []) await this.deliver(ev);
    } finally {
      this.running = false;
    }
  }

  private async deliver(ev: { id: string; integrator_id: string; payload: unknown; attempts: number }): Promise<void> {
    const { data: settings } = await this.supabase.partnerSettings
      .select('webhook_url, webhook_secret')
      .eq('integrator_id', ev.integrator_id)
      .maybeSingle();

    // No URL configured: leave it pending (not failed) so setting a URL later still delivers
    // events from the last day, but stop retrying hot.
    if (!settings?.webhook_url || !settings.webhook_secret) {
      await this.supabase.payoutWebhookEvents
        .update({ next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString() })
        .eq('id', ev.id);
      return;
    }

    const body = JSON.stringify(ev.payload);
    let error: string | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(settings.webhook_url as string, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Loofta-Signature': PartnerWebhooksService.sign(settings.webhook_secret as string, body),
          'X-Loofta-Event-Id': ev.id,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error)?.message || 'request failed';
    }

    const attempts = ev.attempts + 1;
    if (!error) {
      await this.supabase.payoutWebhookEvents
        .update({ status: 'delivered', attempts, delivered_at: new Date().toISOString(), last_error: null })
        .eq('id', ev.id);
      return;
    }
    this.logger.warn(`Partner webhook ${ev.id} attempt ${attempts} failed: ${error}`);
    const wait = BACKOFF_SECONDS[attempts - 1];
    await this.supabase.payoutWebhookEvents
      .update(
        wait
          ? { attempts, last_error: error, next_attempt_at: new Date(Date.now() + wait * 1000).toISOString() }
          : { attempts, last_error: error, status: 'failed' },
      )
      .eq('id', ev.id);
  }
}
