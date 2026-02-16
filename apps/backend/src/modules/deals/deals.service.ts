import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { PayrollContributorsService } from '@/modules/payroll/payroll-contributors.service';
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
  DealInvoiceResponse,
  InvoiceFromFreelancer,
  InvoiceToOrg,
} from './dto';

const DEAL_CONTRACTS_BUCKET = 'deal-contracts';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly payrollContributorsService: PayrollContributorsService,
  ) {}

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
    // Create invoice in prepared state (freelancer → org); becomes sent on confirm delivery, paid when payment done
    await client.from('deal_invoices').insert({
      deal_id: data.id,
      organization_id: organizationId,
      amount: data.amount,
      amount_currency: data.amount_currency || 'USD',
      recipient_email: null,
      status: 'prepared',
      deal_payment_id: null,
    });
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
    if (dto.deadline !== undefined) updatePayload.deadline = dto.deadline === null || dto.deadline === "" ? null : dto.deadline;
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
    await this.payrollContributorsService.ensureContributorForEmail(organizationId, email, userId);
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
    const { data: deal } = await client.from('deals').select('organization_id').eq('id', invite.deal_id).single();
    if (deal?.organization_id && invite.invitee_email) {
      await this.payrollContributorsService.setJoinedWithPayoutFromProfile(
        deal.organization_id,
        invite.invitee_email,
        freelancerProfileId,
        {
          invitePreferredNetwork: updated?.preferred_network ?? undefined,
          invitePreferredTokenSymbol: updated?.preferred_token_symbol ?? undefined,
        },
      );
    }
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
    const { data: invite } = await client.from('deal_invites').select('freelancer_profile_id, invitee_email').eq('deal_id', dealId).eq('status', 'accepted').single();
    if (!invite?.freelancer_profile_id) throw new BadRequestException('No accepted invite for this deal');
    const { data: profile } = await client.from('freelancer_profiles').select('user_id').eq('id', invite.freelancer_profile_id).single();
    if (!profile || profile.user_id !== userId) throw new ForbiddenException('Only the freelancer can confirm delivery');
    await client.from('deals').update({ delivery_confirmed_at: new Date().toISOString(), status: 'delivered', updated_at: new Date().toISOString() }).eq('id', dealId);
    // Invoice: prepared → sent (visible to org)
    const { data: inv } = await client.from('deal_invoices').select('id').eq('deal_id', dealId).limit(1).maybeSingle();
    const invoice = Array.isArray(inv) ? inv[0] : inv;
    if (invoice) {
      await client.from('deal_invoices').update({
        status: 'sent',
        recipient_email: invite.invitee_email || null,
      }).eq('id', invoice.id);
    }
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
    // Fallback: use payout wallet from payroll contributor (your-profile) for this org + invitee email
    if (!recipientWallet && invite.invitee_email) {
      const { data: contrib } = await client
        .from('payroll_contributors')
        .select('wallet_address, network, token_symbol')
        .eq('organization_id', organizationId)
        .eq('email', invite.invitee_email.trim().toLowerCase())
        .in('status', ['invited', 'joined'])
        .limit(1)
        .maybeSingle();
      const c = Array.isArray(contrib) ? contrib[0] : contrib;
      if (c?.wallet_address) {
        recipientWallet = c.wallet_address;
        if (c.network) preferredNetwork = c.network;
        if (c.token_symbol) preferredToken = c.token_symbol;
      }
    }
    if (!recipientWallet) throw new BadRequestException('Freelancer has not set a payout wallet yet. They can set it in Your Profile → Payout for this organization.');
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
    // Link existing invoice (created with deal) to this payment; if none exists (legacy), create one
    const { data: existingInv } = await client.from('deal_invoices').select('id').eq('deal_id', dealId).limit(1).maybeSingle();
    const existingInvoice = Array.isArray(existingInv) ? existingInv[0] : existingInv;
    if (existingInvoice) {
      await client.from('deal_invoices').update({
        deal_payment_id: payment.id,
        recipient_email: invite.invitee_email || null,
      }).eq('id', existingInvoice.id);
    } else {
      await client.from('deal_invoices').insert({
        deal_id: dealId,
        deal_payment_id: payment.id,
        organization_id: organizationId,
        amount: deal.amount,
        amount_currency: deal.amount_currency || 'USD',
        recipient_email: invite.invitee_email || null,
        status: 'sent',
      });
    }
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

  private async getInvoicePartyDetails(
    client: ReturnType<SupabaseService['getClient']>,
    dealId: string,
    organizationId: string,
    recipientEmail: string | null,
  ): Promise<{ from_freelancer: InvoiceFromFreelancer; to_org: InvoiceToOrg }> {
    const { data: org } = await client
      .from('payroll_organizations')
      .select('name, address_line1, address_line2, city, state, postal_code, country, company_legal_name, company_registration_number')
      .eq('id', organizationId)
      .single();
    const to_org: InvoiceToOrg = {
      name: org?.name ?? '',
      address_line1: org?.address_line1 ?? null,
      address_line2: org?.address_line2 ?? null,
      city: org?.city ?? null,
      state: org?.state ?? null,
      postal_code: org?.postal_code ?? null,
      country: org?.country ?? null,
      company_legal_name: org?.company_legal_name ?? null,
      company_registration_number: org?.company_registration_number ?? null,
    };
    const { data: invite } = await client
      .from('deal_invites')
      .select('freelancer_profile_id')
      .eq('deal_id', dealId)
      .eq('status', 'accepted')
      .limit(1)
      .maybeSingle();
    let from_freelancer: InvoiceFromFreelancer = { email: recipientEmail ?? null };
    if (invite?.freelancer_profile_id) {
      const { data: fp } = await client
        .from('freelancer_profiles')
        .select('email, first_name, last_name, billing_address, tva_number')
        .eq('id', invite.freelancer_profile_id)
        .single();
      if (fp) {
        from_freelancer = {
          email: fp.email ?? recipientEmail ?? null,
          first_name: fp.first_name ?? null,
          last_name: fp.last_name ?? null,
          billing_address: fp.billing_address ?? null,
          tva_number: fp.tva_number ?? null,
        };
      }
    }
    // Fallback: use payroll_contributors (Your Profile) for name, address and business when missing
    const emailForLookup = (from_freelancer.email ?? recipientEmail)?.trim()?.toLowerCase();
    const needsName = !from_freelancer.first_name || !from_freelancer.last_name;
    const needsAddressOrBusiness =
      !from_freelancer.billing_address &&
      !from_freelancer.address_line1 &&
      !from_freelancer.business_name;
    if (emailForLookup && (needsName || needsAddressOrBusiness)) {
      const { data: contrib } = await client
        .from('payroll_contributors')
        .select(
          'first_name, last_name, address_line1, address_line2, city, state, postal_code, country, business_name, business_registration_number'
        )
        .eq('organization_id', organizationId)
        .eq('email', emailForLookup)
        .in('status', ['invited', 'joined'])
        .limit(1)
        .maybeSingle();
      const c = Array.isArray(contrib) ? contrib?.[0] : contrib;
      if (c) {
        from_freelancer = {
          ...from_freelancer,
          first_name: from_freelancer.first_name ?? c.first_name ?? null,
          last_name: from_freelancer.last_name ?? c.last_name ?? null,
          address_line1: from_freelancer.address_line1 ?? c.address_line1 ?? null,
          address_line2: from_freelancer.address_line2 ?? c.address_line2 ?? null,
          city: from_freelancer.city ?? c.city ?? null,
          state: from_freelancer.state ?? c.state ?? null,
          postal_code: from_freelancer.postal_code ?? c.postal_code ?? null,
          country: from_freelancer.country ?? c.country ?? null,
          business_name: from_freelancer.business_name ?? c.business_name ?? null,
          business_registration_number:
            from_freelancer.business_registration_number ?? c.business_registration_number ?? null,
        };
      }
    }
    return { from_freelancer, to_org };
  }

  async getInvoiceByDealId(organizationId: string, dealId: string, userId: string): Promise<(DealInvoiceResponse & { deal_title?: string; org_name?: string; from_freelancer?: InvoiceFromFreelancer; to_org?: InvoiceToOrg }) | null> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: row } = await client
      .from('deal_invoices')
      .select('id, deal_id, deal_payment_id, organization_id, amount, amount_currency, recipient_email, status, created_at')
      .eq('deal_id', dealId)
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();
    if (!row) return null;
    const { data: deal } = await client.from('deals').select('title').eq('id', dealId).single();
    const { from_freelancer, to_org } = await this.getInvoicePartyDetails(client, row.deal_id, row.organization_id, row.recipient_email ?? null);
    return {
      id: row.id,
      deal_id: row.deal_id,
      deal_payment_id: row.deal_payment_id ?? null,
      organization_id: row.organization_id,
      amount: row.amount,
      amount_currency: row.amount_currency,
      recipient_email: row.recipient_email ?? null,
      status: row.status,
      created_at: row.created_at,
      invoice_number: (row as any).invoice_number ?? null,
      receipt_on_chain_tx_hash: (row as any).receipt_on_chain_tx_hash ?? null,
      deal_title: deal?.title,
      org_name: to_org.name,
      from_freelancer,
      to_org,
    };
  }

  async getInvoice(organizationId: string, invoiceId: string, userId: string): Promise<DealInvoiceResponse & { deal_title?: string; org_name?: string; from_freelancer?: InvoiceFromFreelancer; to_org?: InvoiceToOrg }> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: row, error } = await client
      .from('deal_invoices')
      .select('id, deal_id, deal_payment_id, organization_id, amount, amount_currency, recipient_email, status, created_at')
      .eq('id', invoiceId)
      .maybeSingle();
    if (error) {
      this.logger.warn(`getInvoice failed for ${invoiceId}: ${error.message} (code: ${error.code})`);
      throw new NotFoundException('Invoice not found');
    }
    if (!row) {
      this.logger.warn(`getInvoice: no row for invoiceId=${invoiceId}, orgId=${organizationId}. Ensure backend uses SUPABASE_SERVICE_ROLE_KEY so RLS is bypassed.`);
      throw new NotFoundException('Invoice not found');
    }
    // Ensure invoice belongs to this org (row.organization_id or deal.organization_id)
    const invoiceOrgId = row.organization_id ?? null;
    let effectiveOrgId = invoiceOrgId ?? null;
    if (effectiveOrgId !== organizationId) {
      const { data: deal } = await client.from('deals').select('organization_id').eq('id', row.deal_id).maybeSingle();
      if (!deal || deal.organization_id !== organizationId) throw new NotFoundException('Invoice not found');
      effectiveOrgId = deal.organization_id;
    }
    const { data: deal } = await client.from('deals').select('title').eq('id', row.deal_id).single();
    const { from_freelancer, to_org } = await this.getInvoicePartyDetails(client, row.deal_id, effectiveOrgId ?? organizationId, row.recipient_email ?? null);
    return {
      id: row.id,
      deal_id: row.deal_id,
      deal_payment_id: row.deal_payment_id ?? null,
      organization_id: row.organization_id,
      amount: row.amount,
      amount_currency: row.amount_currency,
      recipient_email: row.recipient_email ?? null,
      status: row.status,
      created_at: row.created_at,
      invoice_number: (row as any).invoice_number ?? null,
      receipt_on_chain_tx_hash: (row as any).receipt_on_chain_tx_hash ?? null,
      deal_title: deal?.title,
      org_name: to_org.name,
      from_freelancer,
      to_org,
    };
  }

  async listInvoices(organizationId: string, userId: string): Promise<DealInvoiceResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deal_invoices')
      .select('id, deal_id, deal_payment_id, organization_id, amount, amount_currency, recipient_email, status, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list deal invoices:', error);
      throw new Error(`Database error: ${error.message}`);
    }
    return (data || []).map((row: any) => ({
      id: row.id,
      deal_id: row.deal_id,
      deal_payment_id: row.deal_payment_id ?? null,
      organization_id: row.organization_id,
      amount: row.amount,
      amount_currency: row.amount_currency,
      recipient_email: row.recipient_email ?? null,
      status: row.status,
      created_at: row.created_at,
      invoice_number: (row as any).invoice_number ?? null,
    }));
  }

  /**
   * List all invoices for the current user as freelancer, across all organizations.
   */
  async listAllMyInvoices(userId: string): Promise<(DealInvoiceResponse & { deal_title?: string; org_name?: string; invite_id?: string })[]> {
    const client = this.supabaseService.getClient();
    const { data: profile } = await client.from('freelancer_profiles').select('id, email').eq('user_id', userId).single();
    if (!profile?.email) return [];

    const [{ data: byProfile }, { data: byEmail }] = await Promise.all([
      client.from('deal_invites').select('id, deal_id').eq('status', 'accepted').eq('freelancer_profile_id', profile.id),
      client.from('deal_invites').select('id, deal_id, invitee_email').eq('status', 'accepted').eq('invitee_email', profile.email),
    ]);
    const byProfileList = byProfile || [];
    const byEmailList = (byEmail || []).filter(
      (i: { invitee_email?: string | null }) => !byProfileList.some((p: { deal_id: string }) => p.deal_id === (i as any).deal_id),
    );
    const myInvites = [...byProfileList, ...byEmailList];
    const uniqueDealIds = [...new Set(myInvites.map((i: { deal_id: string }) => i.deal_id))];
    if (!uniqueDealIds.length) return [];

    const dealIdToInviteId = new Map((myInvites as { deal_id: string; id: string }[]).map((i) => [i.deal_id, i.id]));

    const { data: rows, error } = await client
      .from('deal_invoices')
      .select('id, deal_id, deal_payment_id, organization_id, amount, amount_currency, recipient_email, status, created_at')
      .in('deal_id', uniqueDealIds)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list all my invoices:', error);
      return [];
    }
    if (!rows?.length) return [];

    const dealIds = [...new Set((rows as any[]).map((r) => r.deal_id))];
    const { data: deals } = await client.from('deals').select('id, title, organization_id').in('id', dealIds);
    const orgIds = [...new Set((deals || []).map((d: any) => d.organization_id))];
    const { data: orgs } = await client.from('payroll_organizations').select('id, name').in('id', orgIds);
    const dealMap = new Map((deals || []).map((d: any) => [d.id, { title: d.title, organization_id: d.organization_id }]));
    const orgMap = new Map((orgs || []).map((o: any) => [o.id, o.name]));

    return (rows as any[]).map((row) => {
      const deal = dealMap.get(row.deal_id);
      const orgName = deal ? orgMap.get(deal.organization_id) : undefined;
      return {
        id: row.id,
        deal_id: row.deal_id,
        deal_payment_id: row.deal_payment_id ?? null,
        organization_id: row.organization_id,
        amount: row.amount,
        amount_currency: row.amount_currency,
        recipient_email: row.recipient_email ?? null,
        status: row.status,
        created_at: row.created_at,
        invoice_number: (row as any).invoice_number ?? null,
        deal_title: deal?.title,
        org_name: orgName,
        invite_id: dealIdToInviteId.get(row.deal_id),
      };
    });
  }

  /**
   * List invoices for the current user as freelancer (invoices for deals where they have an accepted invite).
   * Does not require org membership.
   */
  async listMyInvoicesForOrg(organizationId: string, userId: string): Promise<DealInvoiceResponse[]> {
    const client = this.supabaseService.getClient();
    const { data: org } = await client.from('payroll_organizations').select('id, name').eq('id', organizationId).single();
    if (!org) throw new NotFoundException('Organization not found');

    const { data: profile } = await client.from('freelancer_profiles').select('id, email').eq('user_id', userId).single();
    if (!profile?.email) return [];

    const { data: orgDeals } = await client.from('deals').select('id, title').eq('organization_id', organizationId);
    if (!orgDeals?.length) return [];
    const dealIdsInOrg = (orgDeals as { id: string }[]).map((d) => d.id);

    const { data: invites } = await client
      .from('deal_invites')
      .select('id, deal_id, freelancer_profile_id, invitee_email')
      .in('deal_id', dealIdsInOrg)
      .eq('status', 'accepted');
    const myInvites = (invites || []).filter(
      (i: { freelancer_profile_id: string | null; invitee_email: string | null }) =>
        i.freelancer_profile_id === profile.id ||
        (i.invitee_email && i.invitee_email.toLowerCase() === profile.email.toLowerCase()),
    );
    const uniqueDealIds = [...new Set(myInvites.map((i: { deal_id: string }) => i.deal_id))];
    if (!uniqueDealIds.length) return [];

    const dealIdToInviteId = new Map((myInvites as { deal_id: string; id: string }[]).map((i) => [i.deal_id, i.id]));

    const { data: rows, error } = await client
      .from('deal_invoices')
      .select('id, deal_id, deal_payment_id, organization_id, amount, amount_currency, recipient_email, status, created_at')
      .in('deal_id', uniqueDealIds)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list my invoices:', error);
      return [];
    }
    const dealMap = new Map((orgDeals as { id: string; title: string }[]).map((d) => [d.id, d.title]));
    return (rows || []).map((row: any) => ({
      id: row.id,
      deal_id: row.deal_id,
      deal_payment_id: row.deal_payment_id ?? null,
      organization_id: row.organization_id,
      amount: row.amount,
      amount_currency: row.amount_currency,
      recipient_email: row.recipient_email ?? null,
      status: row.status,
      created_at: row.created_at,
      invoice_number: (row as any).invoice_number ?? null,
      deal_title: dealMap.get(row.deal_id) ?? undefined,
      org_name: org.name,
      invite_id: dealIdToInviteId.get(row.deal_id) ?? undefined,
    }));
  }

  /** Get invoice for a deal by invite (freelancer view). Caller must be the invitee. */
  async getInvoiceForInvite(inviteId: string, userId: string): Promise<(DealInvoiceResponse & { deal_title?: string; org_name?: string; from_freelancer?: InvoiceFromFreelancer; to_org?: InvoiceToOrg }) | null> {
    const client = this.supabaseService.getClient();
    const { data: invite } = await client.from('deal_invites').select('id, deal_id, invitee_email, freelancer_profile_id').eq('id', inviteId).single();
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.freelancer_profile_id) {
      const { data: profile } = await client.from('freelancer_profiles').select('user_id').eq('id', invite.freelancer_profile_id).single();
      if (!profile || profile.user_id !== userId) throw new ForbiddenException('You do not have access to this invite');
    } else {
      const { data: profile } = await client.from('freelancer_profiles').select('email').eq('user_id', userId).single();
      if (!profile || profile.email?.toLowerCase() !== invite.invitee_email?.toLowerCase()) throw new ForbiddenException('You do not have access to this invite');
    }
    const { data: row } = await client
      .from('deal_invoices')
      .select('id, deal_id, deal_payment_id, organization_id, amount, amount_currency, recipient_email, status, created_at')
      .eq('deal_id', invite.deal_id)
      .limit(1)
      .maybeSingle();
    if (!row) return null;
    const { data: deal } = await client.from('deals').select('title').eq('id', invite.deal_id).single();
    const { from_freelancer, to_org } = await this.getInvoicePartyDetails(client, row.deal_id, row.organization_id, row.recipient_email ?? null);
    return {
      id: row.id,
      deal_id: row.deal_id,
      deal_payment_id: row.deal_payment_id ?? null,
      organization_id: row.organization_id,
      amount: row.amount,
      amount_currency: row.amount_currency,
      recipient_email: row.recipient_email ?? null,
      status: row.status,
      created_at: row.created_at,
      receipt_on_chain_tx_hash: (row as any).receipt_on_chain_tx_hash ?? null,
      invoice_number: (row as any).invoice_number ?? null,
      deal_title: deal?.title,
      org_name: to_org.name,
      from_freelancer,
      to_org,
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
