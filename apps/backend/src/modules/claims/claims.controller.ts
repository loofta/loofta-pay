import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard, OptionalAuthGuard } from '@/common/guards';

// All payment-mutating endpoints require authentication (create, pay, status, tx-hash).
// Read-only claim endpoints (GET /:id, /:id/latest-intent) remain public via OptionalAuthGuard.
import { ClaimsService } from './claims.service';
import { ConfigService } from '@nestjs/config';
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
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new payment claim.
   * The caller's Privy user ID is derived from auth (verified), never from the request body.
   */
  @Post('create')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
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
    @Req() req: { user?: { id: string } },
  ): Promise<{ id: string; link: string }> {
    return this.claimsService.create({ ...createDto, userId: req.user?.id });
  }

  /**
   * Create a claim from username (wallet address fetched server-side, never exposed).
   * The caller's Privy user ID is derived from auth (verified), never from the request body.
   */
  @Post('create-from-username')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
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
    @Req() req: { user?: { id: string } },
  ): Promise<{ id: string; link: string }> {
    return this.claimsService.createFromUsername({ ...createDto, userId: req.user?.id });
  }

  /**
   * Create a claim from email. If user exists, use their wallet; otherwise they claim by signing in with this email later.
   * The caller's Privy user ID is derived from auth (verified), never from the request body.
   */
  @Post('create-from-email')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
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
    @Req() req: { user?: { id: string } },
  ): Promise<{ id: string; link: string }> {
    return this.claimsService.createFromEmail({ ...createDto, userId: req.user?.id });
  }

  /**
   * Get fee payer address for Solana sponsored transactions (Pay with Loofta).
   * Declared before :id so "solana-sponsor/fee-payer" is not captured as claim id.
   */
  @Get('solana-sponsor/fee-payer')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
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
   * Troubleshoot endpoint: inspect claim burner balance for creator/recipient.
   */
  @Get(':id/troubleshoot-burner')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Troubleshoot burner balance for this claim' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Burner diagnostics' })
  async troubleshootBurner(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
  ): Promise<{
    canView: true;
    claimId: string;
    claimStatus: string;
    isPrivate: boolean;
    paidWithToken: string | null;
    paidWithChain: string | null;
    burnerAddress: string | null;
    burnerUsdcRaw: string;
    burnerUsdc: string;
    recipientWallet: string | null;
  }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required.');
    return this.claimsService.getBurnerDiagnostics(id, privyUserId);
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
  ): Promise<{ claimed: boolean; sweepTxHash?: string; sweptAmount?: string }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required to claim.');
    return this.claimsService.claimAsRecipient(id, privyUserId);
  }

  @Post(':id/claim-retry-sweep')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Retry sweeping claim burner funds to recipient wallet' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Sweep retried' })
  async retryClaimSweep(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
  ): Promise<{ swept: boolean; sweepTxHash?: string; sweptAmount?: string }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required.');
    return this.claimsService.retryRecipientSweep(id, privyUserId);
  }

  @Post(':id/build-private-transfer')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({
    summary:
      'Build unsigned MagicBlock private USDC transfer (recipient resolved server-side; not in browser network tab)',
  })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Unsigned tx (MagicBlock response shape)' })
  @ApiResponse({ status: 403, description: 'Not the payer' })
  async buildPrivateTransfer(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
    @Body() body: { sender_wallet: string; cluster?: 'devnet' | 'mainnet'; gasless?: boolean },
  ) {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required.');
    return this.claimsService.buildPrivateTransferForPayer(id, privyUserId, body.sender_wallet, body.cluster, body.gasless ?? true);
  }

  /**
   * Check if the creator can reclaim (cancel and sweep). Only true when status is not CANCELLED
   * and the burner has a non-zero USDC balance.
   */
  @Get(':id/reclaim-eligibility')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Check if creator can reclaim (status not cancelled and burner has balance)' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Eligibility', schema: { properties: { canReclaim: { type: 'boolean' } } } })
  @ApiResponse({ status: 403, description: 'Not the creator' })
  async getReclaimEligibility(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
  ): Promise<{ canReclaim: boolean }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required.');
    return this.claimsService.getReclaimEligibility(id, privyUserId);
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
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get claim details' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Claim details', type: Claim })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async findOne(@Param('id') id: string, @Req() req: any): Promise<{ claim: Claim }> {
    const claim = await this.claimsService.findOne(id, req.user?.id);
    return { claim };
  }

  /**
   * Get claim with latest intent
   */
  @Get(':id/latest-intent')
  @UseGuards(OptionalAuthGuard)
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
  async getWithLatestIntent(@Param('id') id: string, @Req() req: any): Promise<{
    claim: Claim;
    intent: ClaimIntent | null;
  }> {
    return this.claimsService.findWithLatestIntent(id, req.user?.id);
  }

  /**
   * Request deposit address for payment
   */
  @Post('deposit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
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

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Update claim status (login required for all transitions)' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Updated claim', type: Claim })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 403, description: 'Not the claim creator' })
  @ApiResponse({ status: 404, description: 'Claim not found' })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: {
      status: string;
      txHash?: string;
      paidWith?: string;
      isPrivate?: boolean;
      paidWithToken?: string;
      paidWithChain?: string;
      feeAmountUsdc?: number;
      feeBreakdown?: { looftaBpsUsdc: number; solRecoveryUsdc: number; solLamports: number; solPriceUsd: number };
    },
    @Req() req: { user?: { id: string } },
  ): Promise<Claim> {
    return this.claimsService.updateStatus(id, body.status as any, {
      txHash: body.txHash,
      paidWith: body.paidWith,
      isPrivate: body.isPrivate,
      paidWithToken: body.paidWithToken,
      paidWithChain: body.paidWithChain,
      feeAmountUsdc: body.feeAmountUsdc,
      feeBreakdown: body.feeBreakdown,
    }, req.user!.id);
  }

  /**
   * Save the Solana tx signature immediately after broadcast, before on-chain confirmation.
   * Allows recovery if confirmation polling fails due to RPC issues.
   */
  @Patch(':id/tx-hash')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Save broadcast tx hash for recovery' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Saved' })
  async saveTxHash(
    @Param('id') id: string,
    @Body() body: { txHash: string },
  ): Promise<void> {
    if (!body.txHash?.trim()) throw new BadRequestException('txHash is required');
    await this.claimsService.saveBroadcastTxHash(id, body.txHash.trim());
  }

  /**
   * Sign a user-signed sponsored transaction with the fee payer and broadcast.
   * Body: { transaction: base64 serialized VersionedTransaction (user already signed) }.
   */
  @Post('solana-sponsor/prepare')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Prepare unsigned Solana transaction with sponsor fee payer' })
  @ApiResponse({
    status: 200,
    description: 'Prepared transaction bytes',
    schema: { properties: { transaction: { type: 'string' } } },
  })
  @ApiResponse({ status: 400, description: 'Invalid transaction' })
  @ApiResponse({ status: 503, description: 'Sponsorship not configured' })
  async prepareSponsoredTransaction(
    @Body() body: { transaction: string },
  ): Promise<{ transaction: string }> {
    if (!body?.transaction || typeof body.transaction !== 'string') {
      throw new BadRequestException('Missing or invalid transaction');
    }
    if (!this.solanaSponsor.isAvailable()) {
      throw new ServiceUnavailableException('Solana fee sponsorship is not configured');
    }
    try {
      return await this.solanaSponsor.prepareSponsoredTransaction(body.transaction);
    } catch (e: any) {
      if (e?.message?.includes('not configured')) {
        throw new ServiceUnavailableException('Solana sponsorship is not configured');
      }
      throw new BadRequestException(e?.message || 'Failed to prepare sponsored transaction');
    }
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
   * Countersign a user-signed MagicBlock PER transaction with the fee payer and broadcast.
   * Used for both claim and send-payment PER flows. The fee payer is allowed to transfer a small
   * amount of SOL (shuttle top-up) which is blocked by the generic sign-and-broadcast endpoint.
   */
  @Post('solana-sponsor/per/sign-and-broadcast')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Countersign and broadcast a user-signed MagicBlock PER transaction' })
  @ApiResponse({ status: 200, description: 'Transaction signature', schema: { properties: { signature: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Invalid transaction' })
  @ApiResponse({ status: 503, description: 'Sponsorship not configured' })
  async signAndBroadcastPER(
    @Body() body: { transaction: string; cluster?: 'devnet' | 'mainnet' },
  ): Promise<{ signature: string }> {
    if (!body?.transaction || typeof body.transaction !== 'string') {
      throw new BadRequestException('Missing or invalid transaction');
    }
    if (!this.solanaSponsor.isAvailable()) {
      throw new ServiceUnavailableException('Solana fee sponsorship is not configured');
    }
    try {
      const { Connection } = await import('@solana/web3.js');
      const heliusKey = this.configService.get<string>('HELIUS_API_KEY') || process.env.HELIUS_API_KEY;
      const conn = body.cluster === 'mainnet'
        ? new Connection(heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : 'https://api.mainnet-beta.solana.com', 'confirmed')
        : undefined;
      return await this.solanaSponsor.signAndBroadcastPER(body.transaction, conn);
    } catch (e: any) {
      if (e?.message?.includes('not configured')) {
        throw new ServiceUnavailableException('Solana sponsorship is not configured');
      }
      throw new BadRequestException(e?.message || 'Failed to sign and broadcast PER transaction');
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

  /**
   * Admin: re-encrypt all legacy v1 burner secrets to v2 (per-payment HKDF) format.
   *
   * Prerequisites:
   *   1. Set SEND_PAYMENT_ENC_KEY to the NEW 32-byte key.
   *   2. Set SEND_PAYMENT_ENC_KEY_OLD to the PREVIOUS key.
   *   3. Deploy the new backend.
   *   4. POST to this endpoint — inspect the response (migrated/failed counts).
   *   5. Once failed === 0, remove SEND_PAYMENT_ENC_KEY_OLD from your environment.
   *
   * Protected by ADMIN_API_KEY header (set ADMIN_API_KEY env var on the backend).
   */
  @Post('admin/rotate-burner-keys')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin: rotate burner encryption keys to v2 per-payment HKDF format' })
  @ApiSecurity('admin-key')
  @ApiResponse({ status: 200, description: 'Migration summary' })
  @ApiResponse({ status: 403, description: 'Invalid admin key' })
  async rotateBurnerKeys(
    @Req() req: Request & { headers: Record<string, string> },
  ): Promise<{ total: number; alreadyV2: number; migrated: number; failed: number; errors: string[] }> {
    const adminKey = this.configService.get<string>('ADMIN_API_KEY');
    const provided = (req.headers as Record<string, string>)['x-admin-api-key'];
    if (!adminKey || !provided || provided !== adminKey) {
      throw new ForbiddenException('Invalid admin API key');
    }
    return this.claimsService.rotateBurnerKeys();
  }
}
