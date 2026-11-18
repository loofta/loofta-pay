import { hashBatchRows } from './partner-payouts.service';

const row = (over: Partial<{ type: string; identifier: string; amount: number | string; message: string | null }> = {}) => ({
  type: 'email',
  identifier: 'alice@example.com',
  amount: 25,
  message: null as string | null,
  ...over,
});

describe('hashBatchRows', () => {
  it('is stable for the same rows', () => {
    expect(hashBatchRows([row(), row({ identifier: 'bob@example.com', amount: 10 })])).toBe(
      hashBatchRows([row(), row({ identifier: 'bob@example.com', amount: 10 })]),
    );
  });

  it('ignores identifier case, surrounding spaces and numeric formatting', () => {
    expect(hashBatchRows([row({ identifier: ' Alice@Example.com ', amount: '25.000000' })])).toBe(hashBatchRows([row()]));
  });

  it('changes when an amount changes', () => {
    expect(hashBatchRows([row({ amount: 26 })])).not.toBe(hashBatchRows([row()]));
  });

  it('changes when a recipient is swapped', () => {
    expect(hashBatchRows([row({ identifier: 'mallory@example.com' })])).not.toBe(hashBatchRows([row()]));
  });

  it('changes when the order changes, so rows cannot be reshuffled after approval', () => {
    const a = row();
    const b = row({ identifier: 'bob@example.com', amount: 10 });
    expect(hashBatchRows([a, b])).not.toBe(hashBatchRows([b, a]));
  });

  it('changes when the message changes', () => {
    expect(hashBatchRows([row({ message: 'bonus' })])).not.toBe(hashBatchRows([row()]));
  });
});
