import { calculateGachaPayoutUnits } from './gacha-payout';

describe('calculateGachaPayoutUnits', () => {
  const participants = [
    { id: 'seat-1', seat_number: 1, excluded: false },
    { id: 'seat-2', seat_number: 2, excluded: true },
    { id: 'seat-3', seat_number: 3, excluded: false },
  ];

  it('pays only survivors and preserves every received unit', () => {
    const payouts = calculateGachaPayoutUnits(participants, 5n);

    expect(payouts.get('seat-1')).toBe(3n);
    expect(payouts.get('seat-2')).toBe(0n);
    expect(payouts.get('seat-3')).toBe(2n);
    expect([...payouts.values()].reduce((sum, units) => sum + units, 0n)).toBe(5n);
  });

  it('uses seat order, not input order, for the dust recipient', () => {
    const payouts = calculateGachaPayoutUnits([...participants].reverse(), 3n);
    expect(payouts.get('seat-1')).toBe(2n);
    expect(payouts.get('seat-3')).toBe(1n);
  });

  it('refuses to hide an invalid all-excluded settlement', () => {
    expect(() => calculateGachaPayoutUnits(
      participants.map((participant) => ({ ...participant, excluded: true })),
      10n,
    )).toThrow('at least one survivor');
  });

  it('rejects a negative on-chain balance delta', () => {
    expect(() => calculateGachaPayoutUnits(participants, -1n)).toThrow('cannot be negative');
  });
});
