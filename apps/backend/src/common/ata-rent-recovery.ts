/**
 * Whenever our fee-payer sponsor creates a NEW associated token account for a recipient, that
 * rent (~0.00204 SOL) is a real, irreversible cost the moment the recipient later closes the
 * account and reclaims the rent for themselves — the sponsor never gets it back. This is the
 * same rent-drain MagicBlock's own hosted Payments API hit with ATAs; they fixed it by never
 * letting a sponsored ATA creation be free. This module mirrors that fix for our own sponsor-paid
 * SPL paths (see project memory: solana sponsor security hardening, and the July 2026 drain
 * attacks that predate this).
 */
import { Logger } from '@nestjs/common';
import { fetchSolPriceUsd } from './magicblock-private-transfer';

const log = new Logger('AtaRentRecovery');

/**
 * Rent-exempt minimum for a standard SPL token account (165 bytes), in lamports. Stable across
 * Solana (rent parameters essentially never change) — hardcoded like MAGICBLOCK_GAS_SOL elsewhere
 * in this codebase rather than an extra getMinimumBalanceForRentExemption RPC call per build.
 */
export const ATA_RENT_LAMPORTS = 2_039_280;

/** Safety margin over raw rent to absorb SOL price swings between quote and settlement. */
const RECOVERY_BUFFER_MULTIPLIER = 1.25;

/**
 * Flat per-ATA fallback fee (USDC) used only when the SOL/USD price feed is unavailable.
 * Comfortably above the real cost (ATA rent is ~$0.15-0.35 at typical SOL prices) so a price-API
 * hiccup never means "skip the fee" — that's exactly the drain this module exists to close.
 */
const RECOVERY_FALLBACK_USDC_PER_ATA = 0.5;

export interface AtaRentRecoveryQuote {
  /** Number of new associated token accounts this transaction will create. */
  newAtaCount: number;
  /** Total USDC (human units, 6dp-rounded) to collect from the sender to cover sponsor ATA rent. */
  totalUsdc: number;
  /** Same amount in raw base units (6 decimals) — what to put in the transfer instruction. */
  totalUsdcUnits: number;
  solPriceUsd: number | null;
}

/**
 * Returns a zero quote when newAtaCount is 0 — recipients who already have an ATA cost nothing
 * extra. Never returns a zero fee for newAtaCount > 0; falls back to a flat per-ATA charge if the
 * price feed is down rather than silently charging nothing.
 */
export async function quoteAtaRentRecoveryUsdc(newAtaCount: number): Promise<AtaRentRecoveryQuote> {
  if (newAtaCount <= 0) {
    return { newAtaCount: 0, totalUsdc: 0, totalUsdcUnits: 0, solPriceUsd: null };
  }

  const solPriceUsd = await fetchSolPriceUsd().catch(() => null);
  let totalUsdc: number;
  if (solPriceUsd != null && solPriceUsd > 0) {
    const lamportsToRecover = ATA_RENT_LAMPORTS * RECOVERY_BUFFER_MULTIPLIER * newAtaCount;
    totalUsdc = (lamportsToRecover / 1e9) * solPriceUsd;
  } else {
    log.warn(
      `SOL price unavailable; using flat fallback of $${RECOVERY_FALLBACK_USDC_PER_ATA}/ATA for ${newAtaCount} new ATA(s)`,
    );
    totalUsdc = RECOVERY_FALLBACK_USDC_PER_ATA * newAtaCount;
  }

  const totalUsdcUnits = Math.ceil(totalUsdc * 1_000_000);
  return { newAtaCount, totalUsdc: totalUsdcUnits / 1_000_000, totalUsdcUnits, solPriceUsd };
}
