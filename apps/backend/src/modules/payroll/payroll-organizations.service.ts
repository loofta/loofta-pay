import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { CreatePayrollOrganizationDto, UpdatePayrollOrganizationDto, PayrollOrganization } from './dto';

@Injectable()
export class PayrollOrganizationsService {
  private readonly logger = new Logger(PayrollOrganizationsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Create a new payroll organization
   */
  async create(dto: CreatePayrollOrganizationDto, userId: string): Promise<PayrollOrganization> {
    const { data, error } = await this.supabaseService.getClient()
      .from('payroll_organizations')
      .insert({
        name: dto.name,
        logo_url: dto.logoUrl || null,
        owner_id: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create payroll organization:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    // Also add owner as a member with 'owner' role
    await this.supabaseService.getClient()
      .from('payroll_org_members')
      .insert({
        organization_id: data.id,
        user_id: userId,
        role: 'owner',
      });

    this.logger.log(`Created payroll organization: ${data.id}`);
    return data;
  }

  /**
   * Get all organizations for a user (as owner or member)
   */
  async findAllForUser(userId: string): Promise<PayrollOrganization[]> {
    // Get orgs where user is owner
    const { data: ownedOrgs, error: ownedError } = await this.supabaseService.getClient()
      .from('payroll_organizations')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (ownedError) {
      this.logger.error('Failed to fetch owned organizations:', ownedError);
      throw new Error(`Database error: ${ownedError.message}`);
    }

    // Get orgs where user is a member (but not owner)
    const { data: memberships, error: memberError } = await this.supabaseService.getClient()
      .from('payroll_org_members')
      .select('organization_id')
      .eq('user_id', userId);

    if (memberError) {
      this.logger.error('Failed to fetch memberships:', memberError);
      throw new Error(`Database error: ${memberError.message}`);
    }

    const memberOrgIds = memberships
      .map(m => m.organization_id)
      .filter(id => !ownedOrgs.some(o => o.id === id));

    if (memberOrgIds.length > 0) {
      const { data: memberOrgs, error: fetchError } = await this.supabaseService.getClient()
        .from('payroll_organizations')
        .select('*')
        .in('id', memberOrgIds)
        .order('created_at', { ascending: false });

      if (!fetchError && memberOrgs) {
        return [...ownedOrgs, ...memberOrgs];
      }
    }

    return ownedOrgs || [];
  }

  /**
   * Get a single organization by ID
   */
  async findOne(id: string, userId: string): Promise<PayrollOrganization> {
    const { data, error } = await this.supabaseService.getClient()
      .from('payroll_organizations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Organization not found`);
    }

    // Check access
    if (data.owner_id !== userId) {
      const { data: membership } = await this.supabaseService.getClient()
        .from('payroll_org_members')
        .select('id')
        .eq('organization_id', id)
        .eq('user_id', userId)
        .single();

      if (!membership) {
        throw new ForbiddenException('You do not have access to this organization');
      }
    }

    return data;
  }

  /**
   * Update an organization
   */
  async update(id: string, dto: UpdatePayrollOrganizationDto, userId: string): Promise<PayrollOrganization> {
    // Verify ownership
    const org = await this.findOne(id, userId);
    if (org.owner_id !== userId) {
      throw new ForbiddenException('Only the owner can update the organization');
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.logoUrl !== undefined) updateData.logo_url = dto.logoUrl;

    const { data, error } = await this.supabaseService.getClient()
      .from('payroll_organizations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update payroll organization:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  }

  /**
   * Delete an organization
   */
  async delete(id: string, userId: string): Promise<void> {
    // Verify ownership
    const org = await this.findOne(id, userId);
    if (org.owner_id !== userId) {
      throw new ForbiddenException('Only the owner can delete the organization');
    }

    const { error } = await this.supabaseService.getClient()
      .from('payroll_organizations')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete payroll organization:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Deleted payroll organization: ${id}`);
  }

  /**
   * Upload logo - returns the public URL
   */
  async uploadLogo(id: string, file: Buffer, filename: string, userId: string): Promise<string> {
    // Verify ownership
    const org = await this.findOne(id, userId);
    if (org.owner_id !== userId) {
      throw new ForbiddenException('Only the owner can upload a logo');
    }

    const filePath = `payroll-logos/${id}/${filename}`;

    const { error: uploadError } = await this.supabaseService.getClient().storage
      .from('public')
      .upload(filePath, file, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      this.logger.error('Failed to upload logo:', uploadError);
      throw new Error(`Upload error: ${uploadError.message}`);
    }

    const { data: publicUrl } = this.supabaseService.getClient().storage
      .from('public')
      .getPublicUrl(filePath);

    // Update org with new logo URL
    await this.update(id, { logoUrl: publicUrl.publicUrl }, userId);

    return publicUrl.publicUrl;
  }

  /**
   * Check if user has access to organization
   */
  async checkAccess(organizationId: string, userId: string): Promise<boolean> {
    try {
      await this.findOne(organizationId, userId);
      return true;
    } catch {
      return false;
    }
  }
}
