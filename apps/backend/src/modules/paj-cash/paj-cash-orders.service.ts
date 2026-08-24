import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { PajCashService, PajApiError, type PajCurrency } from './paj-cash.service';
import { PajCashSessionService, PajLinkRequiredError } from './paj-cash-session.service';
import { PajCashBankService } from './paj-cash-bank.service';
import type { PajCashOrderRow, PajOrderStatus } from './entities/paj-order.entity';
import { computeLooftaFeeUsdc } from '@/common/paj-cash-fee';

export { PajLinkRequiredError };

/** Thrown when PAJ rejects order creation because the user's identity isn't KYC-verified yet.
 * Detected heuristically (string-matching) since PAJ's API does not document a stable error code —
 * see the plan's open questions for PAJ support. */
export class PajKycRequiredError extends Error {
  constructor(message = 'KYC verification required before this order can be created') {
    super(message);
    this.name = 'PajKycRequiredError';
  }
}

const SOLANA_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Status rank for monotonic transitions — never let a reconcile regress an order backwards. */
const STATUS_RANK: Record<PajOrderStatus, number> = {
  CREATED: 0,
  AWAITING_PAYMENT: 1,
  USDC_SENT: 2,
  PAJ_PAID: 3,
  COMPLETE: 4,
  FAILED: 4,
  CANCELLED: 4,
  EXPIRED: 4,
};

const TERMINAL: PajOrderStatus[] = ['COMPLETE', 'FAILED', 'CANCELLED', 'EXPIRED'];

// Conservative caps until PAJ's real KYC threshold is confirmed in practice (see plan §7/§8).
const MAX_FIAT_NGN_PER_ORDER = 100_000;

function looksLikeKycError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes('kyc') || msg.includes('bvn') || msg.includes('nin') || msg.includes('identity');
}

@Injectable()
export class PajCashOrdersService {
  private readonly logger = new Logger(PajCashOrdersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly usersService: UsersService,
    private readonly pajCash: PajCashService,
    private readonly session: PajCashSessionService,
    private readonly bankService: PajCashBankService,
  ) {}

  private table() {
    return this.supabase.getClient().from('paj_cash_orders');
  }

  /** After a "claim in Naira" sweep succeeds, mirror it into paj_cash_orders as a completed
   * OFF_RAMP entry — purely so it shows up in the recipient's own withdrawal history (and for
   * admin/support visibility). No PAJ order is ever created for this path (see
   * claims.service.ts claimAsRecipient) — the burner is swept directly to the bank account's
   * abstracted wallet_address — so paj_order_id stays null here; the unique index on
   * paj_order_id only applies to non-null values, so multiple null rows are fine. Best-effort:
   * never let this bookkeeping insert fail a claim that has already succeeded on-chain. */
  async recordNairaClaimOrder(params: {
    userId: string;
    bankAccountId: string;
    walletAddress: string;
    amountUsdc: number;
    looftaFeeUsdc: number;
    sweepTxHash: string;
  }): Promise<void> {
    let fiatAmount: number | null = null;
    let rate: number | null = null;
    try {
      const token = await this.session.getValidSessionToken(params.userId);
      const quote = await this.pajCash.getOfframpValue(token, params.amountUsdc, SOLANA_USDC_MINT, 'NGN');
      fiatAmount = quote.fiatAmount;
      rate = quote.rate;
    } catch (e) {
      this.logger.warn(`recordNairaClaimOrder: failed to fetch NGN quote (non-fatal): ${(e as Error)?.message}`);
    }

    const { error } = await this.table().insert({
      user_id: params.userId,
      direction: 'OFF_RAMP',
      paj_order_id: null,
      currency: 'NGN',
      fiat_amount: fiatAmount,
      amount_usdc: params.amountUsdc,
      rate,
      loofta_fee_usdc: params.looftaFeeUsdc,
      offramp_deposit_address: params.walletAddress,
      offramp_bank_account_id: params.bankAccountId,
      offramp_tx_signature: params.sweepTxHash,
      status: 'COMPLETE',
      completed_at: new Date().toISOString(),
    });
    if (error) this.logger.error(`recordNairaClaimOrder: insert failed: ${error.message}`);
  }

