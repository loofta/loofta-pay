import {
  Controller,
  Get,
  Post,
  Body,
  Param,
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
} from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { ClaimsService } from './claims.service';
import { DepositService, DepositResult } from './deposit.service';
import { CreateClaimDto, CreateClaimFromUsernameDto, RequestDepositDto } from './dto';
import { Claim, ClaimIntent } from './entities/claim.entity';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly depositService: DepositService,
  ) {}

  /**
   * Create a new payment claim
   */
  @Post('create')
  @ApiOperation({ summary: 'Create a new payment claim' })
  @ApiResponse({
    status: 201,
    description: 'Claim created',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        link: { type: 'string', format: 'uri' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async create(
    @Body() createDto: CreateClaimDto,
  ): Promise<{ id: string; link: string }> {
    return this.claimsService.create(createDto);
  }

  /**
   * Create a claim from username (wallet address fetched server-side, never exposed)
   */
  @Post('create-from-username')
  @ApiOperation({ summary: 'Create claim from username (wallet address stays server-side)' })
  @ApiResponse({
    status: 201,
    description: 'Claim created',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        link: { type: 'string', format: 'uri' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'User not found or no wallet' })
  async createFromUsername(
    @Body() createDto: CreateClaimFromUsernameDto,
  ): Promise<{ id: string; link: string }> {
    return this.claimsService.createFromUsername(createDto);
  }

  /**
   * Get claim by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get claim details' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Claim details', type: Claim })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async findOne(@Param('id') id: string): Promise<{ claim: Claim }> {
    const claim = await this.claimsService.findOne(id);
    return { claim };
  }

  /**
   * Get claim with latest intent
   */
  @Get(':id/latest-intent')
  @ApiOperation({ summary: 'Get claim with latest intent' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({
    status: 200,
    description: 'Claim with latest intent',
    schema: {
      properties: {
        claim: { $ref: '#/components/schemas/Claim' },
        intent: { $ref: '#/components/schemas/ClaimIntent', nullable: true },
      },
    },
  })
  async getWithLatestIntent(@Param('id') id: string): Promise<{
    claim: Claim;
    intent: ClaimIntent | null;
  }> {
    return this.claimsService.findWithLatestIntent(id);
  }

  /**
   * Request deposit address for payment
   */
  @Post('deposit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request deposit address for claim payment' })
  @ApiResponse({
    status: 200,
    description: 'Deposit information',
    schema: {
      properties: {
        depositAddress: { type: 'string' },
        memo: { type: 'string', nullable: true },
        deadline: { type: 'string', format: 'date-time' },
        timeEstimate: { type: 'number' },
        quoteId: { type: 'string' },
        minAmountIn: { type: 'string' },
        minAmountInFormatted: { type: 'string' },
        directTransfer: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid input or route not available' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async requestDeposit(
    @Body() depositDto: RequestDepositDto,
  ): Promise<DepositResult> {
    return this.depositService.requestDeposit(depositDto);
  }

  /**
   * Update claim status (public endpoint for payment flow)
   */
  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update claim status' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Updated claim', type: Claim })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; txHash?: string; paidWith?: string; isPrivate?: boolean },
  ): Promise<Claim> {
    return this.claimsService.updateStatus(id, body.status as any, {
      txHash: body.txHash,
      paidWith: body.paidWith,
      isPrivate: body.isPrivate,
    });
  }

  /**
   * Get user's claims (authenticated)
   */
  @Get('user/my-claims')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Get authenticated user\'s claims' })
  @ApiResponse({
    status: 200,
    description: 'User claims',
    type: [Claim],
  })
  async getMyClaimsPlaceholder(): Promise<{ claims: Claim[] }> {
    // This would use the user ID from the request
    // For now, return empty array as placeholder
    return { claims: [] };
  }
}
