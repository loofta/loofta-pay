import * as crypto from 'crypto';
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { NearIntentsService, NearToken } from '../intents/near-intents.service';
import { StatusService } from '../intents/status.service';
import { PayrollReceiptLoggerService } from '../payroll/payroll-receipt-logger.service';
import { DealPaymentResponse } from './dto';

export interface CheckAndCompleteResult {
  completed: boolean;
  payment?: DealPaymentResponse;
  status?: string;
  normalizedStatus?: string;
}

@Injectable()
export class DealPaymentsService {
  private readonly logger = new Logger(DealPaymentsService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly nearIntentsService: NearIntentsService,
    private readonly statusService: StatusService,
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
      .select('*, deal_invites(invitee_email)')
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Database error: ${error.message}`);
    return (data || []).map((row) => this.toResponse(row));
  }

  /** List payments that are pending or processing. Does not create deposit addresses; org clicks Pay to select network and proceed with NEAR Intent. */
  async listOutstanding(organizationId: string, userId: string): Promise<DealPaymentResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deal_payments')
      .select('*, deal_invites(invitee_email)')
      .eq('organization_id', organizationId)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Database error: ${error.message}`);
    const rows = data || [];
    const paymentIds = rows.map((r: any) => r.id);
    const invoiceByPayment: Record<string, string> = {};
    if (paymentIds.length > 0) {
      const { data: invoices } = await client
        .from('deal_invoices')
        .select('id, deal_payment_id')
        .in('deal_payment_id', paymentIds);
      (invoices || []).forEach((inv: any) => {
        if (inv.deal_payment_id) invoiceByPayment[inv.deal_payment_id] = inv.id;
      });
    }
    return rows.map((row: any) => this.toResponse({ ...row, invoice_id: invoiceByPayment[row.id] }));
  }

  /**
   * Create intents (deposit addresses) for selected pending payments. Returns payments with deposit_address and intent_deadline set.
   * Uses same token resolution as c/[id] (NearIntentsService.findToken). When payWithToken is provided, use that token.
   */
  async preparePay(
    organizationId: string,
    paymentIds: string[],
    userId: string,
    payWithToken?: { symbol: string; chain: string; tokenId?: string; decimals?: number },
    refundAddress?: string,
  ): Promise<DealPaymentResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    // Allow both pending and processing so "Cancel and choose another token" can get a new deposit address
    const { data: payments, error: fetchErr } = await client
      .from('deal_payments')
      .select('*')
      .eq('organization_id', organizationId)
      .in('status', ['pending', 'processing'])
      .in('id', paymentIds);
    if (fetchErr || !payments?.length) throw new BadRequestException('No eligible payments found');
    const results: DealPaymentResponse[] = [];
    let fromTokenOverride: NearToken | null = null;
    if (payWithToken?.symbol && payWithToken?.chain) {
      if (payWithToken.tokenId) {
        const tokens = await this.nearIntentsService.getTokens();
        const byId = tokens.find((t) => t.tokenId === payWithToken!.tokenId);
        if (byId?.tokenId && typeof byId.decimals === 'number') {
          fromTokenOverride = byId;
        }
      }
      if (!fromTokenOverride) {
        fromTokenOverride = await this.nearIntentsService.findToken(payWithToken.symbol, payWithToken.chain);
        if (!fromTokenOverride) {
          this.logger.warn(`payWithToken not found in intents list: ${payWithToken.symbol} on ${payWithToken.chain}`);
        }
      }
    }
    for (const p of payments) {
      // fromToken = what the org pays with (payWithToken override or payment default)
      const fromToken =
        fromTokenOverride ||
        (await this.nearIntentsService.findToken(p.preferred_token_symbol || 'USDC', p.preferred_network || 'base'));
      if (!fromToken?.tokenId) {
        this.logger.warn(
          `Token not found for payment ${p.id} (${p.preferred_token_symbol}/${p.preferred_network}). ` +
            `Use payWithToken to choose a supported token (e.g. USDC on base).`,
        );
        continue;
      }
      // toToken = what the recipient receives (DESTINATION_CHAIN must match recipient's chain)
      // Infer destination chain from recipient address when clearly Solana (so we don't send Base USDC to a Solana address).
      const isSolanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((p.recipient_wallet || '').trim()) && !(p.recipient_wallet || '').startsWith('0x');
      const destChain = isSolanaAddress ? 'solana' : (p.preferred_network || 'base');
      const destSymbol = p.preferred_token_symbol || 'USDC';
      const toToken = await this.nearIntentsService.findToken(destSymbol, destChain);
      if (!toToken?.tokenId) {
        this.logger.warn(
          `Destination token not found for payment ${p.id} (${destSymbol} on ${destChain}). Recipient chain must match destination asset.`,
        );
        continue;
      }
      try {
        // Same request shape as c/[id]: EXACT_OUTPUT, originAsset=fromToken, destinationAsset=toToken, recipientType=DESTINATION_CHAIN
        const quote = await this.nearIntentsService.getDepositQuote({
          fromToken: {
            tokenId: fromToken.tokenId,
            chain: fromToken.chain,
            symbol: fromToken.symbol,
            decimals: fromToken.decimals,
          },
          toToken: {
            tokenId: toToken.tokenId,
            chain: toToken.chain,
            symbol: toToken.symbol,
            decimals: toToken.decimals,
          },
          amountOut: p.amount,
          recipient: p.recipient_wallet,
          refundAddress: refundAddress?.trim() || undefined,
          useExactOutput: true,
          referral: 'loofta',
        });
        if (quote.error || !quote.depositAddress) {
          this.logger.warn(`Quote failed for payment ${p.id}:`, quote.error);
          continue;
        }
        // Do not overwrite preferred_network / preferred_token_symbol: they are the recipient's destination chain/token.
        // Overwriting with fromToken (pay-with token) would make destination = origin and break DESTINATION_CHAIN (e.g. Solana recipient).
        const updatePayload: Record<string, unknown> = {
          deposit_address: quote.depositAddress,
          intent_deadline: quote.deadline ?? null,
          status: 'processing',
          updated_at: new Date().toISOString(),
        };
        await client.from('deal_payments').update(updatePayload).eq('id', p.id);
        const { data: updated } = await client.from('deal_payments').select('*, deal_invites(invitee_email)').eq('id', p.id).single();
        if (updated) {
          const resp: DealPaymentResponse = this.toResponse(updated);
          resp.minAmountInFormatted = quote.minAmountInFormatted ?? undefined;
          resp.timeEstimate = quote.timeEstimate ?? undefined;
          resp.memo = quote.memo ?? undefined;
          results.push(resp);
        }
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
   * Check intent status by deposit address; if completed with txHash, mark payment and invoice paid and post on-chain receipt.
   */
  async checkAndComplete(organizationId: string, paymentId: string, userId: string): Promise<CheckAndCompleteResult> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: payment } = await client
      .from('deal_payments')
      .select('*')
      .eq('id', paymentId)
      .eq('organization_id', organizationId)
      .single();
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'completed') {
      return { completed: true, payment: this.toResponse(payment) };
    }
    if (payment.status !== 'processing' || !payment.deposit_address) {
      return { completed: false, status: payment.status, normalizedStatus: payment.status };
    }
    try {
      const intentStatus = await this.statusService.getStatus({ depositAddress: payment.deposit_address });
      if (intentStatus.normalizedStatus === 'completed') {
        const txHash =
          intentStatus.txHash ||
          (intentStatus.raw?.swapDetails?.destinationChainTxHashes?.[0]) ||
          (intentStatus.raw?.swapDetails?.withdrawTxHashes?.[0]) ||
          (Array.isArray((intentStatus.raw as any)?.destinationChainTxHashes) && (intentStatus.raw as any).destinationChainTxHashes[0]) ||
          `intent:${payment.deposit_address}`;
        const updated = await this.markCompleted(organizationId, paymentId, txHash, userId);
        return { completed: true, payment: updated };
      }
      return {
        completed: false,
        status: intentStatus.status,
        normalizedStatus: intentStatus.normalizedStatus,
      };
    } catch (e) {
      this.logger.warn(`checkAndComplete for payment ${paymentId}:`, (e as Error).message);
      return { completed: false, status: 'unknown', normalizedStatus: 'unknown' };
    }
  }

  /**
   * Reset a processing (or expired) payment back to pending so org can "Prepare pay" again.
   */
  async resetToPending(organizationId: string, paymentId: string, userId: string): Promise<DealPaymentResponse> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: payment } = await client
      .from('deal_payments')
      .select('id, status')
      .eq('id', paymentId)
      .eq('organization_id', organizationId)
      .single();
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'processing') {
      throw new BadRequestException('Only processing payments can be reset (e.g. after intent expired)');
    }
    const { data: updated, error } = await client
      .from('deal_payments')
      .update({
        status: 'pending',
        deposit_address: null,
        intent_deadline: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentId)
      .eq('organization_id', organizationId)
      .select()
      .single();
    if (error) throw new Error(`Database error: ${error.message}`);
    return this.toResponse(updated);
  }

  /**
   * List completed payments (for Pay list "Completed" section). Most recent first, limited.
   */
  async listCompleted(organizationId: string, userId: string, limit = 50): Promise<DealPaymentResponse[]> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deal_payments')
      .select('*, deal_invites(invitee_email)')
      .eq('organization_id', organizationId)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    const paymentIds = (data || []).map((r: any) => r.id);
    const invoiceByPayment: Record<string, string> = {};
    const receiptByPayment: Record<string, string | null> = {};
    if (paymentIds.length > 0) {
      const { data: invoices } = await client
        .from('deal_invoices')
        .select('id, deal_payment_id, receipt_on_chain_tx_hash')
        .in('deal_payment_id', paymentIds);
      (invoices || []).forEach((inv: any) => {
        if (inv.deal_payment_id) {
          invoiceByPayment[inv.deal_payment_id] = inv.id;
          receiptByPayment[inv.deal_payment_id] = inv.receipt_on_chain_tx_hash ?? null;
        }
      });
    }
    return (data || []).map((row: any) =>
      this.toResponse({
        ...row,
        invoice_id: invoiceByPayment[row.id],
        receipt_on_chain_tx_hash: receiptByPayment[row.id],
      }),
    );
  }

  /**
   * Get a single payment by id (any status). Used for payment detail view including completed.
   */
  async getById(organizationId: string, paymentId: string, userId: string): Promise<DealPaymentResponse | null> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data, error } = await client
      .from('deal_payments')
      .select('*, deal_invites(invitee_email)')
      .eq('id', paymentId)
      .eq('organization_id', organizationId)
      .single();
    if (error || !data) return null;
    const { data: invoice } = await client
      .from('deal_invoices')
      .select('id, receipt_on_chain_tx_hash')
      .eq('deal_payment_id', paymentId)
      .single();
    return this.toResponse({
      ...data,
      invoice_id: invoice?.id,
      receipt_on_chain_tx_hash: invoice?.receipt_on_chain_tx_hash ?? null,
    });
  }

  /**
   * Retry posting on-chain receipt for a completed payment (idempotent; no-op if receipt already set).
   * Always returns error message when receiptPosted is false so the client can show it.
   */
  async retryReceiptForPayment(organizationId: string, paymentId: string, userId: string): Promise<{ receiptPosted: boolean; receiptOnChainTxHash?: string | null; error?: string }> {
    await this.checkOrgAccess(organizationId, userId);
    const client = this.supabaseService.getClient();
    const { data: payment } = await client
      .from('deal_payments')
      .select('id, status, tx_hash')
      .eq('id', paymentId)
      .eq('organization_id', organizationId)
      .single();
    if (!payment) {
      this.logger.warn(`retry-receipt: payment not found ${paymentId}`);
      return { receiptPosted: false, error: 'Payment not found' };
    }
    if (payment.status !== 'completed' || !payment.tx_hash) {
      this.logger.warn(`retry-receipt: payment ${paymentId} not completed or missing tx_hash (status=${payment.status})`);
      return { receiptPosted: false, error: 'Payment must be completed with a tx hash before posting receipt' };
    }
    // Select without receipt_on_chain_tx_hash so this works even if that column migration hasn't run
    const invoiceCols = 'id, deal_id, amount, amount_currency, organization_id';
    let invoice: { id: string; deal_id: string; amount: number; amount_currency: string; organization_id: string } | null = (
      await client
        .from('deal_invoices')
        .select(invoiceCols)
        .eq('deal_payment_id', paymentId)
        .single()
    ).data;
    if (!invoice) {
      // Invoice may exist linked by deal_id (UI shows payment on invoice page via deal). Find by deal or create.
      const { data: paymentRow } = await client
        .from('deal_payments')
        .select('deal_id, amount, amount_currency, organization_id, deal_invite_id')
        .eq('id', paymentId)
        .single();
      if (!paymentRow?.deal_id) {
        this.logger.warn(`retry-receipt: no invoice for payment ${paymentId} and payment has no deal_id`);
        return { receiptPosted: false, error: 'No invoice linked to this payment' };
      }
      // Unlinked invoice for this deal (we'll link it); linked one would have been found by first query
      const { data: existingRows } = await client
        .from('deal_invoices')
        .select(`${invoiceCols}, deal_payment_id`)
        .eq('deal_id', paymentRow.deal_id)
        .is('deal_payment_id', null)
        .limit(1);
      const existing = (existingRows && (Array.isArray(existingRows) ? existingRows[0] : existingRows)) ?? null;
      if (existing) {
        const { data: invite } = await client.from('deal_invites').select('invitee_email').eq('id', paymentRow.deal_invite_id).single();
        const inv = Array.isArray(invite) ? invite[0] : invite;
          await client
          .from('deal_invoices')
          .update({ deal_payment_id: paymentId, recipient_email: (inv as any)?.invitee_email ?? null })
          .eq('id', existing.id);
        invoice = {
          id: existing.id,
          deal_id: existing.deal_id,
          amount: existing.amount,
          amount_currency: existing.amount_currency,
          organization_id: existing.organization_id,
        };
      } else {
        const { data: invite } = await client.from('deal_invites').select('invitee_email').eq('id', paymentRow.deal_invite_id).single();
        const inv = Array.isArray(invite) ? invite[0] : invite;
        const { data: inserted, error: insertErr } = await client
          .from('deal_invoices')
          .insert({
            deal_id: paymentRow.deal_id,
            deal_payment_id: paymentId,
            organization_id: paymentRow.organization_id,
            amount: paymentRow.amount,
            amount_currency: paymentRow.amount_currency ?? 'USD',
            recipient_email: (inv as any)?.invitee_email ?? null,
            status: 'paid',
          })
          .select(invoiceCols)
          .single();
        if (insertErr || !inserted) {
          this.logger.warn(`retry-receipt: could not create invoice for payment ${paymentId}: ${insertErr?.message ?? 'unknown'}`);
          return { receiptPosted: false, error: 'No invoice linked to this payment and could not create one' };
        }
        invoice = inserted;
      }
    }
    // Skip "already posted" check when receipt_on_chain_tx_hash column may not exist; contract nonce keeps idempotency
    const batchHash = crypto
      .createHash('sha256')
      .update([invoice.id, invoice.deal_id, invoice.amount, invoice.amount_currency, 'paid'].join('|'))
      .digest('hex');
    const nonce = Number(
      BigInt('0x' + crypto.createHash('sha256').update(invoice.id).digest('hex').slice(0, 12)) % BigInt(Number.MAX_SAFE_INTEGER),
    );
    const result = await this.receiptLogger.postReceipt({
      payrollId: invoice.id,
      batchHash,
      authorizerId: organizationId,
      nonce,
      executorId: 'deal-payment',
      status: 'success',
      txHashes: [payment.tx_hash],
    });
    if (result.ok && result.txHash) {
      const { error: updateErr } = await client.from('deal_invoices').update({ receipt_on_chain_tx_hash: result.txHash }).eq('id', invoice.id);
      if (updateErr) this.logger.warn(`Could not set receipt_on_chain_tx_hash: ${updateErr.message}`);
      return { receiptPosted: true, receiptOnChainTxHash: result.txHash };
    }
    this.logger.warn(`retry-receipt: on-chain post failed for payment ${paymentId}: ${result.ok === false ? result.error : 'unknown'}`);
    return { receiptPosted: false, error: result.ok === false ? result.error : 'Failed to post receipt on-chain' };
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
    const receiptResult = await this.receiptLogger.postReceipt({
      payrollId: invoice.id,
      batchHash,
      authorizerId: organizationId,
      nonce,
      executorId: 'deal-payment',
      status: 'success',
      txHashes: [txHash],
    });
    if (receiptResult.ok && receiptResult.txHash) {
      const { error: updateErr } = await client.from('deal_invoices').update({ receipt_on_chain_tx_hash: receiptResult.txHash }).eq('id', invoice.id);
      if (updateErr) this.logger.warn(`Could not set receipt_on_chain_tx_hash (column may not exist): ${updateErr.message}`);
    }

    const { data: updated } = await client.from('deal_payments').select('*').eq('id', paymentId).single();
    return this.toResponse(updated);
  }

  private toResponse(row: any): DealPaymentResponse {
    const invite = Array.isArray(row.deal_invites) ? row.deal_invites[0] : row.deal_invites;
    const recipientEmail = invite?.invitee_email ?? null;
    return {
      id: row.id,
      deal_id: row.deal_id,
      deal_invite_id: row.deal_invite_id,
      organization_id: row.organization_id,
      amount: row.amount,
      amount_currency: row.amount_currency,
      recipient_wallet: row.recipient_wallet,
      recipient_email: recipientEmail,
      preferred_network: row.preferred_network,
      preferred_token_symbol: row.preferred_token_symbol,
      status: row.status,
      deposit_address: row.deposit_address,
      intent_deadline: row.intent_deadline,
      tx_hash: row.tx_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
      invoice_id: row.invoice_id ?? undefined,
      receipt_on_chain_tx_hash: row.receipt_on_chain_tx_hash ?? undefined,
    };
  }
}
