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

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Get user by username (NO wallet address returned - privacy)
   */
  @Get('by-username')
  @ApiOperation({ summary: 'Get user by username (no wallet address)' })
  @ApiQuery({ name: 'username', description: 'Username (with or without @ prefix)' })
  @ApiResponse({
    status: 200,
    description: 'User info (no wallet address)',
    schema: {
      properties: {
        user: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            privyUserId: { type: 'string' },
            email: { type: 'string', nullable: true },
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

    try {
      const user = await this.usersService.findByUsername(username);
      return { user };
    } catch (error: any) {
      // Re-throw with more context if needed
      throw error;
    }
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
    const balance = await this.usersService.getSolanaWalletBalanceUSD(user.id);
    return { balanceUSD: balance };
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

  /**
   * Debug endpoint to list all usernames (remove in production)
   */
  @Get('debug/list-usernames')
  @ApiOperation({ summary: 'Debug: List all usernames' })
  async listUsernames() {
    return this.usersService.listAllUsernames();
  }
}
