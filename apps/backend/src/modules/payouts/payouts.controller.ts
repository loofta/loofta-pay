import { Controller, Post, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { IntegratorGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { RequireScope } from '@/common/decorators/require-scope.decorator';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { PayoutsService } from './payouts.service';
import { CreatePayoutDto } from './dto/create-payout.dto';

@ApiTags('payouts')
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RequireScope('payouts:create')
  @RateLimit(20, 60, 'payouts:create', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Pay a recipient (by email/username/social handle) from the API key owner\'s account — returns an unsigned tx to sign with your own wallet' })
  @ApiResponse({ status: 201, description: '{ payment_id, short_id, claim_link, unsigned_transaction, transaction_version, is_private, fee_amount_usdc? }' })
  async create(
    @Body() dto: CreatePayoutDto,
    @Req() req: { integrator: AuthenticatedIntegrator },
  ) {
    return this.payouts.create(dto, req.integrator);
  }
}
