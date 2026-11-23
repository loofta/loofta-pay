import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { PartnerPayoutsService } from './partner-payouts.service';
import { ApproveBatchDto, CancelPayoutsDto, ConfirmBatchDto, CreatePartnerBatchDto, PrepareBatchDto } from './dto/partner-batch.dto';

type Caller = { id: string };

/**
 * Batch payouts and the dashboard for a partner org. Default-deny: every route needs a login and
 * resolves the caller's membership and role inside the service, so another org's id returns
 * "not found", never data.
 */
@ApiTags('partners')
@Controller('partners/:orgId')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class PartnerBatchesController {
  constructor(private readonly payouts: PartnerPayoutsService) {}

  @Get('overview')
  @RateLimit(60, 60, 'partners:overview')
  overview(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.payouts.overview(orgId, user.id);
  }

  @Get('counts')
  @RateLimit(60, 60, 'partners:counts')
  counts(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.payouts.counts(orgId, user.id);
  }

  @Get('payouts')
  @RateLimit(60, 60, 'partners:payouts')
  payoutList(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.payouts.payouts(orgId, user.id);
  }

  @Post('payouts/:paymentId/cancel')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'partners:payout-cancel')
  cancelPayout(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('paymentId') paymentId: string) {
    return this.payouts.cancelPayout(orgId, user.id, paymentId);
  }

  @Post('batches/:batchId/cancel-payouts')
  @HttpCode(HttpStatus.OK)
  @RateLimit(6, 60, 'partners:batch-cancel-payouts')
  cancelBatchPayouts(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('batchId') batchId: string, @Body() dto: CancelPayoutsDto) {
    return this.payouts.cancelBatchPayouts(orgId, user.id, batchId, dto.payment_ids);
  }

  @Get('batches')
  @RateLimit(60, 60, 'partners:batches-list')
  list(@PrivyUser() user: Caller, @Param('orgId') orgId: string) {
    return this.payouts.list(orgId, user.id);
  }

  @Post('batches')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit(10, 60, 'partners:batches-create')
  create(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Body() dto: CreatePartnerBatchDto) {
    return this.payouts.createDraft(orgId, user.id, dto);
  }

  @Get('batches/:batchId')
  @RateLimit(60, 60, 'partners:batches-get')
  get(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('batchId') batchId: string) {
    return this.payouts.get(orgId, user.id, batchId);
  }

  @Post('batches/:batchId/approve')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'partners:batches-approve')
  approve(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('batchId') batchId: string, @Body() dto: ApproveBatchDto) {
    return this.payouts.approve(orgId, user.id, batchId, dto);
  }

  @Post('batches/:batchId/cancel')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'partners:batches-cancel')
  cancel(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('batchId') batchId: string) {
    return this.payouts.cancel(orgId, user.id, batchId);
  }

  @Post('batches/:batchId/prepare')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'partners:batches-prepare')
  prepare(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('batchId') batchId: string, @Body() dto: PrepareBatchDto) {
    return this.payouts.prepare(orgId, user.id, batchId, dto);
  }

  @Post('batches/:batchId/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit(30, 60, 'partners:batches-confirm')
  confirm(@PrivyUser() user: Caller, @Param('orgId') orgId: string, @Param('batchId') batchId: string, @Body() dto: ConfirmBatchDto) {
    return this.payouts.confirm(orgId, user.id, batchId, dto);
  }
}
