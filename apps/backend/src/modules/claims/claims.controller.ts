import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
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
import { SolanaSponsorService } from './solana-sponsor.service';
import { CreateClaimDto, CreateClaimFromUsernameDto, CreateClaimFromEmailDto, RequestDepositDto } from './dto';
import { Claim, ClaimIntent } from './entities/claim.entity';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  constructor(
    private readonly claimsService: ClaimsService,
    private readonly depositService: DepositService,
    private readonly solanaSponsor: SolanaSponsorService,
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
  async createFromUsername(
    @Body() createDto: CreateClaimFromUsernameDto,
  ): Promise<{ id: string; link: string }> {
    return this.claimsService.createFromUsername(createDto);
  }

  /**
   * Create a claim from email. If user exists, use their wallet; otherwise they claim by signing in with this email later.
   */
  @Post('create-from-email')
  @ApiOperation({ summary: 'Create claim from email (recipient may not have an account yet)' })
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
  async createFromEmail(
    @Body() createDto: CreateClaimFromEmailDto,
  ): Promise<{ id: string; link: string }> {
    return this.claimsService.createFromEmail(createDto);
  }

  /**
   * Get fee payer address for Solana sponsored transactions (Pay with Loofta).
   * Declared before :id so "solana-sponsor/fee-payer" is not captured as claim id.
   */
  @Get('solana-sponsor/fee-payer')
  @ApiOperation({ summary: 'Get Solana fee payer address for sponsorship' })
  @ApiResponse({
    status: 200,
    description: 'Fee payer address if sponsorship is enabled',
    schema: { properties: { feePayerAddress: { type: 'string', nullable: true } } },
  })
  getSolanaFeePayer(): { feePayerAddress: string | null } {
    return { feePayerAddress: this.solanaSponsor.getFeePayerAddress() };
  }

  /**
   * Check if the authenticated user is the recipient of this claim (for "Received" / "Claim" view on claim page)
   */
  @Get(':id/recipient-check')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Check if current user is the recipient of the claim' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Whether the current user is the recipient', schema: { properties: { isRecipient: { type: 'boolean' } } } })
  async recipientCheck(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
  ): Promise<{ isRecipient: boolean }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) return { isRecipient: false };
    return this.claimsService.checkIsRecipient(id, privyUserId);
  }

  /**
   * Claim a pending payment (PENDING_EMAIL / PENDING_USERNAME) as the logged-in recipient.
   * Updates the claim's recipient to your Solana wallet so the payer can complete the deposit.
   */
  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Claim a pending payment as the recipient' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Claimed', schema: { properties: { claimed: { type: 'boolean' } } } })
  @ApiResponse({ status: 400, description: 'Not pending or already claimed' })
  @ApiResponse({ status: 403, description: 'Not the intended recipient' })
  async claimAsRecipient(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
  ): Promise<{ claimed: boolean }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required to claim.');
    return this.claimsService.claimAsRecipient(id, privyUserId);
  }

  /**
   * Reclaim (cancel) a payment as the creator. Sets claim to CANCELLED.
   * If the claim has a burner with USDC, sweeps it to the creator's Loofta wallet.
   */
  @Post(':id/reclaim')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Reclaim (cancel) payment as creator; funds go to your Loofta wallet' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Cancelled', schema: { properties: { cancelled: { type: 'boolean' } } } })
  @ApiResponse({ status: 403, description: 'Not the creator' })
  async reclaim(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
  ): Promise<{ cancelled: boolean }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required to reclaim.');
    return this.claimsService.reclaimByCreator(id, privyUserId);
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
   * Sign a user-signed sponsored transaction with the fee payer and broadcast.
   * Body: { transaction: base64 serialized VersionedTransaction (user already signed) }.
   */
  @Post('solana-sponsor/sign-and-broadcast')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Sign and broadcast sponsored Solana transaction' })
  @ApiResponse({
    status: 200,
    description: 'Transaction signature',
    schema: { properties: { signature: { type: 'string' } } },
  })
  @ApiResponse({ status: 400, description: 'Invalid transaction' })
  @ApiResponse({ status: 503, description: 'Sponsorship not configured' })
  async signAndBroadcastSponsored(
    @Body() body: { transaction: string },
  ): Promise<{ signature: string }> {
    if (!body?.transaction || typeof body.transaction !== 'string') {
      throw new BadRequestException('Missing or invalid transaction');
    }
    if (!this.solanaSponsor.isAvailable()) {
      throw new ServiceUnavailableException('Solana fee sponsorship is not configured');
    }
    try {
      return await this.solanaSponsor.signAndBroadcast(body.transaction);
    } catch (e: any) {
      if (e?.message?.includes('not configured')) {
        throw new ServiceUnavailableException('Solana sponsorship is not configured');
      }
      throw new BadRequestException(e?.message || 'Failed to sign and broadcast');
    }
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
