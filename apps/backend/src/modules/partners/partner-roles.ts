export type PartnerRole = 'owner' | 'admin' | 'payer' | 'viewer';

export type PartnerPermission =
  | 'view'              // dashboard, payouts, recipients, earnings
  | 'recipients.manage' // import / edit recipients
  | 'payout.create'     // draft and submit a batch
  | 'payout.approve'    // approve a batch that is over the threshold
  | 'settings.manage'   // branding, withdrawal fees and minimum, webhook, pull URL
  | 'treasury.manage' // earnings destination wallet and the approval threshold (owner only)
  | 'members.manage'    // invite, change role, remove
  | 'keys.manage';      // API keys for server/SDK use

const MATRIX: Record<PartnerRole, ReadonlySet<PartnerPermission>> = {
  owner: new Set(['view', 'recipients.manage', 'payout.create', 'payout.approve', 'settings.manage', 'treasury.manage', 'members.manage', 'keys.manage']),
  admin: new Set(['view', 'recipients.manage', 'payout.create', 'payout.approve', 'settings.manage', 'members.manage', 'keys.manage']),
  payer: new Set(['view', 'payout.create']),
  viewer: new Set(['view']),
};

const RANK: Record<PartnerRole, number> = { owner: 4, admin: 3, payer: 2, viewer: 1 };

export const PARTNER_ROLES = Object.keys(RANK) as PartnerRole[];

export function can(role: PartnerRole, permission: PartnerPermission): boolean {
  return MATRIX[role]?.has(permission) === true;
}

/**
 * Who may grant which role. Only an owner can create another owner; an admin can manage payers and
 * viewers but never an equal or higher role, so nobody can promote themselves or a colleague past
 * their own level.
 */
export function canAssignRole(actor: PartnerRole, target: PartnerRole): boolean {
  if (!can(actor, 'members.manage')) return false;
  if (actor === 'owner') return true;
  return RANK[target] < RANK[actor];
}

/** Who may change or remove a member currently holding `current`. Same ceiling as canAssignRole. */
export function canModifyMember(actor: PartnerRole, current: PartnerRole): boolean {
  return canAssignRole(actor, current);
}
