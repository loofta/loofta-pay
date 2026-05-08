import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiQuery, ApiParam } from '@nestjs/swagger';
import { AdminGuard } from '@/common/guards';
import { WaitlistService } from './waitlist.service';

@ApiTags('admin/waitlist')
@Controller('admin/waitlist')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class AdminWaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  @ApiOperation({ summary: 'List waitlist entries (paginated, filterable, sortable)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'access', required: false, enum: ['all', 'granted', 'not_granted'] })
  @ApiQuery({ name: 'sort_col', required: false, type: String })
  @ApiQuery({ name: 'sort_dir', required: false, enum: ['asc', 'desc'] })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('access') access?: string,
    @Query('sort_col') sort_col?: string,
    @Query('sort_dir') sort_dir?: string,
  ) {
    return this.waitlistService.findAll({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      search,
      access: (access as any) ?? 'all',
      sort_col,
      sort_dir: sort_dir === 'asc' ? 'asc' : 'desc',
    });
  }

  @Patch(':id/access')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant or revoke mainnet access by entry ID' })
  @ApiParam({ name: 'id', description: 'Waitlist entry UUID' })
  async setAccess(@Param('id') id: string, @Body() body: { grant: boolean }) {
    return this.waitlistService.setAccess(id, body.grant);
  }

  @Post(':id/resend-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend beta access email by entry ID' })
  @ApiParam({ name: 'id', description: 'Waitlist entry UUID' })
  async resendEmail(@Param('id') id: string) {
    return this.waitlistService.resendBetaAccessEmail(id);
  }

  @Post('grant-by-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant mainnet access by email address' })
  async grantByEmail(@Body() body: { email: string }) {
    return this.waitlistService.grantAccessByEmail(body.email);
  }
}
