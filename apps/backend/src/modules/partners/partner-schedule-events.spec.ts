import { BadRequestException, ConflictException } from '@nestjs/common';

// The claims module pulls in spl-token, which does not load under jest here. Nothing in these tests uses it.
jest.mock('@/modules/claims/claims.service', () => ({ ClaimsService: class {}, runWithPartnerBatchAllowance: jest.fn() }));

import { PartnerPayoutsService } from './partner-payouts.service';

/** A stand-in for the supabase builder: every call returns itself, awaiting it gives `result`. */
function chain(result: unknown, spy?: (name: string, v: unknown) => void) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'not', 'lte', 'order', 'limit', 'delete']) c[m] = () => c;
  c.insert = (v: unknown) => (spy?.('insert', v), c);
  c.update = (v: unknown) => (spy?.('update', v), c);
  c.maybeSingle = async () => result;
  c.single = async () => result;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

const partner = { id: 'p1', org_id: 'org_x', name: 'Acme', status: 'active', integrator_id: 'int1', approval_threshold_usd: 0, contact_email: 'owner@acme.co' };
const rows = [{ amount: 5, recipient_type: 'email' as const, recipient_identifier: 'a@b.co' }];
const inFuture = (ms: number) => new Date(Date.now() + ms).toISOString();

function make(over: { claimWon?: boolean; prepareFails?: string; integrator?: string | null; batchExists?: boolean } = {}) {
  const events: Record<string, unknown>[] = [];
  const batchInserts: Record<string, unknown>[] = [];
  const batchUpdates: Record<string, unknown>[] = [];
  const p = { ...partner, integrator_id: over.integrator === undefined ? 'int1' : over.integrator };
  const supabase = {
    partners: chain({ data: p }),
    payoutBatches: Object.assign(chain({ data: over.batchExists ? { id: 'b1', partner_id: 'p1', status: 'approved', item_count: 1, total_amount: 5 } : null }), {
      insert: (v: Record<string, unknown>) => (batchInserts.push(v), chain({ data: { id: 'b1' }, error: null })),
      update: (v: Record<string, unknown>) => {
        batchUpdates.push(v);
        return chain({ data: over.claimWon === false ? [] : [{ id: 'b1' }], error: null });
      },
    }),
    payoutBatchItems: chain({ error: null }),
    payoutWebhookEvents: { insert: async (v: Record<string, unknown>) => (events.push(v), { error: null }) },
  };
  const partners = { audit: jest.fn() };
  const email = { sendPartnerBatchReadyEmail: jest.fn() };
  const svc = new PartnerPayoutsService(supabase as never, partners as never, {} as never, {} as never, { get: () => undefined } as never, email as never);
  jest.spyOn(svc as never, 'view' as never).mockResolvedValue({ id: 'b1' } as never);
  const prepare = jest.spyOn(svc, 'prepare').mockImplementation(async () => {
    if (over.prepareFails) throw new Error(over.prepareFails);
    return {} as never;
  });
  return { svc, events, batchInserts, batchUpdates, prepare, partners, email };
}

