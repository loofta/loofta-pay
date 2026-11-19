import { computePartnerFeeUsdc } from './partner-fee';

describe('computePartnerFeeUsdc', () => {
  it('is zero when the partner charges nothing', () => {
    expect(computePartnerFeeUsdc({ fee_fixed_usd: 0, fee_percent_bps: 0 }, 100)).toBe(0);
  });
  it('adds the flat fee and the percent fee', () => {
    expect(computePartnerFeeUsdc({ fee_fixed_usd: 0.5, fee_percent_bps: 200 }, 100)).toBe(2.5);
  });
  it('rounds up to the base unit so the partner is never short', () => {
    expect(computePartnerFeeUsdc({ fee_fixed_usd: 0, fee_percent_bps: 1 }, 0.333333)).toBe(0.000034);
  });
  it('never takes more than a quarter of the withdrawal, however the fees are set', () => {
    // $5 flat + 10% on a $10 withdrawal would be $6; capped at $2.50
    expect(computePartnerFeeUsdc({ fee_fixed_usd: 5, fee_percent_bps: 1000 }, 10)).toBe(2.5);
  });
  it('leaves the recipient something even when the flat fee dwarfs the amount', () => {
    const fee = computePartnerFeeUsdc({ fee_fixed_usd: 25, fee_percent_bps: 0 }, 1);
    expect(1 - fee).toBeGreaterThan(0.7);
  });
});

import { allocateFeeUnits } from './partner-fee';

describe('allocateFeeUnits', () => {
  const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, BigInt(0));
  it('always sums exactly to the total fee', () => {
    const payouts = [BigInt(3_333_333), BigInt(3_333_333), BigInt(3_333_334)];
    const shares = allocateFeeUnits(payouts, BigInt(1_000_001));
    expect(sum(shares)).toBe(BigInt(1_000_001));
  });
  it('is proportional, so no share exceeds the cap the total respects', () => {
    const shares = allocateFeeUnits([BigInt(1_000_000), BigInt(9_000_000)], BigInt(2_500_000)); // 25% of $10
    expect(shares[0] * BigInt(4)).toBeLessThanOrEqual(BigInt(1_000_000) + BigInt(4));
    expect(sum(shares)).toBe(BigInt(2_500_000));
  });
  it('charges nothing when there is no fee or nothing to withdraw', () => {
    expect(allocateFeeUnits([BigInt(5_000_000)], BigInt(0))).toEqual([BigInt(0)]);
    expect(allocateFeeUnits([], BigInt(100))).toEqual([]);
  });
});

describe('computePartnerFeeUsdc flat fee already paid', () => {
  it('drops only the flat part', () => {
    expect(computePartnerFeeUsdc({ fee_fixed_usd: 0.5, fee_percent_bps: 200 }, 10, { flatAlreadyPaid: true })).toBe(0.2);
    expect(computePartnerFeeUsdc({ fee_fixed_usd: 0.5, fee_percent_bps: 200 }, 10)).toBe(0.7);
  });
});
