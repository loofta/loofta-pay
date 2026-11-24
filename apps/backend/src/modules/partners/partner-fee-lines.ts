import { allocateFeeUnits, MAX_PARTNER_FEE_SHARE } from './partner-fee';

/**
 * Every fee on a partner withdrawal is a separate line with its own owner and destination, so Loofta's fee and the
 * partner's fee are never mixed into one number. A new kind of fee later (a provider fee, a referral cut) is one more
 * line here, not a change to the sweep. Amounts are integer base units (USDC has 6 decimals), never floats.
 */
export type FeeKind = 'partner' | 'loofta';

export type FeeLine = {
  kind: FeeKind;
  units: bigint;
  /** Where this line is paid. Null means "Loofta's own fee wallet", which the sweep resolves itself. */
  destination: string | null;
};

export type FeeBreakdown = {
  lines: FeeLine[];
  totalUnits: bigint;
  netUnits: bigint;
};

/** What a person sees: one "Platform fee" line. People do not know who Loofta is, so the partner's fee and Loofta's fee are shown as one. */
export type PublicFeeLine = { kind: 'platform' | 'setup'; label: string; usdc: number };

/**
 * Builds the fee lines for one withdrawal of `grossUnits`. Rejects anything that could pay out wrongly: a negative or
 * fractional amount, a partner fee with no wallet to receive it, a partner fee above the share a partner may take, or
 * fees that leave nothing for the recipient. Zero lines are dropped, so "no fees" is simply no lines.
 */
export function buildFeeLines(input: {
  grossUnits: bigint;
  partnerFeeUnits: bigint;
  partnerWallet: string | null;
  looftaFeeUnits: bigint;
}): FeeBreakdown {
  const { grossUnits, partnerFeeUnits, partnerWallet, looftaFeeUnits } = input;
  for (const v of [grossUnits, partnerFeeUnits, looftaFeeUnits]) {
    if (typeof v !== 'bigint' || v < BigInt(0)) throw new Error('Fee amounts must be whole, non-negative base units.');
  }
  const lines: FeeLine[] = [];
  if (partnerFeeUnits > BigInt(0)) {
    if (!partnerWallet) throw new Error('A partner fee needs a wallet to receive it.');
    if (partnerFeeUnits * BigInt(100) > grossUnits * BigInt(Math.round(MAX_PARTNER_FEE_SHARE * 100))) {
      throw new Error('The partner fee is above the share a partner may take.');
    }
    lines.push({ kind: 'partner', units: partnerFeeUnits, destination: partnerWallet });
  }
  if (looftaFeeUnits > BigInt(0)) lines.push({ kind: 'loofta', units: looftaFeeUnits, destination: null });
  const totalUnits = lines.reduce((a, l) => a + l.units, BigInt(0));
  const netUnits = grossUnits - totalUnits;
  if (grossUnits > BigInt(0) && netUnits <= BigInt(0)) throw new Error('This amount is too small to withdraw after fees.');
  return { lines, totalUnits, netUnits };
}

/**
 * Splits a withdrawal's lines across the payouts it covers, line by line, using the same proportional rule as
 * `allocateFeeUnits`. The result is one array of lines per payout, in the same order as `payoutUnits`; for each kind the
 * parts always add up to exactly the original line, so no unit is lost or invented.
 */
export function allocateLines(payoutUnits: bigint[], lines: FeeLine[]): FeeLine[][] {
  const perPayout: FeeLine[][] = payoutUnits.map(() => []);
  for (const line of lines) {
    const shares = allocateFeeUnits(payoutUnits, line.units);
    shares.forEach((units, i) => {
      if (units > BigInt(0)) perPayout[i].push({ ...line, units });
    });
  }
  return perPayout;
}

/**
 * What the recipient and the portal may see: ONE "Platform fee" line that adds up every fee on the withdrawal (the partner's and
 * Loofta's), never a destination. The lines themselves stay separate everywhere money is paid; only the display is combined.
 * No fees means no line.
 */
export function publicLines(lines: FeeLine[]): PublicFeeLine[] {
  const total = lines.reduce((a, l) => a + l.units, BigInt(0));
  return total > BigInt(0) ? [{ kind: 'platform', label: 'Platform fee', usdc: Number(total) / 1_000_000 }] : [];
}
