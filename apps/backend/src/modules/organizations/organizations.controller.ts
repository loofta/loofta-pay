import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
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
import { AdminGuard, AuthGuard } from '@/common/guards';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, UpdateOrganizationDto, CreateCheckoutSessionDto, UpdateOrganizationSelfServeDto } from './dto';
import { Organization } from './entities/organization.entity';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * List all organizations (Admin only)
   */
  @Get()
  @UseGuards(AdminGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'List all organizations' })
  @ApiResponse({
    status: 200,
    description: 'List of organizations',
    type: [Organization],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(): Promise<{ organizations: Organization[] }> {
    const organizations = await this.organizationsService.findAll();
    return { organizations };
  }

  /**
   * List organizations owned by the calling user (self-serve dashboard).
   * Must be registered before the :id wildcard route below — otherwise a request to
   * /organizations/mine matches @Get(':id') first (with "mine" as the id) and hits AdminGuard
   * instead, which a self-serve org owner isn't authorized for. (Real bug, not hypothetical —
   * this exact collision silently 401'd the self-serve dashboard until the routes were reordered.)
   */
  @Get('mine')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'List organizations you own' })
  async findMine(@Req() req: { user?: { id: string } }): Promise<{ organizations: Organization[] }> {
    const organizations = await this.organizationsService.findMine(req.user!.id);
    return { organizations };
  }

  /**
   * Get organization by ID (Admin only)
   */
  @Get(':id')
  @UseGuards(AdminGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization details', type: Organization })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async findOne(@Param('id') id: string): Promise<{ organization: Organization }> {
    const organization = await this.organizationsService.findOne(id);
    return { organization };
  }

  /**
   * Get public organization info by referral code
   */
  @Get('public/by-referral')
  @ApiOperation({ summary: 'Get public organization info by referral code' })
  @ApiQuery({ name: 'code', description: 'Organization referral code' })
  @ApiResponse({ status: 200, description: 'Public organization info' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async getPublicByReferral(@Query('code') code: string): Promise<{
    name: string;
    logo_url: string | null;
    bg_color: string | null;
    checkout_status: string;
  }> {
    const org = await this.organizationsService.findByReferral(code);
    if (!org) {
      throw new Error('Organization not found');
    }
    return {
      name: org.name,
      logo_url: org.logo_url,
      bg_color: org.bg_color,
      checkout_status: org.checkout_status,
    };
  }

  /**
   * Get public organization info by organization_id
   */
  @Get('public/by-id')
  @ApiOperation({ summary: 'Get public organization info by organization_id' })
  @ApiQuery({ name: 'organizationId', description: 'Organization unique ID (e.g., acme-corp)' })
  @ApiResponse({ status: 200, description: 'Public organization info' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async getPublicByOrganizationId(@Query('organizationId') organizationId: string): Promise<{
    organization: {
      id: string;
      organization_id: string;
      name: string;
      logo_url: string | null;
      bg_color: string | null;
      checkout_status: string;
      org_referral: string;
      recipient_wallet: string | null;
      token_symbol: string | null;
      token_chain: string | null;
    };
  }> {
    const org = await this.organizationsService.findByOrganizationId(organizationId);
    if (!org) {
      throw new Error('Organization not found');
    }
    return {
      organization: {
        id: org.id,
        organization_id: org.organization_id,
        name: org.name,
        logo_url: org.logo_url,
        bg_color: org.bg_color,
        checkout_status: org.checkout_status,
        org_referral: org.org_referral,
        recipient_wallet: org.recipient_wallet,
        token_symbol: org.token_symbol,
        token_chain: org.token_chain,
      },
    };
  }

  /**
   * Self-serve organization signup — Privy-authed, lands as 'pending' until an admin
   * approves it via the admin panel. Not the admin CRUD endpoint below.
   */
  @Post('self-serve')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Self-serve organization signup (pending admin approval)' })
  @ApiResponse({ status: 201, description: 'Organization created (pending)', type: Organization })
  async createSelfServe(
    @Body() createDto: CreateOrganizationDto,
    @Req() req: { user?: { id: string } },
  ): Promise<{ organization: Organization }> {
    const organization = await this.organizationsService.createSelfServe(req.user!.id, createDto);
    return { organization };
  }

  /**
   * Self-serve settings update — org owner only. Cannot change checkout_status (admin-only).
   */
  @Post(':id/self-serve')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Update settings for an organization you own' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  async updateSelfServe(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationSelfServeDto,
    @Req() req: { user?: { id: string } },
  ): Promise<{ organization: Organization }> {
    const organization = await this.organizationsService.updateSelfServe(id, req.user!.id, dto);
    return { organization };
  }

  /**
   * Self-serve API key issuance — org owner only, org must already be admin-approved (active).
   */
  @Post(':id/api-keys')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Mint a new API key for an organization you own' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  async createApiKey(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
  ): Promise<{ apiKey: string; keyPrefix: string }> {
    const { rawKey, keyPrefix } = await this.organizationsService.createApiKey(id, req.user!.id);
    return { apiKey: rawKey, keyPrefix };
  }

  /**
   * Create a checkout session — public, called by the hosted /checkout page and PayButton.
   * Mints a burner-backed payment link addressed to the organization's recipient wallet.
   */
  @Post(':organizationId/checkout-sessions')
  @ApiOperation({ summary: 'Create a checkout session (payment link) for an organization' })
  @ApiParam({ name: 'organizationId', description: 'Organization unique ID (e.g., acme-corp)' })
  async createCheckoutSession(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateCheckoutSessionDto,
  ): Promise<{ id: string; short_id: string; link: string }> {
    return this.organizationsService.createCheckoutSession(organizationId, dto);
  }

  /**
   * Create new organization (Admin only)
   */
  @Post()
  @UseGuards(AdminGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({
    status: 201,
    description: 'Organization created',
    type: Organization,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 409, description: 'Organization already exists' })
  async create(
    @Body() createDto: CreateOrganizationDto,
  ): Promise<{ organization: Organization }> {
    const organization = await this.organizationsService.create(createDto);
    return { organization };
  }

  /**
   * Update organization (Admin only)
   */
  @Put()
  @UseGuards(AdminGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Update an organization' })
  @ApiResponse({ status: 200, description: 'Organization updated', type: Organization })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async update(
    @Body() updateDto: UpdateOrganizationDto,
  ): Promise<{ organization: Organization }> {
    const organization = await this.organizationsService.update(updateDto);
    return { organization };
  }

  /**
   * Delete organization (Admin only)
   */
  @Delete()
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Delete an organization' })
  @ApiQuery({ name: 'id', description: 'Organization UUID to delete' })
  @ApiResponse({ status: 200, description: 'Organization deleted' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async remove(@Query('id') id: string): Promise<{ success: boolean }> {
    await this.organizationsService.remove(id);
    return { success: true };
  }
}
