import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import {
  CreateFreelancerProfileDto,
  UpdateFreelancerProfileDto,
  FreelancerProfileResponse,
} from './dto';

@Injectable()
export class FreelancerProfilesService {
  private readonly logger = new Logger(FreelancerProfilesService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async getOrCreate(userId: string, dto: CreateFreelancerProfileDto): Promise<FreelancerProfileResponse> {
    const client = this.supabaseService.getClient();
    const { data: existing } = await client.from('freelancer_profiles').select('*').eq('user_id', userId).single();
    if (existing) {
      return this.toResponse(existing);
    }
    const { data: created, error } = await client
      .from('freelancer_profiles')
      .insert({
        user_id: userId,
        email: dto.email.trim().toLowerCase(),
        first_name: dto.first_name ?? null,
        last_name: dto.last_name ?? null,
        wallet_address: dto.wallet_address ?? null,
        preferred_network: dto.preferred_network ?? null,
        preferred_token_symbol: dto.preferred_token_symbol ?? null,
        billing_address: dto.billing_address ?? null,
        tva_number: dto.tva_number ?? null,
        verify_service: dto.verify_service ?? null,
        kyc_required: dto.kyc_required ?? false,
      })
      .select()
      .single();
    if (error) {
      this.logger.error('Failed to create freelancer profile:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return this.toResponse(created);
  }

  async getByUserId(userId: string): Promise<FreelancerProfileResponse | null> {
    const client = this.supabaseService.getClient();
    const { data, error } = await client.from('freelancer_profiles').select('*').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') {
      this.logger.error('Failed to fetch freelancer profile:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return data ? this.toResponse(data) : null;
  }

  async getById(profileId: string, userId: string): Promise<FreelancerProfileResponse> {
    const client = this.supabaseService.getClient();
    const { data, error } = await client.from('freelancer_profiles').select('*').eq('id', profileId).single();
    if (error || !data) throw new NotFoundException('Freelancer profile not found');
    if (data.user_id !== userId) throw new ForbiddenException('Access denied');
    return this.toResponse(data);
  }

  async update(userId: string, dto: UpdateFreelancerProfileDto): Promise<FreelancerProfileResponse> {
    const client = this.supabaseService.getClient();
    const { data: existing } = await client.from('freelancer_profiles').select('id').eq('user_id', userId).single();
    if (!existing) throw new NotFoundException('Freelancer profile not found. Create one first.');
    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.first_name !== undefined) updatePayload.first_name = dto.first_name;
    if (dto.last_name !== undefined) updatePayload.last_name = dto.last_name;
    if (dto.wallet_address !== undefined) updatePayload.wallet_address = dto.wallet_address;
    if (dto.preferred_network !== undefined) updatePayload.preferred_network = dto.preferred_network;
    if (dto.preferred_token_symbol !== undefined) updatePayload.preferred_token_symbol = dto.preferred_token_symbol;
    if (dto.billing_address !== undefined) updatePayload.billing_address = dto.billing_address;
    if (dto.tva_number !== undefined) updatePayload.tva_number = dto.tva_number;
    if (dto.verify_service !== undefined) updatePayload.verify_service = dto.verify_service;
    if (dto.kyc_required !== undefined) updatePayload.kyc_required = dto.kyc_required;
    const { data, error } = await client.from('freelancer_profiles').update(updatePayload).eq('id', existing.id).select().single();
    if (error) throw new Error(`Database error: ${error.message}`);
    return this.toResponse(data);
  }

  private toResponse(row: any): FreelancerProfileResponse {
    return {
      id: row.id,
      user_id: row.user_id,
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name,
      wallet_address: row.wallet_address,
      preferred_network: row.preferred_network,
      preferred_token_symbol: row.preferred_token_symbol,
      billing_address: row.billing_address,
      tva_number: row.tva_number,
      verify_service: row.verify_service,
      verify_status: row.verify_status,
      kyc_required: row.kyc_required,
      kyc_status: row.kyc_status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
