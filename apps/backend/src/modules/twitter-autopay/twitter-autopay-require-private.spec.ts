import { TwitterAutopayService } from './twitter-autopay.service';

function build(user: any | null) {
  const svc: any = Object.create(TwitterAutopayService.prototype);
  svc.usersService = {
    findByTwitterOrUsername: jest.fn(async () => { if (!user) throw new Error('not found'); return user; }),
    findByUsername: jest.fn(async () => { if (!user) throw new Error('not found'); return user; }),
    getSolanaWalletAddress: jest.fn(async () => 'WALLET'),
  };
  return svc as TwitterAutopayService;
}

describe('paying someone who only accepts private payments', () => {
  it('a public request becomes a private one, with private fees', async () => {
    const svc = build({ privyUserId: 'did:privy:r', requirePrivatePayments: true });
    const plan = await svc.planPayment({ kind: 'x', value: 'lisabeyy' }, false, false, 5);
    expect(plan.delivery).toBe('private');
    expect(plan.privateFeeUsd).toBeGreaterThan(0);
  });
  it('someone who accepts public payments is still paid instantly', async () => {
    const svc = build({ privyUserId: 'did:privy:r', requirePrivatePayments: false });
    const plan = await svc.planPayment({ kind: 'x', value: 'lisabeyy' }, false, false, 5);
    expect(plan.delivery).toBe('instant');
    expect(plan.privateFeeUsd).toBe(0);
  });
  it('someone not on Loofta gets a claim link, as before', async () => {
    const svc = build(null);
    const plan = await svc.planPayment({ kind: 'x', value: 'nobody' }, false, false, 5);
    expect(plan.delivery).toBe('claim');
  });
});
