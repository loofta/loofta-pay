import { Controller, Get, Param, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { DealsService } from './deals.service';
import { DealInvoiceResponse } from './dto';

@ApiTags('deals')
@Controller('payroll/organizations/:orgId')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class DealsInvoicesController {
  constructor(private readonly service: DealsService) {}

  @Get('invoices/mine')
  @ApiOperation({ summary: 'List my invoices as freelancer for this org' })
  @ApiParam({ name: 'orgId' })
  @ApiResponse({ status: 200, description: 'List of deal invoices for the current user' })
  listMine(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealInvoiceResponse[]> {
    return this.service.listMyInvoicesForOrg(orgId, userId);
  }

  @Get('invoices')
  @ApiOperation({ summary: 'List invoices for the organization' })
  @ApiParam({ name: 'orgId' })
  @ApiResponse({ status: 200, description: 'List of deal invoices' })
  list(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealInvoiceResponse[]> {
    return this.service.listInvoices(orgId, userId);
  }

  @Get('invoices/:invoiceId')
  @ApiOperation({ summary: 'Get single invoice (for view/PDF template)' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'invoiceId' })
  get(
    @Param('orgId') orgId: string,
    @Param('invoiceId') invoiceId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealInvoiceResponse & { deal_title?: string; org_name?: string }> {
    return this.service.getInvoice(orgId, invoiceId, userId);
  }
}
