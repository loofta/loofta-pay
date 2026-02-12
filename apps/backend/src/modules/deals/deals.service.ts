import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import {
  CreateDealDto,
  UpdateDealDto,
  CreateDealInviteDto,
  AcceptDealInviteDto,
  RequestChangesDealInviteDto,
  CreateDealCommentDto,
  DealResponse,
  DealInviteResponse,
  DealPaymentResponse,
  DealCommentResponse,
} from './dto';

const DEAL_CONTRACTS_BUCKET = 'deal-contracts';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private async checkOrgAccess(organizationId: string, userId: string, adminOnly = false): Promise<void> {
    const client = this.supabaseService.getClient();
    const { data: org } = await client
      .from('payroll_organizations')
      .select('id, owner_id')
      .eq('id', organizationId)
      .single();
    if (!org) throw new NotFoundException('Organization not found');
    if (org.owner_id === userId) return;
    const { data: member } = await client
      .from('payroll_org_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .single();
    if (member) {
      if (adminOnly && member.role !== 'owner' && member.role !== 'admin') {
        throw new ForbiddenException('Admin access required');
      }
      return;
    }
    // Contributor access: user's email in payroll_contributors for this org
    const { data: profile } = await client.from('freelancer_profiles').select('email').eq('user_id', userId).single();
    if (profile?.email) {
      const { data: contribs } = await client
        .from('payroll_contributors')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('email', profile.email)
        .in('status', ['invited', 'joined'])
        .limit(1);
      const isContributor = Array.isArray(contribs) && contribs.length > 0;
      if (isContributor) {
        if (adminOnly) throw new ForbiddenException('Admin access required');
        return;
      }
    }
    throw new ForbiddenException('You do not have access to this organization');
  }

  async create(organizationId: string, userId: string, dto: CreateDealDto): Promise<DealResponse> {
    await this.checkOrgAccess(organizationId, userId, false);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deals')
      .insert({
        organization_id: organizationId,
        created_by: userId,
        title: dto.title,
        description: dto.description ?? null,
        instructions: dto.instructions ?? null,
        amount: dto.amount,
        amount_currency: dto.amount_currency ?? 'USD',
        deadline: dto.deadline ?? null,
        status: 'draft',
      })
      .select()
      .single();
    if (error) {
      this.logger.error('Failed to create deal:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return this.toDealResponse(data);
  }

  async list(organizationId: string, userId: string): Promise<DealResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deals')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list deals:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return (data || []).map((row) => this.toDealResponse(row));
  }

  async get(organizationId: string, dealId: string, userId: string): Promise<DealResponse> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deals')
      .select('*')
      .eq('id', dealId)
      .eq('organization_id', organizationId)
      .single();
    if (error || !data) throw new NotFoundException('Deal not found');
    const deal = this.toDealResponse(data);
    const { data: invites } = await client
      .from('deal_invites')
      .select('id, deal_id, freelancer_profile_id, invitee_email, status, request_changes_message, preferred_network, preferred_token_symbol, created_at, updated_at')
      .eq('deal_id', dealId);
    deal.invites = (invites || []).map((i) => ({
      id: i.id,
      deal_id: i.deal_id,
      freelancer_profile_id: i.freelancer_profile_id,
      invitee_email: i.invitee_email,
      status: i.status,
      request_changes_message: i.request_changes_message ?? null,
      preferred_network: i.preferred_network,
      preferred_token_symbol: i.preferred_token_symbol,
      created_at: i.created_at,
      updated_at: i.updated_at,
    }));
    return deal;
  }

  async update(organizationId: string, dealId: string, userId: string, dto: UpdateDealDto): Promise<DealResponse> {
    await this.checkOrgAccess(organizationId, userId, true);
    const client = this.supabaseService.getClient();
    const { data: existing } = await client.from('deals').select('id, status').eq('id', dealId).eq('organization_id', organizationId).single();
    if (!existing) throw new NotFoundException('Deal not found');
    if (!['draft', 'invited'].includes(existing.status)) {
      throw new BadRequestException('Deal can only be edited in draft or invited state');
    }
    const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.title !== undefined) updatePayload.title = dto.title;
    if (dto.description !== undefined) updatePayload.description = dto.description;
    if (dto.instructions !== undefined) updatePayload.instructions = dto.instructions;
    if (dto.amount !== undefined) updatePayload.amount = dto.amount;
    if (dto.amount_currency !== undefined) updatePayload.amount_currency = dto.amount_currency;
    if (dto.deadline !== undefined) updatePayload.deadline = dto.deadline;
    const { data, error } = await client.from('deals').update(updatePayload).eq('id', dealId).select().single();
    if (error) throw new Error(`Database error: ${error.message}`);
    return this.toDealResponse(data);
  }

  async uploadContract(
    organizationId: string,
    dealId: string,
    userId: string,
    file: Buffer,
    filename: string,
  ): Promise<{ url: string }> {
    await this.checkOrgAccess(organizationId, userId, true);
    const client = this.supabaseService.getClient();
    const { data: deal } = await client.from('deals').select('id, contract_attachment_path').eq('id', dealId).eq('organization_id', organizationId).single();
    if (!deal) throw new NotFoundException('Deal not found');
    const ext = filename.replace(/^.*\./, '') || 'pdf';
    const path = `organizations/${organizationId}/deals/${dealId}_${Date.now()}.${ext}`;
    const { error: uploadError } = await client.storage.from(DEAL_CONTRACTS_BUCKET).upload(path, file, {
      contentType: ext === 'pdf' ? 'application/pdf' : 'application/octet-stream',
      upsert: true,
    });
    if (uploadError) {
      this.logger.error('Failed to upload contract:', uploadError);
      throw new Error(`Upload error: ${uploadError.message}`);
    }
    await client.from('deals').update({ contract_attachment_path: path, updated_at: new Date().toISOString() }).eq('id', dealId);
    const { data: urlData } = client.storage.from(DEAL_CONTRACTS_BUCKET).getPublicUrl(path);
    return { url: urlData.publicUrl };
  }

  async invite(organizationId: string, dealId: string, userId: string, dto: CreateDealInviteDto): Promise<DealInviteResponse> {
    await this.checkOrgAccess(organizationId, userId, true);
    const client = this.supabaseService.getClient();
    const { data: deal } = await client.from('deals').select('id, status').eq('id', dealId).eq('organization_id', organizationId).single();
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.status === 'draft') {
      await client.from('deals').update({ status: 'invited', updated_at: new Date().toISOString() }).eq('id', dealId);
    }
    const email = dto.invitee_email.trim().toLowerCase();
    const { data: invite, error } = await client
      .from('deal_invites')
      .upsert(
        { deal_id: dealId, invitee_email: email, status: 'invited', updated_at: new Date().toISOString() },
        { onConflict: 'deal_id,invitee_email', ignoreDuplicates: false },
      )
      .select()
      .single();
    if (error) {
      if (error.code === '23505') return this.getInviteByDealAndEmail(client, dealId, email);
      this.logger.error('Failed to create invite:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return this.toInviteResponse(invite);
  }

  private async getInviteByDealAndEmail(client: any, dealId: string, email: string): Promise<DealInviteResponse> {
    const { data } = await client.from('deal_invites').select('*').eq('deal_id', dealId).eq('invitee_email', email).single();
    if (!data) throw new Error('Invite not found');
    return this.toInviteResponse(data);
  }

  async acceptInvite(inviteId: string, userId: string, dto: AcceptDealInviteDto): Promise<DealInviteResponse> {
    const client = this.supabaseService.getClient();
    const { data: invite } = await client.from('deal_invites').select('*').eq('id', inviteId).single();
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== 'invited') throw new BadRequestException('Invite is not pending');
    let freelancerProfileId = invite.freelancer_profile_id;
    if (!freelancerProfileId) {
      let { data: profile } = await client.from('freelancer_profiles').select('id').eq('user_id', userId).single();
      if (!profile) {
        const { data: created } = await client
          .from('freelancer_profiles')
          .insert({
            user_id: userId,
            email: invite.invitee_email,
            preferred_network: dto.preferred_network ?? null,
            preferred_token_symbol: dto.preferred_token_symbol ?? null,
          })
          .select('id')
          .single();
        profile = created;
      }
      if (profile) {
        freelancerProfileId = profile.id;
        await client.from('deal_invites').update({ freelancer_profile_id: profile.id }).eq('id', inviteId);
      }
    } else {
      const { data: profile } = await client.from('freelancer_profiles').select('id').eq('id', freelancerProfileId).eq('user_id', userId).single();
      if (!profile) throw new ForbiddenException('This invite is for another freelancer');
    }
    const updatePayload: Record<string, unknown> = {
      status: 'accepted',
      updated_at: new Date().toISOString(),
    };
    if (dto.preferred_network !== undefined) updatePayload.preferred_network = dto.preferred_network;
    if (dto.preferred_token_symbol !== undefined) updatePayload.preferred_token_symbol = dto.preferred_token_symbol;
    const { data: updated, error } = await client.from('deal_invites').update(updatePayload).eq('id', inviteId).select().single();
    if (error) throw new Error(`Database error: ${error.message}`);
    await client.from('deals').update({ status: 'accepted', updated_at: new Date().toISOString() }).eq('id', invite.deal_id);
    return this.toInviteResponse(updated);
  }

  async declineInvite(inviteId: string, userId: string): Promise<DealInviteResponse> {
    const client = this.supabaseService.getClient();
    const { data: invite } = await client.from('deal_invites').select('*').eq('id', inviteId).single();
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== 'invited') throw new BadRequestException('Invite is not pending');
    if (invite.freelancer_profile_id) {
      const { data: profile } = await client.from('freelancer_profiles').select('id').eq('id', invite.freelancer_profile_id).eq('user_id', userId).single();
      if (!profile) throw new ForbiddenException('This invite is for another freelancer');
    }
    const { data: updated, error } = await client
      .from('deal_invites')
      .update({ status: 'declined', updated_at: new Date().toISOString() })
      .eq('id', inviteId)
      .select()
      .single();
    if (error) throw new Error(`Database error: ${error.message}`);
    return this.toInviteResponse(updated);
  }

  async requestChangesInvite(inviteId: string, userId: string, dto: RequestChangesDealInviteDto): Promise<DealInviteResponse> {
    const client = this.supabaseService.getClient();
    const { data: invite } = await client.from('deal_invites').select('*').eq('id', inviteId).single();
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== 'invited') throw new BadRequestException('Invite is not pending');
    if (invite.freelancer_profile_id) {
      const { data: profile } = await client.from('freelancer_profiles').select('id').eq('id', invite.freelancer_profile_id).eq('user_id', userId).single();
      if (!profile) throw new ForbiddenException('This invite is for another freelancer');
    }
    const { data: updated, error } = await client
      .from('deal_invites')
      .update({
        status: 'request_changes',
        request_changes_message: dto.message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', inviteId)
      .select()
      .single();
    if (error) throw new Error(`Database error: ${error.message}`);
    await client.from('deals').update({ status: 'invited', updated_at: new Date().toISOString() }).eq('id', invite.deal_id);
    return this.toInviteResponse(updated);
  }

  async confirmDelivery(dealId: string, userId: string): Promise<DealResponse> {
    const client = this.supabaseService.getClient();
    const { data: deal } = await client.from('deals').select('*').eq('id', dealId).single();
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.status !== 'accepted' && deal.status !== 'funded') throw new BadRequestException('Deal must be accepted or funded to confirm delivery');
    const { data: invite } = await client.from('deal_invites').select('freelancer_profile_id').eq('deal_id', dealId).eq('status', 'accepted').single();
    if (!invite?.freelancer_profile_id) throw new BadRequestException('No accepted invite for this deal');
    const { data: profile } = await client.from('freelancer_profiles').select('user_id').eq('id', invite.freelancer_profile_id).single();
    if (!profile || profile.user_id !== userId) throw new ForbiddenException('Only the freelancer can confirm delivery');
    await client.from('deals').update({ delivery_confirmed_at: new Date().toISOString(), status: 'delivered', updated_at: new Date().toISOString() }).eq('id', dealId);
    const { data: updated } = await client.from('deals').select('*').eq('id', dealId).single();
    return this.toDealResponse(updated);
  }

  async acceptDelivery(organizationId: string, dealId: string, userId: string): Promise<DealPaymentResponse> {
    await this.checkOrgAccess(organizationId, userId, true);
    const client = this.supabaseService.getClient();
    const { data: deal } = await client.from('deals').select('*').eq('id', dealId).eq('organization_id', organizationId).single();
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.status !== 'delivered') throw new BadRequestException('Deal must be in delivered state (freelancer confirmed)');
    const { data: invite } = await client.from('deal_invites').select('*').eq('deal_id', dealId).eq('status', 'accepted').single();
    if (!invite) throw new BadRequestException('No accepted invite');
    let recipientWallet = '';
    let preferredNetwork = invite.preferred_network || 'base';
    let preferredToken = invite.preferred_token_symbol || 'USDC';
    if (invite.freelancer_profile_id) {
      const { data: profile } = await client.from('freelancer_profiles').select('wallet_address, preferred_network, preferred_token_symbol').eq('id', invite.freelancer_profile_id).single();
      if (profile?.wallet_address) {
        recipientWallet = profile.wallet_address;
        if (profile.preferred_network) preferredNetwork = profile.preferred_network;
        if (profile.preferred_token_symbol) preferredToken = profile.preferred_token_symbol;
      }
    }
    if (!recipientWallet) throw new BadRequestException('Freelancer has not set a payout wallet yet');
    const { data: payment, error } = await client
      .from('deal_payments')
      .insert({
        deal_id: dealId,
        deal_invite_id: invite.id,
        organization_id: organizationId,
        amount: deal.amount,
        amount_currency: deal.amount_currency,
        recipient_wallet: recipientWallet,
        preferred_network: preferredNetwork,
        preferred_token_symbol: preferredToken,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw new Error(`Database error: ${error.message}`);
    await client.from('deals').update({ status: 'released', updated_at: new Date().toISOString() }).eq('id', dealId);
    return this.toPaymentResponse(payment);
  }

  async createDispute(organizationId: string, dealId: string, userId: string): Promise<DealResponse> {
    await this.checkOrgAccess(organizationId, userId, true);
    const client = this.supabaseService.getClient();
    const { data: deal } = await client.from('deals').select('*').eq('id', dealId).eq('organization_id', organizationId).single();
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.status !== 'delivered') throw new BadRequestException('Deal must be in delivered state to dispute');
    await client.from('deals').update({ status: 'disputed', updated_at: new Date().toISOString() }).eq('id', dealId);
    const { data: updated } = await client.from('deals').select('*').eq('id', dealId).single();
    return this.toDealResponse(updated);
  }

  async listComments(organizationId: string, dealId: string, userId: string): Promise<DealCommentResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: deal } = await client.from('deals').select('id, created_by').eq('id', dealId).eq('organization_id', organizationId).single();
    if (!deal) throw new NotFoundException('Deal not found');
    const { data: rows, error } = await client
      .from('deal_comments')
      .select('id, deal_id, author_user_id, body, created_at')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: true });
    if (error) {
      this.logger.error('Failed to list deal comments:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    const comments = rows || [];
    const authorIds = [...new Set(comments.map((c: { author_user_id: string }) => c.author_user_id))];
    const { data: profiles } = await client
      .from('freelancer_profiles')
      .select('user_id, email')
      .in('user_id', authorIds);
    const profileByUser = new Map((profiles || []).map((p: { user_id: string; email: string }) => [p.user_id, p.email]));
    return comments.map((c: any) => ({
      id: c.id,
      deal_id: c.deal_id,
      author_user_id: c.author_user_id,
      author_display: c.author_user_id === deal.created_by ? 'Client' : (profileByUser.get(c.author_user_id) || c.author_user_id.slice(0, 8) + '…'),
      body: c.body,
      created_at: c.created_at,
    }));
  }

  async addComment(organizationId: string, dealId: string, userId: string, dto: CreateDealCommentDto): Promise<DealCommentResponse> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: deal } = await client.from('deals').select('id, created_by').eq('id', dealId).eq('organization_id', organizationId).single();
    if (!deal) throw new NotFoundException('Deal not found');
    const body = dto.body?.trim();
    if (!body) throw new BadRequestException('Comment body is required');
    const { data: row, error } = await client
      .from('deal_comments')
      .insert({ deal_id: dealId, author_user_id: userId, body })
      .select()
      .single();
    if (error) {
      this.logger.error('Failed to add deal comment:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    const { data: profile } = await client.from('freelancer_profiles').select('email').eq('user_id', userId).single();
    const author_display = userId === deal.created_by ? 'Client' : (profile?.email || userId.slice(0, 8) + '…');
    return {
      id: row.id,
      deal_id: row.deal_id,
      author_user_id: row.author_user_id,
      author_display,
      body: row.body,
      created_at: row.created_at,
    };
  }

  async confirmDeliveryByInvite(inviteId: string, userId: string): Promise<DealResponse> {
    const client = this.supabaseService.getClient();
    const { data: invite } = await client.from('deal_invites').select('deal_id').eq('id', inviteId).single();
    if (!invite) throw new NotFoundException('Invite not found');
    return this.confirmDelivery(invite.deal_id, userId);
  }

  /**
   * List deals where the current user is the invitee (for contributor view). Matches by freelancer_profile email.
   */
  async listMyInvites(organizationId: string, userId: string): Promise<Array<{ deal: DealResponse; invite: DealInviteResponse }>> {
    const client = this.supabaseService.getClient();
    const { data: profile } = await client.from('freelancer_profiles').select('email').eq('user_id', userId).single();
    if (!profile?.email) return [];

    const { data: invites, error: invError } = await client
      .from('deal_invites')
      .select('*')
      .eq('invitee_email', profile.email);
    if (invError || !invites?.length) return [];

    const dealIds = [...new Set(invites.map((i: { deal_id: string }) => i.deal_id))];
    const { data: deals, error: dealError } = await client
      .from('deals')
      .select('*')
      .eq('organization_id', organizationId)
      .in('id', dealIds);
    if (dealError || !deals?.length) return [];

    const dealMap = new Map(deals.map((d: any) => [d.id, this.toDealResponse(d)]));
    const result: Array<{ deal: DealResponse; invite: DealInviteResponse }> = [];
    for (const inv of invites) {
      const deal = dealMap.get(inv.deal_id);
      if (deal) result.push({ deal, invite: this.toInviteResponse(inv) });
    }
    result.sort((a, b) => new Date(b.invite.created_at).getTime() - new Date(a.invite.created_at).getTime());
    return result;
  }

  async getInviteByToken(
    inviteToken: string,
    userId?: string,
  ): Promise<{ invite: DealInviteResponse; deal: DealResponse; contributor_payout?: { network: string; token_symbol: string } }> {
    const client = this.supabaseService.getClient();
    const { data: invite } = await client.from('deal_invites').select('*').eq('id', inviteToken).single();
    if (!invite) throw new NotFoundException('Invite not found');
    const { data: deal } = await client.from('deals').select('*').eq('id', invite.deal_id).single();
    if (!deal) throw new NotFoundException('Deal not found');

    let contributor_payout: { network: string; token_symbol: string } | undefined;
    if (userId) {
      const { data: profile } = await client.from('freelancer_profiles').select('email').eq('user_id', userId).single();
      if (profile?.email) {
        const { data: contribs } = await client
          .from('payroll_contributors')
          .select('network, token_symbol')
          .eq('organization_id', deal.organization_id)
          .eq('email', profile.email)
          .in('status', ['invited', 'joined'])
          .limit(1);
        const contrib = Array.isArray(contribs) ? contribs[0] : contribs;
        if (contrib?.network && contrib?.token_symbol) {
          contributor_payout = { network: contrib.network, token_symbol: contrib.token_symbol };
        }
      }
    }

    return {
      invite: this.toInviteResponse(invite),
      deal: this.toDealResponse(deal),
      ...(contributor_payout && { contributor_payout }),
    };
  }

  private toDealResponse(row: any): DealResponse {
    const base: DealResponse = {
      id: row.id,
      organization_id: row.organization_id,
      created_by: row.created_by,
      title: row.title,
      description: row.description,
      instructions: row.instructions,
      contract_attachment_path: row.contract_attachment_path,
      amount: row.amount,
      amount_currency: row.amount_currency,
      status: row.status,
      deadline: row.deadline ?? null,
      delivery_confirmed_at: row.delivery_confirmed_at ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
    if (row.contract_attachment_path) {
      const { data } = this.supabaseService.getClient().storage.from(DEAL_CONTRACTS_BUCKET).getPublicUrl(row.contract_attachment_path);
      base.contract_attachment_url = data.publicUrl;
    }
    return base;
  }

  private toInviteResponse(row: any): DealInviteResponse {
    return {
      id: row.id,
      deal_id: row.deal_id,
      freelancer_profile_id: row.freelancer_profile_id,
      invitee_email: row.invitee_email,
      status: row.status,
      request_changes_message: row.request_changes_message ?? null,
      preferred_network: row.preferred_network,
      preferred_token_symbol: row.preferred_token_symbol,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private toPaymentResponse(row: any): DealPaymentResponse {
    return {
      id: row.id,
      deal_id: row.deal_id,
      deal_invite_id: row.deal_invite_id,
      organization_id: row.organization_id,
      amount: row.amount,
      amount_currency: row.amount_currency,
      recipient_wallet: row.recipient_wallet,
      preferred_network: row.preferred_network,
      preferred_token_symbol: row.preferred_token_symbol,
      status: row.status,
      deposit_address: row.deposit_address,
      intent_deadline: row.intent_deadline,
      tx_hash: row.tx_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
