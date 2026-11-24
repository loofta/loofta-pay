import { allocateLines, buildFeeLines, publicLines } from './partner-fee-lines';

const W = 'So11111111111111111111111111111111111111112';
const U = (n: number) => BigInt(Math.round(n * 1_000_000));

describe('buildFeeLines', () => {
  it('keeps the partner fee and the Loofta fee as separate lines', () => {
    const b = buildFeeLines({ grossUnits: U(100), partnerFeeUnits: U(2), partnerWallet: W, looftaFeeUnits: U(0.1) });
    expect(b.lines.map((l) => l.kind)).toEqual(['partner', 'loofta']);
    expect(b.lines[0].destination).toBe(W);
    expect(b.lines[1].destination).toBeNull();
    expect(b.totalUnits).toBe(U(2.1));
    expect(b.netUnits).toBe(U(97.9));
  });

  it('has no lines when there are no fees', () => {
    const b = buildFeeLines({ grossUnits: U(50), partnerFeeUnits: BigInt(0), partnerWallet: null, looftaFeeUnits: BigInt(0) });
    expect(b.lines).toEqual([]);
    expect(b.netUnits).toBe(U(50));
  });

  it('rejects a partner fee with no wallet', () => {
    expect(() => buildFeeLines({ grossUnits: U(50), partnerFeeUnits: U(1), partnerWallet: null, looftaFeeUnits: BigInt(0) })).toThrow(/wallet/);
  });

  it('rejects a partner fee above the share a partner may take', () => {
    expect(() => buildFeeLines({ grossUnits: U(100), partnerFeeUnits: U(26), partnerWallet: W, looftaFeeUnits: BigInt(0) })).toThrow(/share/);
    expect(() => buildFeeLines({ grossUnits: U(100), partnerFeeUnits: U(25), partnerWallet: W, looftaFeeUnits: BigInt(0) })).not.toThrow();
  });

  it('rejects fees that leave nothing for the recipient', () => {
    expect(() => buildFeeLines({ grossUnits: U(0.1), partnerFeeUnits: BigInt(0), partnerWallet: null, looftaFeeUnits: U(0.1) })).toThrow(/too small/);
  });

  it('rejects negative amounts', () => {
    expect(() => buildFeeLines({ grossUnits: U(10), partnerFeeUnits: BigInt(-1), partnerWallet: W, looftaFeeUnits: BigInt(0) })).toThrow(/non-negative/);
  });
});

describe('allocateLines', () => {
  it('splits each kind across payouts without losing or inventing a unit', () => {
    const payouts = [U(10), U(30), U(60)];
    const b = buildFeeLines({ grossUnits: U(100), partnerFeeUnits: U(3.333333), partnerWallet: W, looftaFeeUnits: U(0.3) });
    const per = allocateLines(payouts, b.lines);
    for (const kind of ['partner', 'loofta'] as const) {
      const sum = per.flat().filter((l) => l.kind === kind).reduce((a, l) => a + l.units, BigInt(0));
      expect(sum).toBe(b.lines.find((l) => l.kind === kind)!.units);
    }
    expect(per).toHaveLength(3);
  });
});

describe('publicLines', () => {
  it('shows ONE Platform fee line that adds the partner fee and the Loofta fee, never a destination', () => {
    const b = buildFeeLines({ grossUnits: U(100), partnerFeeUnits: U(2), partnerWallet: W, looftaFeeUnits: U(0.1) });
    const pub = publicLines(b.lines);
    expect(pub).toEqual([{ kind: 'platform', label: 'Platform fee', usdc: 2.1 }]);
    expect(JSON.stringify(pub)).not.toContain(W);
    expect(JSON.stringify(pub)).not.toMatch(/loofta/i);
  });

  it('the money lines underneath stay separate', () => {
    const b = buildFeeLines({ grossUnits: U(100), partnerFeeUnits: U(2), partnerWallet: W, looftaFeeUnits: U(0.1) });
    expect(b.lines.map((l) => l.kind)).toEqual(['partner', 'loofta']);
  });

  it('shows only the Loofta part when the partner takes nothing, and nothing at all when there are no fees', () => {
    const only = buildFeeLines({ grossUnits: U(100), partnerFeeUnits: BigInt(0), partnerWallet: null, looftaFeeUnits: U(0.35) });
    expect(publicLines(only.lines)).toEqual([{ kind: 'platform', label: 'Platform fee', usdc: 0.35 }]);
    expect(publicLines([])).toEqual([]);
  });
});
