import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { PartnerWithdrawService } from './partner-withdraw.service';

class ConfirmWithdrawDto {
  /** The partner fee the recipient was shown. The withdrawal is refused if the real fee is higher. */
  @IsNumber() @Min(0) @Max(1_000_000) max_fee_usdc: number;
  /** The Loofta fee the recipient was shown. When sent, the withdrawal is refused if the real Loofta fee is higher. */
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000) max_loofta_fee_usdc?: number;
  /** Optional: send to this Solana wallet instead of the recipient's own Loofta wallet. */
  @IsOptional() @IsString() @MaxLength(64) destination_address?: string;
  /** Which route the recipient picked. The partner may have switched it off. */
  @IsOptional() @IsIn(['usdc', 'token', 'bank', 'p2p']) method?: string;
}

/** Recipient side of a partner payout. Default-deny: a verified login is required, and identity is derived from it. */
@ApiTags('partner-withdraw')
@Controller('partner-withdraw')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class PartnerWithdrawController {
  constructor(private readonly withdraw: PartnerWithdrawService) {}

  @Get(':orgId/quote')
  @RateLimit(30, 60, 'partner-withdraw:quote')
  quote(@PrivyUser() user: { id: string }, @Param('orgId') orgId: string, @Query() q: Record<string, string>) {
    // methods, history, name, color, fee, pct and prize only mean something for the built-in demo partner; real partners ignore them.
    const pick = (k: string) => (typeof q?.[k] === 'string' ? q[k] : undefined);
    return this.withdraw.quote(orgId, user.id, { methods: pick('methods'), history: pick('history'), name: pick('name'), color: pick('color'), fee: pick('fee'), pct: pick('pct'), prize: pick('prize'), logo: pick('logo') });
  }

  @Post(':orgId/confirm')
  @HttpCode(HttpStatus.OK)
  @RateLimit(5, 60, 'partner-withdraw:confirm')
  confirm(@PrivyUser() user: { id: string }, @Param('orgId') orgId: string, @Body() dto: ConfirmWithdrawDto) {
    return this.withdraw.confirm(orgId, user.id, { maxFeeUsdc: dto.max_fee_usdc, maxLooftaFeeUsdc: dto.max_loofta_fee_usdc, destinationAddress: dto.destination_address, method: dto.method });
  }
}
