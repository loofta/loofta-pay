import { Controller, Post, Body, Param, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { IntegratorGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { BurnerPaymentService } from './burner-payment.service';
import { PayHumanDto } from './dto/pay-human.dto';
import type { AuthenticatedIntegrator } from '../integrators/integrators.service';

/**
 * Generalized successor to /twitter-payments — same underlying burner/claim machinery, but
 * usable by any registered integrator (API key via IntegratorGuard) rather than one hardcoded
 * bot secret. The integrator sends USDC to the returned deposit address themselves (same funding
 * mechanic as the x402 path, just without the 402 challenge/response envelope) — no pre-funded
 * treasury/balance bookkeeping to build.
 */
@ApiTags('integrators')
@Controller('integrators/v1')
export class IntegratorPaymentsController {
  constructor(private readonly burnerPayments: BurnerPaymentService) {}

  @Post('pay-human')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RateLimit(60, 60, 'integrator:pay-human', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Create a pending payment to a human, addressed by email/username/social handle' })
  @ApiResponse({ status: 201, description: '{ payment_id, short_id, claim_link, deposit_address, required_amount_base_units }' })
  async payHuman(@Body() dto: PayHumanDto, @Req() req: { integrator: AuthenticatedIntegrator }) {
    const result = await this.burnerPayments.createPendingBurnerPayment({
      recipientType: dto.recipient_type,
      recipientIdentifier: dto.recipient_identifier,
      amountUsd: dto.amount_usd,
      description: dto.description,
      integratorId: req.integrator.id,
      isDevnet: req.integrator.isDevnetOnly,
    });
    return {
      payment_id: result.paymentId,
      short_id: result.shortId,
      claim_link: result.claimLink,
      deposit_address: result.depositAddress,
      required_amount_base_units: result.requiredAmountBaseUnits,
    };
  }

  @Post('pay-human/:paymentId/verify-funded')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RateLimit(60, 60, 'integrator:verify-funded', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Check whether the deposit address has actually received the required USDC on-chain' })
  @ApiResponse({ status: 200, description: '{ funded, balance_base_units }' })
  async verifyFunded(@Param('paymentId') paymentId: string) {
    const { funded, balanceBaseUnits } = await this.burnerPayments.verifyAndMarkFunded(paymentId);
    return { funded, balance_base_units: balanceBaseUnits };
  }
}
