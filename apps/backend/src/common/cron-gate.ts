import { ConfigService } from '@nestjs/config';

/**
 * Single gate every @Cron-decorated method should check before doing real work.
 *
 * NODE_ENV=production is the baseline (see feedback_cron_production_gating): a dev/staging
 * instance must never run money-moving/RPC-polling crons. DISABLE_CRONS=true is a second,
 * independent override for an instance that legitimately needs NODE_ENV=production locally
 * (e.g. pointed at the production database for debugging) but must still never run its own
 * cron scheduler — without it, two NODE_ENV=production instances against the same DB race
 * each other on every tick. This is exactly what caused 17 giveaway winners to be paid 2-3x
 * on 2026-08-25: a local backend, configured with NODE_ENV=production to inspect prod data,
 * had its payout cron racing the real Railway deployment for the same rows.
 */
export function isCronEnabled(config: ConfigService): boolean {
  if (config.get<string>('DISABLE_CRONS') === 'true') return false;
  return config.get<string>('NODE_ENV') === 'production';
}
