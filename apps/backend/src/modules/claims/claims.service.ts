import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { CreateClaimDto } from './dto';
import { Claim, ClaimIntent, ClaimStatus } from './entities/claim.entity';

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>(
      'NEXT_PUBLIC_BASE_URL',
      'https://pay.loofta.xyz',
    );
  }

  /**
   * Create a new payment claim
   */
  async create(dto: CreateClaimDto): Promise<{ id: string; link: string }> {
    const { amount, toSel, recipient, userId, userEmail } = dto;

    if (!amount || !toSel?.symbol || !toSel?.chain || !recipient) {
      throw new BadRequestException('Missing required fields');
    }

    const { data, error } = await this.supabaseService.claims
      .insert({
        amount: String(amount),
        to_symbol: String(toSel.symbol),
        to_chain: String(toSel.chain),
        recipient_address: String(recipient),
        created_by: userId ? String(userId) : null,
        creator_email: userEmail ? String(userEmail) : null,
        status: 'OPEN' as ClaimStatus,
      })
      .select('id')
      .single();

    if (error) {
      this.logger.error('Failed to create claim:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    const id = data.id;
    const link = `${this.baseUrl}/c/${id}`;

    this.logger.log(`Created claim: ${id}`);
    return { id, link };
  }

  /**
   * Get claim by ID
   */
  async findOne(id: string): Promise<Claim> {
    const { data, error } = await this.supabaseService.claims
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Claim with ID ${id} not found`);
    }

    return data;
  }

  /**
   * Get claim with latest intent
   */
  async findWithLatestIntent(id: string): Promise<{
    claim: Claim;
    intent: ClaimIntent | null;
  }> {
    const claim = await this.findOne(id);

    const { data: intent } = await this.supabaseService.claimIntents
      .select('*')
      .eq('claim_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return { claim, intent };
  }

  /**
   * Update claim status
   */
  async updateStatus(id: string, status: ClaimStatus): Promise<Claim> {
    const { data, error } = await this.supabaseService.claims
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update claim status:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Updated claim ${id} status to ${status}`);
    return data;
  }

  /**
   * Get all claims for a user
   */
  async findByUser(userId: string): Promise<Claim[]> {
    const { data, error } = await this.supabaseService.claims
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch user claims:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get claims by status (for cron processing)
   */
  async findByStatus(status: ClaimStatus): Promise<Claim[]> {
    const { data, error } = await this.supabaseService.claims
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch claims by status:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create claim intent record
   */
  async createIntent(params: {
    claimId: string;
    quoteId?: string;
    depositAddress?: string;
    memo?: string | null;
    deadline?: string;
    timeEstimate?: number;
    fromChain?: string;
    toChain?: string;
    status?: string;
  }): Promise<ClaimIntent> {
    const { data, error } = await this.supabaseService.claimIntents
      .insert({
        claim_id: params.claimId,
        quote_id: params.quoteId || null,
        deposit_address: params.depositAddress || null,
        memo: params.memo || null,
        deadline: params.deadline ? new Date(params.deadline).toISOString() : null,
        time_estimate: params.timeEstimate || null,
        from_chain: params.fromChain || null,
        to_chain: params.toChain || null,
        status: params.status || 'PENDING_DEPOSIT',
        last_status_payload: null,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create claim intent:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    // Update claim status
    await this.updateStatus(params.claimId, 'PENDING_DEPOSIT');

    return data;
  }

  /**
   * Update claim intent
   */
  async updateIntent(
    intentId: string,
    updates: Partial<{
      status: string;
      lastStatusPayload: any;
      paidAmount: string;
    }>,
  ): Promise<ClaimIntent> {
    const updateData: Record<string, unknown> = {};
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.lastStatusPayload !== undefined) updateData.last_status_payload = updates.lastStatusPayload;
    if (updates.paidAmount !== undefined) updateData.paid_amount = updates.paidAmount;

    const { data, error } = await this.supabaseService.claimIntents
      .update(updateData)
      .eq('id', intentId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update claim intent:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return data;
  }

  /**
   * Get pending intents for processing
   * Excludes expired intents and intents older than 1 month
   */
  async getPendingIntents(): Promise<ClaimIntent[]> {
    const now = new Date().toISOString();
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const { data, error } = await this.supabaseService.claimIntents
      .select('*')
      .in('status', ['PENDING_DEPOSIT', 'IN_FLIGHT'])
      .gt('deadline', now) // Only intents with future deadlines
      .gt('created_at', oneMonthAgo.toISOString()) // Only intents from last month
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Failed to fetch pending intents:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.debug(`Found ${data?.length || 0} pending intents (excluding expired/old)`);
    return data || [];
  }

  /**
   * Get all claims (admin)
   */
  async findAll(options?: {
    status?: ClaimStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ claims: Claim[]; total: number }> {
    let query = this.supabaseService.claims.select('*', { count: 'exact' });

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    query = query.order('created_at', { ascending: false });

    if (options?.limit) {
      query = query.limit(options.limit);
    }
    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      this.logger.error('Failed to fetch all claims:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return { claims: data || [], total: count || 0 };
  }

  /**
   * Delete a claim and its intents (admin)
   */
  async delete(id: string): Promise<void> {
    // First delete all intents for this claim
    const { error: intentError } = await this.supabaseService.claimIntents
      .delete()
      .eq('claim_id', id);

    if (intentError) {
      this.logger.error('Failed to delete claim intents:', intentError);
      throw new Error(`Database error: ${intentError.message}`);
    }

    // Then delete the claim
    const { error } = await this.supabaseService.claims
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Failed to delete claim:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    this.logger.log(`Deleted claim: ${id}`);
  }

  /**
   * Delete multiple claims (admin)
   */
  async deleteMany(ids: string[]): Promise<{ deleted: number }> {
    let deletedCount = 0;

    for (const id of ids) {
      try {
        await this.delete(id);
        deletedCount++;
      } catch (e) {
        this.logger.error(`Failed to delete claim ${id}:`, e);
      }
    }

    return { deleted: deletedCount };
  }

  /**
   * Get claim with all intents (admin)
   */
  async findWithAllIntents(id: string): Promise<{
    claim: Claim;
    intents: ClaimIntent[];
  }> {
    const claim = await this.findOne(id);

    const { data: intents, error } = await this.supabaseService.claimIntents
      .select('*')
      .eq('claim_id', id)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch claim intents:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    return { claim, intents: intents || [] };
  }
}
