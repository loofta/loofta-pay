import { Keypair } from '@solana/web3.js';
import { CompressError } from '@/common/light-compression.service';
import { PartnerCompressionService } from './partner-compression.service';

type Row = Record<string, unknown>;

/** A tiny in-memory stand-in for one supabase table. Supports just what the service uses. */
function table(rows: Row[]) {
  return () => {
    let mode: 'select' | 'update' = 'select';
    let patch: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    const q: Record<string, unknown> = {};
    const run = () => {
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') hit.forEach((r) => Object.assign(r, patch));
      return hit;
    };
    q.select = () => q;
    q.update = (p: Row) => { mode = 'update'; patch = p; return q; };
    q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; };
    q.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return q; };
    q.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; };
    q.order = () => q;
    q.limit = () => q;
    q.maybeSingle = async () => ({ data: run()[0] ?? null, error: null });
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: run(), error: null }).then(res);
    return q;
  };
}

function setup(opts: { count?: number; status?: string; preset?: Record<string, { sig: string; last?: number }>; outcome?: Record<string, string>; staged?: bigint; fail?: (ids: string[]) => 'definite' | 'unknown' | null; msPerChunk?: number } = {}) {
  let clock = 5_000_000;
  if (opts.msPerChunk) jest.spyOn(Date, 'now').mockImplementation(() => clock);
  const count = opts.count ?? 20;
  const ids = Array.from({ length: count }, (_, i) => `p${i}`);
  const payments: Row[] = ids.map((id) => ({ id, amount: 1, compress_sig: opts.preset?.[id]?.sig ?? null, compress_last_valid_block_height: opts.preset?.[id]?.last ?? null }));
  const items: Row[] = ids.map((id) => ({ batch_id: 'b1', payment_id: id, status: 'created' }));
  const proposals: Row[] = [{ id: 'prop1', partner_id: 'pt1', batch_id: 'b1', payment_ids: ids, created_by_user_id: 'u1', compress_attempts: 0, compress_status: 'pending' }];
  const tables: Record<string, () => unknown> = {
    payments: table(payments),
    payoutBatchItems: table(items),
    partnerTreasuryProposals: table(proposals),
    partners: table([{ id: 'pt1' }]),
  };
  const supabase = new Proxy({}, { get: (_t, k: string) => { if (!tables[k]) throw new Error(`unexpected table ${k}`); return tables[k](); } });

  const events: string[] = [];
  const funded: string[] = [];
  const payouts = {
    recordFunded: jest.fn(async (_b: string, id: string, sig: string) => {
      const item = items.find((i) => i.payment_id === id)!;
      if (item.status !== 'created') return false;
      item.status = 'funded';
      funded.push(`${id}:${sig}`);
      return true;
    }),
    closeBatchIfFunded: jest.fn(async () => { events.push('closed'); }),
  };
  const treasury = { refreshProposalStatus: jest.fn(async () => opts.status ?? 'executed') };
  const claims = {
    getPartnerPayoutTargets: jest.fn(async (claimIds: string[]) => claimIds.map((claimId) => ({ claimId, burner: `burner_${claimId}`, baseUnits: 1_000_000, status: 'PENDING', cluster: 'mainnet', mint: '11111111111111111111111111111111' }))),
  };
  let sent = 0;
  const light = {
    signatureOutcome: jest.fn(async (_c: string, sig: string) => opts.outcome?.[sig] ?? 'unknown'),
    compressChunk: jest.fn(async (_c: string, _m: unknown, _kp: unknown, _ata: unknown, targets: Array<{ burner: string }>, record: (s: string, h: number) => Promise<void>) => {
      const sig = `sig${sent++}`;
      await record(sig, 999);
      clock += opts.msPerChunk ?? 0;
      const mode = opts.fail?.(targets.map((x) => x.burner.replace('burner_', '')));
      if (mode === 'definite') throw new CompressError('failed on chain', true, sig);
      if (mode === 'unknown') throw new CompressError('not confirmed yet', false, sig);
      events.push(`sent:${targets.length}`);
      return sig;
    }),
  };
  const feePayer = Keypair.generate();
  const sponsor = {
    getFeePayerKeypair: () => feePayer,
    getConnectionForCluster: () => ({ getTokenAccountBalance: async () => ({ value: { amount: String(opts.staged ?? BigInt(1_000_000_000)) } }) }),
  };
  const redis = { withLock: async (_k: string, fn: () => Promise<unknown>) => fn() };
  const config = { get: () => undefined };
  const svc = new PartnerCompressionService(supabase as never, config as never, redis as never, claims as never, sponsor as never, light as never, treasury as never, payouts as never);
  return { svc, proposals, payments, items, payouts, treasury, claims, light, events, funded };
}

