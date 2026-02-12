import { Controller, Get, Post, Body, Param, UseGuards, Headers } from '@nestjs/common';
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
}
