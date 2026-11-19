import { ForbiddenException } from '@nestjs/common';

// The claims module pulls in spl-token, which does not load under jest here. The service never uses it in these tests.
jest.mock('@/modules/claims/claims.service', () => ({ ClaimsService: class {}, runWithPartnerBatchAllowance: jest.fn() }));

import { PartnerPayoutsService } from './partner-payouts.service';

/** A tiny stand-in for the supabase query builder: every call returns itself, awaiting it gives `result`. */
function chain(result: unknown, spy?: (v: unknown) => void) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'delete']) c[m] = () => c;
  c.insert = (v: unknown) => (spy?.(v), c);
  c.maybeSingle = async () => result;
  c.single = async () => result;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

const partner = { id: 'p1', org_id: 'org_x', status: 'active', approval_threshold_usd: 0 };
const dto = { idempotency_key: 'k1', rows: [{ amount: 5, recipient_type: 'email' as const, recipient_identifier: 'a@b.co' }] };

function make(over: { partner?: unknown } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const supabase = {
    partners: chain({ data: 'partner' in over ? over.partner : partner }),
    payoutBatches: Object.assign(chain({ data: null }), {
      insert: (v: Record<string, unknown>) => (inserted.push(v), chain({ data: { id: 'b1' }, error: null })),
    }),
    payoutBatchItems: chain({ error: null }),
  };
  const partners = { audit: jest.fn() };
  const svc = new PartnerPayoutsService(supabase as never, partners as never, {} as never, {} as never, { get: () => undefined } as never, { sendPartnerBatchReadyEmail: jest.fn() } as never);
  jest.spyOn(svc as never, 'view' as never).mockResolvedValue({ id: 'b1' } as never);
  return { svc, inserted, partners };
}

describe('batches drafted with an API key', () => {
  it('always wait for a person to approve, even with no approval threshold set', async () => {
    const { svc, inserted } = make();
    await svc.createDraftViaApi('int1', dto as never);
    expect(inserted[0]).toMatchObject({ status: 'pending_approval', created_by_user_id: null });
    expect(inserted[0]).not.toHaveProperty('approved_by_user_id');
  });

  it('are recorded in the audit log as coming from the API', async () => {
    const { svc, partners } = make();
    await svc.createDraftViaApi('int1', dto as never);
    expect(partners.audit).toHaveBeenCalledWith('p1', null, 'batch.created', expect.anything(), expect.objectContaining({ via: 'api' }));
  });

  it('are refused for a suspended partner', async () => {
    const { svc } = make({ partner: { ...partner, status: 'suspended' } });
    await expect(svc.createDraftViaApi('int1', dto as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('are refused when the key is not linked to a partner', async () => {
    const { svc } = make({ partner: null });
    await expect(svc.createDraftViaApi('int1', dto as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only accept email recipients', async () => {
    const { svc } = make();
    const bad = { ...dto, rows: [{ amount: 5, recipient_type: 'twitter' as const, recipient_identifier: '@x' }] };
    await expect(svc.createDraftViaApi('int1', bad as never)).rejects.toThrow(/email/i);
  });
});
