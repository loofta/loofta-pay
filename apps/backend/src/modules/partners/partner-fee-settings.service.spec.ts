import { PartnerFeeSettingsService } from './partner-fee-settings.service';

function make(row: unknown, opts: { error?: boolean; throws?: boolean; saveError?: boolean } = {}) {
  const upserts: unknown[] = [];
  let reads = 0;
  const table = {
    select: () => table,
    eq: () => table,
    maybeSingle: async () => {
      reads++;
      if (opts.throws) throw new Error('boom');
      return opts.error ? { data: null, error: { message: 'relation does not exist' } } : { data: row, error: null };
    },
    upsert: async (v: unknown) => {
      upserts.push(v);
      return { error: opts.saveError ? { message: 'x' } : null };
    },
  };
  const svc = new PartnerFeeSettingsService({ partnerPlatformSettings: table } as never);
  return { svc, upserts, reads: () => reads };
}

describe('Loofta fee settings', () => {
  it('reads the saved rates', async () => {
    const { svc } = make({ loofta_fee_flat_usd: '0.07', loofta_fee_bps: 40 });
    expect(await svc.get()).toEqual({ flatUsd: 0.07, bps: 40 });
  });

  it('falls back to $0.05 + 0.3% when the row, the table or the read is missing', async () => {
    expect(await make(null).svc.get()).toEqual({ flatUsd: 0.05, bps: 30 });
    expect(await make(null, { error: true }).svc.get()).toEqual({ flatUsd: 0.05, bps: 30 });
    expect(await make(null, { throws: true }).svc.get()).toEqual({ flatUsd: 0.05, bps: 30 });
  });

  it('ignores saved values that are out of range', async () => {
    expect(await make({ loofta_fee_flat_usd: 50, loofta_fee_bps: 30 }).svc.get()).toEqual({ flatUsd: 0.05, bps: 30 });
    expect(await make({ loofta_fee_flat_usd: 0.05, loofta_fee_bps: 9999 }).svc.get()).toEqual({ flatUsd: 0.05, bps: 30 });
  });

  it('caches reads, and a save clears the cache', async () => {
    const { svc, reads } = make({ loofta_fee_flat_usd: 0.05, loofta_fee_bps: 30 });
    await svc.get();
    await svc.get();
    expect(reads()).toBe(1);
    await svc.set(0.1, 50, 'admin');
    await svc.get();
    expect(reads()).toBe(2);
  });

  it('saves valid rates with who changed them', async () => {
    const { svc, upserts } = make(null);
    expect(await svc.set(0.05, 30, 'did:privy:admin')).toEqual({ flatUsd: 0.05, bps: 30 });
    expect(upserts[0]).toMatchObject({ id: true, loofta_fee_flat_usd: 0.05, loofta_fee_bps: 30, updated_by: 'did:privy:admin' });
  });

  it('refuses a fee above the ceilings, a negative one, or a fractional basis point', async () => {
    const { svc, upserts } = make(null);
    await expect(svc.set(3, 30, 'a')).rejects.toThrow(/flat fee/);
    await expect(svc.set(-1, 30, 'a')).rejects.toThrow(/flat fee/);
    await expect(svc.set(0.05, 301, 'a')).rejects.toThrow(/percentage/);
    await expect(svc.set(0.05, 30.5, 'a')).rejects.toThrow(/percentage/);
    await expect(svc.set(NaN, 30, 'a')).rejects.toThrow(/flat fee/);
    expect(upserts).toEqual([]);
  });

  it('says so when the migration has not been run', async () => {
    const { svc } = make(null, { saveError: true });
    await expect(svc.set(0.05, 30, 'a')).rejects.toThrow(/migration/);
  });
});
