import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Headers,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { DealsService } from './deals.service';
import {
  CreateDealDto,
  UpdateDealDto,
  CreateDealInviteDto,
  AcceptDealInviteDto,
  CreateDealCommentDto,
  DealResponse,
  DealInviteResponse,
  DealCommentResponse,
} from './dto';

@ApiTags('deals')
@Controller('payroll/organizations/:orgId/deals')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class DealsController {
  constructor(private readonly service: DealsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a deal' })
  @ApiParam({ name: 'orgId' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 403 })
  create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateDealDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealResponse> {
    return this.service.create(orgId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List deals for the organization' })
  @ApiParam({ name: 'orgId' })
  list(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealResponse[]> {
    return this.service.list(orgId, userId);
  }

  @Get('my-invites')
  @ApiOperation({ summary: 'List deals where I am the invitee (contributor view)' })
  @ApiParam({ name: 'orgId' })
  listMyInvites(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<Array<{ deal: DealResponse; invite: DealInviteResponse }>> {
    return this.service.listMyInvites(orgId, userId);
  }

  @Get(':dealId')
  @ApiOperation({ summary: 'Get deal with invites' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  get(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealResponse> {
    return this.service.get(orgId, dealId, userId);
  }

  @Get(':dealId/invoice')
  @ApiOperation({ summary: 'Get linked invoice for this deal (org view)' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  getDealInvoice(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<(import('./dto').DealInvoiceResponse & { deal_title?: string; org_name?: string }) | null> {
    return this.service.getInvoiceByDealId(orgId, dealId, userId);
  }

  @Put(':dealId')
  @ApiOperation({ summary: 'Update deal (draft/invited only)' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  update(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Body() dto: UpdateDealDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealResponse> {
    return this.service.update(orgId, dealId, userId, dto);
  }

  @Post(':dealId/contract')
  @ApiOperation({ summary: 'Upload contract attachment for the deal' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  async uploadContract(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Headers('x-privy-user-id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file?.buffer) throw new BadRequestException('File is required');
    return this.service.uploadContract(orgId, dealId, userId, file.buffer, file.originalname || 'contract.pdf');
  }

  @Post(':dealId/invites')
  @ApiOperation({ summary: 'Invite a freelancer to the deal' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  invite(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Body() dto: CreateDealInviteDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealInviteResponse> {
    return this.service.invite(orgId, dealId, userId, dto);
  }

  @Post(':dealId/accept-delivery')
  @ApiOperation({ summary: 'Accept delivery: create pending payment for freelancer' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  acceptDelivery(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<import('./dto').DealPaymentResponse> {
    return this.service.acceptDelivery(orgId, dealId, userId);
  }

  @Post(':dealId/dispute')
  @ApiOperation({ summary: 'Create dispute for delivered deal' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  createDispute(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealResponse> {
    return this.service.createDispute(orgId, dealId, userId);
  }

  @Get(':dealId/comments')
  @ApiOperation({ summary: 'List comments on a deal' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  @ApiResponse({ status: 200, description: 'List of comments' })
  listComments(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealCommentResponse[]> {
    return this.service.listComments(orgId, dealId, userId);
  }

  @Post(':dealId/comments')
  @ApiOperation({ summary: 'Add a comment to a deal' })
  @ApiParam({ name: 'orgId' })
  @ApiParam({ name: 'dealId' })
  @ApiResponse({ status: 201, description: 'Created comment' })
  addComment(
    @Param('orgId') orgId: string,
    @Param('dealId') dealId: string,
    @Body() dto: CreateDealCommentDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<DealCommentResponse> {
    return this.service.addComment(orgId, dealId, userId, dto);
  }
}
