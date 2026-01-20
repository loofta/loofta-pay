import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { PayrollOrganizationsService } from './payroll-organizations.service';
import { CreateContributorDto, UpdateContributorDto, PayrollContributor, ContributorStatus } from './dto';

// Network-specific address validation patterns
const NETWORK_ADDRESS_PATTERNS: Record<string, RegExp> = {
  ethereum: /^0x[a-fA-F0-9]{40}$/,
  base: /^0x[a-fA-F0-9]{40}$/,
  optimism: /^0x[a-fA-F0-9]{40}$/,
  arbitrum: /^0x[a-fA-F0-9]{40}$/,
  polygon: /^0x[a-fA-F0-9]{40}$/,
  avalanche: /^0x[a-fA-F0-9]{40}$/,
  bsc: /^0x[a-fA-F0-9]{40}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
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
    const pattern = NETWORK_ADDRESS_PATTERNS[network.toLowerCase()];
    if (!pattern) {
      // Default to EVM pattern for unknown networks
      return /^0x[a-fA-F0-9]{40}$/.test(address);
    }
    return pattern.test(address);
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
}
