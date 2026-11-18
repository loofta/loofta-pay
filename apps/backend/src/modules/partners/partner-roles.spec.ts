import { can, canAssignRole, canModifyMember } from './partner-roles';

describe('partner roles', () => {
  it('viewers can only view', () => {
    expect(can('viewer', 'view')).toBe(true);
    for (const p of ['payout.create', 'payout.approve', 'settings.manage', 'members.manage', 'treasury.manage', 'keys.manage', 'recipients.manage'] as const) {
      expect(can('viewer', p)).toBe(false);
    }
  });

  it('payers can draft batches but cannot approve, change settings or manage people', () => {
    expect(can('payer', 'payout.create')).toBe(true);
    expect(can('payer', 'payout.approve')).toBe(false);
    expect(can('payer', 'settings.manage')).toBe(false);
    expect(can('payer', 'members.manage')).toBe(false);
  });

  it('only the owner can change where earnings go or the approval threshold', () => {
    expect(can('owner', 'treasury.manage')).toBe(true);
    expect(can('admin', 'treasury.manage')).toBe(false);
  });

  it('admins cannot create or touch an owner or another admin', () => {
    expect(canAssignRole('admin', 'owner')).toBe(false);
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canModifyMember('admin', 'owner')).toBe(false);
    expect(canModifyMember('admin', 'admin')).toBe(false);
    expect(canAssignRole('admin', 'payer')).toBe(true);
    expect(canModifyMember('admin', 'viewer')).toBe(true);
  });

  it('payers and viewers manage nobody', () => {
    expect(canAssignRole('payer', 'viewer')).toBe(false);
    expect(canAssignRole('viewer', 'viewer')).toBe(false);
  });

  it('owners can manage every role', () => {
    for (const r of ['owner', 'admin', 'payer', 'viewer'] as const) expect(canAssignRole('owner', r)).toBe(true);
  });
});
