import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '@/database/supabase.service';
import { PayrollOrganizationsService } from './payroll-organizations.service';
import { CreateContributorDto, UpdateContributorDto, PayrollContributor, ContributorStatus, OnboardContributorDto } from './dto';

export interface InviteInfo {
  organizationName: string;
  organizationId: string;
  contributorId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

// Network-specific address validation patterns (use lowercase keys; add aliases like "sol" for "solana")
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NETWORK_ADDRESS_PATTERNS: Record<string, RegExp> = {
  ethereum: /^0x[a-fA-F0-9]{40}$/,
  base: /^0x[a-fA-F0-9]{40}$/,
  optimism: /^0x[a-fA-F0-9]{40}$/,
  arbitrum: /^0x[a-fA-F0-9]{40}$/,
  polygon: /^0x[a-fA-F0-9]{40}$/,
  avalanche: /^0x[a-fA-F0-9]{40}$/,
  bsc: /^0x[a-fA-F0-9]{40}$/,
  solana: SOLANA_ADDRESS,
  sol: SOLANA_ADDRESS, // alias used by token list / frontend
  near: /^[a-z0-9_-]+\.near$|^[a-f0-9]{64}$/,
  bitcoin: /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/,
};

@Injectable()
export class PayrollContributorsService {
  private readonly logger = new Logger(PayrollContributorsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly payrollOrgsService: PayrollOrganizationsService,
  ) {}

  /**
   * Validate wallet address matches network
   */
  private validateWalletAddress(address: string, network: string): boolean {
    const trimmed = (address || '').trim();
    const pattern = NETWORK_ADDRESS_PATTERNS[network?.toLowerCase()];
    if (!pattern) {
      // Default to EVM pattern for unknown networks
      return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
    }
    return pattern.test(trimmed);
  }