describe('compressed funding', () => {
  it('waits while the proposal has not executed, and sends nothing', async () => {
    const t = setup({ status: 'active' });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.light.compressChunk).not.toHaveBeenCalled();
    expect(t.proposals[0].compress_status).toBe('pending');
  });

  it('marks a proposal that was rejected or cancelled as skipped: nothing was staged', async () => {
    const t = setup({ status: 'rejected' });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.proposals[0].compress_status).toBe('skipped');
    expect(t.light.compressChunk).not.toHaveBeenCalled();
  });

  it('funds 20 payouts in two transactions (15 then 5), saves signatures first, then closes the batch', async () => {
    const t = setup({ count: 20 });
    await t.svc.processProposal(t.proposals[0] as never);
    // two transactions may be in flight together, so only the facts that do not depend on order are checked
    expect([...t.events].sort()).toEqual(['closed', 'sent:15', 'sent:5']);
    expect(t.events[t.events.length - 1]).toBe('closed');
    expect(t.funded).toHaveLength(20);
    const sigOf = (id: string) => t.funded.find((x) => x.startsWith(id + ':'))!.split(':')[1];
    expect(new Set([...Array(15).keys()].map((i) => sigOf('p' + i))).size).toBe(1); // the first 15 share one transaction
    expect(new Set([...Array(5).keys()].map((i) => sigOf('p' + (15 + i)))).size).toBe(1); // the last 5 share another
    expect(sigOf('p0')).not.toBe(sigOf('p19'));
    expect(t.proposals[0].compress_status).toBe('done');
    // every payout carries the signature of the transaction that funded it
    expect(t.payments.filter((p) => p.compress_sig === 'sig0')).toHaveLength(15);
  });

  it('funds a whole batch of 1,000 payouts in a row: 67 transactions in one run', async () => {
    const t = setup({ count: 1000, staged: BigInt(5_000_000_000) });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.light.compressChunk).toHaveBeenCalledTimes(67);
    expect(t.funded).toHaveLength(1000);
    expect(t.proposals[0].compress_status).toBe('done');
    expect(new Set(t.funded.map((x) => x.split(':')[0])).size).toBe(1000); // nobody funded twice
  });

  it('stops at its time budget and the next run carries on, never funding anyone twice', async () => {
    const t = setup({ count: 400, staged: BigInt(5_000_000_000), msPerChunk: 60_000 }); // each transaction "takes" a minute
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.funded.length).toBeGreaterThan(0);
    expect(t.funded.length).toBeLessThan(400);
    expect(t.proposals[0].compress_status).toBe('pending');
    for (let i = 0; i < 10 && t.proposals[0].compress_status !== 'done'; i++) await t.svc.processProposal(t.proposals[0] as never);
    expect(t.funded).toHaveLength(400);
    expect(new Set(t.funded.map((x) => x.split(':')[0])).size).toBe(400);
  });

  it('when a group cannot go through it tries smaller groups until it does', async () => {
    // anything bigger than 4 payouts is refused (too big for the network)
    const t = setup({ count: 15, fail: (ids) => (ids.length > 4 ? 'definite' : null) });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.funded).toHaveLength(15);
    expect(t.proposals[0].compress_status).toBe('done');
    const sizes = t.light.compressChunk.mock.calls.map((c: unknown[]) => (c[4] as unknown[]).length);
    expect(sizes[0]).toBe(15);
    expect(Math.max(...sizes.slice(1))).toBeLessThan(15);
    // every burner got exactly one successful transaction
    expect(new Set(t.funded.map((x) => x.split(':')[0])).size).toBe(15);
  });

  it('one payout that can never be compressed does not hold back the others, and is reported', async () => {
    const t = setup({ count: 15, fail: (ids) => (ids.includes('p7') ? 'definite' : null) });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.funded).toHaveLength(14);
    expect(t.funded.some((x) => x.startsWith('p7:'))).toBe(false);
    expect(t.payments.find((p) => p.id === 'p7')!.compress_sig).toBeNull(); // freed, so a later run can try again
    expect(String(t.proposals[0].compress_error)).toContain('1 payout');
    expect(t.proposals[0].compress_attempts).toBe(1);
    expect(t.proposals[0].compress_status).toBe('running');
  });

  it('a failure that might still land is NOT retried in smaller groups, and keeps its saved signature', async () => {
    const t = setup({ count: 15, fail: () => 'unknown' });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.light.compressChunk).toHaveBeenCalledTimes(1);
    expect(t.funded).toHaveLength(0);
    expect(t.payments.every((p) => p.compress_sig === 'sig0')).toBe(true);
    expect(t.proposals[0].compress_attempts).toBe(1);
  });

  it('never funds twice: a second run after success sends nothing', async () => {
    const t = setup({ count: 3 });
    await t.svc.processProposal(t.proposals[0] as never);
    t.proposals[0].compress_status = 'pending';
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.light.compressChunk).toHaveBeenCalledTimes(1);
  });

  it('a saved signature that landed is recorded as funded and is NOT sent again', async () => {
    const t = setup({ count: 3, preset: { p0: { sig: 'S1', last: 10 }, p1: { sig: 'S1', last: 10 }, p2: { sig: 'S1', last: 10 } }, outcome: { S1: 'landed' } });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.light.compressChunk).not.toHaveBeenCalled();
    expect(t.funded).toEqual(['p0:S1', 'p1:S1', 'p2:S1']);
  });

  it('a saved signature that might still land blocks everything: no second transaction', async () => {
    const t = setup({ count: 3, preset: { p0: { sig: 'S1', last: 10 } }, outcome: { S1: 'unknown' } });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.light.compressChunk).not.toHaveBeenCalled();
    expect(t.funded).toHaveLength(0);
  });

  it('a saved signature that expired is cleared and those payouts are sent again', async () => {
    const t = setup({ count: 2, preset: { p0: { sig: 'S1', last: 10 }, p1: { sig: 'S1', last: 10 } }, outcome: { S1: 'expired' } });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.light.compressChunk).toHaveBeenCalledTimes(1);
    expect(t.funded).toEqual(['p0:sig0', 'p1:sig0']);
  });

  it('refuses to compress when staging holds less than needed, and counts the attempt', async () => {
    const t = setup({ count: 3, staged: BigInt(1_000_000) });
    await t.svc.processProposal(t.proposals[0] as never);
    expect(t.light.compressChunk).not.toHaveBeenCalled();
    expect(t.proposals[0].compress_attempts).toBe(1);
    expect(String(t.proposals[0].compress_error)).toContain('staging holds');
    expect(t.proposals[0].compress_status).toBe('running');
  });
});
