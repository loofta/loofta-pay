import {
  Controller,
  Get,
  Post,
  Put,
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
import { AdminGuard } from '@/common/guards';
import { Throttle } from '@nestjs/throttler';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
            requirePrivatePayments: { type: 'boolean' },
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

    const { username: resolvedUsername, requirePrivatePayments } =
      await this.usersService.findByUsername(username);
    return { user: { username: resolvedUsername, requirePrivatePayments } };
  }

  /**
   * Get current user's preferences
   */
  @Get('me/preferences')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user privacy preferences' })
  @ApiResponse({
    status: 200,
    description: 'User preferences',
    schema: {
      properties: {
        requirePrivatePayments: { type: 'boolean' },
      },
    },
  })
  async getMyPreferences(@PrivyUser() user: { id: string }) {
    const prefs = await this.usersService.getUserPreferences(user.id);
    if (!prefs) {
      throw new NotFoundException('User preferences not found');
    }
    return prefs;
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
   * Update privacy preferences
   */
  @Put('me/preferences')
  @UseGuards(PrivyAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update privacy preferences' })
  @ApiBody({
    schema: {
      properties: {
        requirePrivatePayments: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Preferences updated' })
  async updatePreferences(
    @PrivyUser() user: { id: string },
    @Body() body: { requirePrivatePayments: boolean },
  ) {
    await this.usersService.updatePrivacyPreferences(
      user.id,
      body.requirePrivatePayments,
    );
    return { success: true };
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
}
