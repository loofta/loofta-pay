import { Injectable, BadRequestException } from '@nestjs/common';
import { ClaimsService } from '@/modules/claims/claims.service';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { CreatePayoutDto } from './dto/create-payout.dto';

@Injectable()
export class PayoutsService {
  constructor(private readonly claimsService: ClaimsService) {}

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
    unsigned_transaction: string;
    transaction_version: 'legacy' | 'v0';
    is_private: boolean;
    fee_amount_usdc?: number;
  }> {
    if (!integrator.ownerUserId) {
      // Should be unreachable — only self-serve integrators carry the payouts:create scope
      // (see IntegratorsService.provisionSelfServe) — but never trust that a client-supplied
      // sender is safe to fall back to if it somehow isn't set.
      throw new BadRequestException('This API key has no owner to pay out on behalf of.');
    }
    if (!dto.sender_wallet?.trim()) {
      throw new BadRequestException('sender_wallet is required.');
    }

    const isPrivate = dto.is_private === true;
    const senderUserId = integrator.ownerUserId;
    const shared = {
      amount: dto.amount,
      userId: senderUserId,
      isPrivate,
      description: dto.message,
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

    if (isPrivate) {
      const built = await this.claimsService.buildPrivateTransferForPayer(created.id, senderUserId, dto.sender_wallet.trim());
      return {
        payment_id: created.id,
        short_id: created.short_id,
        claim_link: created.link,
        unsigned_transaction: built.transactionBase64,
        transaction_version: built.version,
        is_private: true,
        fee_amount_usdc: built.feeAmountUsdc,
      };
    }

    const built = await this.claimsService.buildPublicTransferForPayer(created.id, senderUserId, dto.sender_wallet.trim());
    return {
      payment_id: created.id,
      short_id: created.short_id,
      claim_link: created.link,
      unsigned_transaction: built.transactionBase64,
      transaction_version: built.version,
      is_private: false,
    };
  }
}