  async createOnramp(userId: string, params: { amountUsdc: number; currency?: PajCurrency }): Promise<PajCashOrderRow> {
    if (!(params.amountUsdc > 0)) throw new BadRequestException('amountUsdc must be greater than 0');
    const currency = params.currency ?? 'NGN';

    const token = await this.session.getValidSessionToken(userId);
    const recipient = await this.usersService.getSolanaWalletAddress(userId, { skipCache: true });

    let order;
    try {
      // Pass the token amount, not a pre-computed fiatAmount — PAJ returns the authoritative
      // fiatAmount for exactly this many USDC, rather than us guessing at their rate/fee.
      order = await this.pajCash.createOnramp(token, {
        amount: params.amountUsdc,
        currency,
        recipient,
        mint: SOLANA_USDC_MINT,
        chain: 'SOLANA',
      });
    } catch (err) {
      if (err instanceof PajApiError && looksLikeKycError(err)) throw new PajKycRequiredError(err.message);
      throw err;
    }

    if (currency === 'NGN' && order.fiatAmount > MAX_FIAT_NGN_PER_ORDER) {
      throw new BadRequestException(`Amount exceeds the current per-order limit of ₦${MAX_FIAT_NGN_PER_ORDER.toLocaleString()}`);
    }

    const { data, error } = await this.table()
      .insert({
        user_id: userId,
        direction: 'ON_RAMP',
        paj_order_id: order.id,
        currency,
        fiat_amount: order.fiatAmount,
        amount_usdc: order.amount,
        rate: order.rate,
        fee_usdc: order.fee ?? null,
        onramp_bank_name: order.bank,
        onramp_account_number: order.accountNumber,
        onramp_account_name: order.accountName,
        status: 'CREATED',
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to persist onramp order for ${userId}: ${error?.message}`);
      throw new BadRequestException('Failed to create onramp order');
    }
    return data as PajCashOrderRow;
  }

  async createOfframp(userId: string, params: { bankAccountId: string; amountUsdc: number; currency?: PajCurrency }): Promise<PajCashOrderRow> {
    if (!(params.amountUsdc > 0)) throw new BadRequestException('amountUsdc must be greater than 0');
    const currency = params.currency ?? 'NGN';

    const bankAccount = await this.bankService.getSavedAccount(userId, params.bankAccountId);
    if (!bankAccount) throw new NotFoundException('Bank account not found');

    const token = await this.session.getValidSessionToken(userId);

    // params.amountUsdc is the gross amount debited from the user's balance. Loofta's cut is
    // taken by ordering PAJ the *net* amount — what actually gets deposited to order.address —
    // while the fee itself is sent on-chain to Loofta's fee wallet in the same withdraw
    // transaction (see PajCashOfframpView.tsx's sendUsdcWithBackendFeePayer).
    const looftaFeeUsdc = computeLooftaFeeUsdc(params.amountUsdc);
    const netAmountUsdc = params.amountUsdc - looftaFeeUsdc;

    let order;
    try {
      order = await this.pajCash.createOfframp(token, {
        bank: bankAccount.bank_id,
        accountNumber: bankAccount.account_number,
        currency,
        amount: netAmountUsdc,
        mint: SOLANA_USDC_MINT,
        chain: 'SOLANA',
        description: 'Loofta withdrawal',
      });
    } catch (err) {
      if (err instanceof PajApiError && looksLikeKycError(err)) throw new PajKycRequiredError(err.message);
      throw err;
    }

    if (currency === 'NGN' && order.fiatAmount > MAX_FIAT_NGN_PER_ORDER) {
      throw new BadRequestException(`Amount exceeds the current per-order limit of ₦${MAX_FIAT_NGN_PER_ORDER.toLocaleString()}`);
    }

    const { data, error } = await this.table()
      .insert({
        user_id: userId,
        direction: 'OFF_RAMP',
        paj_order_id: order.id,
        currency,
        fiat_amount: order.fiatAmount,
        amount_usdc: order.amount,
        rate: order.rate,
        fee_usdc: order.fee ?? null,
        loofta_fee_usdc: looftaFeeUsdc,
        offramp_deposit_address: order.address,
        offramp_bank_account_id: bankAccount.id,
        status: 'CREATED',
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to persist offramp order for ${userId}: ${error?.message}`);
      throw new BadRequestException('Failed to create offramp order');
    }
    return data as PajCashOrderRow;
  }

