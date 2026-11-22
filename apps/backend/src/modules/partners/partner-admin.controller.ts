import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminGuard } from '@/common/guards';
import { PartnerAdminService } from './partner-admin.service';

class ReviewDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** Loofta staff only. Approves, rejects or suspends the companies that apply for the partner product. */
@ApiTags('admin/partners')
@Controller('admin/partners')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class PartnerAdminController {
  constructor(private readonly admin: PartnerAdminService) {}

  @Get()
  @ApiOperation({ summary: 'Companies by status (pending first in the admin UI)' })
  async list(@Query('status') status?: string) {
    return { partners: await this.admin.list(status) };
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Req() req: { user: { id: string } }) {
    return this.admin.review(id, 'approve', req.user.id, dto.note);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Req() req: { user: { id: string } }) {
    return this.admin.review(id, 'reject', req.user.id, dto.note);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Req() req: { user: { id: string } }) {
    return this.admin.review(id, 'suspend', req.user.id, dto.note);
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  reinstate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto, @Req() req: { user: { id: string } }) {
    return this.admin.review(id, 'reinstate', req.user.id, dto.note);
  }
}
