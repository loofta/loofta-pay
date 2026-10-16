import { BadRequestException } from '@nestjs/common';
import { TwitterAutopayService, ResolvedPayer } from './twitter-autopay.service';

// Chainable supabase stub: every builder method returns the same object, awaiting it (or
// maybeSingle) yields the canned result registered for that table.
function stub(results: Record<string, any>) {
  const builder = (table: string): any => {
    const b: any = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === 'then') return (res: any) => res(results[table] ?? { data: [], error: null });
        if (prop === 'maybeSingle') return async () => results[table] ?? { data: null, error: null };
        return () => b;
      },
    });
    return b;
  };
  return {
    twitterAutopayEnrollments: builder('enrollments'),
    twitterAutopayApprovers: builder('approvers'),
    getClient: () => ({ from: (t: string) => builder(t) }),
  } as any;
}

const payer: ResolvedPayer = {
  enrollmentId: 'e1', userId: 'u1', ownerHandle: 'acme', approverHandle: 'maria',
  signerGranted: true, perPaymentCapUsd: 25, dailyCapUsd: 100,
};

function svc(results: Record<string, any>, env: Record<string, string> = {}) {
  const config: any = { get: (k: string, d?: any) => env[k] ?? d };
  return new TwitterAutopayService(stub(results), config, {} as any, {} as any, {} as any, {} as any);
}

describe('TwitterAutopayService limits', () => {
  it('rejects a payment over the per-payment cap', async () => {
    await expect(svc({}).assertWithinLimits(payer, 26)).rejects.toThrow(/per-payment limit/);
  });

  it('allows a payment under both caps', async () => {
    await expect(svc({ twitter_payment_requests: { data: [{ amount_usd: 20 }] } }).assertWithinLimits(payer, 10)).resolves.toBeUndefined();
  });

  it('rejects when 24h spend plus this payment passes the daily cap', async () => {
    const s = svc({ twitter_payment_requests: { data: [{ amount_usd: 60 }, { amount_usd: 35 }], error: null } });
    await expect(s.assertWithinLimits(payer, 10)).rejects.toThrow(/daily limit/);
  });

  it('allows spending right up to the daily cap', async () => {
    const s = svc({ twitter_payment_requests: { data: [{ amount_usd: 90 }], error: null } });
    await expect(s.assertWithinLimits(payer, 10)).resolves.toBeUndefined();
  });

  it('validates limit updates', async () => {
    const s = svc({}, { TWITTER_AUTOPAY_OPEN: 'true' });
    await expect(s.updateLimits('u1', { perPaymentCapUsd: 0, dailyCapUsd: 10 })).rejects.toThrow(BadRequestException);
    await expect(s.updateLimits('u1', { perPaymentCapUsd: 50, dailyCapUsd: 10 })).rejects.toThrow(/higher than the daily/);
    await expect(s.updateLimits('u1', { perPaymentCapUsd: 5, dailyCapUsd: 99999 })).rejects.toThrow(/Daily limit/);
  });

  it('never lets an approver spend treasury-funded actions', async () => {
    expect(await svc({}).canSpendTreasury(payer)).toBe(false);
  });
});
