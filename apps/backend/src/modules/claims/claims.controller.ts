import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard, OptionalAuthGuard, CronGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';

// All payment-mutating endpoints require authentication (create, pay, status, tx-hash).
// Read-only claim endpoints (GET /:id, /:id/latest-intent) remain public via OptionalAuthGuard.
// Guest checkout (no Privy session) is handled entirely in the frontend's own /api/claims/[id]
// PATCH route instead of here — it needs verifySolanaUsdcPayment (a frontend-only utility) to
// independently prove a guest's claimed payment actually happened on-chain before trusting it,
// since there's no authenticated account to anchor trust in like every endpoint below has.
import { ClaimsService } from './claims.service';
import { ConfigService } from '@nestjs/config';
import { DepositService, DepositResult } from './deposit.service';
import { SolanaSponsorService } from './solana-sponsor.service';
import { UsersService } from '../users/users.service';
import { CreateClaimDto, CreateClaimFromUsernameDto, CreateClaimFromEmailDto, CreateClaimFromSocialDto, RequestDepositDto } from './dto';
import { Claim, ClaimIntent } from './entities/claim.entity';

@ApiTags('claims')
@Controller('claims')
export class ClaimsController {
  private readonly logger = new Logger(ClaimsController.name);

  constructor(
    private readonly claimsService: ClaimsService,
    private readonly depositService: DepositService,
    private readonly solanaSponsor: SolanaSponsorService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Gate for internal-only routes that must have come through our Next.js BFF, never called
   * directly. Fails CLOSED: if LOOFTA_INTERNAL_SECRET isn't configured, the route is unusable
   * rather than silently unprotected — the 2026-08-03 x402 drain happened on a route with no
   * secret check at all, and this fail-open variant (skip-and-log if unset) was found on these
   * three routes during that incident's cleanup. Never revert to fail-open.
   */
  private assertInternalCaller(internalKey: string | undefined, routeLabel: string): void {
    const expectedSecret = this.configService.get<string>('LOOFTA_INTERNAL_SECRET') ?? process.env.LOOFTA_INTERNAL_SECRET;
    if (!expectedSecret) {
      this.logger.error(`ClaimsController[${routeLabel}]: LOOFTA_INTERNAL_SECRET is not set — refusing all calls until it is configured in Railway`);
      throw new ServiceUnavailableException('Internal auth is not configured');
    }
    if (!internalKey || internalKey !== expectedSecret) {
      this.logger.warn(`ClaimsController[${routeLabel}]: blocked direct call — missing/invalid X-Loofta-Internal`);
      throw new ForbiddenException('Direct API access not permitted');
    }
  }

  /**
   * Create a new payment claim.
   * The caller's Privy user ID is derived from auth (verified), never from the request body.
   */
  @Post('create')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'claims:create')
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
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'claims:create')
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
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'claims:create')
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
   * Create a claim addressed to a Discord/GitHub/Telegram handle (wallet address fetched
   * server-side if the handle is already connected to a Loofta account, never exposed).
   * The caller's Privy user ID is derived from auth (verified), never from the request body.
   */
  @Post('create-from-social')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'claims:create')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Create claim from a Discord/GitHub/Telegram handle' })
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
  async createFromSocial(
    @Body() createDto: CreateClaimFromSocialDto,
    @Req() req: { user?: { id: string } },
  ): Promise<{ id: string; link: string }> {
    return this.claimsService.createFromSocial({ ...createDto, userId: req.user?.id });
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
   * Genuinely public pre-auth summary (amount/description/status only, no recipient identity) —
   * lets a claim page show "you're about to claim $X" before the visitor logs in. Accepts either
   * the UUID or the 8-char short_id (fetchRawRow resolves both).
   */
  @Get(':id/summary')
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 60, 'claims:summary', 'ip')
  @ApiOperation({ summary: 'Get public, pre-auth payment summary (amount/description/status only)' })
  @ApiParam({ name: 'id', description: 'Claim UUID or short_id' })
  async findPublicSummary(@Param('id') id: string) {
    return this.claimsService.findPublicSummary(id);
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
   * Has the current user ever sent this recipient a public (non-private) payment before?
   * Backs the "you paid this person publicly before, they already know your wallet address"
   * privacy nudge — recipientUserId is the stable identity, never the raw wallet address.
   */
  @Get('exposure-check')
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Check whether the current user has ever paid this recipient publicly' })
  @ApiResponse({ status: 200, description: 'Whether a public payment to this recipient exists', schema: { properties: { hasPaidPublicly: { type: 'boolean' } } } })
  async exposureCheck(
    @Query('recipientUserId') recipientUserId: string,
    @Req() req: { user?: { id: string } },
  ): Promise<{ hasPaidPublicly: boolean }> {
    const senderUserId = req.user?.id;
    if (!senderUserId || !recipientUserId) return { hasPaidPublicly: false };
    const hasPaidPublicly = await this.claimsService.hasEverPaidPublicly(senderUserId, recipientUserId);
    return { hasPaidPublicly };
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
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(5, 60, 'claims:claim')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Claim a pending payment as the recipient' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Claimed', schema: { properties: { claimed: { type: 'boolean' } } } })
  @ApiResponse({ status: 400, description: 'Not pending or already claimed' })
  @ApiResponse({ status: 403, description: 'Not the intended recipient' })
  async claimAsRecipient(
    @Param('id') id: string,
    @Req() req: { user?: { id: string } },
    @Body() body: { claimPrivately?: boolean; destinationAddress?: string; claimToNaira?: boolean },
  ): Promise<{ claimed: boolean; sweepTxHash?: string; sweptAmount?: string; feeAmountUsdc?: number }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required to claim.');
    return this.claimsService.claimAsRecipient(id, privyUserId, {
      claimPrivately: body?.claimPrivately,
      destinationAddress: body?.destinationAddress,
      claimToNaira: body?.claimToNaira,
    });
  }

  /**
   * Sender action: fix a typo'd or wrong recipient (email, username, or social handle) on a
   * payment they sent, whether the current recipient is still unregistered/pending or already
   * resolved to a registered account — as long as it's still unclaimed. Blocked while the
   * recipient is mid-claim (recipient_claim_lock_at) or once they've actually claimed (status
   * SUCCESS). Always writes a fresh PENDING_* recipient, so editing an already-resolved
   * recipient correctly turns the claim pending again on the corrected identifier.
   */
  @Post(':id/recipient')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'claims:edit-recipient')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Edit the recipient of an unclaimed payment you sent (fixes a typo without cancelling)' })
  @ApiParam({ name: 'id', description: 'Claim UUID' })
  @ApiResponse({ status: 200, description: 'Recipient updated', schema: { properties: { ok: { type: 'boolean' } } } })
  @ApiResponse({ status: 400, description: 'Not editable (already claimed, in progress, or cancelled)' })
  @ApiResponse({ status: 403, description: 'Not the creator' })
  async updateRecipient(
    @Param('id') id: string,
    @Body() body: { recipientType: 'email' | 'username' | 'social'; recipientIdentifier: string; platform?: 'discord' | 'github' | 'telegram' | 'twitter' },
    @Req() req: { user?: { id: string } },
  ): Promise<{ ok: boolean }> {
    const privyUserId = req.user?.id;
    if (!privyUserId) throw new UnauthorizedException('Login required.');
    if (!['email', 'username', 'social'].includes(body.recipientType)) {
      throw new BadRequestException('recipientType must be "email", "username", or "social"');
    }
    if (!body.recipientIdentifier?.trim()) {
      throw new BadRequestException('recipientIdentifier required');
    }
    if (body.recipientType === 'social' && !['discord', 'github', 'telegram', 'twitter'].includes(body.platform || '')) {
      throw new BadRequestException('platform must be "discord", "github", "telegram", or "twitter" when recipientType is "social"');
    }
    return this.claimsService.updateClaimRecipient({
      claimId: id,
      userId: privyUserId,
      recipientType: body.recipientType,
      recipientIdentifier: body.recipientIdentifier,
      platform: body.platform,
    });
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
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'claims:build-transfer')
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
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit(120, 60, 'claims:get')
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
  @UseGuards(OptionalAuthGuard, RateLimitGuard)
  @RateLimit(120, 60, 'claims:get')
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
    const result = await this.claimsService.updateStatus(id, body.status as any, {
      txHash: body.txHash,
      paidWith: body.paidWith,
      isPrivate: body.isPrivate,
      paidWithToken: body.paidWithToken,
      paidWithChain: body.paidWithChain,
      feeAmountUsdc: body.feeAmountUsdc,
      feeBreakdown: body.feeBreakdown,
    }, req.user!.id);
    const effectiveStatus = (result.status || '').toUpperCase();
    if (effectiveStatus === 'SUCCESS' || effectiveStatus === 'PRIVATE_TRANSFER_PENDING') {
      this.claimsService.notifyRecipientAfterPayment(id);
    }
    return result;
  }

  /** Internal: trigger email notification after payment confirmed. Requires CRON_SECRET. */
  @Post(':id/notify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CronGuard)
  async notifyPayment(@Param('id') id: string): Promise<{ ok: boolean }> {
    this.claimsService.notifyRecipientAfterPayment(id);
    return { ok: true };
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
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'claims:sponsor-prepare')
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
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(15, 60, 'claims:sponsor-broadcast')
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
    @Body() body: { transaction: string; network?: string; claimId?: string; pajOrderId?: string; nearIntentsOrderId?: string; offrampRequestId?: string; giveawayId?: string },
    @Headers('x-loofta-internal') internalKey: string | undefined,
    @Req() req: { user?: { id: string } },
  ): Promise<{ signature: string }> {
    // Require the request to have come through our Next.js BFF, not directly.
    this.assertInternalCaller(internalKey, 'sign-and-broadcast');

    if (!body?.transaction || typeof body.transaction !== 'string') {
      throw new BadRequestException('Missing or invalid transaction');
    }
    if (!this.solanaSponsor.isAvailable()) {
      throw new ServiceUnavailableException('Solana fee sponsorship is not configured');
    }

    // Verify EVERY non-fee-payer signer in the transaction belongs to the authenticated user —
    // not just one of them. A burner can never legitimately appear as a required signer here:
    // the client doesn't hold our burner keys, so it could never produce a valid signature for
    // one (burner-signed transactions are always built and signed server-side elsewhere, never
    // submitted through this client-facing endpoint). So every required signer besides the fee
    // payer must be one of the caller's own linked wallets, with no exceptions — a transaction
    // with a mix of "one signer matches, one doesn't" is not a case that should ever pass.
    const userId = req.user?.id;
    if (userId) {
      const userSigners = this.solanaSponsor.getRequiredUserSigners(body.transaction);
      if (userSigners.length > 0) {
        const checks = await Promise.all(
          userSigners.map((addr) => this.usersService.isSolanaAddressInLinkedAccounts(userId, addr)),
        );
        if (!checks.every(Boolean)) {
          const unlinked = userSigners.filter((_, i) => !checks[i]);
          this.logger.warn(
            `ClaimsController[sign-and-broadcast]: userId=${userId} submitted tx with unlinked signer(s): ${unlinked.map((a) => a.slice(0, 8)).join(', ')}…`,
          );
          throw new ForbiddenException('Transaction signer does not match your account');
        }
      }

      // NOTE: we deliberately do NOT require an ATA-creation destination to be one of the caller's
      // own linked wallets — withdraw-to-external-wallet is a legitimate flow where the destination
      // is never linked to the sender's account (confirmed broken in production 2026-07-17 by an
      // earlier version of this check). ATA-rent drain protection is enforced inside
      // SolanaSponsorService.signAndBroadcast itself (assertAtaCreationsAllowed), not here — it is
      // ownership-agnostic, refuses only *repeat* rent for a (wallet, mint) we already paid for,
      // and lives in the broadcast path so no controller can forget to call it. An earlier version
      // of this comment pointed at an `assertAtaNeverExistedBefore` that was never actually
      // written, which left both sponsor routes with no rent protection at all until 2026-07-30.
    }

    try {
      return await this.solanaSponsor.signAndBroadcast(body.transaction, body.network, userId, body.claimId, body.pajOrderId, body.nearIntentsOrderId, body.offrampRequestId, body.giveawayId);
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
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(15, 60, 'claims:per-broadcast')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Countersign and broadcast a user-signed MagicBlock PER transaction' })
  @ApiResponse({ status: 200, description: 'Transaction signature', schema: { properties: { signature: { type: 'string' } } } })
  @ApiResponse({ status: 400, description: 'Invalid transaction' })
  @ApiResponse({ status: 503, description: 'Sponsorship not configured' })
  async signAndBroadcastPER(
    @Body() body: { transaction: string; claimId?: string },
    @Headers('x-loofta-internal') internalKey: string | undefined,
    @Req() req: { user?: { id: string } },
  ): Promise<{ signature: string }> {
    // Require the request to have come through our Next.js BFF, not directly.
    this.assertInternalCaller(internalKey, 'sign-and-broadcast-per');

    if (!body?.transaction || typeof body.transaction !== 'string') {
      throw new BadRequestException('Missing or invalid transaction');
    }
    if (!this.solanaSponsor.isAvailable()) {
      throw new ServiceUnavailableException('Solana fee sponsorship is not configured');
    }

    // Same ownership checks as sign-and-broadcast — this endpoint had neither, which combined
    // with its previously-missing program whitelist made it the more exploitable of the two.
    const userId = req.user?.id;
    if (userId) {
      const userSigners = this.solanaSponsor.getRequiredUserSigners(body.transaction);
      if (userSigners.length > 0) {
        const checks = await Promise.all(
          userSigners.map((addr) => this.usersService.isSolanaAddressInLinkedAccounts(userId, addr)),
        );
        if (!checks.every(Boolean)) {
          const unlinked = userSigners.filter((_, i) => !checks[i]);
          this.logger.warn(
            `ClaimsController[sign-and-broadcast-per]: userId=${userId} submitted tx with unlinked signer(s): ${unlinked.map((a) => a.slice(0, 8)).join(', ')}…`,
          );
          throw new ForbiddenException('Transaction signer does not match your account');
        }
      }

      // See the matching note in signAndBroadcastSponsored above — every required signer must be
      // the caller's own linked wallet, no exceptions (a burner could never validly appear here
      // anyway — the client can't sign for a key it doesn't hold). ATA-creation destination is
      // deliberately not restricted to the caller's own linked wallets (breaks withdraw-to-external-
      // wallet); assertAtaCreationsAllowed inside signAndBroadcastPER is the real drain guard.
    }

    try {
      return await this.solanaSponsor.signAndBroadcastPER(body.transaction, undefined, userId, body.claimId);
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
   * Internal: mint a burner keypair for a claim being created outside this service (the Next.js
   * request-money/pay-to-wallet route inserts directly into Supabase and has no access to
   * SEND_PAYMENT_ENC_KEY/KMS). Gated by X-Loofta-Internal — must come through our own BFF, not a
   * direct caller — same convention as solana-sponsor/sign-and-broadcast above.
   */
  @Post('internal/create-burner')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(30, 60, 'claims:internal-create-burner')
  @ApiOperation({ summary: 'Internal: mint an encrypted burner keypair for claim creation' })
  @ApiResponse({
    status: 200,
    description: 'Burner address + encrypted secret',
    schema: { properties: { burner_address: { type: 'string' }, burner_encrypted_secret: { type: 'string' } } },
  })
  async createBurnerInternal(
    @Headers('x-loofta-internal') internalKey: string | undefined,
  ): Promise<{ burner_address: string; burner_encrypted_secret: string }> {
    this.assertInternalCaller(internalKey, 'internal/create-burner');
    const burner = this.claimsService.mintBurnerForExternalCreation();
    if (!burner) {
      throw new BadRequestException('Burner creation is unavailable (SEND_PAYMENT_ENC_KEY not configured).');
    }
    return { burner_address: burner.claim_burner_address, burner_encrypted_secret: burner.claim_burner_encrypted_secret };
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
