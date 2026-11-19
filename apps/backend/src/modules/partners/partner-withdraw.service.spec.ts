import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

// spl-token and the claims module do not load under jest here. The withdraw service only needs them for balances and the sweep.
let mockBalances: Record<string, bigint> = {};
jest.mock('@solana/spl-token', () => ({
  getAssociatedTokenAddress: async (_mint: unknown, owner: { toBase58(): string }) => owner.toBase58(),
  getAccount: async (_conn: unknown, ata: string) => {
    if (!(ata in mockBalances)) throw new Error('no account');
    return { amount: mockBalances[ata] };
  },
}));
jest.mock('@/modules/claims/claims.service', () => ({ ClaimsService: class {}, REGISTERED_BURNER_CLAIM_FEE_USD: 0.1 }));
jest.mock('@/modules/claims/solana-sponsor.service', () => ({ SolanaSponsorService: class {} }));
jest.mock('@/modules/partners/partners.service', () => ({ PartnersService: class {} }));

import { PartnerWithdrawService } from './partner-withdraw.service';

const B1 = 'So11111111111111111111111111111111111111112';
const B2 = 'SysvarC1ock11111111111111111111111111111111';
const FEE_WALLET = 'Vote111111111111111111111111111111111111111';

const basePartner = {
  id: 'p1', org_id: 'org_x', status: 'active', withdraw_min_usd: 1,
  fee_fixed_usd: 0.5, fee_percent_bps: 200, fee_wallet: FEE_WALLET,
};

type Pay = { id: string; amount: number; burner_address: string; recipient_user_id: string | null; partner_fee_stamped_at?: string | null };
const pay = (id: string, amount: number, burner: string, registered = false): Pay => ({
  id, amount, burner_address: burner, recipient_user_id: registered ? 'u1' : null,
});

/** A stand-in for the supabase builder. Every call returns itself; awaiting it gives `result`. */
function chain(result: unknown, spy?: (name: string, v: unknown) => void) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit']) c[m] = () => c;
  c.update = (v: unknown) => (spy?.('update', v), c);
  c.maybeSingle = async () => result;
  c.single = async () => result;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

function make(opts: {
  partner?: Record<string, unknown>;
  payments?: Pay[];
  balances?: Record<string, bigint>;
  notRecipient?: string[];
  staleStamp?: string[];
  sweepFails?: string[];
  feeWalletReady?: boolean;
  siblingWithdrawn?: boolean;
  history?: Array<Record<string, unknown>>;
  historyError?: boolean;
} = {}) {
  const partner = { ...basePartner, ...(opts.partner ?? {}) };
  const payments = opts.payments ?? [pay('a', 10, B1)];
  mockBalances = opts.balances ?? { [B1]: BigInt(10_000_000), [B2]: BigInt(10_000_000) };

  const events: string[] = [];
  const stamps: Record<string, Record<string, unknown>> = {};
  let currentId = '';
  const paymentsTable: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'not', 'order', 'limit']) paymentsTable[m] = () => paymentsTable;
  paymentsTable.update = (v: Record<string, unknown>) => { stamps.__pending = v; return paymentsTable; };
  let sibling = false;
  let hist = false;
  const historyFilters: Array<[string, unknown]> = [];
  paymentsTable.in = () => { sibling = true; return paymentsTable; };
  paymentsTable.eq = (col: string, val: string) => {
    if (col === 'id') currentId = val;
    if (col === 'recipient_user_id') { hist = true; historyFilters.push([col, val]); }
    return paymentsTable;
  };
  paymentsTable.then = (res: (v: unknown) => unknown) => {
    if (hist) { hist = false; return Promise.resolve(opts.historyError ? { data: null, error: { message: 'x' } } : { data: opts.history ?? [], error: null }).then(res); }
    if (sibling) { sibling = false; return Promise.resolve({ data: opts.siblingWithdrawn ? [{ id: 'done' }] : [], error: null }).then(res); }
    const isStamp = '__pending' in stamps;
    if (!isStamp) return Promise.resolve({ data: payments, error: null }).then(res);
    const id = currentId; const v = stamps.__pending; delete stamps.__pending;
    if (opts.staleStamp?.includes(id)) return Promise.resolve({ data: [], error: null }).then(res);
    stamps[id] = v; events.push(`stamp:${id}`);
    return Promise.resolve({ data: [{ id }], error: null }).then(res);
  };

  const supabase = {
    partners: chain({ data: partner }),
    payments: paymentsTable,
  };
  const claims = {
    checkIsRecipient: jest.fn(async (id: string) => ({ isRecipient: !opts.notRecipient?.includes(id) })),
    claimAsRecipient: jest.fn(async (id: string) => {
      if (opts.sweepFails?.includes(id)) throw new Error('boom');
      events.push(`sweep:${id}`);
      return { sweepTxHash: `tx_${id}` };
    }),
  };
  const partnersSvc = {
    promoteFeeWalletIfDue: async (p: unknown) => p,
    assertFeeWalletReady: jest.fn(async () => { if (opts.feeWalletReady === false) throw new Error('not ready'); }),
    audit: jest.fn(),
  };
  const sponsor = { getConnectionForCluster: () => ({}) };
  const config = { get: (k: string) => (k === 'SOLANA_CLUSTER' ? 'mainnet-beta' : undefined) };
  const svc = new PartnerWithdrawService(supabase as never, config as never, partnersSvc as never, claims as never, sponsor as never);
  return { svc, events, stamps, claims, partnersSvc, historyFilters };
}

