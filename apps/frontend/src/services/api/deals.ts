/**
 * Deals & freelancer API (payroll product)
 */

import { fetchApi } from './client';

export interface DealResponse {
  id: string;
  organization_id: string;
  created_by: string;
  title: string;
  description: string | null;
  instructions: string | null;
  contract_attachment_path: string | null;
  contract_attachment_url?: string | null;
  amount: string;
  amount_currency: string;
  status: string;
  deadline: string | null;
  delivery_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  invites?: DealInviteResponse[];
}

export interface DealInviteResponse {
  id: string;
  deal_id: string;
  freelancer_profile_id: string | null;
  invitee_email: string;
  status: string;
  request_changes_message: string | null;
  preferred_network: string | null;
  preferred_token_symbol: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealPaymentResponse {
  id: string;
  deal_id: string;
  deal_invite_id: string;
  organization_id: string;
  amount: string;
  amount_currency: string;
  recipient_wallet: string;
  recipient_email?: string | null;
  preferred_network: string;
  preferred_token_symbol: string;
  status: string;
  deposit_address: string | null;
  intent_deadline: string | null;
  tx_hash: string | null;
  created_at: string;
  updated_at: string;
  /** From preparePay (same $→token as c/[id]) */
  minAmountInFormatted?: string;
  timeEstimate?: number;
  memo?: string | null;
  /** Linked invoice id (for list view link) */
  invoice_id?: string;
  /** When completed: invoice receipt on-chain (from linked invoice) */
  receipt_on_chain_tx_hash?: string | null;
}

export interface DealCommentResponse {
  id: string;
  deal_id: string;
  author_user_id: string;
  author_display: string;
  body: string;
  created_at: string;
}

export interface InvoiceFromFreelancer {
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  billing_address?: string | null;
  tva_number?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  business_name?: string | null;
  business_registration_number?: string | null;
}

export interface InvoiceToOrg {
  name: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  company_legal_name?: string | null;
  company_registration_number?: string | null;
}

export interface DealInvoiceResponse {
  id: string;
  deal_id: string;
  deal_payment_id: string | null;
  organization_id: string;
  amount: string;
  amount_currency: string;
  recipient_email: string | null;
  status: string;
  created_at: string;
  invoice_number?: string | null;
  /** NEAR tx hash when receipt was recorded on-chain (paid invoices) */
  receipt_on_chain_tx_hash?: string | null;
  deal_title?: string;
  org_name?: string;
  from_freelancer?: InvoiceFromFreelancer;
  to_org?: InvoiceToOrg;
}

export const dealsApi = {
  deals: {
    list(orgId: string, userId?: string): Promise<DealResponse[]> {
      return fetchApi<DealResponse[]>(`/payroll/organizations/${orgId}/deals`, { userId });
    },
    listMyInvites(orgId: string, userId?: string): Promise<Array<{ deal: DealResponse; invite: DealInviteResponse }>> {
      return fetchApi<Array<{ deal: DealResponse; invite: DealInviteResponse }>>(`/payroll/organizations/${orgId}/deals/my-invites`, { userId });
    },
    get(orgId: string, dealId: string, userId?: string): Promise<DealResponse> {
      return fetchApi<DealResponse>(`/payroll/organizations/${orgId}/deals/${dealId}`, { userId });
    },
    create(orgId: string, data: { title: string; description?: string; instructions?: string; amount: string; amount_currency?: string; deadline?: string }, userId?: string): Promise<DealResponse> {
      return fetchApi<DealResponse>(`/payroll/organizations/${orgId}/deals`, {
        method: 'POST',
        body: JSON.stringify(data),
        userId,
      });
    },
    update(orgId: string, dealId: string, data: Partial<{ title: string; description: string; instructions: string; amount: string; amount_currency: string; deadline: string }>, userId?: string): Promise<DealResponse> {
      return fetchApi<DealResponse>(`/payroll/organizations/${orgId}/deals/${dealId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
        userId,
      });
    },
    uploadContract(orgId: string, dealId: string, file: File, userId?: string): Promise<{ url: string }> {
      const form = new FormData();
      form.append('file', file);
      const headers: Record<string, string> = {};
      if (userId) headers['x-privy-user-id'] = userId;
      return fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001'}/payroll/organizations/${orgId}/deals/${dealId}/contract`, {
        method: 'POST',
        body: form,
        headers,
      }).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Upload failed'))));
    },
    invite(orgId: string, dealId: string, data: { invitee_email: string }, userId?: string): Promise<DealInviteResponse> {
      return fetchApi<DealInviteResponse>(`/payroll/organizations/${orgId}/deals/${dealId}/invites`, {
        method: 'POST',
        body: JSON.stringify(data),
        userId,
      });
    },
    acceptDelivery(orgId: string, dealId: string, userId?: string): Promise<DealPaymentResponse> {
      return fetchApi<DealPaymentResponse>(`/payroll/organizations/${orgId}/deals/${dealId}/accept-delivery`, {
        method: 'POST',
        userId,
      });
    },
    createDispute(orgId: string, dealId: string, userId?: string): Promise<DealResponse> {
      return fetchApi<DealResponse>(`/payroll/organizations/${orgId}/deals/${dealId}/dispute`, {
        method: 'POST',
        userId,
      });
    },
    listComments(orgId: string, dealId: string, userId?: string): Promise<DealCommentResponse[]> {
      return fetchApi<DealCommentResponse[]>(`/payroll/organizations/${orgId}/deals/${dealId}/comments`, { userId });
    },
    addComment(orgId: string, dealId: string, body: string, userId?: string): Promise<DealCommentResponse> {
      return fetchApi<DealCommentResponse>(`/payroll/organizations/${orgId}/deals/${dealId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
        userId,
      });
    },
  },
  invoices: {
    list(orgId: string, userId?: string): Promise<DealInvoiceResponse[]> {
      return fetchApi<DealInvoiceResponse[]>(`/payroll/organizations/${orgId}/invoices`, { userId });
    },
    listMine(orgId: string, userId?: string): Promise<DealInvoiceResponse[]> {
      return fetchApi<DealInvoiceResponse[]>(`/payroll/organizations/${orgId}/invoices/mine`, { userId });
    },
    listAllMine(userId?: string): Promise<(DealInvoiceResponse & { deal_title?: string; org_name?: string; invite_id?: string })[]> {
      return fetchApi(`/payroll/my-invoices`, { userId });
    },
    get(orgId: string, invoiceId: string, userId?: string): Promise<DealInvoiceResponse> {
      return fetchApi<DealInvoiceResponse>(`/payroll/organizations/${orgId}/invoices/${invoiceId}`, { userId });
    },
    getByDeal(orgId: string, dealId: string, userId?: string): Promise<DealInvoiceResponse | null> {
      return fetchApi<DealInvoiceResponse | null>(`/payroll/organizations/${orgId}/deals/${dealId}/invoice`, { userId });
    },
  },

  invite: {
    get(
      inviteId: string,
      userId?: string,
    ): Promise<{ invite: DealInviteResponse; deal: DealResponse; contributor_payout?: { network: string; token_symbol: string } }> {
      return fetchApi<{ invite: DealInviteResponse; deal: DealResponse; contributor_payout?: { network: string; token_symbol: string } }>(
        `/deal-invites/${inviteId}`,
        { userId },
      );
    },
    listPayments(inviteId: string, userId?: string): Promise<DealPaymentResponse[]> {
      return fetchApi<DealPaymentResponse[]>(`/deal-invites/${inviteId}/payments`, { userId });
    },
    getInvoice(inviteId: string, userId?: string): Promise<DealInvoiceResponse | null> {
      return fetchApi<DealInvoiceResponse | null>(`/deal-invites/${inviteId}/invoice`, { userId });
    },
    accept(inviteId: string, data: { preferred_network?: string; preferred_token_symbol?: string }, userId?: string): Promise<DealInviteResponse> {
      return fetchApi<DealInviteResponse>(`/deal-invites/${inviteId}/accept`, {
        method: 'PUT',
        body: JSON.stringify(data),
        userId,
      });
    },
    decline(inviteId: string, userId?: string): Promise<DealInviteResponse> {
      return fetchApi<DealInviteResponse>(`/deal-invites/${inviteId}/decline`, { method: 'PUT', userId });
    },
    requestChanges(inviteId: string, data: { message: string }, userId?: string): Promise<DealInviteResponse> {
      return fetchApi<DealInviteResponse>(`/deal-invites/${inviteId}/request-changes`, {
        method: 'PUT',
        body: JSON.stringify(data),
        userId,
      });
    },
    confirmDelivery(inviteId: string, userId?: string): Promise<DealResponse> {
      return fetchApi<DealResponse>(`/deal-invites/${inviteId}/confirm-delivery`, {
        method: 'POST',
        userId,
      });
    },
  },

  payments: {
    listPending(orgId: string, userId?: string): Promise<DealPaymentResponse[]> {
      return fetchApi<DealPaymentResponse[]>(`/payroll/organizations/${orgId}/deal-payments/pending`, { userId });
    },
    listOutstanding(orgId: string, userId?: string): Promise<DealPaymentResponse[]> {
      return fetchApi<DealPaymentResponse[]>(`/payroll/organizations/${orgId}/deal-payments/outstanding`, { userId });
    },
    listCompleted(orgId: string, userId?: string): Promise<DealPaymentResponse[]> {
      return fetchApi<DealPaymentResponse[]>(`/payroll/organizations/${orgId}/deal-payments/completed`, { userId });
    },
    get(orgId: string, paymentId: string, userId?: string): Promise<DealPaymentResponse | null> {
      return fetchApi<DealPaymentResponse | null>(`/payroll/organizations/${orgId}/deal-payments/${paymentId}`, { userId });
    },
    retryReceipt(orgId: string, paymentId: string, userId?: string): Promise<{ receiptPosted: boolean; receiptOnChainTxHash?: string | null; error?: string }> {
      return fetchApi(`/payroll/organizations/${orgId}/deal-payments/${paymentId}/retry-receipt`, {
        method: 'POST',
        userId,
      });
    },
    preparePay(
      orgId: string,
      paymentIds: string[],
      userId?: string,
      payWithToken?: { symbol: string; chain: string; tokenId?: string; decimals?: number },
      refundAddress?: string,
    ): Promise<DealPaymentResponse[]> {
      return fetchApi<DealPaymentResponse[]>(`/payroll/organizations/${orgId}/deal-payments/prepare-pay`, {
        method: 'POST',
        body: JSON.stringify({
          paymentIds,
          ...(payWithToken && { payWithToken }),
          ...(refundAddress?.trim() && { refundAddress: refundAddress.trim() }),
        }),
        userId,
      });
    },
    delete(orgId: string, paymentId: string, userId?: string): Promise<void> {
      return fetchApi<void>(`/payroll/organizations/${orgId}/deal-payments/${paymentId}`, {
        method: 'DELETE',
        userId,
      });
    },
    markCompleted(orgId: string, paymentId: string, txHash: string, userId?: string): Promise<DealPaymentResponse> {
      return fetchApi<DealPaymentResponse>(`/payroll/organizations/${orgId}/deal-payments/${paymentId}/mark-completed`, {
        method: 'POST',
        body: JSON.stringify({ txHash }),
        userId,
      });
    },
    checkComplete(orgId: string, paymentId: string, userId?: string): Promise<{ completed: boolean; payment?: DealPaymentResponse; status?: string; normalizedStatus?: string }> {
      return fetchApi(`/payroll/organizations/${orgId}/deal-payments/${paymentId}/check-complete`, { userId });
    },
    resetToPending(orgId: string, paymentId: string, userId?: string): Promise<DealPaymentResponse> {
      return fetchApi<DealPaymentResponse>(`/payroll/organizations/${orgId}/deal-payments/${paymentId}/reset-to-pending`, {
        method: 'PUT',
        userId,
      });
    },
  },

  freelancerProfile: {
    get(userId?: string): Promise<FreelancerProfileResponse | null> {
      return fetchApi<FreelancerProfileResponse | null>('/freelancer-profile', { userId });
    },
    create(data: CreateFreelancerProfileDto, userId?: string): Promise<FreelancerProfileResponse> {
      return fetchApi<FreelancerProfileResponse>('/freelancer-profile', {
        method: 'POST',
        body: JSON.stringify(data),
        userId,
      });
    },
    update(data: UpdateFreelancerProfileDto, userId?: string): Promise<FreelancerProfileResponse> {
      return fetchApi<FreelancerProfileResponse>('/freelancer-profile', {
        method: 'PUT',
        body: JSON.stringify(data),
        userId,
      });
    },
  },
};

export interface FreelancerProfileResponse {
  id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  wallet_address: string | null;
  preferred_network: string | null;
  preferred_token_symbol: string | null;
  billing_address: string | null;
  tva_number: string | null;
  verify_service: string | null;
  verify_status: string;
  kyc_required: boolean;
  kyc_status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateFreelancerProfileDto {
  email: string;
  first_name?: string;
  last_name?: string;
  wallet_address?: string;
  preferred_network?: string;
  preferred_token_symbol?: string;
  billing_address?: string;
  tva_number?: string;
  verify_service?: string;
  kyc_required?: boolean;
}

export interface UpdateFreelancerProfileDto {
  first_name?: string;
  last_name?: string;
  wallet_address?: string;
  preferred_network?: string;
  preferred_token_symbol?: string;
  billing_address?: string;
  tva_number?: string;
  verify_service?: string;
  kyc_required?: boolean;
}
