import { Controller, Get, Post, Put, Body, Param, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { DealsService } from './deals.service';
import { DealPaymentsService } from './deal-payments.service';
import { AcceptDealInviteDto, RequestChangesDealInviteDto, DealInviteResponse, DealResponse, DealPaymentResponse } from './dto';

@ApiTags('deal-invites')
@Controller('deal-invites')
export class DealInvitesController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly dealPaymentsService: DealPaymentsService,
  ) {}

  @Get(':inviteId')
  @ApiOperation({ summary: 'Get invite and deal (for freelancer view; with auth returns contributor_payout if set)' })
  @ApiParam({ name: 'inviteId' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async getInvite(
    @Param('inviteId') inviteId: string,
    @Headers('x-privy-user-id') userId?: string,
  ): Promise<{ invite: DealInviteResponse; deal: DealResponse; contributor_payout?: { network: string; token_symbol: string } }> {
    return this.dealsService.getInviteByToken(inviteId, userId);
  }

  @Get(':inviteId/payments')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'List payments for this invite (freelancer only, after accept)' })
  @ApiParam({ name: 'inviteId' })
  @ApiResponse({ status: 200, description: 'Payments for this deal invite' })
  @ApiResponse({ status: 403 })
  async listPayments(
    @Param('inviteId') inviteId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealPaymentResponse[]> {
    return this.dealPaymentsService.listForInvite(inviteId, userId);
  }

  @Get(':inviteId/invoice')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get invoice for this deal (freelancer view)' })
  @ApiParam({ name: 'inviteId' })
  @ApiResponse({ status: 200, description: 'Invoice for the deal, or null' })
  @ApiResponse({ status: 403 })
  async getInvoice(
    @Param('inviteId') inviteId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<(import('./dto').DealInvoiceResponse & { deal_title?: string; org_name?: string }) | null> {
    return this.dealsService.getInvoiceForInvite(inviteId, userId);
  }

  @Put(':inviteId/accept')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Accept invite (freelancer sets preferred token/network)' })
  @ApiParam({ name: 'inviteId' })
  accept(
    @Param('inviteId') inviteId: string,
    @Body() dto: AcceptDealInviteDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealInviteResponse> {
    return this.dealsService.acceptInvite(inviteId, userId, dto);
  }

  @Put(':inviteId/decline')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Decline invite' })
  @ApiParam({ name: 'inviteId' })
  decline(
    @Param('inviteId') inviteId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealInviteResponse> {
    return this.dealsService.declineInvite(inviteId, userId);
  }

  @Put(':inviteId/request-changes')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Request terms to be edited (freelancer negotiates)' })
  @ApiParam({ name: 'inviteId' })
  requestChanges(
    @Param('inviteId') inviteId: string,
    @Body() dto: RequestChangesDealInviteDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealInviteResponse> {
    return this.dealsService.requestChangesInvite(inviteId, userId, dto);
  }

  @Post(':inviteId/confirm-delivery')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Freelancer confirms delivery' })
  @ApiParam({ name: 'inviteId' })
  confirmDelivery(
    @Param('inviteId') inviteId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealResponse> {
    return this.dealsService.confirmDeliveryByInvite(inviteId, userId);
  }
}
