import { BadRequestException, Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { HTTPFacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2, USDC_DEVNET_ADDRESS, USDC_MAINNET_ADDRESS } from '@x402/svm';
import { RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { BurnerPaymentService } from './burner-payment.service';
import { PayHumanDto } from './dto/pay-human.dto';

/** How long the burner/deposit address stays valid before the payment is considered abandoned. */
const MAX_TIMEOUT_SECONDS = 900;

/**
 * x402-compliant facade — the "agent pays a human" entry point that needs no prior Loofta
 * integration at all: any x402-aware agent (Coinbase AgentKit, LangChain's x402 tool, our own
 * SDK, or a hand-rolled client) can hit this exactly like any other x402 resource.
 *
 * IMPORTANT — not yet live-tested end-to-end: the facilitator URL/auth below default to the
 * public x402.org facilitator per the official @x402/core quick-start docs. Coinbase's
 * CDP-hosted facilitator (confirmed to support Solana, with a free tier) is the intended
 * production facilitator per the plan, but its exact URL and whether it needs a CDP API key
 * were not verified against live credentials — set X402_FACILITATOR_URL /
 * X402_FACILITATOR_API_KEY once provisioned, and run a full devnet 402 → sign → settle → claim
 * round trip before this ships.
 *
 * Two-phase flow (deliberately NOT using @x402/express's paymentMiddleware — that middleware
 * assumes a route's price/payTo are static or a deterministic function of stable request
 * metadata, whereas here a *fresh burner* must be minted once and then reused identically across
 * the initial 402 and the follow-up paid request; this two-phase controller does that
 * explicitly instead of fighting the middleware's config shape):
 *   1. No X-PAYMENT header: mint a burner + pending `payments` row (via the same
 *      BurnerPaymentService the REST integrator path uses), respond 402 with PaymentRequirements
 *      pointing at that burner's deposit address.
 *   2. X-PAYMENT header present: decode it, re-derive PaymentRequirements from OUR OWN pending
 *      payment record (never trust the client-echoed `accepted` object as authoritative), verify
 *      + settle via the facilitator, then independently confirm the burner's real on-chain
 *      balance (BurnerPaymentService.verifyAndMarkFunded) before ever telling the caller it's
 *      claimable — the facilitator's "success" alone is not trusted as ground truth.
 */
@Controller('x402')
export class X402PaymentsController {
  private readonly facilitator: HTTPFacilitatorClient;
  private readonly baseUrl: string;

  constructor(
    private readonly burnerPayments: BurnerPaymentService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('NEXT_PUBLIC_BASE_URL') || 'https://pay.loofta.xyz';

    const apiKey = this.configService.get<string>('X402_FACILITATOR_API_KEY');
    this.facilitator = new HTTPFacilitatorClient({
      url: this.configService.get<string>('X402_FACILITATOR_URL') || 'https://x402.org/facilitator',
      createAuthHeaders: apiKey
        ? async () => {
            const header = { Authorization: `Bearer ${apiKey}` };
            return { verify: header, settle: header, supported: header, list: header };
          }
        : undefined,
    });
  }

  @Post('pay-human')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 60, 'x402:pay-human', 'ip')
  async payHuman(@Body() dto: PayHumanDto, @Req() req: Request, @Res() res: Response) {
    const xPaymentHeader = req.headers['x-payment'] as string | undefined;
    const isDevnet = isSolanaDevnetFromConfig(this.configService);

    if (!xPaymentHeader) {
      await this.respondWithPaymentRequired(dto, isDevnet, res);
      return;
    }

    await this.settleAndRespond(xPaymentHeader, res);
  }

  private buildPaymentRequirements(
    paymentId: string,
    depositAddress: string,
    requiredAmountBaseUnits: string,
    isDevnet: boolean,
  ): PaymentRequirements {
    return {
      scheme: 'exact',
      network: isDevnet ? SOLANA_DEVNET_CAIP2 : SOLANA_MAINNET_CAIP2,
      asset: isDevnet ? USDC_DEVNET_ADDRESS : USDC_MAINNET_ADDRESS,
      amount: requiredAmountBaseUnits,
      payTo: depositAddress,
      maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
      extra: { payment_id: paymentId },
    };
  }

  private async respondWithPaymentRequired(dto: PayHumanDto, isDevnet: boolean, res: Response): Promise<void> {
    const pending = await this.burnerPayments.createPendingBurnerPayment({
      recipientType: dto.recipient_type,
      recipientIdentifier: dto.recipient_identifier,
      amountUsd: dto.amount_usd,
      description: dto.description,
      integratorId: null,
      isDevnet,
    });

    const paymentRequirements = this.buildPaymentRequirements(
      pending.paymentId,
      pending.depositAddress,
      pending.requiredAmountBaseUnits,
      isDevnet,
    );

    const body: PaymentRequired = {
      x402Version: 2,
      resource: {
        url: `${this.baseUrl}/x402/pay-human`,
        description: 'Pay a human by email, username, or social handle via Loofta',
        mimeType: 'application/json',
      },
      accepts: [paymentRequirements],
    };

    res.status(402).json(body);
  }

  private async settleAndRespond(xPaymentHeader: string, res: Response): Promise<void> {
    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = JSON.parse(Buffer.from(xPaymentHeader, 'base64').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid X-PAYMENT header');
    }

    const paymentId = paymentPayload.accepted?.extra?.payment_id as string | undefined;
    if (!paymentId) {
      throw new BadRequestException('Payment does not reference a known payment_id (extra.payment_id)');
    }

    // Re-derive requirements from our own pending-payment record — never trust the client-echoed
    // `accepted` object, since a malicious client could alter amount/payTo in its own copy.
    const pendingInfo = await this.burnerPayments.getPendingPaymentInfo(paymentId);
    const requirements = this.buildPaymentRequirements(
      paymentId,
      pendingInfo.depositAddress,
      pendingInfo.requiredAmountBaseUnits,
      pendingInfo.isDevnet,
    );

    const verifyResult = await this.facilitator.verify(paymentPayload, requirements);
    if (!verifyResult.isValid) {
      throw new BadRequestException(verifyResult.invalidReason || 'Payment verification failed');
    }

    const settleResult = await this.facilitator.settle(paymentPayload, requirements);
    if (!settleResult.success) {
      throw new BadRequestException(settleResult.errorMessage || 'Settlement failed');
    }

    // Never trust the facilitator's success claim alone — independently confirm the burner's
    // real on-chain balance before telling the caller the payment is claimable.
    const { funded } = await this.burnerPayments.verifyAndMarkFunded(paymentId);
    if (!funded) {
      throw new BadRequestException(
        'Facilitator reported settlement but funds are not yet visible on-chain — retry shortly.',
      );
    }

    const claimLink = await this.burnerPayments.getClaimLink(paymentId);
    res.status(200).json({ payment_id: paymentId, claim_link: claimLink, status: 'FUNDED' });
  }
}
