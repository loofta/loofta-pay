import { Controller, Get, Post, Delete, Body, Param, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { DealPaymentsService } from './deal-payments.service';
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

  @Post('prepare-pay')
  @ApiOperation({ summary: 'Prepare pay: create intents for selected payment IDs; returns deposit addresses' })
  @ApiParam({ name: 'orgId' })
  preparePay(
    @Param('orgId') orgId: string,
    @Body() body: { paymentIds: string[] },
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse[]> {
    return this.service.preparePay(orgId, body.paymentIds || [], userId);
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
}
