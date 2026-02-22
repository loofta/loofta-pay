/**
 * Privacy Cash fee config and gross amount calculation for private send.
 * Sender pays: recipient amount + PC fees so recipient gets the full amount.
 * Fee structure from relayer /config or fallback constants.
 */

const RELAYER_API_URL =
  process.env.NEXT_PUBLIC_RELAYER_API_URL ?? 'https://api3.privacycash.org';

const USDC_UNITS_PER_TOKEN = 1_000_000;

/** Fallback from user-provided fee structure (same as relayer /config). */
const FALLBACK = {
  withdraw_fee_rate: 0.0035,
  rent_fees: { usdc: 0.600063726767783 },
  minimum_withdrawal: { usdc: 2 },
} as const;

export type PrivacyCashFeeConfig = {
  withdraw_fee_rate: number;
  rent_fee_usdc: number;
  minimum_withdrawal_usdc: number;
};

let cachedConfig: PrivacyCashFeeConfig | null = null;

export async function getPrivacyCashFeeConfig(): Promise<PrivacyCashFeeConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch(`${RELAYER_API_URL}/config`);
    if (!res.ok) throw new Error(`config ${res.status}`);
    const raw = (await res.json()) as {
      withdraw_fee_rate?: number;
      rent_fees?: { usdc?: number };
      minimum_withdrawal?: { usdc?: number };
    };
    cachedConfig = {
      withdraw_fee_rate: raw.withdraw_fee_rate ?? FALLBACK.withdraw_fee_rate,
      rent_fee_usdc: raw.rent_fees?.usdc ?? FALLBACK.rent_fees.usdc,
      minimum_withdrawal_usdc:
        raw.minimum_withdrawal?.usdc ?? FALLBACK.minimum_withdrawal.usdc,
    };
    return cachedConfig;
  } catch (e) {
    return {
      withdraw_fee_rate: FALLBACK.withdraw_fee_rate,
      rent_fee_usdc: FALLBACK.rent_fees.usdc,
      minimum_withdrawal_usdc: FALLBACK.minimum_withdrawal.usdc,
    };
  }
}

/**
 * Compute gross deposit/withdraw amount so that after Privacy Cash fees
 * the recipient receives exactly recipientAmountUsdc.
 * Formula matches SDK withdrawSPL: fee = gross * rate + units_per_token * rent_fee; net = gross - fee.
 * So gross = (recipientBaseUnits + rent_fee_base_units) / (1 - rate).
 */
export function computePrivateGrossFromRecipient(
  recipientAmountUsdc: number,
  config: PrivacyCashFeeConfig,
): {
  grossUsdc: number;
  grossBaseUnits: number;
  feeUsdc: number;
  feeBaseUnits: number;
} {
  const recipientBaseUnits = Math.floor(recipientAmountUsdc * USDC_UNITS_PER_TOKEN);
  const rentFeeBaseUnits = Math.ceil(config.rent_fee_usdc * USDC_UNITS_PER_TOKEN);
  const rate = config.withdraw_fee_rate;
  const grossBaseUnits = Math.ceil(
    (recipientBaseUnits + rentFeeBaseUnits) / (1 - rate),
  );
  const feeBaseUnits = Math.floor(
    grossBaseUnits * rate + USDC_UNITS_PER_TOKEN * config.rent_fee_usdc,
  );
  const feeUsdc = feeBaseUnits / USDC_UNITS_PER_TOKEN;
  const grossUsdc = grossBaseUnits / USDC_UNITS_PER_TOKEN;
  return {
    grossUsdc,
    grossBaseUnits,
    feeUsdc,
    feeBaseUnits,
  };
}

/** Platform SOL for burner to cover claim/reclaim gas (not sent to our fee payer). */
export const BURNER_SOL_LAMPORTS = 500_000; // 0.0005 SOL
