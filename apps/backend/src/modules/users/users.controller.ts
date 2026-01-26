import {
  Controller,
  Get,
  Query,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { UsersService } from './users.service';

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
   * Debug endpoint to list all usernames (remove in production)
   */
  @Get('debug/list-usernames')
  @ApiOperation({ summary: 'Debug: List all usernames' })
  async listUsernames() {
    return this.usersService.listAllUsernames();
  }
}
