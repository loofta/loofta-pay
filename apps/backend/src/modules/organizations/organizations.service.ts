import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto';
import { Organization } from './entities/organization.entity';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

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
