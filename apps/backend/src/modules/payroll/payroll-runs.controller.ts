import { Controller, Get, Post, Body, Param, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { PayrollRunsService } from './payroll-runs.service';
import { CreatePayrollRunDto, PayrollRunResponse } from './dto';

@ApiTags('payroll/runs')
@Controller('payroll/organizations/:orgId/runs')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class PayrollRunsController {
  constructor(private readonly service: PayrollRunsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a payment run and get deposit intents' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: 201, description: 'Run created with deposit addresses' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreatePayrollRunDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollRunResponse> {
    return this.service.createRun(orgId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payment runs for the organization' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: 200, description: 'List of runs' })
  async list(
    @Param('orgId') orgId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<any[]> {
    return this.service.listRuns(orgId, userId);
  }

  @Get(':runId')
  @ApiOperation({ summary: 'Get a payment run with entries and deposit details' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'runId', description: 'Run UUID' })
  @ApiResponse({ status: 200, description: 'Run with entries' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  async get(
    @Param('orgId') orgId: string,
    @Param('runId') runId: string,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<PayrollRunResponse> {
    return this.service.getRun(orgId, runId, userId);
  }
}
