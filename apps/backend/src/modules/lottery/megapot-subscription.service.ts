import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';
import { SupabaseService } from '@/database/supabase.service';
import { LotteryService, TICKET_PRICE_USDC } from './lottery.service';
import { TicketPick } from './megapot.service';
import { UsersService } from '../users/users.service';

// Same mainnet USDC mint used everywhere else in this module (see pack.service.ts / lottery.service.ts).
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Fixed duration: every subscription runs exactly this many days. The user picks tickets/day,
// not days — more tickets/day means more tickets (and more $) over the SAME month, not the same
// 30 tickets delivered faster. total_tickets = ticketsPerDay * SUBSCRIPTION_DAYS.
export const SUBSCRIPTION_DAYS = 30;
// $28 for 30 tickets (1/day for 30 days) is the base rate — $2 cheaper than buying 30 tickets one
// at a time at $1 each (~6.7% off, not a round 10%). Scales linearly with ticketsPerDay so the
// same discount always applies: price = ticketsPerDay * this.
export const PRICE_USDC_PER_TICKET_PER_DAY = 28;
export const MIN_TICKETS_PER_DAY = 1;
// Caps the treasury's worst-case exposure to one subscription (10/day = 300 tickets = $280 paid,
// $300 owed in tickets) — a plain retail ceiling, not a technical limit.
export const MAX_TICKETS_PER_DAY = 10;

export function computeTotalTickets(ticketsPerDay: number): number {
  return ticketsPerDay * SUBSCRIPTION_DAYS;
}
export function computePriceUsdc(ticketsPerDay: number): number {
  return ticketsPerDay * PRICE_USDC_PER_TICKET_PER_DAY;
}

// Outer safety cutoff only — every subscription runs exactly SUBSCRIPTION_DAYS days regardless of
// ticketsPerDay, so this only ever fires if something upstream (cron, wallet resolution) has been
// stuck for months. See expireStaleSubscriptions.
const SUBSCRIPTION_VALIDITY_MONTHS = 30;

const MAX_BATCH_RETRIES = 3;
const BATCH_RETRY_MAX_AGE_MS = 48 * 60 * 60_000;
const DUE_BATCH_BATCH_SIZE = 20;
const RETRY_BATCH_BATCH_SIZE = 10;

// Megapot's daily draw runs at a fixed real-world time (~7pm CET/CEST, i.e. ~17:00-18:00 UTC
// depending on DST). Megapot no longer pauses sales before a draw (purchases just roll into the next
// draw), so there is no cutoff to avoid. What this constant guards against is scheduling. If "next batch due" were computed as "whenever
// this batch happened to buy + 24h" (a retry delay, cron jitter, etc.), that time-of-day would
// drift a little further every day and could eventually creep into that 5-minute cutoff window,
// causing repeated failures right as the schedule reaches ~7pm CET. Anchoring every batch to this
// fixed, far-earlier UTC hour instead means the buy time never drifts and always has hours of
// margin before the draw, so a subscriber is reliably bought in for the next day's draw with no
// risk of stalling near cutoff and no risk of a day being skipped or compressed.
const DAILY_BATCH_ANCHOR_UTC_HOUR = 10; // 10:00 UTC = 11am CET / noon CEST — ~7-8h clear of the draw

/** Always the anchor hour on the day AFTER `from`'s calendar date — never "later today" even if
 *  `from` is earlier than today's anchor, so a subscription always advances by exactly one
 *  calendar day per batch (never two batches compressed into the same day, never a day skipped). */
function nextDailyAnchor(from: Date): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, DAILY_BATCH_ANCHOR_UTC_HOUR, 0, 0, 0));
}

export type SubscriptionStatus = 'active' | 'completed' | 'cancelled' | 'expired';
export type BatchStatus = 'pending' | 'bought' | 'failed' | 'refunded';

export interface SubscriptionBatchSummary {
  id: string;
  batchNumber: number;
  numTickets: number;
  status: BatchStatus;
  lotteryTicketId: string | null;
  failureReason: string | null;
  createdAt: string;
}

export interface SubscriptionSummary {
  id: string;
  status: SubscriptionStatus;
  totalTickets: number;
  ticketsPerDay: number;
  ticketsBought: number;
  priceUsdc: number;
  startedAt: string;
  nextBatchDueAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  refundUsdc: number | null;
  /** Numbers picked at signup, reused unchanged for every daily batch — null means quick-pick
   *  (fresh random numbers bought each day). */
  pickedNumbers: TicketPick[] | null;
  batches: SubscriptionBatchSummary[];
}

