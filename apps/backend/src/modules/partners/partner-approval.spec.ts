import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

jest.mock('@/modules/claims/solana-sponsor.service', () => ({ SolanaSponsorService: class {} }));
jest.mock('@/modules/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@/modules/email/email.service', () => ({ EmailService: class {} }));

import { PartnersService } from './partners.service';
import { PartnerAdminService } from './partner-admin.service';
import { FakeDb, fakeSupabase } from './payout-vault.fakes';

const setup = (status: string) => {
  const db = new FakeDb();
  db.rows('partners').push({ id: 'p1', org_id: 'org_a', owner_user_id: 'u1', name: 'Acme', status, fee_wallet_pending: null });
  db.rows('partner_members').push({ id: 'm1', partner_id: 'p1', user_id: 'u1', role: 'owner', status: 'active' });
  const supabase = fakeSupabase(db) as never;
  const partners = new PartnersService(supabase, {} as never, { get: () => undefined } as never, {} as never);
  return { db, partners, admin: new PartnerAdminService(supabase, partners) };
};

describe('a company must be approved before it can do anything', () => {
  it('blocks a pending company from every action that needs an active one', async () => {
    const { partners } = setup('pending');
    await expect(partners.requireMembership('org_a', 'u1', 'keys.manage')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(partners.requireMembership('org_a', 'u1', 'payout.create')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(partners.requireMembership('org_a', 'u1', 'members.manage')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a pending or rejected company see and complete its application only', async () => {
    for (const status of ['pending', 'rejected']) {
      const { partners } = setup(status);
      await expect(partners.requireMembership('org_a', 'u1', 'view', { allowUnapproved: true })).resolves.toBeTruthy();
    }
  });

  it('never lets a suspended company through, even for the application view', async () => {
    const { partners } = setup('suspended');
    await expect(partners.requireMembership('org_a', 'u1', 'view', { allowUnapproved: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps branding locked until approval so nobody can pose as another company', async () => {
    const { partners } = setup('pending');
    await expect(partners.update('org_a', 'u1', { logo_url: 'https://evil.example/logo.png' } as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(partners.update('org_a', 'u1', { name: 'Stripe' } as never)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(partners.update('org_a', 'u1', { use_case: 'We pay 200 freelancers every month for design work.' } as never)).resolves.toBeTruthy();
  });

  it('a non-member still gets not found', async () => {
    const { partners } = setup('pending');
    await expect(partners.requireMembership('org_a', 'stranger', 'view', { allowUnapproved: true })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not show a pending company on the public withdraw page', async () => {
    const { partners } = setup('pending');
    await expect(partners.findPublicByOrgId('org_a')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('admin review', () => {
  it('approves a pending company and records who and when', async () => {
    const { db, admin } = setup('pending');
    await expect(admin.review('p1', 'approve', 'admin1')).resolves.toEqual({ id: 'p1', status: 'active' });
    expect(db.rows('partners')[0]).toMatchObject({ status: 'active', reviewed_by: 'admin1' });
    expect(db.rows('partner_audit_log').some((r) => r.action === 'partner.approve')).toBe(true);
  });

  it('needs a note to reject or suspend', async () => {
    const a = setup('pending');
    await expect(a.admin.review('p1', 'reject', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(a.admin.review('p1', 'reject', 'admin1', 'Unclear what you pay for')).resolves.toMatchObject({ status: 'rejected' });
    const b = setup('active');
    await expect(b.admin.review('p1', 'suspend', 'admin1', '  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(b.admin.review('p1', 'suspend', 'admin1', 'Complaint received')).resolves.toMatchObject({ status: 'suspended' });
  });

  it('cannot approve a company that is not pending, or suspend one that is not active', async () => {
    await expect(setup('suspended').admin.review('p1', 'approve', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup('pending').admin.review('p1', 'suspend', 'admin1', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('can reinstate a suspended company', async () => {
    const { db, admin } = setup('suspended');
    await admin.review('p1', 'reinstate', 'admin1');
    expect(db.rows('partners')[0].status).toBe('active');
  });

  it('answers not found for an unknown company', async () => {
    await expect(setup('pending').admin.review('nope', 'approve', 'admin1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
