import { BadRequestException } from '@nestjs/common';
import { PartnerPayoutsService } from './partner-payouts.service';

type Pay = { id: string; status: string; partner_withdrawn_at: string | null };

function make(opts: { items: Array<{ payment_id: string | null; status: string }>; payments: Pay[]; failing?: string[]; vault?: string | null }) {
  const refunded: string[] = [];
  const audit = jest.fn();
  const partner = { id: 'pt1', treasury_vault: opts.vault === undefined ? 'VAULT' : opts.vault };
  const claims = {
    refundPartnerPayout: jest.fn(async (id: string) => {
      if (opts.failing?.includes(id)) throw new BadRequestException('This payout is being withdrawn right now.');
      refunded.push(id);
      return { amountUsdc: 1, txHash: `tx_${id}` };
    }),
  };
  const supabase = {
    payments: {
      select: () => ({ in: () => ({ eq: async () => ({ data: opts.payments, error: null }) }) }),
    },
  };
  const svc = new PartnerPayoutsService(supabase as never, { requireMembership: async () => ({ partner }), audit } as never, claims as never, {} as never, {} as never, {} as never);
  jest.spyOn(svc as never as { getOwnedBatch: () => Promise<unknown> }, 'getOwnedBatch').mockResolvedValue({ id: 'b1' } as never);
  jest.spyOn(svc as never as { getItems: () => Promise<unknown> }, 'getItems').mockResolvedValue(opts.items as never);
  return { svc, refunded, claims, audit };
}

const funded = (id: string): { payment_id: string; status: string } => ({ payment_id: id, status: 'funded' });
const pay = (id: string, status = 'SUCCESS', withdrawn: string | null = null): Pay => ({ id, status, partner_withdrawn_at: withdrawn });

describe('taking back payouts of a batch', () => {
  it('with no list it takes back every funded payout, one by one', async () => {
    const t = make({ items: [funded('a'), funded('b'), funded('c')], payments: [pay('a'), pay('b'), pay('c')] });
    const out = await t.svc.cancelBatchPayouts('org', 'u1', 'b1');
    expect(t.refunded).toEqual(['a', 'b', 'c']);
    expect(out.refunded_usdc).toBe(3);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(t.audit).toHaveBeenCalledTimes(3);
  });

  it('with a list it takes back only those', async () => {
    const t = make({ items: [funded('a'), funded('b'), funded('c')], payments: [pay('a'), pay('b'), pay('c')] });
    await t.svc.cancelBatchPayouts('org', 'u1', 'b1', ['b']);
    expect(t.refunded).toEqual(['b']);
  });

  it('ignores a payment that is not in this batch', async () => {
    const t = make({ items: [funded('a')], payments: [pay('a')] });
    await expect(t.svc.cancelBatchPayouts('org', 'u1', 'b1', ['someone-elses'])).rejects.toBeInstanceOf(BadRequestException);
    expect(t.claims.refundPartnerPayout).not.toHaveBeenCalled();
  });

  it('skips payouts already withdrawn or already cancelled instead of failing', async () => {
    const t = make({ items: [funded('a'), funded('b'), funded('c')], payments: [pay('a', 'SUCCESS', '2026-11-23T10:00:00Z'), pay('b', 'CANCELLED'), pay('c')] });
    await t.svc.cancelBatchPayouts('org', 'u1', 'b1');
    expect(t.refunded).toEqual(['c']);
  });

  it('one payout failing does not stop the rest, and its error is reported', async () => {
    const t = make({ items: [funded('a'), funded('b'), funded('c')], payments: [pay('a'), pay('b'), pay('c')], failing: ['b'] });
    const out = await t.svc.cancelBatchPayouts('org', 'u1', 'b1');
    expect(t.refunded).toEqual(['a', 'c']);
    expect(out.results.find((r) => r.payment_id === 'b')).toMatchObject({ ok: false, error: expect.stringContaining('withdrawn right now') });
    expect(out.refunded_usdc).toBe(2);
  });

  it('says so when there is nothing to take back', async () => {
    const t = make({ items: [{ payment_id: 'a', status: 'created' }], payments: [] });
    await expect(t.svc.cancelBatchPayouts('org', 'u1', 'b1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('needs a company wallet, and sends every refund to it', async () => {
    const t = make({ items: [funded('a')], payments: [pay('a')], vault: null });
    const out = await t.svc.cancelBatchPayouts('org', 'u1', 'b1');
    expect(out.results[0]).toMatchObject({ ok: false, error: 'Create your company wallet first.' });
    const ok = make({ items: [funded('a')], payments: [pay('a')] });
    await ok.svc.cancelBatchPayouts('org', 'u1', 'b1');
    expect(ok.claims.refundPartnerPayout).toHaveBeenCalledWith('a', 'pt1', 'VAULT');
  });
});
