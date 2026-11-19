import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '@/modules/users/users.service';
import { isValidSolanaAddress } from '@/common/solana-address';
import { assertSafePublicUrl } from '@/common/assert-safe-public-url';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { tokenAccountExists } from '@/common/token-account-exists';
import { SolanaSponsorService } from '@/modules/claims/solana-sponsor.service';
import { CreatePartnerDto, RecipientInputDto, UpdatePartnerDto, UpdatePartnerSettingsDto } from './dto/partner.dto';
import { MAX_PARTNER_FEE_SHARE, computePartnerFeeUsdc } from './partner-fee';
import { PartnerPermission, PartnerRole, can, canAssignRole, canModifyMember } from './partner-roles';

export interface Partner {
  id: string;
  org_id: string;
  owner_user_id: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
  description: string | null;
  legal_name: string | null;
  country: string | null;
  website: string | null;
  contact_email: string | null;
  kyb_status: string;
  withdraw_min_usd: number;
  fee_fixed_usd: number;
  fee_percent_bps: number;
  fee_wallet: string | null;
  fee_wallet_pending: string | null;
  fee_wallet_effective_at: string | null;
  approval_threshold_usd: number;
  integrator_id: string | null;
  recipients_pull_url: string | null;
  status: string;
  treasury_multisig: string | null;
  treasury_vault: string | null;
  treasury_threshold: number | null;
}

/** What anyone (a recipient on the withdraw page, the widget) may see about a partner. */
export interface PublicPartner {
  org_id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  brand_color: string | null;
  withdraw_min_usd: number;
  fee_fixed_usd: number;
  fee_percent_bps: number;
}

export interface Membership {
  partner: Partner;
  member: { id: string; user_id: string; role: PartnerRole };
}

