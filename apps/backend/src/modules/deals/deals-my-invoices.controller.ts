import { Controller, Get, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { DealsService } from './deals.service';
import { DealInvoiceResponse } from './dto';

@ApiTags('deals')
@Controller('payroll')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class DealsMyInvoicesController {
  constructor(private readonly service: DealsService) {}

  @Get('my-invoices')
  @ApiOperation({ summary: 'List all my invoices as freelancer (across all organizations)' })
  @ApiResponse({ status: 200, description: 'List of deal invoices for the current user' })
  listAllMyInvoices(
    @Headers('x-privy-user-id') userId: string,
  ): Promise<(DealInvoiceResponse & { deal_title?: string; org_name?: string; invite_id?: string })[]> {
    return this.service.listAllMyInvoices(userId);
  }
}