describe('partner withdraw quote', () => {
  it('shows gross, the partner fee, and what the recipient keeps', async () => {
    const { svc } = make({ payments: [pay('a', 10, B1)] });
    const q = await svc.quote('org_x', 'u1');
    // $0.50 flat + 2% of $10 = $0.70
    expect(q.gross_usdc).toBe(10);
    expect(q.partner_fee_usdc).toBeCloseTo(0.7, 6);
    expect(q.net_usdc).toBeCloseTo(9.3, 6);
    expect(q.can_withdraw).toBe(true);
  });

  it('also deducts the Loofta fee for a registered recipient and never goes negative', async () => {
    const { svc } = make({ payments: [pay('a', 10, B1, true)] });
    const q = await svc.quote('org_x', 'u1');
    expect(q.loofta_fee_usdc).toBe(0.1);
    expect(q.net_usdc).toBeCloseTo(9.2, 6);
  });

  it('keeps an unfunded payout in "processing" and does not count it', async () => {
    const { svc } = make({ payments: [pay('a', 10, B1)], balances: {} });
    const q = await svc.quote('org_x', 'u1');
    expect(q.available).toHaveLength(0);
    expect(q.processing).toHaveLength(1);
    expect(q.can_withdraw).toBe(false);
    expect(q.reason).toMatch(/processed/i);
  });

  it('never shows payouts that were sent to someone else', async () => {
    const { svc } = make({ payments: [pay('a', 10, B1), pay('b', 10, B2)], notRecipient: ['b'] });
    const q = await svc.quote('org_x', 'u1');
    expect(q.available.map((p) => p.payment_id)).toEqual(['a']);
  });

  it('refuses below the partner minimum', async () => {
    const { svc } = make({ payments: [pay('a', 0.5, B1)], balances: { [B1]: BigInt(500_000) } });
    const q = await svc.quote('org_x', 'u1');
    expect(q.can_withdraw).toBe(false);
    expect(q.reason).toMatch(/minimum/i);
  });

  it('is unavailable when the partner has a fee but no working fee wallet', async () => {
    const { svc } = make({ partner: { fee_wallet: null } });
    expect((await svc.quote('org_x', 'u1')).can_withdraw).toBe(false);
    const { svc: svc2 } = make({ feeWalletReady: false });
    expect((await svc2.quote('org_x', 'u1')).can_withdraw).toBe(false);
  });

  it('takes no partner fee when the partner is suspended, but the recipient can still withdraw', async () => {
    const { svc } = make({ partner: { status: 'suspended' } });
    const q = await svc.quote('org_x', 'u1');
    expect(q.partner_fee_usdc).toBe(0);
    expect(q.can_withdraw).toBe(true);
    expect(q.net_usdc).toBe(10);
  });
});