const PUBLIC_COLUMNS = 'org_id, name, description, logo_url, brand_color, withdraw_min_usd, fee_fixed_usd, fee_percent_bps';
export const MAX_MEMBERS = 25;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FEE_WALLET_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export { MAX_PARTNER_FEE_SHARE, computePartnerFeeUsdc };

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class PartnersService {
  private readonly logger = new Logger(PartnersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    private readonly sponsor: SolanaSponsorService,
  ) {}

  /**
   * Fees are paid straight to the partner's wallet inside each withdrawal, and we never create a
   * token account for a wallet we do not control. So the wallet must already hold a USDC account
   * before it can be set. Sending it any amount of USDC creates one.
   */
  async assertFeeWalletReady(wallet: string): Promise<void> {
    const devnet = isSolanaDevnetFromConfig(this.config);
    const mint = new PublicKey(
      devnet
        ? this.config.get<string>('SOLANA_USDC_MINT_DEVNET') || '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
        : this.config.get<string>('SOLANA_USDC_MINT_MAINNET') || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    );
    const ata = await getAssociatedTokenAddress(mint, new PublicKey(wallet), true);
    const conn = this.sponsor.getConnectionForCluster(devnet ? 'devnet' : 'mainnet');
    if (!(await tokenAccountExists(conn, ata))) {
      throw new BadRequestException('That wallet has no USDC account yet. Send it any amount of USDC first, then set it as your fee wallet.');
    }
  }

  // ---------------------------------------------------------------- audit

  /** Append-only record of who did what. Never throws: a logging failure must not block the action. */
  async audit(partnerId: string, actorUserId: string | null, action: string, target?: { type: string; id: string }, metadata: Record<string, unknown> = {}) {
    const { error } = await this.supabase.partnerAuditLog.insert({
      partner_id: partnerId,
      actor_user_id: actorUserId,
      action,
      target_type: target?.type ?? null,
      target_id: target?.id ?? null,
      metadata,
    });
    if (error) this.logger.error(`AUDIT WRITE FAILED partner=${partnerId} action=${action}: ${error.message}`);
  }

  // ---------------------------------------------------------- membership

  /**
   * The ONE way a partner endpoint learns who the caller is within an org. Looks the membership up
   * fresh on every call (so removal is immediate) and answers "not found" for both a missing org
   * and a non-member, so org ids cannot be probed.
   */
  async requireMembership(orgId: string, userId: string, permission: PartnerPermission): Promise<Membership> {
    const { data: partner } = await this.supabase.partners.select('*').eq('org_id', orgId).maybeSingle();
    if (!partner) throw new NotFoundException('Partner not found.');
    const { data: member } = await this.supabase.partnerMembers
      .select('id, user_id, role')
      .eq('partner_id', partner.id)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (!member) throw new NotFoundException('Partner not found.');
    if (!can(member.role as PartnerRole, permission)) throw new ForbiddenException('Your role does not allow this.');
    if ((partner as Partner).status !== 'active') throw new ForbiddenException('This partner account is suspended.');
    const promoted = await this.promoteFeeWalletIfDue(partner as Partner);
    return { partner: promoted, member: member as Membership['member'] };
  }

  /** The partner's own settings for the portal. Members only; never includes webhook secrets. */
  async getSettings(orgId: string, userId: string) {
    const { partner, member } = await this.requireMembership(orgId, userId, 'view');
    return {
      org_id: partner.org_id,
      name: partner.name,
      logo_url: partner.logo_url,
      brand_color: partner.brand_color,
      description: partner.description,
      legal_name: partner.legal_name,
      country: partner.country,
      website: partner.website,
      contact_email: partner.contact_email,
      kyb_status: partner.kyb_status,
      withdraw_min_usd: Number(partner.withdraw_min_usd),
      fee_fixed_usd: Number(partner.fee_fixed_usd),
      fee_percent_bps: partner.fee_percent_bps,
      fee_wallet: partner.fee_wallet,
      fee_wallet_pending: partner.fee_wallet_pending,
      fee_wallet_effective_at: partner.fee_wallet_effective_at,
      approval_threshold_usd: Number(partner.approval_threshold_usd),
      recipients_pull_url: partner.recipients_pull_url,
      my_role: member.role,
    };
  }

  async orgIdForIntegrator(integratorId: string): Promise<string> {
    const { data } = await this.supabase.partners.select('org_id').eq('integrator_id', integratorId).maybeSingle();
    if (!data) throw new NotFoundException('Partner not found.');
    return data.org_id as string;
  }

  async listMine(userId: string) {
    const { data } = await this.supabase.partnerMembers
      .select('role, partners!inner(org_id, name, logo_url, status)')
      .eq('user_id', userId)
      .eq('status', 'active');
    return (data ?? []).map((m) => {
      const p = (m as unknown as { partners: { org_id: string; name: string; logo_url: string | null; status: string } }).partners;
      return { org_id: p.org_id, name: p.name, logo_url: p.logo_url, status: p.status, role: m.role as PartnerRole };
    });
  }

  async create(ownerUserId: string, dto: CreatePartnerDto): Promise<Partner> {
    if (dto.logo_url) assertSafePublicUrl(dto.logo_url, 'logo_url');
    const { data: existing } = await this.supabase.partners.select('id').eq('owner_user_id', ownerUserId).maybeSingle();
    if (existing) throw new ConflictException('You already have a partner account.');
    const { data, error } = await this.supabase.partners
      .insert({ org_id: `org_${randomBytes(6).toString('hex')}`, owner_user_id: ownerUserId, name: dto.name.trim(), logo_url: dto.logo_url ?? null })
      .select('*')
      .single();
    if (error || !data) throw new BadRequestException('Could not create partner account.');
    const { error: memberErr } = await this.supabase.partnerMembers.insert({
      partner_id: data.id, user_id: ownerUserId, role: 'owner', status: 'active', accepted_at: new Date().toISOString(),
    });
    if (memberErr) {
      // An org with no owner member would be unmanageable: undo it rather than leave it behind.
      await this.supabase.partners.delete().eq('id', data.id);
      throw new BadRequestException('Could not create partner account.');
    }
    await this.audit(data.id, ownerUserId, 'partner.created', { type: 'partner', id: data.id });
    return data as Partner;
  }

  async findPublicByOrgId(orgId: string): Promise<PublicPartner> {
    const { data } = await this.supabase.partners.select(PUBLIC_COLUMNS).eq('org_id', orgId).eq('status', 'active').maybeSingle();
    if (!data) throw new NotFoundException('Partner not found.');
    return data as unknown as PublicPartner;
  }

  async findById(id: string): Promise<Partner | null> {
    const { data } = await this.supabase.partners.select('*').eq('id', id).maybeSingle();
    return (data as Partner | null) ?? null;
  }

  // ------------------------------------------------------------ settings

  async update(orgId: string, userId: string, dto: UpdatePartnerDto): Promise<Partner> {
    const { partner } = await this.requireMembership(orgId, userId, 'settings.manage');
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (!Object.keys(patch).length) return partner;
    // We fetch recipients_pull_url from our servers, and show logo_url to recipients: both must be public https.
    if (dto.recipients_pull_url) assertSafePublicUrl(dto.recipients_pull_url, 'recipients_pull_url');
    if (dto.logo_url) assertSafePublicUrl(dto.logo_url, 'logo_url');
    const { data, error } = await this.supabase.partners.update(patch).eq('id', partner.id).select('*').single();
    if (error || !data) throw new BadRequestException('Could not update partner account.');
    await this.audit(partner.id, userId, 'partner.updated', { type: 'partner', id: partner.id }, { fields: Object.keys(patch) });
    return data as Partner;
  }

  /**
   * The first time an OWNER funds a batch, their funding wallet becomes the fee wallet, so the
   * partner earns without a separate setup step. It only ever fills an empty slot: an existing or
   * pending fee wallet is never touched, and a payer or admin funding a batch never sets it, so
   * redirecting fees stays an owner action behind the cooling-off period. The wallet must already
   * hold a USDC account, which a funding wallet does.
   */
  async adoptFundingWalletAsFeeWallet(partner: Partner, role: PartnerRole, actorUserId: string, wallet: string): Promise<void> {
    // The company wallet is the partner's own multisig, so any member's payout may default fees to it.
    // A personal wallet is only ever adopted when an owner funds with it.
    if ((role !== 'owner' && wallet !== partner.treasury_vault) || partner.fee_wallet || partner.fee_wallet_pending) return;
    try {
      await this.assertFeeWalletReady(wallet);
    } catch {
      return; // no USDC account yet: leave the fee wallet empty rather than failing the batch
    }
    const { data } = await this.supabase.partners
      .update({ fee_wallet: wallet })
      .eq('id', partner.id)
      .is('fee_wallet', null)
      .is('fee_wallet_pending', null)
      .select('id');
    if (data?.length) await this.audit(partner.id, actorUserId, 'fee_wallet.defaulted_to_funding_wallet', { type: 'partner', id: partner.id }, { wallet });
  }

  /** Applies a pending fee-wallet change once its cooling-off period has passed. Conditional, so it only ever runs once. */
  async promoteFeeWalletIfDue(partner: Partner): Promise<Partner> {
    if (!partner.fee_wallet_pending || !partner.fee_wallet_effective_at) return partner;
    if (new Date(partner.fee_wallet_effective_at).getTime() > Date.now()) return partner;
    const { data } = await this.supabase.partners
      .update({ fee_wallet: partner.fee_wallet_pending, fee_wallet_pending: null, fee_wallet_effective_at: null })
      .eq('id', partner.id)
      .eq('fee_wallet_pending', partner.fee_wallet_pending)
      .select('*')
      .maybeSingle();
    if (data) {
      await this.audit(partner.id, null, 'fee_wallet.change_applied', { type: 'partner', id: partner.id }, { to: partner.fee_wallet_pending });
      return data as Partner;
    }
    return { ...partner, fee_wallet: partner.fee_wallet_pending, fee_wallet_pending: null, fee_wallet_effective_at: null };
  }

  async updateSettings(orgId: string, userId: string, dto: UpdatePartnerSettingsDto): Promise<Partner> {
    const touchesTreasury = dto.fee_wallet !== undefined || dto.approval_threshold_usd !== undefined;
    // Money destination and the approval threshold are owner-only; the fee numbers are admin-level.
    const { partner } = await this.requireMembership(orgId, userId, touchesTreasury ? 'treasury.manage' : 'settings.manage');

    const patch: Record<string, unknown> = {};
    if (dto.withdraw_min_usd !== undefined) patch.withdraw_min_usd = dto.withdraw_min_usd;
    if (dto.fee_fixed_usd !== undefined) patch.fee_fixed_usd = dto.fee_fixed_usd;
    if (dto.fee_percent_bps !== undefined) patch.fee_percent_bps = dto.fee_percent_bps;
    if (dto.approval_threshold_usd !== undefined) patch.approval_threshold_usd = dto.approval_threshold_usd;

    let walletChange: { from: string | null; to: string; immediate: boolean } | null = null;
    const requested = dto.fee_wallet?.trim();
    if (requested) {
      if (!isValidSolanaAddress(requested)) throw new BadRequestException('fee_wallet is not a valid Solana address.');
      if (requested !== partner.fee_wallet) {
        await this.assertFeeWalletReady(requested);
        if (!partner.fee_wallet) {
          // First-ever wallet: nothing earned yet that could be redirected, so it applies now.
          patch.fee_wallet = requested;
          walletChange = { from: null, to: requested, immediate: true };
        } else {
          patch.fee_wallet_pending = requested;
          patch.fee_wallet_effective_at = new Date(Date.now() + FEE_WALLET_COOLDOWN_MS).toISOString();
          walletChange = { from: partner.fee_wallet, to: requested, immediate: false };
        }
      }
    }

    const fixed = Number(patch.fee_fixed_usd ?? partner.fee_fixed_usd);
    const bps = Number(patch.fee_percent_bps ?? partner.fee_percent_bps);
    const hasWallet = Boolean(patch.fee_wallet ?? partner.fee_wallet);
    if ((fixed > 0 || bps > 0) && !hasWallet) {
      throw new BadRequestException('Set fee_wallet before charging a fee, so we know where to send it.');
    }
    if (!Object.keys(patch).length) return partner;

    const { data, error } = await this.supabase.partners.update(patch).eq('id', partner.id).select('*').single();
    if (error || !data) throw new BadRequestException('Could not update settings.');
    await this.audit(partner.id, userId, 'settings.updated', { type: 'partner', id: partner.id }, {
      fields: Object.keys(patch).filter((k) => !k.startsWith('fee_wallet')),
      ...(walletChange ? { fee_wallet: walletChange } : {}),
    });
    return data as Partner;
  }

  /** Owner cancels a not-yet-effective fee wallet change (the "that wasn't me" button). */
  async cancelFeeWalletChange(orgId: string, userId: string): Promise<Partner> {
    const { partner } = await this.requireMembership(orgId, userId, 'treasury.manage');
    const { data } = await this.supabase.partners
      .update({ fee_wallet_pending: null, fee_wallet_effective_at: null })
      .eq('id', partner.id)
      .select('*')
      .single();
    await this.audit(partner.id, userId, 'fee_wallet.change_cancelled', { type: 'partner', id: partner.id }, { cancelled: partner.fee_wallet_pending });
    return data as Partner;
  }

  // ---------------------------------------------------------------- team

  async listMembers(orgId: string, userId: string) {
    const { partner } = await this.requireMembership(orgId, userId, 'view');
    const { data } = await this.supabase.partnerMembers
      .select('id, user_id, email, role, status, invited_by, invite_expires_at, accepted_at, created_at')
      .eq('partner_id', partner.id)
      .neq('status', 'removed')
      .order('created_at', { ascending: true });
    return data ?? [];
  }

  /**
   * Creates a pending invite and returns its link token ONCE. Only a hash is stored. The invitee
   * must log in with the invited email verified on their account to accept, so a leaked link is
   * useless to anyone else.
   */
  async invite(orgId: string, userId: string, email: string, role: PartnerRole) {
    const { partner, member } = await this.requireMembership(orgId, userId, 'members.manage');
    if (!canAssignRole(member.role, role)) throw new ForbiddenException('You cannot invite someone to that role.');
    const normalized = email.trim().toLowerCase();

    const { count } = await this.supabase.partnerMembers
      .select('id', { count: 'exact', head: true })
      .eq('partner_id', partner.id)
      .in('status', ['active', 'invited']);
    if ((count ?? 0) >= MAX_MEMBERS) throw new BadRequestException(`A team can have at most ${MAX_MEMBERS} members and pending invites.`);

    const { data: already } = await this.supabase.partnerMembers
      .select('id, status, user_id')
      .eq('partner_id', partner.id)
      .ilike('email', normalized)
      .in('status', ['active', 'invited'])
      .maybeSingle();
    if (already) throw new ConflictException('That email is already on the team or has a pending invite.');

    const token = randomBytes(32).toString('base64url');
    const { data, error } = await this.supabase.partnerMembers
      .insert({
        partner_id: partner.id, email: normalized, role, status: 'invited', invited_by: userId,
        invite_token_hash: sha256(token), invite_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      })
      .select('id')
      .single();
    if (error || !data) throw new BadRequestException('Could not create the invite.');
    await this.audit(partner.id, userId, 'member.invited', { type: 'member', id: data.id }, { email: normalized, role });
    return { member_id: data.id, token, expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString() };
  }

  /** Invitee accepts. Identity comes from the verified login, never from the request. */
  async acceptInvite(userId: string, token: string) {
    // One message for every failure so a token cannot be told apart from a used/expired one.
    const invalid = new BadRequestException('This invite is invalid or has expired.');
    if (!token || token.length > 200) throw invalid;
    const { data: invite } = await this.supabase.partnerMembers
      .select('id, partner_id, email, role, invite_expires_at')
      .eq('invite_token_hash', sha256(token))
      .eq('status', 'invited')
      .maybeSingle();
    if (!invite || !invite.invite_expires_at || new Date(invite.invite_expires_at).getTime() < Date.now()) throw invalid;

    const emailMatches = await this.users.verifyRecipientIdentityForSendPayment(userId, 'email', invite.email as string);
    if (!emailMatches) {
      throw new ForbiddenException('Log in with the email address this invite was sent to.');
    }

    // Already a member under another row? Then this invite is redundant.
    const { data: existing } = await this.supabase.partnerMembers
      .select('id').eq('partner_id', invite.partner_id).eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (existing) throw new ConflictException('You are already on this team.');

    // First write wins: the status guard plus the row count stop a double-accept race.
    const { data: rows, error } = await this.supabase.partnerMembers
      .update({ user_id: userId, status: 'active', accepted_at: new Date().toISOString(), invite_token_hash: null, invite_expires_at: null })
      .eq('id', invite.id)
      .eq('status', 'invited')
      .select('id');
    if (error || !rows?.length) throw invalid;
    await this.audit(invite.partner_id as string, userId, 'member.accepted', { type: 'member', id: invite.id as string }, { role: invite.role });
    return { org_id: (await this.findById(invite.partner_id as string))?.org_id, role: invite.role as PartnerRole };
  }

  async revokeInvite(orgId: string, userId: string, memberId: string) {
    const { partner, member } = await this.requireMembership(orgId, userId, 'members.manage');
    const { data: target } = await this.supabase.partnerMembers
      .select('id, role, email').eq('id', memberId).eq('partner_id', partner.id).eq('status', 'invited').maybeSingle();
    if (!target) throw new NotFoundException('Invite not found.');
    if (!canModifyMember(member.role, target.role as PartnerRole)) throw new ForbiddenException('You cannot revoke that invite.');
    await this.supabase.partnerMembers
      .update({ status: 'removed', removed_at: new Date().toISOString(), removed_by: userId, invite_token_hash: null, invite_expires_at: null })
      .eq('id', target.id).eq('status', 'invited');
    await this.audit(partner.id, userId, 'member.invite_revoked', { type: 'member', id: target.id }, { email: target.email });
  }

  private async activeOwnerCount(partnerId: string): Promise<number> {
    const { count } = await this.supabase.partnerMembers
      .select('id', { count: 'exact', head: true }).eq('partner_id', partnerId).eq('role', 'owner').eq('status', 'active');
    return count ?? 0;
  }

  async changeRole(orgId: string, userId: string, memberId: string, newRole: PartnerRole) {
    const { partner, member } = await this.requireMembership(orgId, userId, 'members.manage');
    const { data: target } = await this.supabase.partnerMembers
      .select('id, user_id, role, wallet_address').eq('id', memberId).eq('partner_id', partner.id).eq('status', 'active').maybeSingle();
    if (!target) throw new NotFoundException('Member not found.');
    if (target.user_id === userId) throw new ForbiddenException('You cannot change your own role.');
    if (target.wallet_address) throw new ConflictException('This person is a signer of the company wallet. Remove them as a signer under Wallet first, then change their role.');
    if (!canModifyMember(member.role, target.role as PartnerRole) || !canAssignRole(member.role, newRole)) {
      throw new ForbiddenException('You cannot make that change.');
    }
    if (target.role === 'owner' && newRole !== 'owner' && (await this.activeOwnerCount(partner.id)) <= 1) {
      throw new BadRequestException('A team needs at least one owner.');
    }
    // Guarded on the role we read, so two admins racing cannot clobber each other.
    const { data: rows } = await this.supabase.partnerMembers
      .update({ role: newRole }).eq('id', target.id).eq('role', target.role).eq('status', 'active').select('id');
    if (!rows?.length) throw new ConflictException('That member changed while you were editing. Refresh and try again.');
    await this.audit(partner.id, userId, 'member.role_changed', { type: 'member', id: target.id }, { from: target.role, to: newRole });
  }

  async removeMember(orgId: string, userId: string, memberId: string) {
    const { partner, member } = await this.requireMembership(orgId, userId, 'view'); // anyone may leave; manage rights checked below
    const { data: target } = await this.supabase.partnerMembers
      .select('id, user_id, role, wallet_address').eq('id', memberId).eq('partner_id', partner.id).eq('status', 'active').maybeSingle();
    if (!target) throw new NotFoundException('Member not found.');
    // A removed person must not keep the power to sign for the company wallet directly on-chain.
    if (target.wallet_address) throw new ConflictException('This person is a signer of the company wallet. Remove them as a signer under Wallet first, then remove them from the team.');
    const leaving = target.user_id === userId;
    if (!leaving && (!can(member.role, 'members.manage') || !canModifyMember(member.role, target.role as PartnerRole))) {
      throw new ForbiddenException('You cannot remove that member.');
    }
    if (target.role === 'owner' && (await this.activeOwnerCount(partner.id)) <= 1) {
      throw new BadRequestException('A team needs at least one owner. Make someone else an owner first.');
    }
    const { data: rows } = await this.supabase.partnerMembers
      .update({ status: 'removed', removed_at: new Date().toISOString(), removed_by: userId })
      .eq('id', target.id).eq('status', 'active').select('id');
    if (!rows?.length) throw new ConflictException('That member was already removed.');
    await this.audit(partner.id, userId, leaving ? 'member.left' : 'member.removed', { type: 'member', id: target.id }, { role: target.role });
  }

  async listAudit(orgId: string, userId: string, limit = 100) {
    const { partner } = await this.requireMembership(orgId, userId, 'members.manage');
    const { data } = await this.supabase.partnerAuditLog
      .select('id, created_at, actor_user_id, action, target_type, target_id, metadata')
      .eq('partner_id', partner.id)
      .order('id', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 500));
    return data ?? [];
  }

  // ---------------------------------------------------------- recipients

  private normalize(r: RecipientInputDto) {
    const email = r.email?.trim().toLowerCase() || null;
    const handle = r.handle?.trim().replace(/^@/, '') || null;
    const platform = handle ? r.handle_platform ?? null : null;
    if (handle && !platform) throw new Error('handle_platform is required with a handle');
    if (!email && !handle) throw new Error('needs an email or a handle');
    return {
      external_user_id: r.external_user_id?.trim() || null,
      display_name: r.name?.trim() || null,
      email,
      handle,
      handle_platform: platform,
      metadata: r.metadata ?? {},
    };
  }

  /** Create or update recipients. A bad row is reported and skipped; it never fails the whole import. */
  async importRecipients(orgId: string, userId: string, rows: RecipientInputDto[]) {
    const { partner } = await this.requireMembership(orgId, userId, 'recipients.manage');
    let created = 0;
    let updated = 0;
    const errors: Array<{ row: number; error: string }> = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const n = this.normalize(rows[i]);
        let existingId: string | undefined;
        if (n.external_user_id) {
          const { data } = await this.supabase.partnerRecipients.select('id').eq('partner_id', partner.id).eq('external_user_id', n.external_user_id).maybeSingle();
          existingId = data?.id;
        }
        if (!existingId && n.email) {
          const { data } = await this.supabase.partnerRecipients.select('id').eq('partner_id', partner.id).ilike('email', n.email).maybeSingle();
          existingId = data?.id;
        }
        if (!existingId && n.handle) {
          const { data } = await this.supabase.partnerRecipients.select('id').eq('partner_id', partner.id).eq('handle_platform', n.handle_platform).ilike('handle', n.handle).maybeSingle();
          existingId = data?.id;
        }
        if (existingId) {
          // Scoped to this partner even though existingId came from a partner-scoped query.
          await this.supabase.partnerRecipients.update(n).eq('id', existingId).eq('partner_id', partner.id);
          updated++;
        } else {
          const { error } = await this.supabase.partnerRecipients.insert({ ...n, partner_id: partner.id });
          if (error) throw new Error('could not save');
          created++;
        }
      } catch (e) {
        errors.push({ row: i, error: (e as Error).message });
      }
    }
    await this.audit(partner.id, userId, 'recipients.imported', undefined, { created, updated, failed: errors.length });
    return { created, updated, failed: errors.length, errors };
  }

  async listRecipients(orgId: string, userId: string, limit = 200, offset = 0) {
    const { partner } = await this.requireMembership(orgId, userId, 'view');
    const { data } = await this.supabase.partnerRecipients
      .select('id, external_user_id, display_name, email, handle_platform, handle, metadata, loofta_user_id, created_at')
      .eq('partner_id', partner.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + Math.min(limit, 500) - 1);

    // How much each person has been paid (funded payouts only), matched by email or handle.
    const { data: pays } = await this.supabase.payments
      .select('amount, status, recipient_email, recipient_address, partner_withdrawn_at')
      .eq('partner_id', partner.id)
      .limit(5000);
    const paid = new Map<string, number>();
    for (const p of pays ?? []) {
      if (!p.partner_withdrawn_at && !['PRIVATE_TRANSFER_PENDING', 'SUCCESS'].includes(String(p.status).toUpperCase())) continue;
      const addr = String(p.recipient_address ?? '');
      const key = p.recipient_email ? String(p.recipient_email).toLowerCase() : addr.startsWith('PENDING_SOCIAL:') ? addr.slice('PENDING_SOCIAL:'.length).toLowerCase() : null;
      if (key) paid.set(key, (paid.get(key) ?? 0) + (Number(p.amount) || 0));
    }
    return (data ?? []).map((r) => {
      const key = r.email ? String(r.email).toLowerCase() : r.handle_platform && r.handle ? `${r.handle_platform}:${String(r.handle).toLowerCase()}` : null;
      return { ...r, paid_usd: key ? Math.round((paid.get(key) ?? 0) * 100) / 100 : 0 };
    });
  }

  /**
   * Resolve one of the PARTNER'S OWN recipients to its Loofta user id. Only people the partner has
   * already imported are findable, so this cannot be used to probe who has a Loofta account.
   */
  async lookupRecipient(orgId: string, userId: string, q: { externalUserId?: string; email?: string; handle?: string; platform?: string }) {
    const { partner } = await this.requireMembership(orgId, userId, 'view');
    let query = this.supabase.partnerRecipients.select('id, external_user_id, loofta_user_id').eq('partner_id', partner.id);
    if (q.externalUserId) query = query.eq('external_user_id', q.externalUserId);
    else if (q.email) query = query.ilike('email', q.email.trim().toLowerCase());
    else if (q.handle && q.platform) query = query.eq('handle_platform', q.platform).ilike('handle', q.handle.trim().replace(/^@/, ''));
    else throw new BadRequestException('Pass external_user_id, email, or handle with platform.');
    const { data } = await query.maybeSingle();
    if (!data) throw new NotFoundException('Recipient not found. Import them first.');
    return { recipient_id: data.id, external_user_id: data.external_user_id, loofta_user_id: data.loofta_user_id ?? null };
  }
}
