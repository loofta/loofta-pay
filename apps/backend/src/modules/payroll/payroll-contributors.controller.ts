import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { PayrollContributorsService } from './payroll-contributors.service';
import { CreateContributorDto, UpdateContributorDto, UpdateContributorProfileDto, PayrollContributor, ContributorStatus } from './dto';

@ApiTags('payroll/contributors')
@Controller('payroll/organizations/:orgId/contributors')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class PayrollContributorsController {
  constructor(private readonly service: PayrollContributorsService) {}

  /**
   * Add a contributor to the organization
   */
  @Post()
  @ApiOperation({ summary: 'Add a contributor' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: 201, description: 'Contributor added' })
  @ApiResponse({ status: 400, description: 'Invalid input or duplicate' })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateContributorDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollContributor> {
    return this.service.create(orgId, dto, userId);
  }

  /**
   * Get all contributors for the organization
   */
  @Get()
  @ApiOperation({ summary: 'List contributors' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiQuery({ name: 'status', required: false, enum: ['invited', 'joined', 'removed'] })
  @ApiResponse({ status: 200, description: 'List of contributors' })
  async findAll(
    @Param('orgId') orgId: string,
    @Query('status') status: ContributorStatus | undefined,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollContributor[]> {
    return this.service.findAll(orgId, userId, status);
  }

  /**
   * Get my contributor record for this org (for contributor info page)
   */
  @Get('me')
  @ApiOperation({ summary: 'Get my contributor profile in this organization' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Current user contributor record' })
  @ApiResponse({ status: 404, description: 'Not a contributor' })
  async findMe(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollContributor> {
    return this.service.findMe(orgId, userId);
  }

  /**
   * Update my contributor profile (address, business registration)
   */
  @Patch('me')
  @ApiOperation({ summary: 'Update my contributor profile' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Updated contributor' })
  async updateMe(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateContributorProfileDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollContributor> {
    return this.service.updateMe(orgId, userId, dto);
  }

  /**
   * Get a single contributor
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get contributor details' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Contributor UUID' })
  @ApiResponse({ status: 200, description: 'Contributor details' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async findOne(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollContributor> {
    return this.service.findOne(orgId, id, userId);
  }

  /**
   * Update a contributor
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update contributor' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Contributor UUID' })
  @ApiResponse({ status: 200, description: 'Contributor updated' })
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContributorDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollContributor> {
    return this.service.update(orgId, id, dto, userId);
  }

  /**
   * Remove a contributor (soft delete)
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove contributor' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Contributor UUID' })
  @ApiResponse({ status: 204, description: 'Contributor removed' })
  async remove(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<void> {
    await this.service.remove(orgId, id, userId);
  }

  /**
   * Permanently delete a contributor
   */
  @Delete(':id/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete contributor' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Contributor UUID' })
  @ApiResponse({ status: 204, description: 'Contributor deleted permanently' })
  async deletePermanent(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<void> {
    await this.service.delete(orgId, id, userId);
  }

  /**
   * Bulk invite contributors
   */
  @Post('bulk-invite')
  @ApiOperation({ summary: 'Bulk invite contributors' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Bulk invite results' })
  async bulkInvite(
    @Param('orgId') orgId: string,
    @Body() body: { contributors: Array<{ email: string; firstName?: string; lastName?: string }> },
    @Headers('x-privy-user-id') userId: string,
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    return this.service.bulkInvite(orgId, body.contributors, userId);
  }

  /**
   * Get or create invite link for a contributor (copy link or send email)
   */
  @Post(':id/send-invite')
  @ApiOperation({ summary: 'Get invite link for contributor' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Contributor UUID' })
  @ApiResponse({ status: 200, description: 'Invite link' })
  async sendInvite(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Headers('x-privy-user-id') userId: string,
    @Body() body: { baseUrl?: string } = {},
  ): Promise<{ inviteLink: string }> {
    const baseUrl = body.baseUrl || process.env.FRONTEND_URL || 'https://swap.loofta.xyz';
    const { inviteLink } = await this.service.getOrCreateInviteLink(orgId, id, userId, baseUrl);
    return { inviteLink };
  }
}
