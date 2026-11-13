import { FILTERS, TokenMetrics, buildChecks, failReason, passesFilters, riskLevel, stageOf } from './memecoin-filters';

const base: TokenMetrics = {
  status: 'migrated',
  curveProgress: null,
  volume24hUsd: 186_000,
  holders: 1240,
  bundlerPct: 6,
  devPct: 2,
  lpBurnPct: 100,
  dexPaid: true,
  mintAuthorityActive: false,
  freezeAuthorityActive: false,
  rugged: false,
};
const with_ = (o: Partial<TokenMetrics>): TokenMetrics => ({ ...base, ...o });

describe('memecoin filters', () => {
  it('passes a healthy coin', () => {
    expect(passesFilters(base)).toBe(true);
    expect(failReason(base)).toBeNull();
  });

  it.each([
    ['volume under $500', with_({ volume24hUsd: FILTERS.minVolumeUsd - 1 }), 'low volume'],
    ['under 12 holders', with_({ holders: FILTERS.minHolders - 1 }), 'too few holders'],
    ['bundlers over 20%', with_({ bundlerPct: FILTERS.maxBundlerPct + 1 }), 'too much bundled'],
    ['creator over 15%', with_({ devPct: FILTERS.maxDevPct + 1 }), 'creator holds too much'],
    ['rugged', with_({ rugged: true }), 'rugged'],
    ['mint authority active', with_({ mintAuthorityActive: true }), 'mint authority active'],
    ['freeze authority active', with_({ freezeAuthorityActive: true }), 'freeze authority active'],
  ])('fails on %s', (_name, t, reason) => {
    expect(failReason(t)).toBe(reason);
    expect(riskLevel(t)).toBe('high');
  });

  it('accepts the exact thresholds', () => {
    expect(passesFilters(with_({ volume24hUsd: 500, holders: 12, bundlerPct: 20, devPct: 15 }))).toBe(true);
  });

  it('treats unknown metrics as not passing', () => {
    for (const k of ['volume24hUsd', 'holders', 'bundlerPct', 'devPct'] as const) {
      expect(failReason(with_({ [k]: null }))).toBe('metrics not available yet');
    }
  });

  it('is low risk only with a lock or paid listing and little insider share', () => {
    expect(riskLevel(base)).toBe('low');
    expect(riskLevel(with_({ lpBurnPct: 0, dexPaid: false }))).not.toBe('low');
    expect(riskLevel(with_({ dexPaid: false, lpBurnPct: 96 }))).toBe('low');
  });

  it('is high risk when insiders hold a lot and nothing is locked or paid', () => {
    expect(riskLevel(with_({ bundlerPct: 18, devPct: 14, lpBurnPct: 0, dexPaid: false, holders: 50 }))).toBe('high');
  });

  it('maps stage from status and curve progress', () => {
    expect(stageOf({ status: 'migrated', curveProgress: null })).toEqual({ key: 'grad', percent: 100 });
    expect(stageOf({ status: 'launchpad', curveProgress: 0.1 }).key).toBe('new');
    expect(stageOf({ status: 'launchpad', curveProgress: 0.6 }).key).toBe('final');
    expect(stageOf({ status: 'launchpad', curveProgress: null }).percent).toBe(2);
  });

  it('flags leftover creator powers in the checks', () => {
    const titles = buildChecks(with_({ mintAuthorityActive: true })).map(c => c.title);
    expect(titles).toContain('Creator can print more coins');
  });

  it('never says safe as a label', () => {
    const text = buildChecks(base).map(c => c.title + c.why).join(' ').toLowerCase();
    expect(text).not.toMatch(/\bis safe\b|\bsafe to buy\b/);
  });
});
