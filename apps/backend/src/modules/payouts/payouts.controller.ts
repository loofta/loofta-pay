import { Controller, Get, Param, ParseUUIDPipe, Post, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { IntegratorGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { RequireScope } from '@/common/decorators/require-scope.decorator';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { PayoutsService } from './payouts.service';
import { PartnerWebhooksService } from './partner-webhooks.service';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { CreatePayoutBatchDto } from './dto/create-payout-batch.dto';

@ApiTags('payouts')
@Controller('payouts')
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly webhooks: PartnerWebhooksService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RequireScope('payouts:create')
  @RateLimit(20, 60, 'payouts:create', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Pay a recipient (by email/username/social handle) from the API key owner\'s account — returns an unsigned Solana tx to sign, or (with funding_source) a deposit address to fund from another chain' })
  @ApiResponse({ status: 201, description: '{ payment_id, short_id, claim_link, is_private, unsigned_transaction?, transaction_version?, send_to?, fee_amount_usdc?, funding_source?, deposit_address?, deposit_address_raw?, deposit_memo?, deposit_amount?, deposit_deadline?, deposit_note? }' })
  async create(
    @Body() dto: CreatePayoutDto,
    @Req() req: { integrator: AuthenticatedIntegrator },
  ) {
    return this.payouts.create(dto, req.integrator);
  }

  @Post('batches')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RequireScope('payouts:create')
  @RateLimit(5, 60, 'payouts:batch', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Pay up to 100 recipients in one call. Returns one unsigned transaction per created row for your wallet to sign. Idempotent by idempotency_key.' })
  async createBatch(
    @Body() dto: CreatePayoutBatchDto,
    @Req() req: { integrator: AuthenticatedIntegrator },
  ) {
    return this.payouts.createBatch(dto, req.integrator);
  }

  @Get('batches/:id')
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RequireScope('payouts:create')
  @RateLimit(60, 60, 'payouts:batch-read', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Batch status: each row with its payment status (pending, claimed, ...)' })
  async getBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { integrator: AuthenticatedIntegrator },
  ) {
    return this.payouts.getBatch(id, req.integrator);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RequireScope('payouts:create')
  @RateLimit(10, 60, 'payouts:webhook-config', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Set (or clear with null) the https URL that receives payout.funded and payout.claimed events. Returns the signing secret; verify the X-Loofta-Signature header (sha256 HMAC of the raw body).' })
  async setWebhook(
    @Body() body: { url: string | null },
    @Req() req: { integrator: AuthenticatedIntegrator },
  ) {
    return this.webhooks.setWebhookUrl(req.integrator.id, body?.url ?? null);
  }
}