  /**
   * Add a contributor to an organization
   */
  async create(organizationId: string, dto: CreateContributorDto, userId: string): Promise<PayrollContributor> {
    // Verify access
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    // Validate wallet address if provided
    if (dto.walletAddress && dto.network) {
      if (!this.validateWalletAddress(dto.walletAddress, dto.network)) {
        throw new BadRequestException(`Wallet address format is invalid for ${dto.network} network`);
      }
    }

    const inviteToken = randomBytes(24).toString('base64url');
    const { data, error } = await this.supabaseService.getClient()
      .from('payroll_contributors')
      .insert({
        organization_id: organizationId,
        email: dto.email.toLowerCase(),
        first_name: dto.firstName || null,
        last_name: dto.lastName || null,
        wallet_address: dto.walletAddress || null,
        network: dto.network || null,
        token_symbol: dto.tokenSymbol || null,
        department: dto.department || null,
        status: 'invited',
        invited_at: new Date().toISOString(),
        invite_token: inviteToken,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new BadRequestException('A contributor with this email already exists in this organization');
      }
      this.logger.error('Failed to create contributor:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Created contributor ${data.id} for org ${organizationId}`);
    return data;
  }

  /**
   * Get all contributors for an organization
   */
  async findAll(organizationId: string, userId: string, status?: ContributorStatus): Promise<PayrollContributor[]> {
    // Verify access
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    let query = this.supabaseService.getClient()
      .from('payroll_contributors')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    } else {
      // By default, exclude 'removed'
      query = query.neq('status', 'removed');
    }

    const { data, error } = await query;

    if (error) {
      this.logger.error('Failed to fetch contributors:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get a single contributor
   */
  async findOne(organizationId: string, contributorId: string, userId: string): Promise<PayrollContributor> {
    // Verify access
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('payroll_contributors')
      .select('*')
      .eq('id', contributorId)
      .eq('organization_id', organizationId)
      .single();

    if (error || !data) {
      throw new NotFoundException('Contributor not found');
    }

    return data;
  }

  /**
   * Update a contributor
   */
  async update(
    organizationId: string,
    contributorId: string,
    dto: UpdateContributorDto,
    userId: string,
  ): Promise<PayrollContributor> {
    // Verify access
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    // Validate wallet address if updating
    if (dto.walletAddress && dto.network) {
      if (!this.validateWalletAddress(dto.walletAddress, dto.network)) {
        throw new BadRequestException(`Wallet address format is invalid for ${dto.network} network`);
      }
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.firstName !== undefined) updateData.first_name = dto.firstName;
    if (dto.lastName !== undefined) updateData.last_name = dto.lastName;
    if (dto.walletAddress !== undefined) updateData.wallet_address = dto.walletAddress;
    if (dto.network !== undefined) updateData.network = dto.network;
    if (dto.tokenSymbol !== undefined) updateData.token_symbol = dto.tokenSymbol;
    if (dto.department !== undefined) updateData.department = dto.department;
    if (dto.status !== undefined) {
      updateData.status = dto.status;
      if (dto.status === 'joined') {
        updateData.joined_at = new Date().toISOString();
      }
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('payroll_contributors')
      .update(updateData)
      .eq('id', contributorId)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update contributor:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  }

  /**
   * Remove a contributor (soft delete)
   */
  async remove(organizationId: string, contributorId: string, userId: string): Promise<void> {
    // Verify access
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    const { error } = await this.supabaseService.getClient()
      .from('payroll_contributors')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('id', contributorId)
      .eq('organization_id', organizationId);

    if (error) {
      this.logger.error('Failed to remove contributor:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Removed contributor ${contributorId} from org ${organizationId}`);
  }

  /**
   * Permanently delete a contributor
   */
  async delete(organizationId: string, contributorId: string, userId: string): Promise<void> {
    // Verify access
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    const { error } = await this.supabaseService.getClient()
      .from('payroll_contributors')
      .delete()
      .eq('id', contributorId)
      .eq('organization_id', organizationId);

    if (error) {
      this.logger.error('Failed to delete contributor:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Permanently deleted contributor ${contributorId}`);
  }

  /**
   * Bulk invite contributors
   */
  async bulkInvite(
    organizationId: string,
    contributors: Array<{ email: string; firstName?: string; lastName?: string }>,
    userId: string,
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    // Verify access
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    const results = { created: 0, skipped: 0, errors: [] as string[] };

    for (const contrib of contributors) {
      try {
        await this.create(organizationId, {
          email: contrib.email,
          firstName: contrib.firstName,
          lastName: contrib.lastName,
        }, userId);
        results.created++;
      } catch (e: any) {
        if (e?.message?.includes('already exists')) {
          results.skipped++;
        } else {
          results.errors.push(`${contrib.email}: ${e?.message}`);
        }
      }
    }

    return results;
  }

  /**
   * Get invite details by token (public, for invite landing page)
   */
  async getInviteByToken(token: string): Promise<InviteInfo | null> {
    const { data: contrib, error: contribError } = await this.supabaseService.getClient()
      .from('payroll_contributors')
      .select('id, organization_id, email, first_name, last_name, status')
      .eq('invite_token', token)
      .neq('status', 'removed')
      .single();

    if (contribError || !contrib) return null;

    const { data: org, error: orgError } = await this.supabaseService.getClient()
      .from('payroll_organizations')
      .select('name')
      .eq('id', contrib.organization_id)
      .single();

    if (orgError || !org) return null;

    return {
      organizationName: org.name,
      organizationId: contrib.organization_id,
      contributorId: contrib.id,
      email: contrib.email,
      firstName: contrib.first_name,
      lastName: contrib.last_name,
    };
  }

  /**
   * Complete onboarding via invite token (set wallet + optional username)
   */
  async onboardByToken(token: string, dto: OnboardContributorDto): Promise<PayrollContributor> {
    const invite = await this.getInviteByToken(token);
    if (!invite) throw new NotFoundException('Invalid or expired invite link');

    const walletAddress = (dto.walletAddress || '').trim();
    if (!this.validateWalletAddress(walletAddress, dto.network)) {
      throw new BadRequestException(`Wallet address format is invalid for ${dto.network}`);
    }

    const { data, error } = await this.supabaseService.getClient()
      .from('payroll_contributors')
      .update({
        wallet_address: walletAddress,
        network: dto.network,
        token_symbol: dto.tokenSymbol,
        status: 'joined',
        joined_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // Keep invite_token so link can be used again to update wallet if needed
      })
      .eq('invite_token', token)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to onboard contributor:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Onboarded contributor ${invite.contributorId} via invite`);
    return data;
  }

  /**
   * Generate or get invite link for a contributor (for managers to send invite)
   */
  async getOrCreateInviteLink(organizationId: string, contributorId: string, userId: string, baseUrl: string): Promise<{ inviteLink: string; inviteToken: string }> {
    if (!(await this.payrollOrgsService.checkAccess(organizationId, userId))) {
      throw new ForbiddenException('You do not have access to this organization');
    }

    const { data: contrib, error: fetchError } = await this.supabaseService.getClient()
      .from('payroll_contributors')
      .select('id, invite_token')
      .eq('id', contributorId)
      .eq('organization_id', organizationId)
      .single();

    if (fetchError || !contrib) throw new NotFoundException('Contributor not found');

    let token = contrib.invite_token;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      await this.supabaseService.getClient()
        .from('payroll_contributors')
        .update({
          invite_token: token,
          invite_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', contributorId)
        .eq('organization_id', organizationId);
    }

    const inviteLink = `${baseUrl.replace(/\/$/, '')}/payroll/invite/${token}`;
    return { inviteLink, inviteToken: token };
  }
}