@Injectable()
export class MegapotSubscriptionService {
  private readonly logger = new Logger(MegapotSubscriptionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly lottery: LotteryService,
    private readonly usersService: UsersService,
  ) {}

  private async getSolanaConnection(): Promise<Connection> {
    const rpc =
      this.config.get<string>('SOLANA_RPC_URL') ||
      (this.config.get<string>('HELIUS_API_KEY')
        ? `https://mainnet.helius-rpc.com/?api-key=${this.config.get('HELIUS_API_KEY')}`
        : 'https://api.mainnet-beta.solana.com');
    return new Connection(rpc, 'confirmed');
  }

  /** Reuses the same fee wallet as ticket-fee collection / Mystery Pack payments — same
   *  custody model, no new secret. Only the public key is used here. */
  private async getTreasuryKeypair(): Promise<Keypair> {
    const feePayerKey = this.config.get<string>('SOLANA_FEE_PAYER_PRIVATE_KEY');
    if (!feePayerKey) throw new Error('SOLANA_FEE_PAYER_PRIVATE_KEY not configured');
    const bs58Mod = await import('bs58');
    return Keypair.fromSecretKey(bs58Mod.default.decode(feePayerKey));
  }

  private async getTreasuryUsdcBalanceUsdc(): Promise<number> {
    const treasury = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const ata = await getAssociatedTokenAddress(USDC_MINT, treasury.publicKey);
    try {
      const bal = await conn.getTokenAccountBalance(ata);
      return Number(bal.value.amount) / 1_000_000;
    } catch {
      return 0;
    }
  }

  /**
   * Finds, across every token balance touched by the tx, the account that was DEBITED the most
   * USDC, and returns its owner — same technique as PackService.findUsdcDebitOwner, duplicated
   * rather than shared since it's a small, self-contained helper (matches this module's existing
   * pattern of each service deriving its own treasury/verification helpers independently).
   */
  private findUsdcDebitOwner(tx: NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>, usdcMint: string): { owner: string | null; amount: bigint } {
    const preByIdx = new Map((tx.meta?.preTokenBalances ?? []).map(b => [b.accountIndex, b]));
    const postByIdx = new Map((tx.meta?.postTokenBalances ?? []).map(b => [b.accountIndex, b]));
    let debitOwner: string | null = null;
    let maxDebit = 0n;
    for (const [idx, post] of postByIdx) {
      if (post.mint !== usdcMint) continue;
      const pre = preByIdx.get(idx);
      if (!pre || pre.mint !== usdcMint) continue;
      const delta = BigInt(pre.uiTokenAmount.amount) - BigInt(post.uiTokenAmount.amount);
      if (delta > maxDebit) { maxDebit = delta; debitOwner = post.owner ?? pre.owner ?? null; }
    }
    return { owner: debitOwner, amount: maxDebit };
  }