describe('partner withdraw confirm', () => {
  it('stamps the fee on a payout BEFORE sweeping it', async () => {
    const { svc, events } = make();
    const out = await svc.confirm('org_x', 'u1', { maxFeeUsdc: 0.7 });
    expect(events).toEqual(['stamp:a', 'sweep:a']);
    expect(out.results).toEqual([{ payment_id: 'a', ok: true, tx: 'tx_a' }]);
  });

  it('stamps the fee wallet and an amount that adds up exactly to the quoted fee', async () => {
    const { svc, stamps } = make({ payments: [pay('a', 3.333333, B1), pay('b', 6.666667, B2)], balances: { [B1]: BigInt(3_333_333), [B2]: BigInt(6_666_667) } });
    const out = await svc.confirm('org_x', 'u1', { maxFeeUsdc: 1 });
    const total = Number(stamps.a.partner_fee_usdc) + Number(stamps.b.partner_fee_usdc);
    expect(Math.round(total * 1e6)).toBe(Math.round(out.partner_fee_usdc * 1e6));
    expect(stamps.a.partner_fee_wallet).toBe(FEE_WALLET);
    expect(stamps.b.partner_fee_wallet).toBe(FEE_WALLET);
  });

  it('refuses, with nothing stamped or swept, when the real fee is higher than the one shown', async () => {
    const { svc, events, claims } = make();
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: 0.5 })).rejects.toBeInstanceOf(ConflictException);
    expect(events).toEqual([]);
    expect(claims.claimAsRecipient).not.toHaveBeenCalled();
  });

  it('refuses a missing or negative max fee, and a bad destination address', async () => {
    const { svc } = make();
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: -1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: Number.NaN })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: 1, destinationAddress: 'not-an-address' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when there is nothing available, and sweeps nothing', async () => {
    const { svc, claims } = make({ balances: {} });
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: 1 })).rejects.toBeInstanceOf(BadRequestException);
    expect(claims.claimAsRecipient).not.toHaveBeenCalled();
  });

  it('does not sweep a payout whose stamp did not apply (already withdrawn), and says so', async () => {
    const { svc, claims } = make({ staleStamp: ['a'] });
    const out = await svc.confirm('org_x', 'u1', { maxFeeUsdc: 1 });
    expect(claims.claimAsRecipient).not.toHaveBeenCalled();
    expect(out.results[0]).toMatchObject({ payment_id: 'a', ok: false });
  });

  it('keeps going when one payout fails, and reports each one', async () => {
    const { svc, events, partnersSvc } = make({
      payments: [pay('a', 5, B1), pay('b', 5, B2)], balances: { [B1]: BigInt(5_000_000), [B2]: BigInt(5_000_000) }, sweepFails: ['a'],
    });
    const out = await svc.confirm('org_x', 'u1', { maxFeeUsdc: 1 });
    expect(out.results.map((r) => r.ok)).toEqual([false, true]);
    expect(events).toContain('sweep:b');
    expect(partnersSvc.audit).toHaveBeenCalledWith('p1', 'u1', 'recipient.withdrew', undefined, expect.objectContaining({ payouts: 2, sent: 1 }));
  });

  it('passes the destination through to the sweep and flags it as a partner withdrawal', async () => {
    const { svc, claims } = make();
    await svc.confirm('org_x', 'u1', { maxFeeUsdc: 1, destinationAddress: B2 });
    expect(claims.claimAsRecipient).toHaveBeenCalledWith('a', 'u1', { viaPartnerWithdraw: true, destinationAddress: B2 });
  });

  it('stamps no fee wallet when the fee is zero', async () => {
    const { svc, stamps } = make({ partner: { fee_fixed_usd: 0, fee_percent_bps: 0 } });
    await svc.confirm('org_x', 'u1', { maxFeeUsdc: 0 });
    expect(stamps.a.partner_fee_usdc).toBe(0);
    expect(stamps.a.partner_fee_wallet).toBeNull();
  });

  it('never lets the partner take more than a quarter, whatever the fees are set to', async () => {
    const { svc, stamps } = make({ partner: { fee_fixed_usd: 50, fee_percent_bps: 5000 } });
    await svc.confirm('org_x', 'u1', { maxFeeUsdc: 100 });
    expect(Number(stamps.a.partner_fee_usdc)).toBeLessThanOrEqual(2.5);
  });
});

