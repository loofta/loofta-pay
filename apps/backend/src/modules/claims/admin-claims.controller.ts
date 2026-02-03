import {
  Controller,
  Get,
  Delete,
  Patch,
  Post,
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
import { ClaimsService } from './claims.service';
import { Claim, ClaimIntent, ClaimStatus } from './entities/claim.entity';

@ApiTags('admin/claims')
@Controller('admin/claims')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class AdminClaimsController {
  constructor(private readonly claimsService: ClaimsService) {}

  /**
   * List all claims (paginated)
   */
  @Get()
  @ApiOperation({ summary: 'List all claims (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'PENDING_DEPOSIT', 'IN_FLIGHT', 'PRIVATE_TRANSFER_PENDING', 'SUCCESS', 'REFUNDED', 'EXPIRED', 'CANCELLED'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'List of claims',
    schema: {
      properties: {
        claims: { type: 'array', items: { $ref: '#/components/schemas/Claim' } },
        total: { type: 'number' },
      },
    },
  })
  async findAll(
    @Query('status') status?: ClaimStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ claims: Claim[]; total: number }> {
    return this.claimsService.findAll({
      status,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  /**
   * Get claim details with all intents
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get claim with all intents (admin)' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({
    status: 200,
    description: 'Claim with intents',
    schema: {
      properties: {
        claim: { $ref: '#/components/schemas/Claim' },
        intents: { type: 'array', items: { $ref: '#/components/schemas/ClaimIntent' } },
      },
    },
  })
  async findOne(@Param('id') id: string): Promise<{
    claim: Claim;
    intents: ClaimIntent[];
  }> {
    return this.claimsService.findWithAllIntents(id);
  }

  /**
   * Update claim status
   */
  @Patch(':id/status')
  @ApiOperation({ summary: 'Update claim status (admin)' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Updated claim', type: Claim })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: ClaimStatus },
  ): Promise<Claim> {
    return this.claimsService.updateStatus(id, body.status);
  }

  /**
   * Delete a single claim
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a claim (admin)' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 204, description: 'Claim deleted' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.claimsService.delete(id);
  }

  /**
   * Delete multiple claims
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete multiple claims (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Deleted count',
    schema: {
      properties: {
        deleted: { type: 'number' },
      },
    },
  })
  async deleteMany(@Body() body: { ids: string[] }): Promise<{ deleted: number }> {
    return this.claimsService.deleteMany(body.ids);
  }
}
