import { Injectable, BadRequestException } from '@nestjs/common';
import { ClaimsService } from '@/modules/claims/claims.service';
import { DepositService } from '@/modules/claims/deposit.service';
import { NearIntentsService } from '@/modules/intents/near-intents.service';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { Address } from '@ton/core';
import { CreatePayoutDto, PayoutFundingSource } from './dto/create-payout.dto';

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
  constructor(
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

    let created: { id: string; short_id: string | null; link: string };
    switch (dto.recipient_type) {
      case 'email':
        created = await this.claimsService.createFromEmail({ ...shared, email: dto.recipient_identifier });
        break;
      case 'username':
        created = await this.claimsService.createFromUsername({ ...shared, username: dto.recipient_identifier });
        break;
      case 'twitter':
        // Twitter handles route through the same username lookup (a Twitter handle can double
        // as a Loofta username) — treatUnregisteredAsTwitter just tags an unresolved handle as
        // a pending Twitter recipient rather than a pending Loofta username.
        created = await this.claimsService.createFromUsername({
          ...shared,
          username: dto.recipient_identifier,
          treatUnregisteredAsTwitter: true,
        });
        break;
      case 'discord':
      case 'github':
      case 'telegram':
        created = await this.claimsService.createFromSocial({
          ...shared,
          platform: dto.recipient_type,
          handle: dto.recipient_identifier,
        });
        break;
      default:
        throw new BadRequestException(`Unsupported recipient_type: ${dto.recipient_type}`);
    }

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
}
