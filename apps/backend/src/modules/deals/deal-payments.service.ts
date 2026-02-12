import * as crypto from 'crypto';
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { PayrollReceiptLoggerService } from '../payroll/payroll-receipt-logger.service';
import { DealPaymentResponse } from './dto';

@Injectable()
export class DealPaymentsService {
  private readonly logger = new Logger(DealPaymentsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly nearIntentsService: NearIntentsService,
    private readonly receiptLogger: PayrollReceiptLoggerService,
  ) {}

  private async checkOrgAccess(organizationId: string, userId: string): Promise<void> {
    const client = this.supabaseService.getClient();
    const { data: org } = await client.from('payroll_organizations').select('id, owner_id').eq('id', organizationId).single();
    if (!org) throw new NotFoundException('Organization not found');
    if (org.owner_id === userId) return;
    const { data: member } = await client.from('payroll_org_members').select('role').eq('organization_id', organizationId).eq('user_id', userId).single();
    if (!member) throw new ForbiddenException('You do not have access to this organization');
  }

  /**
   * List payments for a deal invite (freelancer view). Caller must be the invitee (accepted invite linked to their freelancer profile).
   */
  async listForInvite(inviteId: string, userId: string): Promise<DealPaymentResponse[]> {
    const client = this.supabaseService.getClient();
    const { data: invite } = await client.from('deal_invites').select('id, freelancer_profile_id').eq('id', inviteId).single();
    if (!invite) throw new NotFoundException('Invite not found');
    const { data: profile } = await client.from('freelancer_profiles').select('id').eq('user_id', userId).single();
    if (!profile || invite.freelancer_profile_id !== profile.id) {
      throw new ForbiddenException('You do not have access to this invite');
    }
    const { data, error } = await client
      .from('deal_payments')
      .select('*')
      .eq('deal_invite_id', inviteId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Database error: ${error.message}`);
    return (data || []).map((row) => this.toResponse(row));
  }

  async listPending(organizationId: string, userId: string): Promise<DealPaymentResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deal_payments')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Database error: ${error.message}`);
    return (data || []).map((row) => this.toResponse(row));
  }

  /** List payments that are pending or processing (so org can see prepared ones and mark completed when paid). */
  async listOutstanding(organizationId: string, userId: string): Promise<DealPaymentResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deal_payments')
      .select('*')
      .eq('organization_id', organizationId)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Database error: ${error.message}`);
    return (data || []).map((row) => this.toResponse(row));
  }

  /**
   * Create intents (deposit addresses) for selected pending payments. Returns payments with deposit_address and intent_deadline set.
   */
  async preparePay(organizationId: string, paymentIds: string[], userId: string): Promise<DealPaymentResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: payments, error: fetchErr } = await client
      .from('deal_payments')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .in('id', paymentIds);
    if (fetchErr || !payments?.length) throw new BadRequestException('No pending payments found');
    const tokens = await this.nearIntentsService.getTokens();
    const results: DealPaymentResponse[] = [];
    for (const p of payments) {
      const fromToken = tokens.find(
        (t) =>
          t.symbol.toUpperCase() === (p.preferred_token_symbol || 'USDC').toUpperCase() &&
          (t.chain.toLowerCase() === (p.preferred_network || 'base').toLowerCase() || (p.preferred_network === 'solana' && t.chain === 'sol')),
      );
      if (!fromToken?.tokenId) {
        this.logger.warn(`Token not found for payment ${p.id}, skipping`);
        continue;
      }
      try {
        const quote = await this.nearIntentsService.getDepositQuote({
          fromToken: { tokenId: fromToken.tokenId, chain: fromToken.chain, symbol: fromToken.symbol, decimals: fromToken.decimals },
          toToken: { tokenId: fromToken.tokenId, chain: fromToken.chain, symbol: fromToken.symbol, decimals: fromToken.decimals },
          amountIn: p.amount,
          recipient: p.recipient_wallet,
          useExactOutput: false,
        });
        if (quote.error || !quote.depositAddress) {
          this.logger.warn(`Quote failed for payment ${p.id}:`, quote.error);
          continue;
        }
        await client
          .from('deal_payments')
          .update({
            deposit_address: quote.depositAddress,
            intent_deadline: quote.deadline ?? null,
            status: 'processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id);
        const { data: updated } = await client.from('deal_payments').select('*').eq('id', p.id).single();
        if (updated) results.push(this.toResponse(updated));
      } catch (e) {
        this.logger.warn(`Intent creation failed for payment ${p.id}:`, (e as Error).message);
      }
    }
    return results;
  }

  /**
   * Delete a pending payment. Unlinks invoice (deal_payment_id = null), reverts deal to delivered, then deletes.
   */
  async deletePayment(organizationId: string, paymentId: string, userId: string): Promise<void> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: payment } = await client
      .from('deal_payments')
      .select('id, deal_id, status')
      .eq('id', paymentId)
      .eq('organization_id', organizationId)
      .single();
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'pending') {
      throw new BadRequestException('Only pending payments can be deleted');
    }
    await client.from('deal_invoices').update({ deal_payment_id: null }).eq('deal_payment_id', paymentId);
    await client.from('deals').update({ status: 'delivered', updated_at: new Date().toISOString() }).eq('id', payment.deal_id);
    const { error } = await client.from('deal_payments').delete().eq('id', paymentId);
    if (error) throw new Error(`Database error: ${error.message}`);
  }

  /**
   * Mark payment as completed (e.g. after intent execution). Sets invoice to paid and posts attestation on-chain.
   */
  async markCompleted(organizationId: string, paymentId: string, txHash: string, userId: string): Promise<DealPaymentResponse> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: payment } = await client
      .from('deal_payments')
      .select('*')
      .eq('id', paymentId)
      .eq('organization_id', organizationId)
      .single();
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'completed') return this.toResponse(payment);

    const { data: invoice } = await client
      .from('deal_invoices')
      .select('id, deal_id, amount, amount_currency, organization_id')
      .eq('deal_payment_id', paymentId)
      .single();
    if (!invoice) throw new BadRequestException('No invoice linked to this payment');

    await client
      .from('deal_payments')
      .update({ status: 'completed', tx_hash: txHash, updated_at: new Date().toISOString() })
      .eq('id', paymentId);
    await client.from('deal_invoices').update({ status: 'paid' }).eq('id', invoice.id);

    const batchHash = crypto
      .createHash('sha256')
      .update([invoice.id, invoice.deal_id, invoice.amount, invoice.amount_currency, 'paid'].join('|'))
      .digest('hex');
    const nonce = Number(
      BigInt('0x' + crypto.createHash('sha256').update(invoice.id).digest('hex').slice(0, 12)) % BigInt(Number.MAX_SAFE_INTEGER),
    );
    const receiptTx = await this.receiptLogger.postReceipt({
      payrollId: invoice.id,
      batchHash,
      authorizerId: organizationId,
      nonce,
      executorId: 'deal-payment',
      status: 'success',
      txHashes: [txHash],
    });
    if (receiptTx) {
      await client.from('deal_invoices').update({ receipt_on_chain_tx_hash: receiptTx }).eq('id', invoice.id);
    }

    const { data: updated } = await client.from('deal_payments').select('*').eq('id', paymentId).single();
    return this.toResponse(updated);
  }

  private toResponse(row: any): DealPaymentResponse {
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
