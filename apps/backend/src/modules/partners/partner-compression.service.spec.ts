import { Keypair } from '@solana/web3.js';
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

function setup(opts: { count?: number; status?: string; preset?: Record<string, { sig: string; last?: number }>; outcome?: Record<string, string>; staged?: bigint } = {}) {
  const count = opts.count ?? 20;
  const ids = Array.from({ length: count }, (_, i) => `p${i}`);
  const payments: Row[] = ids.map((id) => ({ id, compress_sig: opts.preset?.[id]?.sig ?? null, compress_last_valid_block_height: opts.preset?.[id]?.last ?? null }));
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
    expect(t.events).toEqual(['sent:15', 'sent:5', 'closed']);
    expect(t.funded).toHaveLength(20);
    expect(t.funded[0]).toBe('p0:sig0');
    expect(t.funded[19]).toBe('p19:sig1');
    expect(t.proposals[0].compress_status).toBe('done');
    // every payout carries the signature of the transaction that funded it
    expect(t.payments.filter((p) => p.compress_sig === 'sig0')).toHaveLength(15);
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
