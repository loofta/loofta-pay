import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AdminGuard } from '@/common/guards';
import { PartnerAdminService } from './partner-admin.service';
import { PartnerFeeSettingsService } from './partner-fee-settings.service';
import { MAX_LOOFTA_FEE_BPS, MAX_LOOFTA_FEE_FLAT_USD } from './partner-fee';

class ReviewDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class KycDto {
  @IsBoolean() enabled: boolean;
}

class LooftaFeeDto {
  @IsNumber() @Min(0) @Max(MAX_LOOFTA_FEE_FLAT_USD) flat_usd: number;
  /** Basis points: 30 is 0.3%. */
  @IsInt() @Min(0) @Max(MAX_LOOFTA_FEE_BPS) bps: number;
}

/** Loofta staff only. Approves, rejects or suspends the companies that apply for the partner product. */
@ApiTags('admin/partners')
@Controller('admin/partners')
@UseGuards(AdminGuard)
@ApiSecurity('privy-auth')
export class PartnerAdminController {
  constructor(private readonly admin: PartnerAdminService, private readonly fees: PartnerFeeSettingsService) {}

  // Declared before the ':id' routes so "loofta-fee" is never read as a company id.
  @Get('loofta-fee')
  @ApiOperation({ summary: "Loofta's own fee on every partner withdrawal" })
  async looftaFee() {
    const r = await this.fees.get();
    return { flat_usd: r.flatUsd, bps: r.bps };
  }

  @Put('loofta-fee')
  @ApiOperation({ summary: "Change Loofta's own fee on every partner withdrawal (applies to new withdrawals)" })
  async setLooftaFee(@Body() dto: LooftaFeeDto, @Req() req: { user: { id: string } }) {
    const r = await this.fees.set(dto.flat_usd, dto.bps, req.user.id);
    return { flat_usd: r.flatUsd, bps: r.bps };
  }

  @Get()
  @ApiOperation({ summary: 'Companies by status (pending first in the admin UI)' })
  async list(@Query('status') status?: string) {
    return { partners: await this.admin.list(status) };
  }

  @Post(':id/kyc')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Switch identity checks (zkMe) on or off for one company' })
  kyc(@Param('id', ParseUUIDPipe) id: string, @Body() dto: KycDto, @Req() req: { user: { id: string } }) {
    return this.admin.setKyc(id, dto.enabled, req.user.id);
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
