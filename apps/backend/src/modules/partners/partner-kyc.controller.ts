import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { PartnerKycService } from './partner-kyc.service';

class KycRequestDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) recipient_ids: string[];
}

/** Identity checks for recipients. Default-deny like the rest of the portal: a verified login, then the caller's role. */
@ApiTags('partners')
@Controller('partners')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class PartnerKycController {
  constructor(private readonly kyc: PartnerKycService) {}

  @Get(':orgId/kyc')
  @RateLimit(60, 60, 'partners:kyc')
  overview(@PrivyUser() user: { id: string }, @Param('orgId') orgId: string) {
    return this.kyc.overview(orgId, user.id);
  }

  @Post(':orgId/kyc/request')
  @HttpCode(HttpStatus.OK)
  @RateLimit(20, 60, 'partners:kyc:write')
  request(@PrivyUser() user: { id: string }, @Param('orgId') orgId: string, @Body() dto: KycRequestDto) {
    return this.kyc.request(orgId, user.id, dto.recipient_ids);
  }

  @Post(':orgId/kyc/resend')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'partners:kyc:write')
  resend(@PrivyUser() user: { id: string }, @Param('orgId') orgId: string, @Body() dto: KycRequestDto) {
    return this.kyc.resend(orgId, user.id, dto.recipient_ids);
  }

  @Post(':orgId/kyc/refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit(6, 60, 'partners:kyc:refresh')
  refresh(@PrivyUser() user: { id: string }, @Param('orgId') orgId: string) {
    return this.kyc.refresh(orgId, user.id);
  }
}
