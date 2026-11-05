import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { SupabaseService } from '@/database/supabase.service';
import { ClaimsService } from '@/modules/claims/claims.service';
import { DepositService } from '@/modules/claims/deposit.service';
import { NearIntentsService } from '@/modules/intents/near-intents.service';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { Address } from '@ton/core';
import { CreatePayoutDto, PayoutFundingSource } from './dto/create-payout.dto';
import { CreatePayoutBatchDto } from './dto/create-payout-batch.dto';

// Fixed symbol/chain pair NEAR Intents needs looked up for each supported funding_source. Chain
// candidates list handles the possibility NEAR's token list names a chain differently than we'd
// guess (e.g. a chain labeled differently than we expect). gram_ton uses native TON coin (NEAR
// Intents' own token list labels it "GRAM") rather than the USDT jetton — a plain native-coin
// transfer just credits the destination's balance directly, with no jetton-wallet "notify" step
// to fail on insufficient gas, which is what made the USDT route unreliable (real stuck deposit,
// 2026-09-09: funds landed but the notify aborted with cskip_no_gas, so it never registered).
const FUNDING_SOURCE_TOKENS: Record<PayoutFundingSource, { symbol: string; chains: string[] }> = {
  gram_ton: { symbol: 'GRAM', chains: ['ton'] },
  usdc_base: { symbol: 'USDC', chains: ['base'] },
};

const PAYOUT_EXPIRY_MS = 4 * 60 * 60 * 1000;

// gram_ton waives both Loofta's own cross-chain fee and the NEAR app fee — bridging TON already
// carries real, unavoidable overhead (HOT's bridge/relayer costs), so adding our own fee on top
// only makes an already-expensive route worse. usdc_base is unaffected.
const FEE_FREE_FUNDING_SOURCES: PayoutFundingSource[] = ['gram_ton'];

