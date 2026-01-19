import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
import { AdminGuard } from '@/common/guards';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto';
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