describe('partner withdraw when the database is down', () => {
  it('does not pretend there is nothing to withdraw', async () => {
    const { svc } = make();
    (svc as never as { supabase: { payments: unknown } }).supabase.payments = Object.assign(chain({ data: null, error: { message: 'column missing' } }), {});
    await expect(svc.quote('org_x', 'u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('the demo partner (orgId=demo)', () => {
  it('quotes a sample prize with real fee math, without touching the database', async () => {
    const { svc } = make();
    (svc as never as { supabase: unknown }).supabase = new Proxy({}, { get: () => { throw new Error('demo must not use the database'); } });
    const q = await svc.quote('demo', 'u1');
    expect(q.partner.name).toBe('Rally');
    expect(q.gross_usdc).toBe(120);
    // $0.25 flat + 1% of $120
    expect(q.partner_fee_usdc).toBeCloseTo(1.45, 6);
    expect(q.net_usdc).toBeCloseTo(118.55, 6);
    expect(q.can_withdraw).toBe(true);
  });

  it('confirms without sweeping anything or moving money', async () => {
    const { svc, claims, events } = make();
    const out = await svc.confirm('demo', 'u1', { maxFeeUsdc: 2 });
    expect(out.results[0]).toMatchObject({ ok: true });
    expect(claims.claimAsRecipient).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('still validates the destination and the fee ceiling like a real withdrawal', async () => {
    const { svc } = make();
    await expect(svc.confirm('demo', 'u1', { maxFeeUsdc: -1 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.confirm('demo', 'u1', { maxFeeUsdc: 2, destinationAddress: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is a name no real partner can have: real org ids are org_ plus hex', () => {
    expect('demo').not.toMatch(/^org_[0-9a-f]{12}$/);
  });
});

describe('flat fee on a retried withdrawal', () => {
  const retry = (siblingWithdrawn: boolean) =>
    make({ payments: [{ ...pay('b', 10, B1), partner_fee_stamped_at: '2026-11-19T10:00:00.000Z' }], siblingWithdrawn });

  it('is not charged again when a payout of the same withdrawal already went through', async () => {
    const { svc } = retry(true);
    const q = await svc.quote('org_x', 'u1');
    // only the 2% part: $0.20, not $0.50 flat + $0.20
    expect(q.partner_fee_usdc).toBeCloseTo(0.2, 6);
  });

  it('is charged normally when an earlier attempt was stamped but nothing went through', async () => {
    const { svc } = retry(false);
    expect((await svc.quote('org_x', 'u1')).partner_fee_usdc).toBeCloseTo(0.7, 6);
  });

  it('stamps every payout of one withdrawal with the same time so a retry can find its siblings', async () => {
    const { svc, stamps } = make({ payments: [pay('a', 5, B1), pay('b', 5, B2)], balances: { [B1]: BigInt(5_000_000), [B2]: BigInt(5_000_000) } });
    await svc.confirm('org_x', 'u1', { maxFeeUsdc: 1 });
    expect(stamps.a.partner_fee_stamped_at).toBe(stamps.b.partner_fee_stamped_at);
  });

  it('confirm on the retry stamps only the percent fee', async () => {
    const { svc, stamps } = retry(true);
    await svc.confirm('org_x', 'u1', { maxFeeUsdc: 0.2 });
    expect(Number(stamps.b.partner_fee_usdc)).toBeCloseTo(0.2, 6);
  });
});

describe('withdraw history', () => {
  const past = { id: 'old', amount: 50, description: 'Spring', created_at: '2026-10-01T00:00:00Z', partner_withdrawn_at: '2026-10-02T00:00:00Z', partner_fee_usdc: 1.5 };

  it('lists what this recipient already withdrew, scoped to their own user id', async () => {
    const { svc, historyFilters } = make({ history: [past] });
    const q = await svc.quote('org_x', 'u1');
    expect(q.history_enabled).toBe(true);
    expect(q.history).toEqual([{ payment_id: 'old', amount: 50, message: 'Spring', received_at: past.created_at, withdrawn_at: past.partner_withdrawn_at, partner_fee_usdc: 1.5 }]);
    expect(historyFilters).toEqual([['recipient_user_id', 'u1']]);
  });

  it('returns no history, and does not even query it, when the partner hides it', async () => {
    const { svc, historyFilters } = make({ partner: { show_history: false }, history: [past] });
    const q = await svc.quote('org_x', 'u1');
    expect(q.history_enabled).toBe(false);
    expect(q.history).toEqual([]);
    expect(historyFilters).toHaveLength(0);
  });

  it('treats a partner row without the new columns as history on and every route on', async () => {
    const { svc } = make();
    const q = await svc.quote('org_x', 'u1');
    expect(q.history_enabled).toBe(true);
    expect(q.methods).toEqual(['usdc', 'token', 'bank', 'p2p']);
  });

  it('a failed history query is an error, never an empty list', async () => {
    const { svc } = make({ historyError: true });
    await expect(svc.quote('org_x', 'u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('switched-off withdraw methods', () => {
  it('lists only the routes the partner left on', async () => {
    const { svc } = make({ partner: { disabled_withdraw_methods: ['p2p', 'bank'] } });
    expect((await svc.quote('org_x', 'u1')).methods).toEqual(['usdc', 'token']);
  });

  it('refuses a switched-off route and sends nothing', async () => {
    const { svc, events } = make({ partner: { disabled_withdraw_methods: ['p2p'] } });
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: 5, method: 'p2p' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(events).toEqual([]);
  });

  it('refuses a USDC send to an outside wallet when USDC is off, even without a method', async () => {
    const { svc, events } = make({ partner: { disabled_withdraw_methods: ['usdc'] } });
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: 5, destinationAddress: FEE_WALLET })).rejects.toBeInstanceOf(ForbiddenException);
    expect(events).toEqual([]);
  });

  it('refuses claiming into the own wallet when token, bank and p2p are all off', async () => {
    const { svc } = make({ partner: { disabled_withdraw_methods: ['token', 'bank', 'p2p'] } });
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: 5 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still allows an enabled route', async () => {
    const { svc, events } = make({ partner: { disabled_withdraw_methods: ['p2p'] } });
    const out = await svc.confirm('org_x', 'u1', { maxFeeUsdc: 5, method: 'bank' });
    expect(out.results[0].ok).toBe(true);
    expect(events).toContain('sweep:a');
  });

  it('rejects a destination wallet combined with a non-USDC method', async () => {
    const { svc } = make();
    await expect(svc.confirm('org_x', 'u1', { maxFeeUsdc: 5, method: 'bank', destinationAddress: FEE_WALLET })).rejects.toBeInstanceOf(BadRequestException);
  });
});
