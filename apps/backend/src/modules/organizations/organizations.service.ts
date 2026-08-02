import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { ClaimsService } from '../claims/claims.service';
import { IntegratorsService } from '../integrators/integrators.service';
import { CreateOrganizationDto, UpdateOrganizationDto, CreateCheckoutSessionDto, UpdateOrganizationSelfServeDto } from './dto';
import { Organization } from './entities/organization.entity';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly claimsService: ClaimsService,
    private readonly integratorsService: IntegratorsService,
  ) {}

  /**
   * Generate a unique referral code for organizations
   */
  private generateOrgReferral(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'org_';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * List all organizations
   */
  async findAll(): Promise<Organization[]> {
    const { data, error } = await this.supabaseService.organizations
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch organizations:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get organization by ID
   */
  async findOne(id: string): Promise<Organization> {
    const { data, error } = await this.supabaseService.organizations
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }

    return data;
  }

  /**
   * Get organization by organization_id
   */
  async findByOrganizationId(organizationId: string): Promise<Organization | null> {
    const { data, error } = await this.supabaseService.organizations
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) {
      this.logger.error('Failed to fetch organization by organization_id:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  }

  /**
   * Get organization by referral code
   */
  async findByReferral(orgReferral: string): Promise<Organization | null> {
    const { data, error } = await this.supabaseService.organizations
      .select('*')
      .eq('org_referral', orgReferral)
      .maybeSingle();

    if (error) {
      this.logger.error('Failed to fetch organization by referral:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  }

  /**
   * Create a new organization
   */
  async create(dto: CreateOrganizationDto): Promise<Organization> {
    // Check for existing organization with same organization_id
    const existing = await this.findByOrganizationId(dto.organization_id);
    if (existing) {
      throw new ConflictException(
        `Organization with ID ${dto.organization_id} already exists`,
      );
    }

    const orgReferral = this.generateOrgReferral();

    const { data, error } = await this.supabaseService.organizations
      .insert({
        organization_id: dto.organization_id,
        name: dto.name,
        logo_url: dto.logo_url || null,
        checkout_status: dto.checkout_status || 'inactive',
        org_referral: orgReferral,
        recipient_wallet: dto.recipient_wallet || null,
        token_symbol: dto.token_symbol || null,
        token_chain: dto.token_chain || null,
        bg_color: dto.bg_color || null,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create organization:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Created organization: ${dto.organization_id}`);
    return data;
  }

  /**
   * Update an organization
   */
  async update(dto: UpdateOrganizationDto): Promise<Organization> {
    const { id, ...updateData } = dto;

    // Verify organization exists
    await this.findOne(id);

    // Build update object with only provided fields
    const updates: Record<string, unknown> = {};
    if (updateData.name !== undefined) updates.name = updateData.name;
    if (updateData.logo_url !== undefined) updates.logo_url = updateData.logo_url || null;
    if (updateData.checkout_status !== undefined) updates.checkout_status = updateData.checkout_status;
    if (updateData.organization_id !== undefined) updates.organization_id = updateData.organization_id;
    if (updateData.recipient_wallet !== undefined) updates.recipient_wallet = updateData.recipient_wallet || null;
    if (updateData.token_symbol !== undefined) updates.token_symbol = updateData.token_symbol || null;
    if (updateData.token_chain !== undefined) updates.token_chain = updateData.token_chain || null;
    if (updateData.bg_color !== undefined) updates.bg_color = updateData.bg_color || null;

    const { data, error } = await this.supabaseService.organizations
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update organization:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Updated organization: ${id}`);
    return data;
  }

  /**
   * Self-serve organization signup. Always lands as 'pending' regardless of what the caller
   * sends — activation is an admin-only action (OrganizationsTab in the admin panel), so a
   * business can request an org but can't grant itself a live checkout on signup.
   */
  async createSelfServe(ownerPrivyUserId: string, dto: CreateOrganizationDto): Promise<Organization> {
    // Required here (though optional on the shared DTO, since admin-created orgs don't need it)
    // — this is the only contact info Loofta has to review a pending org and reach the business.
    if (!dto.contact_email) {
      throw new BadRequestException('contact_email is required for self-serve signup');
    }

    const existing = await this.findByOrganizationId(dto.organization_id);
    if (existing) {
      throw new ConflictException(`Organization with ID ${dto.organization_id} already exists`);
    }

    const orgReferral = this.generateOrgReferral();
    const { data, error } = await this.supabaseService.organizations
      .insert({
        organization_id: dto.organization_id,
        name: dto.name,
        logo_url: dto.logo_url || null,
        checkout_status: 'pending',
        org_referral: orgReferral,
        recipient_wallet: dto.recipient_wallet || null,
        token_symbol: dto.token_symbol || null,
        token_chain: dto.token_chain || null,
        bg_color: dto.bg_color || null,
        contact_email: dto.contact_email,
        website_url: dto.website_url || null,
        created_by: ownerPrivyUserId,
        owner_privy_user_id: ownerPrivyUserId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to self-serve create organization:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Self-serve organization created (pending admin approval): ${dto.organization_id}`);
    return data;
  }

  /** Organizations self-serve-created (and thus owned) by `privyUserId`. */
  async findMine(privyUserId: string): Promise<Organization[]> {
    const { data, error } = await this.supabaseService.organizations
      .select('*')
      .eq('owner_privy_user_id', privyUserId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch organizations by owner:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return data || [];
  }

  /** Self-serve settings update — see UpdateOrganizationSelfServeDto for why this excludes checkout_status/organization_id. */
  async updateSelfServe(id: string, ownerPrivyUserId: string, dto: UpdateOrganizationSelfServeDto): Promise<Organization> {
    await this.assertOwnership(id, ownerPrivyUserId);

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.logo_url !== undefined) updates.logo_url = dto.logo_url || null;
    if (dto.recipient_wallet !== undefined) updates.recipient_wallet = dto.recipient_wallet || null;
    if (dto.token_symbol !== undefined) updates.token_symbol = dto.token_symbol || null;
    if (dto.token_chain !== undefined) updates.token_chain = dto.token_chain || null;
    if (dto.bg_color !== undefined) updates.bg_color = dto.bg_color || null;
    if (dto.contact_email !== undefined) updates.contact_email = dto.contact_email || null;
    if (dto.website_url !== undefined) updates.website_url = dto.website_url || null;

    const { data, error } = await this.supabaseService.organizations
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to self-serve update organization:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return data;
  }

  /** Throws unless `privyUserId` owns the organization identified by `id` (the org's UUID). */
  private async assertOwnership(id: string, privyUserId: string): Promise<Organization> {
    const org = await this.findOne(id);
    if (org.owner_privy_user_id !== privyUserId) {
      throw new NotFoundException(`Organization with ID ${id} not found`);
    }
    return org;
  }

  /**
   * Self-serve API key issuance — the org owner mints their own key once the org has been
   * approved by an admin. Thin wrapper around IntegratorsService.provision(), scoped to the
   * caller's own organization instead of admin-arbitrary provisioning.
   */
  async createApiKey(
    id: string,
    ownerPrivyUserId: string,
  ): Promise<{ rawKey: string; keyPrefix: string }> {
    const org = await this.assertOwnership(id, ownerPrivyUserId);
    if (org.checkout_status !== 'active') {
      throw new BadRequestException('Organization must be approved (active) before issuing API keys');
    }

    const { rawKey, keyPrefix } = await this.integratorsService.provision({
      name: org.name,
      createdByAdmin: ownerPrivyUserId,
      organizationId: org.id,
      isDevnetOnly: true,
    });
    return { rawKey, keyPrefix };
  }

  /**
   * Create a checkout session: mints a burner-backed payment link addressed to the
   * organization's own recipient_wallet, settling in whatever token/chain the org configured
   * (org.token_symbol/token_chain — set via the self-serve dashboard's token picker), then
   * records a companion row in organization_payments for org-scoped reporting.
   *
   * Uses ClaimsService.createForOrganizationCheckout() rather than the generic create() — see
   * that method's docstring for why arbitrary-destination settlement needed its own path. This
   * is also what makes privacy possible at all for a Solana payout: DepositService routes a
   * cross-chain deposit to Solana through the burner it mints, then a private PER transfer
   * delivers to recipient_wallet, exactly like every other private Loofta payment link. Only a
   * Solana destination gets that privacy hop today — a non-Solana payout (e.g. USDC on Base)
   * settles directly via NEAR Intents with no burner involved, so `isPrivate` has no effect
   * there yet.
   */
  async createCheckoutSession(
    organizationId: string,
    dto: CreateCheckoutSessionDto,
  ): Promise<{ id: string; short_id: string; link: string }> {
    const org = await this.findByOrganizationId(organizationId);
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }
    if (org.checkout_status !== 'active') {
      throw new BadRequestException("This organization's checkout is not active");
    }
    if (!org.recipient_wallet) {
      throw new BadRequestException('Organization has no recipient wallet configured');
    }
    if (!org.token_symbol || !org.token_chain) {
      throw new BadRequestException('Organization has no payout token/chain configured');
    }

    // No organization_id passed here — payments carries no such column. The link back to this
    // org lives only in organization_payments.payment_id (set right below), which is also what
    // ClaimsService's fee check and the auto-settle cron key off of.
    const claim = await this.claimsService.createForOrganizationCheckout({
      amount: dto.amount,
      recipient: org.recipient_wallet,
      toChain: org.token_chain,
      toSymbol: org.token_symbol,
      isPrivate: dto.isPrivate,
    });

    const { error: ledgerError } = await this.supabaseService.organizationPayments.insert({
      organization_id: org.id,
      payment_id: claim.id,
      amount_usd: String(dto.amount),
      deposit_address: org.recipient_wallet,
      memo: dto.description || null,
      referral: org.org_referral,
      status: 'OPEN',
      token_chain: org.token_chain || 'solana',
      token_symbol: org.token_symbol || 'USDC',
    });
    if (ledgerError) {
      this.logger.warn(`Failed to record organization_payments row for checkout session ${claim.id}: ${ledgerError.message}`);
    }

    return claim;
  }

  /**
   * Delete an organization
   */
  async remove(id: string): Promise<void> {
    // Verify organization exists
    await this.findOne(id);

    const { error } = await this.supabaseService.organizations
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete organization:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Deleted organization: ${id}`);
  }
}