  /** Verifies ON-CHAIN that `txHash` is a confirmed tx that credited the treasury with at least
   *  `expectedUsdc` USDC AND was paid BY `expectedSender` — never trusted from the client (same
   *  anti-replay reasoning as PackService.verifyPackPaymentOnChain). */
  private async verifyPaymentOnChain(txHash: string, expectedUsdc: number, expectedSender: string, retries = 5): Promise<void> {
    const treasury = (await this.getTreasuryKeypair()).publicKey.toBase58();
    const conn = await this.getSolanaConnection();
    const usdcMint = USDC_MINT.toBase58();

    for (let attempt = 0; ; attempt++) {
      const tx = await conn.getTransaction(txHash, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (tx) {
        if (tx.meta?.err) throw new BadRequestException('Payment transaction failed on-chain');
        const pre = tx.meta?.preTokenBalances?.find(b => b.owner === treasury && b.mint === usdcMint);
        const post = tx.meta?.postTokenBalances?.find(b => b.owner === treasury && b.mint === usdcMint);
        const received = BigInt(post?.uiTokenAmount?.amount ?? '0') - BigInt(pre?.uiTokenAmount?.amount ?? '0');
        const expectedUnits = BigInt(Math.round(expectedUsdc * 1_000_000));
        if (received < expectedUnits) {
          throw new BadRequestException(`Subscription payment paid ${received} units, expected ${expectedUnits}`);
        }
        const debit = this.findUsdcDebitOwner(tx, usdcMint);
        if (debit.owner !== expectedSender) {
          throw new BadRequestException('This payment was not sent from your wallet');
        }
        return;
      }
      if (attempt >= retries) throw new BadRequestException('Payment transaction not found on-chain — wait a few seconds and retry');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  private async getActiveSubscriptionRow(userId: string): Promise<any | null> {
    const db = this.supabase.getClient();
    const { data } = await db.from('megapot_subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    return data ?? null;
  }

  /** When picking custom numbers, one set is required per daily ticket and reused unchanged for
   *  every batch over the whole run — so exactly `ticketsPerDay` sets must be provided. Anything
   *  else is rejected here rather than silently falling back to quick-pick, since the frontend
   *  picker always sends a complete, correctly-sized set when the user chose "custom" at all. */
  private validatePickedNumbers(pickedNumbers: TicketPick[] | undefined, ticketsPerDay: number): void {
    if (!pickedNumbers) return;
    if (pickedNumbers.length !== ticketsPerDay) {
      throw new BadRequestException(`Picked ${pickedNumbers.length} ticket number set(s), expected ${ticketsPerDay} (one per ticket/day)`);
    }
  }

  /**
   * Builds the payment transfer for the user to sign client-side — a plain public USDC transfer
   * to the treasury (mirrors PackService.buildPaymentTx). Price scales with ticketsPerDay
   * (computePriceUsdc) — the fixed quantity is the 30-day duration, not the ticket count. Refuses
   * to build the charge at all if the treasury can't currently cover the full future commitment
   * for the requested cadence, or if the user already has an active subscription — so nobody ever
   * pays into a subscription we can't/won't let them start.
   */
  async buildPaymentTx(userSolanaAddress: string, userId: string, ticketsPerDay: number, pickedNumbers?: TicketPick[]): Promise<string> {
    if (!Number.isInteger(ticketsPerDay) || ticketsPerDay < MIN_TICKETS_PER_DAY || ticketsPerDay > MAX_TICKETS_PER_DAY) {
      throw new BadRequestException(`ticketsPerDay must be an integer between ${MIN_TICKETS_PER_DAY} and ${MAX_TICKETS_PER_DAY}`);
    }
    this.validatePickedNumbers(pickedNumbers, ticketsPerDay);
    const totalTickets = computeTotalTickets(ticketsPerDay);
    const priceUsdc = computePriceUsdc(ticketsPerDay);
    const balanceUsdc = await this.getTreasuryUsdcBalanceUsdc();
    if (balanceUsdc < totalTickets * TICKET_PRICE_USDC) {
      throw new BadRequestException('Ticket subscriptions are temporarily unavailable at that cadence — please check back soon or choose fewer tickets/day');
    }
    if (await this.getActiveSubscriptionRow(userId)) {
      throw new BadRequestException('You already have an active subscription');
    }

    const treasuryKeypair = await this.getTreasuryKeypair();
    const conn = await this.getSolanaConnection();
    const fromPubkey = new PublicKey(userSolanaAddress);
    const fromAta = await getAssociatedTokenAddress(USDC_MINT, fromPubkey);
    const toAta = await getAssociatedTokenAddress(USDC_MINT, treasuryKeypair.publicKey);

    const instructions: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(treasuryKeypair.publicKey, toAta, treasuryKeypair.publicKey, USDC_MINT),
      createTransferInstruction(fromAta, toAta, fromPubkey, Math.round(priceUsdc * 1_000_000)),
    ];

    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: treasuryKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([treasuryKeypair]);

    return Buffer.from(tx.serialize()).toString('base64');
  }

  /**
   * Verifies the payment on-chain (amount scaled to the requested cadence — see computePriceUsdc),
   * creates the subscription row, and immediately buys the first batch so the user doesn't wait
   * ~24h for ticket #1. A subscription row is only ever inserted AFTER the payment is verified —
   * same ordering as PackService.openPack.
   */
  async activateSubscription(userId: string, paymentTxHash: string, ticketsPerDay: number, pickedNumbers?: TicketPick[]): Promise<SubscriptionSummary> {
    if (!Number.isInteger(ticketsPerDay) || ticketsPerDay < MIN_TICKETS_PER_DAY || ticketsPerDay > MAX_TICKETS_PER_DAY) {
      throw new BadRequestException(`ticketsPerDay must be an integer between ${MIN_TICKETS_PER_DAY} and ${MAX_TICKETS_PER_DAY}`);
    }
    this.validatePickedNumbers(pickedNumbers, ticketsPerDay);
    if (await this.getActiveSubscriptionRow(userId)) {
      throw new BadRequestException('You already have an active subscription');
    }

    const totalTickets = computeTotalTickets(ticketsPerDay);
    const priceUsdc = computePriceUsdc(ticketsPerDay);

    const db = this.supabase.getClient();
    const { data: existingPayment } = await db.from('megapot_subscriptions').select('id').eq('payment_tx_hash', paymentTxHash).maybeSingle();
    if (existingPayment) throw new BadRequestException('This payment has already been used to activate a subscription');

    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId);
    await this.verifyPaymentOnChain(paymentTxHash, priceUsdc, userSolanaAddress);

    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + SUBSCRIPTION_VALIDITY_MONTHS);

    const { data: sub, error } = await db
      .from('megapot_subscriptions')
      .insert({
        user_id: userId,
        total_tickets: totalTickets,
        tickets_per_day: ticketsPerDay,
        price_usdc: priceUsdc,
        picked_numbers: pickedNumbers ?? null,
        payment_tx_hash: paymentTxHash,
        tickets_bought: 0,
        status: 'active',
        started_at: now.toISOString(),
        next_batch_due_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .select('*')
      .single();
    if (error) {
      // Unique-violation on payment_tx_hash (race) or on the one-active-subscription-per-user index.
      if ((error as any).code === '23505') {
        throw new BadRequestException('This payment has already been used, or you already have an active subscription');
      }
      throw new Error(`Failed to create subscription: ${error.message}`);
    }
    if (!sub) throw new Error('Failed to create subscription: no row returned');

    this.logger.log(`Subscription ${sub.id} activated for user ${userId}: ${ticketsPerDay}/day, payment=${paymentTxHash}`);

    // Never let a fulfillment failure take the paid-for subscription down with it — same contract
    // as PackService.fulfillPackOpening. A failed first batch just leaves it retryable.
    await this.attemptBatch(sub).catch(e => this.logger.error(`Subscription ${sub.id}: first batch failed: ${e.message}`));

    return this.getMySubscription(userId) as Promise<SubscriptionSummary>;
  }

  /** Cancel + full refund — only while no batch has bought yet. Once the first ticket buys, the
   *  subscription is locked in and runs to completion automatically. */
  async cancelSubscription(userId: string, subscriptionId: string): Promise<{ refundTxHash: string }> {
    const db = this.supabase.getClient();
    const { data: sub, error } = await db
      .from('megapot_subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !sub) throw new BadRequestException('Subscription not found');
    if (sub.status !== 'active') throw new BadRequestException(`Can only cancel an active subscription (this one is '${sub.status}')`);
    if (sub.tickets_bought > 0) {
      throw new BadRequestException('Your subscription has already started buying tickets — it will run to completion automatically.');
    }

    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(userId, { skipCache: true });
    const refundTxHash = await this.lottery.refundToUserWallet(userSolanaAddress, Number(sub.price_usdc));

    await db.from('megapot_subscriptions').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      refund_tx_hash: refundTxHash,
      refund_usdc: sub.price_usdc,
    }).eq('id', subscriptionId);

    this.logger.log(`Subscription ${subscriptionId} cancelled for user ${userId}, refunded $${sub.price_usdc}, sig=${refundTxHash}`);
    return { refundTxHash };
  }

  /** Buys the next batch for one subscription (numTickets = min(tickets_per_day, remaining)),
   *  funded from treasury via LotteryService.purchaseTicketsForUser. When the subscription has
   *  `picked_numbers` set, the exact same numbers are bought every single batch across the whole
   *  30-day run — reused unchanged, not re-picked per day. Never throws to the caller beyond the
   *  initial insert — a purchase failure just leaves the batch row 'failed' for retryFailedBatches
   *  to pick up. */
  private async attemptBatch(subscription: any): Promise<void> {
    const db = this.supabase.getClient();
    const remaining = subscription.total_tickets - subscription.tickets_bought;
    if (remaining <= 0) return;
    const numTickets = Math.min(subscription.tickets_per_day, remaining);
    const pickedNumbers: TicketPick[] | undefined = Array.isArray(subscription.picked_numbers) ? subscription.picked_numbers : undefined;

    const { count } = await db
      .from('megapot_subscription_batches')
      .select('id', { count: 'exact', head: true })
      .eq('subscription_id', subscription.id);
    const batchNumber = (count ?? 0) + 1;

    const { data: batch, error: insertError } = await db
      .from('megapot_subscription_batches')
      .insert({ subscription_id: subscription.id, batch_number: batchNumber, num_tickets: numTickets, status: 'pending' })
      .select('id')
      .single();
    if (insertError || !batch) throw new Error(`Failed to create subscription batch: ${insertError?.message}`);

    try {
      const { ticketId } = await this.lottery.purchaseTicketsForUser(subscription.user_id, numTickets, pickedNumbers);
      await this.settleBatchSuccess(subscription, batch.id, numTickets, ticketId);
    } catch (e: any) {
      await db.from('megapot_subscription_batches').update({ status: 'failed', failure_reason: e.message }).eq('id', batch.id);
      this.logger.error(`Subscription ${subscription.id} batch ${batch.id}: purchase failed, will retry: ${e.message}`);
    }
  }

  private async settleBatchSuccess(subscription: any, batchId: string, numTickets: number, ticketId: string): Promise<void> {
    const db = this.supabase.getClient();
    await db.from('megapot_subscription_batches').update({ status: 'bought', lottery_ticket_id: ticketId }).eq('id', batchId);

    const newTicketsBought = subscription.tickets_bought + numTickets;
    const now = new Date().toISOString();
    if (newTicketsBought >= subscription.total_tickets) {
      await db.from('megapot_subscriptions').update({
        tickets_bought: newTicketsBought, status: 'completed', completed_at: now, last_batch_at: now,
      }).eq('id', subscription.id);
      this.logger.log(`Subscription ${subscription.id}: completed (${newTicketsBought}/${subscription.total_tickets} tickets)`);
    } else {
      const nextDue = nextDailyAnchor(new Date());
      await db.from('megapot_subscriptions').update({
        tickets_bought: newTicketsBought, last_batch_at: now, next_batch_due_at: nextDue.toISOString(),
      }).eq('id', subscription.id);
    }
  }

  /** Cron entry point: buys the next due batch for every active subscription whose next batch is
   *  due. Skips a subscription that already has an unresolved (pending/failed) batch — that
   *  means a purchase is either mid-flight or waiting on retryFailedBatches, so buying another
   *  batch here would double up. */
  async processDueBatches(): Promise<void> {
    const db = this.supabase.getClient();
    const { data: due } = await db
      .from('megapot_subscriptions')
      .select('*')
      .eq('status', 'active')
      .lte('next_batch_due_at', new Date().toISOString())
      .order('next_batch_due_at', { ascending: true })
      .limit(DUE_BATCH_BATCH_SIZE);

    for (const subscription of due ?? []) {
      const { count: unresolved } = await db
        .from('megapot_subscription_batches')
        .select('id', { count: 'exact', head: true })
        .eq('subscription_id', subscription.id)
        .in('status', ['pending', 'failed']);
      if ((unresolved ?? 0) > 0) continue;

      await this.attemptBatch(subscription).catch(e =>
        this.logger.error(`processDueBatches: subscription ${subscription.id}: ${e.message}`),
      );
    }
  }

  /** Retries batches whose purchase failed on a prior attempt — same shape as
   *  PackService.retryFailedPackPurchases. */
  async retryFailedBatches(): Promise<void> {
    const db = this.supabase.getClient();
    const cutoff = new Date(Date.now() - BATCH_RETRY_MAX_AGE_MS).toISOString();
    const { data: batches } = await db
      .from('megapot_subscription_batches')
      .select('id, subscription_id, num_tickets, retry_count')
      .eq('status', 'failed')
      .lt('retry_count', MAX_BATCH_RETRIES)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(RETRY_BATCH_BATCH_SIZE);

    for (const batch of batches ?? []) {
      const { data: subscription } = await db.from('megapot_subscriptions').select('*').eq('id', batch.subscription_id).maybeSingle();
      if (!subscription || subscription.status !== 'active') continue;

      await db.from('megapot_subscription_batches').update({ retry_count: batch.retry_count + 1 }).eq('id', batch.id);
      try {
        const pickedNumbers: TicketPick[] | undefined = Array.isArray(subscription.picked_numbers) ? subscription.picked_numbers : undefined;
        const { ticketId } = await this.lottery.purchaseTicketsForUser(subscription.user_id, batch.num_tickets, pickedNumbers);
        await this.settleBatchSuccess(subscription, batch.id, batch.num_tickets, ticketId);
      } catch (e: any) {
        await db.from('megapot_subscription_batches').update({ status: 'failed', failure_reason: e.message }).eq('id', batch.id);
        this.logger.warn(`retryFailedBatches: subscription ${subscription.id} batch ${batch.id}: ${e.message}`);
      }
    }
  }

  /** 30-month safety net — refunds the undelivered remainder (at the discounted per-ticket rate)
   *  for any subscription still active past its expiry. Firing at all means something upstream
   *  has been stuck for months; logs loudly. */
  async expireStaleSubscriptions(): Promise<void> {
    const db = this.supabase.getClient();
    const { data: stale } = await db
      .from('megapot_subscriptions')
      .select('*')
      .eq('status', 'active')
      .lte('expires_at', new Date().toISOString());

    for (const sub of stale ?? []) {
      if (sub.tickets_bought >= sub.total_tickets) continue;
      try {
        const remaining = sub.total_tickets - sub.tickets_bought;
        const refundUsdc = Number((Number(sub.price_usdc) * remaining / sub.total_tickets).toFixed(6));
        const userSolanaAddress = await this.usersService.getSolanaWalletAddress(sub.user_id, { skipCache: true });
        const refundTxHash = await this.lottery.refundToUserWallet(userSolanaAddress, refundUsdc);
        await db.from('megapot_subscriptions').update({
          status: 'expired', expired_at: new Date().toISOString(), refund_tx_hash: refundTxHash, refund_usdc: refundUsdc,
        }).eq('id', sub.id);
        this.logger.error(`Subscription ${sub.id} hit its 30-month safety cutoff with ${remaining} tickets undelivered — refunded $${refundUsdc}, sig=${refundTxHash}. This should not happen under normal operation; investigate why it stalled.`);
      } catch (e: any) {
        this.logger.error(`expireStaleSubscriptions: subscription ${sub.id}: ${e.message}`);
      }
    }
  }

  private mapSubscription(sub: any, batches: any[]): SubscriptionSummary {
    return {
      id: sub.id,
      status: sub.status,
      totalTickets: sub.total_tickets,
      ticketsPerDay: sub.tickets_per_day,
      ticketsBought: sub.tickets_bought,
      priceUsdc: Number(sub.price_usdc),
      startedAt: sub.started_at,
      nextBatchDueAt: sub.status === 'active' ? sub.next_batch_due_at : null,
      completedAt: sub.completed_at,
      cancelledAt: sub.cancelled_at,
      expiresAt: sub.expires_at,
      refundUsdc: sub.refund_usdc != null ? Number(sub.refund_usdc) : null,
      pickedNumbers: Array.isArray(sub.picked_numbers) ? sub.picked_numbers : null,
      batches: (batches ?? []).map(b => ({
        id: b.id,
        batchNumber: b.batch_number,
        numTickets: b.num_tickets,
        status: b.status,
        lotteryTicketId: b.lottery_ticket_id,
        failureReason: b.failure_reason,
        createdAt: b.created_at,
      })),
    };
  }

  /** Current/most recent subscription for the user, with its batch history — powers the
   *  frontend status card. Returns null if the user has never subscribed. */
  async getMySubscription(userId: string): Promise<SubscriptionSummary | null> {
    const db = this.supabase.getClient();
    const { data: sub } = await db
      .from('megapot_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return null;
    const { data: batches } = await db
      .from('megapot_subscription_batches')
      .select('id, batch_number, num_tickets, status, lottery_ticket_id, failure_reason, created_at')
      .eq('subscription_id', sub.id)
      .order('batch_number', { ascending: true });
    return this.mapSubscription(sub, batches ?? []);
  }

  /** Admin: paginated subscriptions list, newest first — mirrors PackService.getAdminOpenings. */
  async getAdminSubscriptions(page: number, pageSize: number): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const db = this.supabase.getClient();
    const { data, count, error } = await db
      .from('megapot_subscriptions')
      .select('id, created_at, user_id, tickets_per_day, total_tickets, tickets_bought, price_usdc, status, payment_tx_hash, refund_tx_hash, refund_usdc', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(`Failed to load subscriptions: ${error.message}`);

    const rows = data ?? [];
    const uniqueUserIds = Array.from(new Set(rows.map(r => r.user_id)));
    let usernameByUserId: Record<string, string | null> = {};
    if (uniqueUserIds.length) {
      const { data: users } = await db.from('app_users').select('privy_user_id, username').in('privy_user_id', uniqueUserIds);
      usernameByUserId = Object.fromEntries((users ?? []).map((u: any) => [u.privy_user_id, u.username ?? null]));
    }

    return {
      data: rows.map(r => ({ ...r, username: usernameByUserId[r.user_id] ?? null })),
      total: count ?? 0,
      page,
      limit: pageSize,
    };
  }

  /** Admin: net revenue — gross collected minus refunds issued minus what delivered tickets
   *  actually cost, same formula style as PackService.getRevenue. */
  async getRevenue(): Promise<{
    grossUsdc: number; refundsUsdc: number; ticketCostUsdc: number; netRevenueUsdc: number;
    subscriptionsSold: number; ticketsDelivered: number;
  }> {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('megapot_subscriptions').select('price_usdc, tickets_bought, refund_usdc');
    if (error) throw new Error(`Failed to compute subscription revenue: ${error.message}`);

    const rows = data ?? [];
    const grossUsdc = rows.reduce((sum, r) => sum + Number(r.price_usdc), 0);
    const refundsUsdc = rows.reduce((sum, r) => sum + Number(r.refund_usdc ?? 0), 0);
    const ticketsDelivered = rows.reduce((sum, r) => sum + r.tickets_bought, 0);
    const ticketCostUsdc = ticketsDelivered * TICKET_PRICE_USDC;

    return {
      grossUsdc,
      refundsUsdc,
      ticketCostUsdc,
      netRevenueUsdc: grossUsdc - refundsUsdc - ticketCostUsdc,
      subscriptionsSold: rows.length,
      ticketsDelivered,
    };
  }

  /**
   * Admin remediation for a batch whose purchase permanently failed (retries exhausted) — refunds
   * that batch's tickets at the full (non-discounted) $1 rate, marks the batch 'refunded', and
   * writes off that many tickets from the subscription's total so it can still reach 'completed'
   * without them. Only for a batch confirmed NOT to have delivered (no lottery_ticket_id).
   */
  async refundFailedBatch(batchId: string): Promise<{ refundTxHash: string }> {
    const db = this.supabase.getClient();
    const { data: batch, error } = await db
      .from('megapot_subscription_batches')
      .select('id, subscription_id, num_tickets, status, lottery_ticket_id')
      .eq('id', batchId)
      .maybeSingle();
    if (error || !batch) throw new BadRequestException('Batch not found');
    if (batch.status !== 'failed') throw new BadRequestException(`Can only refund a 'failed' batch (this one is '${batch.status}')`);
    if (batch.lottery_ticket_id) throw new BadRequestException('This batch already delivered a ticket — refunding would double-pay the user');

    const { data: subscription } = await db.from('megapot_subscriptions').select('*').eq('id', batch.subscription_id).maybeSingle();
    if (!subscription) throw new BadRequestException('Subscription not found for this batch');

    const refundUsdc = batch.num_tickets * TICKET_PRICE_USDC;
    const userSolanaAddress = await this.usersService.getSolanaWalletAddress(subscription.user_id, { skipCache: true });
    const refundTxHash = await this.lottery.refundToUserWallet(userSolanaAddress, refundUsdc);

    await db.from('megapot_subscription_batches').update({
      status: 'refunded', refund_tx_hash: refundTxHash, refunded_at: new Date().toISOString(),
    }).eq('id', batchId);

    const newTotal = Math.max(subscription.tickets_bought, subscription.total_tickets - batch.num_tickets);
    const nowCompleted = subscription.tickets_bought >= newTotal;
    await db.from('megapot_subscriptions').update({
      total_tickets: newTotal,
      ...(nowCompleted ? { status: 'completed', completed_at: new Date().toISOString() } : {}),
    }).eq('id', subscription.id);

    this.logger.log(`Subscription ${subscription.id} batch ${batchId}: refunded $${refundUsdc} for ${batch.num_tickets} undelivered ticket(s), sig=${refundTxHash}`);
    return { refundTxHash };
  }
}
