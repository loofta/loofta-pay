import { hashBatchRows, PartnerPayoutsService } from './partner-payouts.service';

type Item = { id: string; row_index: number; recipient_type: string; recipient_identifier: string; amount: number; message: string | null; status: string; payment_id: string | null };

/**
 * Preparing a batch creates a payout for every row. A batch can hold 1,000, so one call works for a bounded time and the
 * caller asks again. These tests run the real prepare with a fake clock: each payout "takes" 10 seconds.
 */
function make(rowCount: number) {
  const items: Item[] = Array.from({ length: rowCount }, (_, i) => ({
    id: `i${i}`, row_index: i, recipient_type: 'email', recipient_identifier: `u${i}@x.co`, amount: 5, message: null, status: 'queued', payment_id: null,
  }));
  const batch = {
    id: 'b1', status: 'approved', scheduled_for: null, sender_wallet: null, rows_hash: hashBatchRows(items.map((i) => ({ type: i.recipient_type, identifier: i.recipient_identifier, amount: i.amount, message: i.message }))),
    total_amount: rowCount * 5, item_count: rowCount, failed_count: 0, label: null, created_by_user_id: 'u1', approved_by_user_id: 'u2',
  };
  const partner = { id: 'pt1', status: 'active', treasury_multisig: 'MS', treasury_vault: '11111111111111111111111111111112', integrator_id: null };
  let clock = 1_000_000;
  const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const created: string[] = [];
  const audits: string[] = [];

  const supabase = {
    payoutBatches: { update: (v: Record<string, unknown>) => ({ eq: () => ({ eq: () => ({ eq: () => ({ select: async () => { Object.assign(batch, v); return { data: [{ id: 'b1' }] }; } }) }) }), }) },
  };
  const partners = {
    requireMembership: async () => ({ partner, member: { role: 'owner' } }),
    adoptFundingWalletAsFeeWallet: async () => undefined,
    audit: async (_p: string, _u: string, action: string) => { audits.push(action); },
  };
  const redis = { withLock: async (_k: string, fn: () => Promise<unknown>) => fn() };
  const config = { get: () => undefined };
  const svc = new PartnerPayoutsService(supabase as never, partners as never, {} as never, redis as never, config as never, {} as never);
  const s = svc as unknown as Record<string, unknown>;
  s.getOwnedBatch = async () => batch;
  s.getItems = async () => items;
  s.createClaimForItem = async (_p: string, _u: string, _b: string, item: Item) => {
    clock += 10_000; // each payout takes ten fake seconds
    const row = items.find((i) => i.id === item.id)!;
    row.status = 'created';
    row.payment_id = `pay_${item.id}`;
    created.push(item.id);
  };
  const announced = jest.fn(async () => undefined);
  s.announceReady = announced;
  return { svc, items, created, audits, announced, restore: () => dateNow.mockRestore() };
}

describe('preparing a big batch', () => {
  afterEach(() => jest.restoreAllMocks());

  it('works for a bounded time, reports what is left, and finishes on the next call', async () => {
    const t = make(12);
    const first = (await t.svc.prepare('org', 'u1', 'b1', {})) as { preparing?: boolean; remaining?: number };
    expect(first.preparing).toBe(true);
    expect(first.remaining).toBeGreaterThan(0);
    expect(first.remaining).toBeLessThan(12);
    expect(t.created.length + (first.remaining as number)).toBe(12);
    expect(t.announced).not.toHaveBeenCalled(); // nobody is told "ready" while payouts are still being made
    expect(t.audits).not.toContain('batch.prepared');

    let guard = 0;
    let last: { preparing?: boolean } = first;
    while (last.preparing && guard++ < 10) last = (await t.svc.prepare('org', 'u1', 'b1', {})) as { preparing?: boolean };
    expect(last.preparing).toBeUndefined();
    expect(t.created).toHaveLength(12);
    expect(t.items.every((i) => i.status === 'created')).toBe(true);
    expect(t.announced).toHaveBeenCalledTimes(1);
    expect(t.audits.filter((a) => a === 'batch.prepared')).toHaveLength(1);
  });

  it('never creates a payout twice, however many rounds it takes', async () => {
    const t = make(30);
    let last: { preparing?: boolean } = (await t.svc.prepare('org', 'u1', 'b1', {})) as { preparing?: boolean };
    let guard = 0;
    while (last.preparing && guard++ < 20) last = (await t.svc.prepare('org', 'u1', 'b1', {})) as { preparing?: boolean };
    expect(new Set(t.created).size).toBe(30);
    expect(t.created).toHaveLength(30);
  });

  it('a small batch is done in one call, as before', async () => {
    const t = make(3);
    const out = (await t.svc.prepare('org', 'u1', 'b1', {})) as { preparing?: boolean; payouts?: number };
    expect(out.preparing).toBeUndefined();
    expect(out.payouts).toBe(3);
    expect(t.announced).toHaveBeenCalledTimes(1);
  });
});
