import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { DealPaymentsService, CheckAndCompleteResult } from './deal-payments.service';
import { DealPaymentResponse } from './dto';

@ApiTags('deal-payments')
@Controller('payroll/organizations/:orgId/deal-payments')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class DealPaymentsController {
  constructor(private readonly service: DealPaymentsService) {}

  @Get('pending')
  @ApiOperation({ summary: 'List pending payments (from accepted deliveries)' })
  @ApiParam({ name: 'orgId' })
  listPending(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse[]> {
    return this.service.listPending(orgId, userId);
  }

  @Get('outstanding')
  @ApiOperation({ summary: 'List pending + processing payments (to select for pay or mark completed)' })
  @ApiParam({ name: 'orgId' })
  listOutstanding(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse[]> {
    return this.service.listOutstanding(orgId, userId);
  }

  @Get('completed')
  @ApiOperation({ summary: 'List completed payments (for Pay list)' })
  @ApiParam({ name: 'orgId' })
  listCompleted(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse[]> {
    return this.service.listCompleted(orgId, userId);
  }

  @Get(':paymentId')
  @ApiOperation({ summary: 'Get a single payment by id (any status, for detail view)' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'paymentId' })
  getById(
    @Param('orgId') orgId: string,
    @Param('paymentId') paymentId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse | null> {
    return this.service.getById(orgId, paymentId, userId);
  }

  @Post('prepare-pay')
  @ApiOperation({ summary: 'Prepare pay: create intents for selected payment IDs; optional payWithToken and refundAddress' })
  @ApiParam({ name: 'orgId' })
  preparePay(
    @Param('orgId') orgId: string,
    @Body() body: { paymentIds: string[]; payWithToken?: { symbol: string; chain: string; tokenId?: string; decimals?: number }; refundAddress?: string },
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse[]> {
    return this.service.preparePay(orgId, body.paymentIds || [], userId, body.payWithToken, body.refundAddress);
  }

  @Delete(':paymentId')
  @ApiOperation({ summary: 'Delete a pending payment; unlinks invoice and reverts deal to delivered' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'paymentId' })
  deletePayment(
    @Param('orgId') orgId: string,
    @Param('paymentId') paymentId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<void> {
    return this.service.deletePayment(orgId, paymentId, userId);
  }

  @Post(':paymentId/mark-completed')
  @ApiOperation({ summary: 'Mark payment as completed (with tx hash); marks invoice paid and posts on-chain attestation' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'paymentId' })
  @ApiResponse({ status: 200, description: 'Payment and invoice updated; receipt posted if configured' })
  markCompleted(
    @Param('orgId') orgId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: { txHash: string },
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse> {
    return this.service.markCompleted(orgId, paymentId, body.txHash || '', userId);
  }

  @Get(':paymentId/check-complete')
  @ApiOperation({ summary: 'Check intent status; if completed, auto-mark payment and invoice paid + on-chain attestation' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'paymentId' })
  @ApiResponse({ status: 200, description: 'Check result; completed true if payment was marked paid' })
  checkAndComplete(
    @Param('orgId') orgId: string,
    @Param('paymentId') paymentId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<CheckAndCompleteResult> {
    return this.service.checkAndComplete(orgId, paymentId, userId);
  }

  @Post(':paymentId/retry-receipt')
  @ApiOperation({ summary: 'Retry posting on-chain receipt for a completed payment' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'paymentId' })
  @ApiResponse({ status: 200, description: 'Receipt posted or already present; when receiptPosted is false, error contains the reason' })
  retryReceipt(
    @Param('orgId') orgId: string,
    @Param('paymentId') paymentId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<{ receiptPosted: boolean; receiptOnChainTxHash?: string | null; error?: string }> {
    return this.service.retryReceiptForPayment(orgId, paymentId, userId);
  }

  @Put(':paymentId/reset-to-pending')
  @ApiOperation({ summary: 'Reset a processing payment to pending (e.g. after intent expired); allows Prepare pay again' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'paymentId' })
  @ApiResponse({ status: 200, description: 'Payment reset to pending' })
  resetToPending(
    @Param('orgId') orgId: string,
    @Param('paymentId') paymentId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse> {
    return this.service.resetToPending(orgId, paymentId, userId);
  }
}
