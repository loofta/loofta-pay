import { computeTelegramFees } from './telegram-fees';

describe('computeTelegramFees', () => {
  it('public to a registered user: only Loofta 20 bps', () => {
    const f = computeTelegramFees(10, { isPrivate: false, registered: true });
    expect(f.privateFeeUsd).toBe(0);
    expect(f.looftaFeeUsd).toBeCloseTo(0.02, 6);
    expect(f.claimFeeUsd).toBe(0);
    expect(f.totalUsd).toBeCloseTo(10.02, 6);
  });

  it('public to an unregistered user adds the $0.10 claim fee', () => {
    const f = computeTelegramFees(10, { isPrivate: false, registered: false });
    expect(f.claimFeeUsd).toBe(0.1);
    expect(f.totalUsd).toBeCloseTo(10.12, 6);
  });

  it('private: $0.20 + 10 bps MagicBlock + 10 bps Loofta platform fee under one line, plus Loofta 20 bps', () => {
    const f = computeTelegramFees(100, { isPrivate: true, registered: true });
    expect(f.privateFeeUsd).toBeCloseTo(0.2 + 0.1 + 0.1, 6);
    expect(f.looftaFeeUsd).toBeCloseTo(0.2, 6);
    expect(f.totalUsd).toBeCloseTo(100 + 0.4 + 0.2, 6);
  });

  it('private to an unregistered user: everything stacks, nothing counted twice', () => {
    const f = computeTelegramFees(1, { isPrivate: true, registered: false });
    expect(f.privateFeeUsd).toBeCloseTo(0.202, 6);
    expect(f.looftaFeeUsd).toBeCloseTo(0.002, 6);
    expect(f.claimFeeUsd).toBe(0.1);
    expect(f.totalUsd).toBeCloseTo(1 + 0.202 + 0.002 + 0.1, 6);
  });
});
