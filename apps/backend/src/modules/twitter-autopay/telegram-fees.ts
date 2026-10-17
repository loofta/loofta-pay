import {
  MAGICBLOCK_GAS_USDC,
  MAGICBLOCK_VOLUME_FEE_BPS,
  ENABLE_SINGLE_PAYMENT_PLATFORM_FEE,
  SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS,
} from '@/common/magicblock-private-transfer';

/** Loofta's own fee on every Telegram payment, public or private, on top of everything else. */
export const TELEGRAM_LOOFTA_FEE_BPS = 20;
/** Flat fee when the recipient is not on Loofta yet (same as the web send flow). */
export const UNREGISTERED_CLAIM_FEE_USD = 0.1;

export interface TelegramFees {
  /** Everything the privacy API takes, shown as one "MagicBlock" line: its flat $0.20 relay, its
   *  10 bps, and the 10 bps Loofta platform fee the privacy API collects inside the private
   *  transaction (not mentioned separately). 0 for a public payment. */
  privateFeeUsd: number;
  /** Loofta's separate 20 bps, charged on every payment as its own transfer to the fee account. */
  looftaFeeUsd: number;
  /** $0.10 when the recipient is not on Loofta, else 0. */
  claimFeeUsd: number;
  /** What leaves the wallet in total. */
  totalUsd: number;
}

export function computeTelegramFees(amountUsd: number, opts: { isPrivate: boolean; registered: boolean }): TelegramFees {
  const privateFeeUsd = opts.isPrivate
    ? MAGICBLOCK_GAS_USDC +
      (amountUsd * (MAGICBLOCK_VOLUME_FEE_BPS + (ENABLE_SINGLE_PAYMENT_PLATFORM_FEE ? SINGLE_PAYMENT_LOOFTA_PLATFORM_FEE_BPS : 0))) / 10_000
    : 0;
  const looftaFeeUsd = (amountUsd * TELEGRAM_LOOFTA_FEE_BPS) / 10_000;
  const claimFeeUsd = opts.registered ? 0 : UNREGISTERED_CLAIM_FEE_USD;
  return { privateFeeUsd, looftaFeeUsd, claimFeeUsd, totalUsd: amountUsd + privateFeeUsd + looftaFeeUsd + claimFeeUsd };
}
