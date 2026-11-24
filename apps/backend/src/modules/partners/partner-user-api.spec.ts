import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PartnerPayoutsService } from './partner-payouts.service';

type Call = { method: string; args: unknown[] };

/** A query builder that records what was asked and answers with whatever `answer(calls)` returns. */
function builder(answer: (calls: Call[]) => unknown) {
  const calls: Call[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'range', 'is', 'not']) {
    q[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return q;
    };
  }
  q.maybeSingle = async () => answer(calls);
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(answer(calls)).then(res);
  return { q, calls };
}

function make(opts: { partner?: Record<string, unknown> | null; payments?: (calls: Call[]) => unknown; recipient?: unknown; items?: Array<{ payment_id: string; external_ref: string | null }> }) {
  const seen: Call[][] = [];
  const partner = opts.partner === undefined ? { id: 'pt1', status: 'active' } : opts.partner;
  const supabase = {
    partners: builder(() => ({ data: partner })).q,
    partnerRecipients: builder(() => ({ data: opts.recipient ?? null })).q,
    payoutBatchItems: builder(() => ({ data: opts.items ?? [], error: null })).q,
    get payments() {
      const b = builder((calls) => opts.payments?.(calls) ?? { data: [], error: null });
      seen.push(b.calls);
      return b.q;
    },
  };
  const svc = new PartnerPayoutsService(supabase as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, seen };
}

const eqValue = (calls: Call[], col: string) => calls.find((c) => c.method === 'eq' && c.args[0] === col)?.args[1];

describe('a partner reading one user balance', () => {
  it('adds up what can be withdrawn and what already was, rounded to cents', async () => {
    const { svc } = make({
      payments: () => ({
        data: [
          { amount: 10.005, partner_withdrawn_at: null },
          { amount: '5', partner_withdrawn_at: null },
          { amount: 7, partner_withdrawn_at: '2026-11-20T10:00:00Z' },
        ],
        error: null,
      }),
    });
    const out = await svc.userBalanceViaApi('int1', { email: ' Alice@Example.com ' });
    expect(out).toEqual({ identity: 'alice@example.com', available_usd: 15.01, withdrawn_usd: 7, total_received_usd: 22.01, payouts: 3 });
  });

  it('only ever asks for this partner and this person, never anything cancelled or unfunded', async () => {
    const { svc, seen } = make({});
    await svc.userBalanceViaApi('int1', { email: 'Alice@Example.com' });
    const calls = seen[0];
    expect(eqValue(calls, 'partner_id')).toBe('pt1');
    expect(eqValue(calls, 'recipient_email')).toBe('alice@example.com');
    const filter = calls.find((c) => c.method === 'or')!.args[0] as string;
    expect(filter).toContain('partner_withdrawn_at.not.is.null');
    expect(filter).toContain('PRIVATE_TRANSFER_PENDING,SUCCESS');
    expect(filter).not.toContain('CANCELLED');
  });

  it('finds a person by social handle', async () => {
    const { svc, seen } = make({});
    const out = await svc.userBalanceViaApi('int1', { platform: 'twitter', handle: '@Alice' });
    expect(eqValue(seen[0], 'recipient_address')).toBe('PENDING_SOCIAL:twitter:alice');
    expect(out.identity).toBe('twitter:alice');
  });

  it('finds a person by the partner own id', async () => {
    const { svc, seen } = make({ recipient: { email: 'Bob@Example.com', handle_platform: null, handle: null } });
    const out = await svc.userBalanceViaApi('int1', { external_user_id: 'user_42' });
    expect(eqValue(seen[0], 'recipient_email')).toBe('bob@example.com');
    expect(out.identity).toBe('bob@example.com');
  });

  it('keeps reading past 1,000 payouts', async () => {
    let page = 0;
    const { svc } = make({
      payments: () => {
        page++;
        return { data: Array.from({ length: page === 1 ? 1000 : 5 }, () => ({ amount: 1, partner_withdrawn_at: null })), error: null };
      },
    });
    const out = await svc.userBalanceViaApi('int1', { email: 'a@b.co' });
    expect(out.payouts).toBe(1005);
    expect(out.available_usd).toBe(1005);
  });

  it('refuses a request that names nobody, an unknown own id, and a suspended partner', async () => {
    await expect(make({}).svc.userBalanceViaApi('int1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(make({ recipient: null }).svc.userBalanceViaApi('int1', { external_user_id: 'nope' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(make({ partner: { id: 'pt1', status: 'suspended' } }).svc.userBalanceViaApi('int1', { email: 'a@b.co' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(make({ partner: null }).svc.userBalanceViaApi('int1', { email: 'a@b.co' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('a partner reading one user history', () => {
  const row = (id: string, withdrawn: string | null = null) => ({ id, amount: 12.5, description: 'Bonus', created_at: '2026-11-20T08:00:00Z', paid_at: '2026-11-21T09:00:00Z', partner_withdrawn_at: withdrawn });

  it('returns a page, newest first, with the total and the partner own reference', async () => {
    const { svc, seen } = make({
      payments: () => ({ data: [row('p1'), row('p2', '2026-11-22T10:00:00Z')], error: null, count: 45 }),
      items: [{ payment_id: 'p1', external_ref: 'inv_881' }],
    });
    const out = await svc.userHistoryViaApi('int1', { email: 'a@b.co', page: 2, limit: 20 });
    const calls = seen[0];
    expect(calls.find((c) => c.method === 'range')!.args).toEqual([20, 39]);
    expect(calls.find((c) => c.method === 'order')!.args).toEqual(['created_at', { ascending: false }]);
    expect(out).toMatchObject({ page: 2, limit: 20, total: 45, has_more: true });
    expect(out.items[0]).toEqual({ payment_id: 'p1', amount: 12.5, message: 'Bonus', external_ref: 'inv_881', received_at: '2026-11-21T09:00:00Z', state: 'available', withdrawn_at: null });
    expect(out.items[1]).toMatchObject({ payment_id: 'p2', external_ref: null, state: 'withdrawn', withdrawn_at: '2026-11-22T10:00:00Z' });
  });

  it('says there is no more on the last page', async () => {
    const { svc } = make({ payments: () => ({ data: [row('p1')], error: null, count: 21 }) });
    const out = await svc.userHistoryViaApi('int1', { email: 'a@b.co', page: 2, limit: 20 });
    expect(out.has_more).toBe(false);
  });

  it('defaults to page 1 of 20 and never returns more than 100 a page', async () => {
    const a = make({});
    await a.svc.userHistoryViaApi('int1', { email: 'a@b.co' });
    expect(a.seen[0].find((c) => c.method === 'range')!.args).toEqual([0, 19]);
    const b = make({});
    await b.svc.userHistoryViaApi('int1', { email: 'a@b.co', page: 3, limit: 5000 });
    expect(b.seen[0].find((c) => c.method === 'range')!.args).toEqual([200, 299]);
  });

  it('stays scoped to the partner of the key', async () => {
    const { svc, seen } = make({});
    await svc.userHistoryViaApi('int1', { email: 'a@b.co' });
    expect(eqValue(seen[0], 'partner_id')).toBe('pt1');
  });
});