// NEAR Intents hands back TON deposit addresses in the bounceable "EQ..." form. Wallets and
// exchanges display (and often expect) the non-bounceable "UQ..." form for plain deposits, so
// return that as deposit_address plus the raw "0:<hex>" form. Same account, only flag bits and
// checksum differ. Falls back to the original string if it isn't a parseable TON address.
export function tonDepositAddressFields(
  fundingSource: PayoutFundingSource,
  address: string,
): { deposit_address: string; deposit_address_raw?: string } {
  if (fundingSource !== 'gram_ton') return { deposit_address: address };
  try {
    const parsed = Address.parse(address);
    return {
      deposit_address: parsed.toString({ bounceable: false, testOnly: false }),
      deposit_address_raw: parsed.toRawString(),
    };
  } catch {
    return { deposit_address: address };
  }
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly claimsService: ClaimsService,
    private readonly depositService: DepositService,
    private readonly nearIntentsService: NearIntentsService,
  ) {}

  /**
   * Creates a claim addressed to the given recipient with the calling integrator's owner as
   * sender — the mirror image of PaymentLinksService.create (which pays the integrator; this
   * pays out of the integrator's own account) — then immediately builds the unsigned transfer
   * transaction, so a single call returns something the caller's own wallet can sign right away.
   * Delegates recipient resolution (registered user vs. pending email/username/social, burner
   * minting) entirely to ClaimsService's existing create-from-* methods — the same code path the
   * in-app "Send" flow already uses under Privy auth, just reached by API key here instead.
   *
   * Private payouts go through buildPrivateTransferForPayer with gasless: true (its default) —
   * MagicBlock's own configured sponsor pays SOL gas, not SolanaSponsorService — and Loofta's own
   * 10 bps platform fee lands in that same method's existing platformFeeAccount, the sponsor
   * wallet's own USDC ATA. That's the already-live design (ENABLE_SINGLE_PAYMENT_PLATFORM_FEE),
   * unchanged here — SolanaSponsorService's wallet legitimately doubles as Loofta's fee-collection
   * address; nothing about it is being reused for gas sponsorship on this path.
   */
  async create(
    dto: CreatePayoutDto,
    integrator: AuthenticatedIntegrator,
  ): Promise<{
    payment_id: string;
    short_id: string | null;
    claim_link: string;
    is_private: boolean;
    unsigned_transaction?: string;
    transaction_version?: 'legacy' | 'v0';
    send_to?: 'base' | 'ephemeral';
    fee_amount_usdc?: number;
    funding_source?: PayoutFundingSource;
    deposit_address?: string;
    deposit_address_raw?: string;
    deposit_memo?: string | null;
    deposit_amount?: string;
    deposit_deadline?: string;
  }> {
    if (!integrator.ownerUserId) {
      // Should be unreachable — only self-serve integrators carry the payouts:create scope
      // (see IntegratorsService.provisionSelfServe) — but never trust that a client-supplied
      // sender is safe to fall back to if it somehow isn't set.
      throw new BadRequestException('This API key has no owner to pay out on behalf of.');
    }
    if (dto.funding_source && dto.sender_wallet?.trim()) {
      throw new BadRequestException('Pass either sender_wallet or funding_source, not both.');
    }
    if (dto.funding_source && !dto.refund_wallet?.trim()) {
      throw new BadRequestException('refund_wallet is required when funding_source is set.');
    }
    if (!dto.funding_source && !dto.sender_wallet?.trim()) {
      throw new BadRequestException('sender_wallet is required.');
    }

    const isPrivate = dto.is_private === true;
    const senderUserId = integrator.ownerUserId;
    const shared = {
      amount: dto.amount,
      userId: senderUserId,
      isPrivate,
      description: dto.message,
      // Unsettled payouts (never signed, or never funded) die out on their own rather than
      // sitting open forever — ClaimProcessorService.handleExpireStaleClaims sweeps these every
      // 10 minutes. Already-funded claims (PRIVATE_TRANSFER_PENDING/SUCCESS) are untouched.
      expiresAt: new Date(Date.now() + PAYOUT_EXPIRY_MS).toISOString(),
    };

    const created = await this.createClaimForRecipient(dto.recipient_type, dto.recipient_identifier, shared, integrator.id);

    if (dto.funding_source) {
      // Cross-chain funding: same claim, same burner routing and EXACT_OUTPUT gross-up the
      // in-app "pay claim from another chain" flow already uses (DepositService.requestDeposit)
      // — so the caller sends the source token to a deposit address instead of signing a Solana
      // transaction, and the existing near-intents-withdrawals reconciliation sweeps it to the
      // recipient once it lands, same as any other cross-chain claim payment.
      const { symbol, chains } = FUNDING_SOURCE_TOKENS[dto.funding_source];
      const token = await this.nearIntentsService.findToken(symbol, chains);
      if (!token) {
        throw new BadRequestException(`${dto.funding_source} is temporarily unavailable — no route found.`);
      }

      const deposit = await this.depositService.requestDeposit({
        claimId: created.id,
        fromToken: {
          tokenId: token.tokenId!,
          symbol: token.symbol,
          chain: token.chain,
          decimals: token.decimals,
        },
        amount: String(dto.amount),
        refundAddress: dto.refund_wallet!.trim(),
        isPrivate,
        waiveFees: FEE_FREE_FUNDING_SOURCES.includes(dto.funding_source),
      });

      if (!deposit.depositAddress) {
        throw new BadRequestException('Failed to prepare a deposit address for this funding_source.');
      }

      return {
        payment_id: created.id,
        short_id: created.short_id,
        claim_link: created.link,
        is_private: isPrivate,
        funding_source: dto.funding_source,
        ...tonDepositAddressFields(dto.funding_source, deposit.depositAddress),
        deposit_memo: deposit.memo ?? null,
        deposit_amount: deposit.minAmountInFormatted,
        deposit_deadline: deposit.deadline,
      };
    }

    const senderWallet = dto.sender_wallet!.trim();

    if (isPrivate) {
      const built = await this.claimsService.buildPrivateTransferForPayer(created.id, senderUserId, senderWallet);
      return {
        payment_id: created.id,
        short_id: created.short_id,
        claim_link: created.link,
        unsigned_transaction: built.transactionBase64,
        transaction_version: built.version,
        // MagicBlock private transfers can require broadcasting to its ephemeral rollup RPC
        // rather than base Solana — callers signing and sending this themselves need to know
        // which, or the signed tx silently goes nowhere.
        send_to: built.sendTo,
        is_private: true,
        fee_amount_usdc: built.feeAmountUsdc,
      };
    }

    const built = await this.claimsService.buildPublicTransferForPayer(created.id, senderUserId, senderWallet);
    return {
      payment_id: created.id,
      short_id: created.short_id,
      claim_link: created.link,
      unsigned_transaction: built.transactionBase64,
      transaction_version: built.version,
      send_to: 'base',
      is_private: false,
    };
  }

  async findOrCreatePartnerRecipient(integratorId: string, externalUserId: string, displayName?: string): Promise<string> {
    const ext = externalUserId.trim();
    if (!ext) throw new BadRequestException('external_user_id is required.');
    const { data: existing } = await this.supabase.partnerRecipients
      .select('id')
      .eq('integrator_id', integratorId)
      .eq('external_user_id', ext)
      .maybeSingle();
    if (existing) return existing.id;
    const { data, error } = await this.supabase.partnerRecipients
      .insert({ integrator_id: integratorId, external_user_id: ext, display_name: displayName ?? null })
      .select('id')
      .single();
    if (error || !data) {
      // Lost a race with a concurrent insert for the same user: read the winner.
      const { data: again } = await this.supabase.partnerRecipients.select('id').eq('integrator_id', integratorId).eq('external_user_id', ext).maybeSingle();
      if (again) return again.id;
      throw new BadRequestException('Could not create recipient.');
    }
    return data.id;
  }

  /** Resolves the recipient and creates their claim (burner, pending identity) without building any transaction. */
  private async createClaimForRecipient(
    recipientType: CreatePayoutDto['recipient_type'],
    recipientIdentifier: string,
    shared: { amount: number; userId: string; isPrivate: boolean; description?: string; expiresAt?: string },
    integratorId: string,
  ): Promise<{ id: string; short_id: string | null; link: string }> {
    let created: { id: string; short_id: string | null; link: string };
    switch (recipientType) {
      case 'email':
        created = await this.claimsService.createFromEmail({ ...shared, email: recipientIdentifier });
        break;
      case 'username':
        created = await this.claimsService.createFromUsername({ ...shared, username: recipientIdentifier });
        break;
      case 'twitter':
        // Twitter handles route through the same username lookup (a Twitter handle can double
        // as a Loofta username) — treatUnregisteredAsTwitter just tags an unresolved handle as
        // a pending Twitter recipient rather than a pending Loofta username.
        created = await this.claimsService.createFromUsername({
          ...shared,
          username: recipientIdentifier,
          treatUnregisteredAsTwitter: true,
        });
        break;
      case 'discord':
      case 'github':
      case 'telegram':
        created = await this.claimsService.createFromSocial({
          ...shared,
          platform: recipientType,
          handle: recipientIdentifier,
        });
        break;
      case 'partner_user': {
        // The partner's own user id; recipient has no Loofta account and withdraws via the portal.
        if (shared.isPrivate) throw new BadRequestException('partner_user payouts cannot be private yet.');
        const partnerRecipientId = await this.findOrCreatePartnerRecipient(integratorId, recipientIdentifier);
        created = await this.claimsService.createForPartnerRecipient({
          amount: shared.amount,
          userId: shared.userId,
          partnerRecipientId,
          description: shared.description,
          expiresAt: shared.expiresAt,
        });
        break;
      }
      default:
        throw new BadRequestException(`Unsupported recipient_type: ${recipientType}`);
    }

    return created;
  }

  /**
   * Bulk payouts: one request, many recipients. Each row goes through the exact same create()
   * path as a single payout (recipient resolution, burner routing, private transfer), so a
   * batch can never behave differently from N single calls. A failing row is recorded and
   * skipped rather than failing the whole batch, and the caller signs every returned
   * transaction with their own wallet (wallets can sign many at once), so Loofta never holds
   * the partner's funds. Idempotent per (partner, idempotency_key).
   */
  async createBatch(dto: CreatePayoutBatchDto, integrator: AuthenticatedIntegrator) {
    const { data: existing } = await this.supabase.payoutBatches
      .select('id')
      .eq('integrator_id', integrator.id)
      .eq('idempotency_key', dto.idempotency_key)
      .maybeSingle();
    // A retry returns the batch's current state (not fresh unsigned transactions: those carry a
    // recent blockhash and must never be re-issued for already-created claims).
    if (existing) return this.getBatch(existing.id, integrator);

    const { data: batch, error: batchErr } = await this.supabase.payoutBatches
      .insert({
        integrator_id: integrator.id,
        idempotency_key: dto.idempotency_key,
        label: dto.label ?? null,
        item_count: dto.rows.length,
      })
      .select('id')
      .single();
    if (batchErr || !batch) {
      // Unique violation = a concurrent retry won the race.
      throw new BadRequestException('Could not create batch. If you retried, the first request may still be running.');
    }

    const isPrivate = dto.is_private === true;
    const items: Array<Record<string, unknown>> = [];
    const itemRows: Array<Record<string, unknown>> = [];
    const createdClaims: Array<{ index: number; claimId: string }> = [];
    let total = 0;
    let failed = 0;

    const recordFailure = (i: number, message: string) => {
      failed++;
      const row = dto.rows[i];
      itemRows.push({
        batch_id: batch.id,
        row_index: i,
        recipient_type: row.recipient_type,
        recipient_identifier: row.recipient_identifier,
        amount: row.amount,
        external_ref: row.external_ref ?? null,
        status: 'failed',
        error: message.slice(0, 500),
      });
      items.push({ row_index: i, external_ref: row.external_ref ?? null, status: 'failed', error: message });
    };
    const recordCreated = (i: number, paymentId: string, extra: Record<string, unknown>) => {
      const row = dto.rows[i];
      total += row.amount;
      itemRows.push({
        batch_id: batch.id,
        row_index: i,
        recipient_type: row.recipient_type,
        recipient_identifier: row.recipient_identifier,
        amount: row.amount,
        external_ref: row.external_ref ?? null,
        status: 'created',
        payment_id: paymentId,
      });
      items.push({ row_index: i, external_ref: row.external_ref ?? null, status: 'created', payment_id: paymentId, ...extra });
    };

    // Sequential on purpose: each row hits RPC and the claims service, and a 100-row batch
    // firing all at once would trip rate limits for every other integrator.
    const packedTransactions: Array<{ payment_ids: string[]; unsigned_transaction: string; transaction_version: 'legacy' | 'v0'; send_to: 'base' }> = [];

    if (isPrivate) {
      // Private transfers go through MagicBlock one at a time, so they can't share a transaction.
      for (let i = 0; i < dto.rows.length; i++) {
        const row = dto.rows[i];
        try {
          const created = await this.create(
            {
              amount: row.amount,
              recipient_type: row.recipient_type,
              recipient_identifier: row.recipient_identifier,
              sender_wallet: dto.sender_wallet,
              message: row.message,
              is_private: true,
            },
            integrator,
          );
          recordCreated(i, created.payment_id, created as unknown as Record<string, unknown>);
        } catch (err) {
          const message = (err as Error).message || 'Failed to create payout';
          this.logger.warn(`Batch ${batch.id} row ${i} failed: ${message}`);
          recordFailure(i, message);
        }
      }
    } else {
      if (!integrator.ownerUserId) throw new BadRequestException('This API key has no owner to pay out on behalf of.');
      const senderUserId = integrator.ownerUserId;
      for (let i = 0; i < dto.rows.length; i++) {
        const row = dto.rows[i];
        try {
          const created = await this.createClaimForRecipient(row.recipient_type, row.recipient_identifier, {
            amount: row.amount,
            userId: senderUserId,
            isPrivate: false,
            description: row.message,
            expiresAt: new Date(Date.now() + PAYOUT_EXPIRY_MS).toISOString(),
          }, integrator.id);
          createdClaims.push({ index: i, claimId: created.id });
          recordCreated(i, created.id, { short_id: created.short_id, claim_link: created.link, is_private: false });
        } catch (err) {
          const message = (err as Error).message || 'Failed to create payout';
          this.logger.warn(`Batch ${batch.id} row ${i} failed: ${message}`);
          recordFailure(i, message);
        }
      }

      if (createdClaims.length) {
        // Many transfers per transaction: one signature fee and one wallet approval covers
        // several payees. If packing fails for the whole batch, mark every created row failed so
        // none is left looking payable without a transaction to pay it.
        try {
          const packed = await this.claimsService.buildPackedPublicTransfersForPayer(
            createdClaims.map((c) => c.claimId),
            senderUserId,
            dto.sender_wallet.trim(),
          );
          for (const tx of packed) {
            packedTransactions.push({
              payment_ids: tx.claimIds,
              unsigned_transaction: tx.transactionBase64,
              transaction_version: tx.version,
              send_to: 'base',
            });
          }
        } catch (err) {
          const message = (err as Error).message || 'Could not build funding transactions';
          this.logger.warn(`Batch ${batch.id} packing failed: ${message}`);
          for (const c of createdClaims) {
            const row = itemRows.find((r) => r.row_index === c.index);
            if (row) {
              row.status = 'failed';
              row.error = message.slice(0, 500);
              row.payment_id = null;
            }
            const item = items.find((it) => it.row_index === c.index);
            if (item) Object.assign(item, { status: 'failed', error: message });
            total -= dto.rows[c.index].amount;
            failed++;
          }
        }
      }
    }

    if (itemRows.length) await this.supabase.payoutBatchItems.insert(itemRows);
    await this.supabase.payoutBatches.update({ total_amount: total, failed_count: failed }).eq('id', batch.id);

    return {
      batch_id: batch.id,
      item_count: dto.rows.length,
      failed_count: failed,
      total_amount: total,
      // Public batches: sign and send every entry in `transactions` (each funds the listed
      // payment_ids). Private batches: each item carries its own unsigned_transaction.
      transactions: packedTransactions,
      items,
    };
  }

  async getBatch(batchId: string, integrator: AuthenticatedIntegrator) {
    const { data: batch } = await this.supabase.payoutBatches
      .select('id, label, idempotency_key, total_amount, item_count, failed_count, created_at')
      .eq('id', batchId)
      .eq('integrator_id', integrator.id)
      .maybeSingle();
    if (!batch) throw new BadRequestException('Batch not found.');

    const { data: items } = await this.supabase.payoutBatchItems
      .select('row_index, recipient_type, recipient_identifier, amount, external_ref, status, error, payment_id')
      .eq('batch_id', batchId)
      .order('row_index', { ascending: true });

    const paymentIds = (items ?? []).map((i) => i.payment_id).filter((id): id is string => !!id);
    const statusById = new Map<string, string>();
    if (paymentIds.length) {
      const { data: payments } = await this.supabase.payments.select('id, status').in('id', paymentIds);
      for (const p of payments ?? []) statusById.set(p.id, p.status);
    }

    return {
      ...batch,
      items: (items ?? []).map((i) => ({ ...i, payment_status: i.payment_id ? statusById.get(i.payment_id) ?? null : null })),
    };
  }
}