  async confirmOfframpSent(userId: string, orderId: string, txSignature: string): Promise<PajCashOrderRow> {
    const row = await this.getOwnedRow(userId, orderId);
    if (row.direction !== 'OFF_RAMP') throw new BadRequestException('Not an off-ramp order');
    if (row.status !== 'CREATED') throw new BadRequestException(`Cannot confirm-sent from status ${row.status}`);

    const { data, error } = await this.table()
      .update({ status: 'USDC_SENT', offramp_tx_signature: txSignature, updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .select('*')
      .single();

    if (error || !data) throw new BadRequestException('Failed to update order');
    return data as PajCashOrderRow;
  }

  async listOrders(userId: string, limit = 50): Promise<PajCashOrderRow[]> {
    const { data } = await this.table().select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    return (data as PajCashOrderRow[] | null) ?? [];
  }

  /** Single order, re-fetching live status from PAJ if non-terminal and stale. */
  async getOrder(userId: string, orderId: string): Promise<PajCashOrderRow> {
    let row = await this.getOwnedRow(userId, orderId);
    if (!TERMINAL.includes(row.status) && this.isStale(row)) {
      row = await this.reconcileOrder(row);
    }
    return row;
  }

  private isStale(row: PajCashOrderRow, debounceMs = 10_000): boolean {
    if (!row.last_reconciled_at) return true;
    return Date.now() - new Date(row.last_reconciled_at).getTime() > debounceMs;
  }

  private async getOwnedRow(userId: string, orderId: string): Promise<PajCashOrderRow> {
    const { data, error } = await this.table().select('*').eq('id', orderId).single();
    if (error || !data) throw new NotFoundException('Order not found');
    if (data.user_id !== userId) throw new ForbiddenException('Not your order');
    return data as PajCashOrderRow;
  }

  /** Re-fetches the authoritative transaction status from PAJ (never trusts an inbound webhook
   * body — this codebase runs no webhook receiver at all, see plan §5) and advances our row
   * monotonically. Shared by getOrder()'s on-demand refresh and the cron poller. */
  async reconcileOrder(row: PajCashOrderRow): Promise<PajCashOrderRow> {
    if (!row.paj_order_id) return row;

    let token: string;
    try {
      token = await this.session.getValidSessionToken(row.user_id);
    } catch (err) {
      if (err instanceof PajLinkRequiredError) {
        this.logger.warn(`[PajCashReconcile] ${row.id}: user ${row.user_id} has no active PAJ session, cannot reconcile — will retry once relinked`);
        return row;
      }
      throw err;
    }

    let txn;
    try {
      txn = await this.pajCash.getTransaction(token, row.paj_order_id);
    } catch (err) {
      this.logger.warn(`[PajCashReconcile] ${row.id}: getTransaction failed: ${err instanceof Error ? err.message : String(err)}`);
      return row;
    }

    const nextStatus = this.mapPajStatus(row, txn.status);
    const update: Record<string, unknown> = { last_reconciled_at: new Date().toISOString() };

    // Monotonic: only ever move forward. Terminal statuses (rank 4) always outrank any
    // in-flight status, so a FAILED/CANCELLED/COMPLETED result from PAJ always applies.
    if (nextStatus && STATUS_RANK[nextStatus] > STATUS_RANK[row.status]) {
      update.status = nextStatus;
      if (TERMINAL.includes(nextStatus)) update.completed_at = new Date().toISOString();
    }

    const { data, error } = await this.table().update(update).eq('id', row.id).select('*').single();
    if (error || !data) return row;

    const updated = data as PajCashOrderRow;
    if (updated.status !== row.status) {
      this.logger.log(`[PajCashReconcile] ${row.id}: ${row.status} -> ${updated.status} (PAJ status=${txn.status})`);
    }
    return updated;
  }

  private mapPajStatus(row: PajCashOrderRow, pajStatus: string): PajOrderStatus | null {
    switch (pajStatus) {
      case 'COMPLETED':
        return 'COMPLETE';
      case 'PAID':
        // For OFF_RAMP, PAID is PAJ's terminal state — money is already disbursed to the bank
        // account. There's no confirmed follow-up COMPLETED event for off-ramp orders (unlike
        // ON_RAMP, where PAID only means the user's bank transfer landed with PAJ and we still
        // wait for COMPLETED). Treating OFF_RAMP PAID as non-terminal left orders stuck showing
        // "In progress" forever once PAJ stopped reporting anything past PAID.
        return row.direction === 'OFF_RAMP' ? 'COMPLETE' : row.status;
      case 'FAILED':
        return 'FAILED';
      case 'CANCELLED':
        return 'CANCELLED';
      case 'INIT':
      default:
        return null; // no change
    }
  }

  /** Auto-expire orders nobody ever funded — safe since no money has moved yet. Orders stuck
   * post-funding (OFF_RAMP USDC_SENT) are never auto-failed; those are logged for manual review. */
  async expireStaleOrders(): Promise<void> {
    const onrampCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const offrampCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    await this.table()
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('direction', 'ON_RAMP')
      .eq('status', 'CREATED')
      .lt('created_at', onrampCutoff);

    await this.table()
      .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
      .eq('direction', 'OFF_RAMP')
      .eq('status', 'CREATED')
      .lt('created_at', offrampCutoff);

    const { data: stuck } = await this.table()
      .select('id, user_id, updated_at')
      .eq('direction', 'OFF_RAMP')
      .eq('status', 'USDC_SENT')
      .lt('updated_at', offrampCutoff);

    for (const row of stuck ?? []) {
      this.logger.warn(`[PajCashAlert] offramp order ${row.id} (user ${row.user_id}) stuck in USDC_SENT past 30min — USDC already sent, needs manual review`);
    }
  }

  async listNonTerminal(limit = 25): Promise<PajCashOrderRow[]> {
    const { data } = await this.table()
      .select('*')
      .not('status', 'in', `(${TERMINAL.join(',')})`)
      .order('created_at', { ascending: true })
      .limit(limit);
    return (data as PajCashOrderRow[] | null) ?? [];
  }
}
