import { allowanceToday, daysLeftInMonth } from './memecoin-budget';

const D = (s: string) => new Date(`${s}T10:00:00Z`);

describe('daysLeftInMonth', () => {
  it('counts today', () => {
    expect(daysLeftInMonth(D('2026-10-21'))).toBe(11);
    expect(daysLeftInMonth(D('2026-10-31'))).toBe(1);
    expect(daysLeftInMonth(D('2026-10-01'))).toBe(31);
  });
});

describe('allowanceToday', () => {
  it('spreads the cap over the month', () => {
    expect(allowanceToday({ monthlyCap: 2000, usedThisMonth: 0, usedToday: 0, now: D('2026-10-01') })).toBe(65);
  });
  it('does not shrink as today is spent, and hits zero at today share', () => {
    const base = { monthlyCap: 2000, now: D('2026-10-01') };
    expect(allowanceToday({ ...base, usedThisMonth: 40, usedToday: 40 })).toBe(25);
    expect(allowanceToday({ ...base, usedThisMonth: 65, usedToday: 65 })).toBe(0);
  });
  it('gives unspent days back to the rest of the month', () => {
    const quiet = allowanceToday({ monthlyCap: 2000, usedThisMonth: 0, usedToday: 0, now: D('2026-10-16') });
    expect(quiet).toBe(125);
  });
  it('is zero once the monthly cap is spent', () => {
    expect(allowanceToday({ monthlyCap: 2000, usedThisMonth: 2000, usedToday: 10, now: D('2026-10-10') })).toBe(0);
    expect(allowanceToday({ monthlyCap: 2000, usedThisMonth: 2100, usedToday: 10, now: D('2026-10-10') })).toBe(0);
  });
  it('never exceeds what is left in the month', () => {
    expect(allowanceToday({ monthlyCap: 2000, usedThisMonth: 1995, usedToday: 0, now: D('2026-10-31') })).toBe(5);
  });
});
