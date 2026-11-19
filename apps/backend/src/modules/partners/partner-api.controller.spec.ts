import { ForbiddenException } from '@nestjs/common';
import { REQUIRE_SCOPE_KEY } from '@/common/decorators/require-scope.decorator';

// The claims module pulls in spl-token, which does not load under jest here. Nothing in these tests uses it.
jest.mock('@/modules/claims/claims.service', () => ({ ClaimsService: class {}, runWithPartnerBatchAllowance: jest.fn() }));

import { PartnerApiController } from './partner-api.controller';
import { IntegratorGuard } from '@/common/guards';

const stored = {
  id: 'b1',
  status: 'pending_approval',
  label: 'Nov',
  item_count: 1,
  failed_count: 0,
  total_amount: 25,
  created_at: '2026-11-19T10:00:00Z',
  // internal fields that must never reach a partner's server
  partner_id: 'p1',
  created_by_user_id: 'did:privy:abc',
  approved_by_user_id: 'did:privy:def',
  sender_wallet: 'Wallet111',
  rows_hash: 'h'.repeat(64),
  items: [{ row_index: 0, recipient_identifier: 'a@b.co', amount: 25, external_ref: 'u1', status: 'queued', error: null, withdrawn: false, payment_id: 'pay1', partner_fee_usdc: 1 }],
};

function make() {
  const payouts = {
    createDraftViaApi: jest.fn().mockResolvedValue(stored),
    getViaApi: jest.fn().mockResolvedValue(stored),
    cancelViaApi: jest.fn().mockResolvedValue({ ...stored, status: 'cancelled' }),
    listViaApi: jest.fn().mockResolvedValue([{ ...stored, sender_wallet: 'Wallet111' }]),
  };
  const keys = { setWebhookForIntegrator: jest.fn().mockResolvedValue({ url: 'https://x.co/h', secret: 'whsec_1' }) };
  const partners = { orgIdForIntegrator: jest.fn().mockResolvedValue('org_x') };
  const config = { get: (k: string) => (k === 'PAY_APP_URL' ? 'https://pay.example/' : undefined) };
  const ctl = new PartnerApiController(payouts as never, partners as never, config as never, keys as never);
  return { ctl, payouts, keys };
}
const req = { integrator: { id: 'int1' } } as never;

describe('partner API controller', () => {
  it('returns an approve link that opens the batch in the portal', async () => {
    const { ctl } = make();
    const out = await ctl.create({ idempotency_key: 'k', rows: [] } as never, req);
    expect(out.approve_url).toBe('https://pay.example/app/partner?org=org_x&tab=payouts&batch=b1');
    expect(out.batch_id).toBe('b1');
  });

  it('never returns internal user ids, wallets or hashes', async () => {
    const { ctl } = make();
    const out = JSON.stringify(await ctl.create({} as never, req));
    for (const secret of ['did:privy', 'Wallet111', 'rows_hash', 'partner_id', 'payment_id', 'partner_fee_usdc', 'hhhhhhhh']) {
      expect(out).not.toContain(secret);
    }
  });

  it('looks a batch up scoped to the key that asked', async () => {
    const { ctl, payouts } = make();
    await ctl.get('b1', req);
    expect(payouts.getViaApi).toHaveBeenCalledWith('int1', 'b1');
  });

  it('demands the batches:write scope on every route', () => {
    for (const route of ['create', 'get', 'list', 'cancel', 'setWebhook'] as const) {
      expect(Reflect.getMetadata(REQUIRE_SCOPE_KEY, PartnerApiController.prototype[route])).toBe('batches:write');
    }
  });

  it('shows when a batch is scheduled', async () => {
    const { ctl, payouts } = make();
    payouts.getViaApi.mockResolvedValue({ ...stored, scheduled_for: '2026-12-01T09:00:00Z', scheduled_error: null });
    const out = await ctl.get('b1', req);
    expect(out.scheduled_for).toBe('2026-12-01T09:00:00Z');
  });

  it('lists batches without internal fields', async () => {
    const { ctl, payouts } = make();
    const out = await ctl.list('10', req);
    expect(payouts.listViaApi).toHaveBeenCalledWith('int1', 10);
    expect(JSON.stringify(out)).not.toContain('Wallet111');
    expect(out.batches[0].approve_url).toContain('batch=b1');
  });

  it('cancels only through the key that owns the batch', async () => {
    const { ctl, payouts } = make();
    const out = await ctl.cancel('b1', req);
    expect(payouts.cancelViaApi).toHaveBeenCalledWith('int1', 'b1');
    expect(out.status).toBe('cancelled');
  });

  it('sets the webhook for the partner that owns the key', async () => {
    const { ctl, keys } = make();
    await ctl.setWebhook({ url: 'https://x.co/h' }, req);
    expect(keys.setWebhookForIntegrator).toHaveBeenCalledWith('int1', 'https://x.co/h');
  });

  it('is behind the integrator guard, so a missing or foreign key is rejected', () => {
    const guards = Reflect.getMetadata('__guards__', PartnerApiController) as unknown[];
    expect(guards).toContain(IntegratorGuard);
  });
});

describe('IntegratorGuard scope check', () => {
  const run = (scopes: string[]) => {
    const integrators = { findActiveByRawKey: jest.fn().mockResolvedValue({ id: 'i', scopes }) };
    const reflector = { get: () => 'batches:write' };
    const guard = new IntegratorGuard(integrators as never, reflector as never);
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer lft_live_x' } }) }), getHandler: () => ({}) };
    return guard.canActivate(ctx as never);
  };
  it('refuses a key that only has the widget scope', async () => {
    await expect(run(['portal:token'])).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('lets a key with batches:write through', async () => {
    await expect(run(['portal:token', 'batches:write'])).resolves.toBe(true);
  });
});
