import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { PrivyAuthGuard } from '../../auth/privy-auth.guard';
import { PrivyUser } from '../../auth/privy-user.decorator';
import { PrivyVerificationService } from '../../auth/privy-verification.service';
import { AdminGuard } from '@/common/guards';
import { Throttle } from '@nestjs/throttler';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly privyVerification: PrivyVerificationService,
  ) {}

  /**
   * Bust the cached Privy user record for the caller. Call right after linking a new
   * account (email/X/etc) via Privy so identity-gated reads (e.g. claim recipient
   * checks) see it immediately instead of waiting out the cache TTL.
   */
  @Post('refresh-privy-cache')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Invalidate the caller's cached Privy user record" })
  @ApiResponse({ status: 200, schema: { properties: { ok: { type: 'boolean' } } } })
  async refreshPrivyCache(@PrivyUser() user: { id: string }) {
    await this.privyVerification.invalidatePrivyUserCache(user.id);
    return { ok: true };
  }

  /**
   * Verify auth token and return the caller's Privy user ID.
   * Used by Next.js API routes (e.g. payment history) to verify tokens server-side
   * without needing the Privy SDK on the frontend.
   */
  @Get('me')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify token and return current user ID' })
  @ApiResponse({ status: 200, schema: { properties: { userId: { type: 'string' } } } })
  getMe(@PrivyUser() user: { id: string }) {
    return { userId: user.id };
  }

  /**
   * Creates the caller's app_users row if it doesn't exist yet (idempotent) — call once right
   * after login, from any client. See UsersService.ensureAppUser for why this exists.
   */
  @Post('me/ensure-profile')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create the caller's app_users row on first login if missing" })
  async ensureProfile(@PrivyUser() user: { id: string }) {
    return this.usersService.ensureAppUser(user.id);
  }

  /**
   * Check if a username exists and return only public fields.
   * email and privyUserId are intentionally omitted — this endpoint is unauthenticated.
   */
  @Get('by-username')
  @Throttle({ short: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Check if username exists (public fields only)' })
  @ApiQuery({ name: 'username', description: 'Username (with or without @ prefix)' })
  @ApiResponse({
    status: 200,
    description: 'Public user info (no wallet, no email, no Privy ID)',
    schema: {
      properties: {
        user: {
          type: 'object',
          properties: {
            username: { type: 'string', nullable: true },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findByUsername(@Query('username') username: string) {
    if (!username) {
      throw new NotFoundException('username is required');
    }

    const { username: resolvedUsername } = await this.usersService.findByUsername(username);
    return { user: { username: resolvedUsername } };
  }

  @Get('me/tier')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user tier based on mainnet volume' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        totalVolumeUsd: { type: 'number' },
        tier: { type: 'string' },
      },
    },
  })
  async getMyTier(@PrivyUser() user: { id: string }) {
    return this.usersService.getUserTier(user.id);
  }

  /**
   * Get current user's wallet balance
   */
  @Get('me/wallet/balance')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user wallet balance in USD' })
  @ApiResponse({
    status: 200,
    description: 'Wallet balance',
    schema: {
      properties: {
        balanceUSD: { type: 'number' },
      },
    },
  })
  async getMyBalance(@PrivyUser() user: { id: string }) {
    const { balanceUSD, walletAddress } = await this.usersService.getSolanaWalletBalanceAndAddress(user.id);
    return { balanceUSD, walletAddress };
  }

  /**
   * Get current user's wallet SOL + USDC balances (mobile's Seeker-wallet profile display —
   * separate from me/wallet/balance above, which only reports a USDC-as-USD figure for the web
   * embedded-wallet flow).
   */
  @Get('me/wallet/balances')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user wallet SOL and USDC balances' })
  @ApiResponse({
    status: 200,
    description: 'Wallet balances',
    schema: {
      properties: {
        walletAddress: { type: 'string' },
        solBalance: { type: 'number' },
        usdcBalance: { type: 'number' },
        skrDomain: { type: 'string', nullable: true },
      },
    },
  })
  async getMyBalances(@PrivyUser() user: { id: string }) {
    return this.usersService.getSolanaWalletBalances(user.id);
  }

  /**
   * Generate new embedded wallet (only if balance is 0)
   */
  @Post('me/wallet/generate-new')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate new embedded wallet (requires zero balance)' })
  @ApiResponse({
    status: 200,
    description: 'New wallet generated',
    schema: {
      properties: {
        walletAddress: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Wallet has balance - must withdraw first' })
  async generateNewWallet(@PrivyUser() user: { id: string }) {
    // Check balance first
    const balance = await this.usersService.getSolanaWalletBalanceUSD(user.id);
    
    if (balance > 0) {
      throw new BadRequestException(
        'Cannot generate new wallet: current wallet has balance. Please withdraw all funds first.'
      );
    }

    // TODO: Implement Privy API call to create new embedded wallet
    // This requires Privy server-side API integration
    // For now, return error indicating feature not yet implemented
    throw new BadRequestException(
      'New wallet generation is not yet implemented. Please contact support.'
    );
  }

  @Get('by-email')
  @UseGuards(PrivyAuthGuard)
  @Throttle({ short: { ttl: 60000, limit: 20 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user by email (returns username for /link redirect)' })
  @ApiQuery({ name: 'email', description: 'User email' })
  @ApiResponse({ status: 200, description: 'User info (no wallet)' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findByEmail(@Query('email') email: string) {
    const user = await this.usersService.findByEmail(email);
    return { user };
  }

  @Get('search')
  @UseGuards(PrivyAuthGuard)
  @Throttle({ short: { ttl: 60000, limit: 20 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search usernames by prefix' })
  @ApiQuery({ name: 'q', description: 'Search query (min 2 chars)' })
  @ApiResponse({ status: 200, description: 'List of matching usernames' })
  async searchUsernames(@Query('q') q: string) {
    return this.usersService.searchUsernames(q || '', 10);
  }

  @Get('debug/list-usernames')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Admin: List all usernames' })
  async listUsernames() {
    return this.usersService.listAllUsernames();
  }

  @Get('me/force-update')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get force-update completion status for a given update_id' })
  async getForceUpdateStatus(
    @PrivyUser() user: { id: string },
    @Query('update_id') updateId: string,
  ) {
    if (!updateId) throw new BadRequestException('update_id is required');
    return this.usersService.getForceUpdateStatus(user.id, updateId);
  }

  @Post('me/force-update/complete')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark a force-update as complete' })
  async markForceUpdateComplete(
    @PrivyUser() user: { id: string },
    @Body() body: { update_id: string },
  ) {
    if (!body?.update_id) throw new BadRequestException('update_id is required');
    await this.usersService.markForceUpdateComplete(user.id, body.update_id);
    return { ok: true };
  }
}
