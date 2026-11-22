import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { PayoutVaultService } from './payout-vault.service';

class PrepareExitDto {
  @IsString() @MaxLength(64) org_id: string;
  @IsString() @MaxLength(64) destination: string;
}
class SubmitExitDto {
  @IsString() @MaxLength(4000) signed_transaction: string;
}

/** The signed-in user's own payout vault. Identity always comes from the verified login; every id is scoped to it. */
@ApiTags('payout-vault')
@Controller('payout-vault')
@UseGuards(AuthGuard, RateLimitGuard)
@ApiSecurity('privy-auth')
export class PayoutVaultController {
  constructor(private readonly vault: PayoutVaultService) {}

  @Get()
  @RateLimit(30, 60, 'payout-vault:state')
  state(@PrivyUser() user: { id: string }) {
    return this.vault.state(user.id);
  }

  @Post('exit/prepare')
  @HttpCode(HttpStatus.OK)
  @RateLimit(5, 60, 'payout-vault:prepare')
  prepare(@PrivyUser() user: { id: string }, @Body() dto: PrepareExitDto) {
    return this.vault.prepareExit(user.id, dto.org_id, dto.destination);
  }

  @Post('exit/:exitId/submit')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'payout-vault:submit')
  submit(@PrivyUser() user: { id: string }, @Param('exitId', ParseUUIDPipe) exitId: string, @Body() dto: SubmitExitDto) {
    return this.vault.submitExit(user.id, exitId, dto.signed_transaction);
  }

  @Post('exit/:exitId/cancel')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60, 'payout-vault:cancel')
  cancel(@PrivyUser() user: { id: string }, @Param('exitId', ParseUUIDPipe) exitId: string) {
    return this.vault.cancelExit(user.id, exitId);
  }
}
