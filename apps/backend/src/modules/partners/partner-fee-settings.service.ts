import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { DEFAULT_LOOFTA_FEE_RATES, LooftaFeeRates, MAX_LOOFTA_FEE_BPS, MAX_LOOFTA_FEE_FLAT_USD } from './partner-fee';

const CACHE_MS = 30_000;

/**
 * Loofta's own withdrawal fee on partner payouts, set from the admin dashboard. Reads are cached for a few seconds
 * because every quote and every withdrawal asks. A missing table, a missing row or a failed read falls back to the
 * defaults, so the withdraw flow never breaks because this setting is unavailable.
 */
@Injectable()
export class PartnerFeeSettingsService {
  private readonly logger = new Logger(PartnerFeeSettingsService.name);
  private cache: { rates: LooftaFeeRates; at: number } | null = null;

  constructor(private readonly supabase: SupabaseService) {}

  async get(): Promise<LooftaFeeRates> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rates;
    let rates = DEFAULT_LOOFTA_FEE_RATES;
    try {
      const { data, error } = await this.supabase.partnerPlatformSettings.select('loofta_fee_flat_usd, loofta_fee_bps').eq('id', true).maybeSingle();
      if (error) {
        this.logger.warn(`Loofta fee settings unavailable, using defaults: ${error.message}`);
      } else if (data) {
        const flatUsd = Number(data.loofta_fee_flat_usd);
        const bps = Number(data.loofta_fee_bps);
        if (Number.isFinite(flatUsd) && flatUsd >= 0 && flatUsd <= MAX_LOOFTA_FEE_FLAT_USD && Number.isInteger(bps) && bps >= 0 && bps <= MAX_LOOFTA_FEE_BPS) {
          rates = { flatUsd, bps };
        } else {
          this.logger.error('Loofta fee settings are out of range, using defaults');
        }
      }
    } catch (e) {
      this.logger.warn(`Loofta fee settings unavailable, using defaults: ${(e as Error).message}`);
    }
    this.cache = { rates, at: Date.now() };
    return rates;
  }

  /** Saves new rates. Rejects anything outside the ceilings, so a typo cannot overcharge recipients. */
  async set(flatUsd: number, bps: number, adminUserId: string): Promise<LooftaFeeRates> {
    if (!Number.isFinite(flatUsd) || flatUsd < 0 || flatUsd > MAX_LOOFTA_FEE_FLAT_USD) {
      throw new BadRequestException(`The flat fee must be between $0 and $${MAX_LOOFTA_FEE_FLAT_USD}.`);
    }
    if (!Number.isInteger(bps) || bps < 0 || bps > MAX_LOOFTA_FEE_BPS) {
      throw new BadRequestException(`The percentage must be between 0% and ${MAX_LOOFTA_FEE_BPS / 100}%.`);
    }
    const rounded = Math.round(flatUsd * 1_000_000) / 1_000_000;
    const { error } = await this.supabase.partnerPlatformSettings.upsert(
      { id: true, loofta_fee_flat_usd: rounded, loofta_fee_bps: bps, updated_by: adminUserId, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
    if (error) {
      this.logger.error(`Could not save Loofta fee settings: ${error.message}`);
      throw new BadRequestException('Could not save. Has the partner_platform_settings migration been run?');
    }
    this.logger.log(`Loofta withdrawal fee set to $${rounded} + ${bps} bps by ${adminUserId}`);
    this.cache = null;
    return { flatUsd: rounded, bps };
  }
}