describe('scheduling a batch', () => {
  it('stores the run time', async () => {
    const { svc, batchInserts } = make();
    const at = inFuture(2 * 3_600_000);
    await svc.createDraftViaApi('int1', { idempotency_key: 'k', rows, scheduled_for: at } as never);
    expect(batchInserts[0].scheduled_for).toBe(at);
  });

  it('is optional', async () => {
    const { svc, batchInserts } = make();
    await svc.createDraftViaApi('int1', { idempotency_key: 'k', rows } as never);
    expect(batchInserts[0].scheduled_for).toBeNull();
  });

  it('refuses a time in the past or less than 5 minutes away', async () => {
    const { svc, batchInserts } = make();
    for (const at of [inFuture(-60_000), inFuture(60_000)]) {
      await expect(svc.createDraftViaApi('int1', { idempotency_key: 'k', rows, scheduled_for: at } as never)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(batchInserts).toHaveLength(0);
  });

  it('refuses a time more than 90 days away', async () => {
    const { svc } = make();
    await expect(svc.createDraftViaApi('int1', { idempotency_key: 'k', rows, scheduled_for: inFuture(91 * 24 * 3_600_000) } as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('running a scheduled batch', () => {
  const due = { id: 'b1', partner_id: 'p1', approved_by_user_id: 'u-approver', created_by_user_id: null };

  it('prepares it as the person who approved it, flagged as scheduled', async () => {
    const { svc, prepare } = make();
    await expect(svc.runScheduledBatch(due)).resolves.toBe('ran');
    expect(prepare).toHaveBeenCalledWith('org_x', 'u-approver', 'b1', {}, { scheduled: true });
  });

  it('never runs the same batch twice when another worker already claimed it', async () => {
    const { svc, prepare } = make({ claimWon: false });
    await expect(svc.runScheduledBatch(due)).resolves.toBe('skipped');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('records why it failed, tells the partner, and does not throw', async () => {
    const { svc, batchUpdates, events } = make({ prepareFails: 'Create your company wallet first.' });
    await expect(svc.runScheduledBatch(due)).resolves.toBe('failed');
    expect(batchUpdates.some((u) => u.scheduled_error === 'Create your company wallet first.')).toBe(true);
    expect(events.some((e) => e.event_type === 'batch.schedule_failed')).toBe(true);
  });

  it('does not run when nobody approved it', async () => {
    const { svc, prepare } = make();
    await expect(svc.runScheduledBatch({ ...due, approved_by_user_id: null })).resolves.toBe('failed');
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('batch webhook events', () => {
  it('queues batch.created, and waits to say approved until a person approves an API draft', async () => {
    const { svc, events } = make();
    await svc.createDraftViaApi('int1', { idempotency_key: 'k2', rows } as never);
    const types = events.map((e) => e.event_type);
    expect(types).toContain('batch.created');
    // an API draft always waits for a person, so it is not approved yet
    expect(types).not.toContain('batch.approved');
  });

  it('carries the batch id and no internal data', async () => {
    const { svc, events } = make();
    await svc.createDraftViaApi('int1', { idempotency_key: 'k', rows } as never);
    const e = events.find((x) => x.event_type === 'batch.created') as { payload: Record<string, unknown>; integrator_id: string; batch_id: string; payment_id: null };
    expect(e.integrator_id).toBe('int1');
    expect(e.batch_id).toBe('b1');
    expect(e.payment_id).toBeNull();
    expect(e.payload).toMatchObject({ event: 'batch.created', batch_id: 'b1', status: 'pending_approval', total_amount: 5 });
    expect(JSON.stringify(e.payload)).not.toMatch(/user|wallet|hash/i);
  });

  it('queues nothing when the partner has no integrator account', async () => {
    const { svc, events } = make({ integrator: null });
    await svc.createDraftViaApi('int1', { idempotency_key: 'k', rows } as never);
    expect(events).toHaveLength(0);
  });

  it('never lets a failed event block the batch', async () => {
    const { svc } = make();
    (svc as never as { supabase: { payoutWebhookEvents: unknown } }).supabase.payoutWebhookEvents = { insert: async () => { throw new Error('db down'); } };
    await expect(svc.createDraftViaApi('int1', { idempotency_key: 'k', rows } as never)).resolves.toBeDefined();
  });
});

describe('calling a batch off with an API key', () => {
  it('cancels and queues batch.cancelled', async () => {
    const { svc, events, partners } = make({ batchExists: true });
    await svc.cancelViaApi('int1', 'b1');
    expect(events.map((e) => e.event_type)).toContain('batch.cancelled');
    expect(partners.audit).toHaveBeenCalledWith('p1', null, 'batch.cancelled', expect.anything(), { via: 'api' });
  });

  it('is refused once the batch can no longer be stopped', async () => {
    const { svc } = make({ claimWon: false, batchExists: true });
    await expect(svc.cancelViaApi('int1', 'b1')).rejects.toBeInstanceOf(ConflictException);
  });
});
