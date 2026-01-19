import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
} from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { PayrollOrganizationsService } from './payroll-organizations.service';
import { CreatePayrollOrganizationDto, UpdatePayrollOrganizationDto, PayrollOrganization } from './dto';

@ApiTags('payroll/organizations')
@Controller('payroll/organizations')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class PayrollOrganizationsController {
  constructor(private readonly service: PayrollOrganizationsService) {}

  /**
   * Create a new payroll organization
   */
  @Post()
  @ApiOperation({ summary: 'Create a new payroll organization' })
  @ApiResponse({ status: 201, description: 'Organization created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @Body() dto: CreatePayrollOrganizationDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollOrganization> {
    return this.service.create(dto, userId);
  }

  /**
   * Get all organizations for the current user
   */
  @Get()
  @ApiOperation({ summary: 'Get all organizations for the current user' })
  @ApiResponse({ status: 200, description: 'List of organizations' })
  async findAll(
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollOrganization[]> {
    return this.service.findAllForUser(userId);
  }

  /**
   * Get a single organization
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get organization details' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization details' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findOne(
    @Param('id') id: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollOrganization> {
    return this.service.findOne(id, userId);
  }

  /**
   * Update an organization
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization updated' })
  @ApiResponse({ status: 403, description: 'Only owner can update' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePayrollOrganizationDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollOrganization> {
    return this.service.update(id, dto, userId);
  }

  /**
   * Delete an organization
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete organization' })
  @ApiParam({ name: 'id', description: 'Organization UUID' })
  @ApiResponse({ status: 204, description: 'Organization deleted' })
  @ApiResponse({ status: 403, description: 'Only owner can delete' })
  async delete(
    @Param('id') id: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<void> {
    await this.service.delete(id, userId);
  }
}
