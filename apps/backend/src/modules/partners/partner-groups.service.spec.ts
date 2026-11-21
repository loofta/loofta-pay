import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { PartnerGroupsService } from './partner-groups.service';

jest.mock('@/common/safe-https-get', () => ({ safeHttpsGet: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { safeHttpsGet } = require('@/common/safe-https-get') as { safeHttpsGet: jest.Mock };

/** A chainable stand-in for one supabase table. Every call is recorded; results are set per test. */
function table(result: { data?: unknown; thenData?: unknown; error?: unknown; count?: number } = {}) {
  const calls: Array<[string, unknown[]]> = [];
  const t: Record<string, unknown> = {};
  const chain = new Proxy(t, {
    get(_, key: string) {
      if (key === 'then') return (resolve: (v: unknown) => void) => resolve({ data: result.thenData ?? result.data ?? null, error: result.error ?? null, count: result.count ?? 0 });
      return (...args: unknown[]) => {
        calls.push([key, args]);
        if (key === 'maybeSingle' || key === 'single') return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
        return chain;
      };
    },
  });
  return { chain, calls, result };
}

function harness(opts: { membership?: 'ok' | 'forbidden'; group?: unknown; slot?: unknown[]; current?: unknown[] } = {}) {
  // one table for the groups: a single-row read returns the group, an awaited update returns the claimed sync slot
  const groups = table({ data: opts.group ?? null, thenData: opts.slot ?? [{ id: 'g1' }] });
  const members = table({ data: opts.current ?? [] });
  const recipients = table({ data: [] });
  const supabase = {
    partnerRecipientGroups: groups.chain,
    partnerRecipientGroupMembers: members.chain,
    partnerRecipients: recipients.chain,
  };
  const partners = {
    requireMembership: jest.fn(async () => {
      if (opts.membership === 'forbidden') throw new ForbiddenException('Your role does not allow this.');
      return { partner: { id: 'p1' }, member: { id: 'm1', user_id: 'u1', role: 'owner' } };
    }),
    audit: jest.fn(async () => undefined),
    upsertRecipientRows: jest.fn(async () => ({ created: 0, updated: 0, ids: ['r1'], errors: [] })),
  };
  const svc = new PartnerGroupsService(supabase as never, partners as never);
  return { svc, partners, members, groups };
}

describe('PartnerGroupsService access', () => {
  beforeEach(() => safeHttpsGet.mockReset());

  it('a role without recipients.manage can not create, change, delete or sync, and nothing else runs', async () => {
    const h = harness({ membership: 'forbidden' });
    await expect(h.svc.create('org', 'u', { name: 'VIPs' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.svc.update('org', 'u', 'g1', { name: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.svc.remove('org', 'u', 'g1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.svc.addMembers('org', 'u', 'g1', { recipient_ids: [] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.svc.sync('org', 'u', 'g1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(safeHttpsGet).not.toHaveBeenCalled();
    expect(h.groups.calls).toHaveLength(0);
  });

  it("another company's group id is simply not found", async () => {
    const h = harness({ group: null });
    await expect(h.svc.members('org', 'u', 'g-other')).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.svc.sync('org', 'u', 'g-other')).rejects.toBeInstanceOf(NotFoundException);
    // the lookup was filtered by the caller's own partner
    expect(h.groups.calls.some(([k, a]) => k === 'eq' && a[0] === 'partner_id' && a[1] === 'p1')).toBe(true);
  });

  it('rejects an unsafe link when the group is created', async () => {
    const h = harness();
    await expect(h.svc.create('org', 'u', { name: 'VIPs', source_url: 'https://169.254.169.254/latest' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.svc.create('org', 'u', { name: 'VIPs', source_url: 'http://example.com/list' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never returns the linked URL, only its host', async () => {
    const h = harness({ group: { id: 'g1', partner_id: 'p1', name: 'VIPs', source_url: 'https://feed.example.com/list?token=SECRET', created_at: 'x' } });
    const out = await h.svc.members('org', 'u', 'g1');
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(out.group.source_host).toBe('feed.example.com');
  });
});

describe('PartnerGroupsService sync', () => {
  const group = { id: 'g1', partner_id: 'p1', name: 'VIPs', source_url: 'https://feed.example.com/list', created_at: 'x' };
  beforeEach(() => safeHttpsGet.mockReset());

  it('refuses a group that is not linked', async () => {
    const h = harness({ group: { ...group, source_url: null } });
    await expect(h.svc.sync('org', 'u', 'g1')).rejects.toThrow(/not linked/);
  });

  it('refuses a second read inside the cooldown and does not fetch', async () => {
    const h = harness({ group, slot: [] });
    await expect(h.svc.sync('org', 'u', 'g1')).rejects.toBeInstanceOf(HttpException);
    expect(safeHttpsGet).not.toHaveBeenCalled();
  });

  it('an empty or invalid list leaves the group exactly as it was', async () => {
    const h = harness({ group, current: [{ recipient_id: 'r9' }] });
    safeHttpsGet.mockResolvedValue({ contentType: 'application/json', body: '[]' });
    await expect(h.svc.sync('org', 'u', 'g1')).rejects.toThrow(/no valid people/);
    expect(h.members.calls.some(([k]) => k === 'delete')).toBe(false);
    expect(h.partners.upsertRecipientRows).not.toHaveBeenCalled();
  });

  it('a failed read leaves the group as it was', async () => {
    const h = harness({ group, current: [{ recipient_id: 'r9' }] });
    safeHttpsGet.mockRejectedValue(new BadRequestException('Could not read that URL.'));
    await expect(h.svc.sync('org', 'u', 'g1')).rejects.toBeInstanceOf(BadRequestException);
    expect(h.members.calls.some(([k]) => k === 'delete')).toBe(false);
  });

  it('a good read adds the new people and drops the ones no longer listed', async () => {
    const h = harness({ group, current: [{ recipient_id: 'r9' }] });
    safeHttpsGet.mockResolvedValue({ contentType: 'application/json', body: JSON.stringify([{ email: 'a@b.co' }]) });
    const out = await h.svc.sync('org', 'u', 'g1');
    expect(out).toMatchObject({ people: 1, added: 1, removed: 1 });
    expect(h.members.calls.some(([k]) => k === 'delete')).toBe(true);
  });
});
