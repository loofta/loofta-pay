import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { PrivateBalanceService } from './private-balance.service';
import { StartPrivateDepositDto, BuildPrivateWithdrawalDto, RecordWithdrawalSignatureDto } from './dto';

@Controller('private-balance')
export class PrivateBalanceController {
  constructor(private readonly privateBalanceService: PrivateBalanceService) {}

  @Post('deposit/start')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'privatebal:build')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Start a private deposit — returns a one-time burner address to send USDC to' })
  @ApiResponse({ status: 200, description: '{ id, depositAddress, amountToSendUsdc?, feeEstimateUsdc? }' })
  async startDeposit(@PrivyUser() user: { id: string }, @Body() dto: StartPrivateDepositDto) {
    return this.privateBalanceService.startDeposit(user.id, dto);
  }

  @Post('withdrawal/build')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'privatebal:build')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Build the unsigned leg-1 private transfer (user wallet -> burner) for a private withdrawal' })
  @ApiResponse({ status: 200, description: '{ id, transactionBase64, version, sendTo, feeAmountUsdc, feeBreakdown }' })
  async buildWithdrawal(@PrivyUser() user: { id: string }, @Body() dto: BuildPrivateWithdrawalDto) {
    return this.privateBalanceService.buildWithdrawal(user.id, dto);
  }

  @Post('withdrawal/:id/signature')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'privatebal:signature')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Record the broadcast leg-1 signature so the backend can complete the withdrawal even if the client disconnects' })
  @ApiParam({ name: 'id' })
  async recordWithdrawalSignature(
    @Param('id') id: string,
    @PrivyUser() user: { id: string },
    @Body() dto: RecordWithdrawalSignatureDto,
  ) {
    await this.privateBalanceService.recordWithdrawalSignature(id, user.id, dto.signature);
    return { ok: true };
  }

  @Get(':id')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(120, 60, 'privatebal:get')
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Poll status of a private deposit or withdrawal' })
  @ApiParam({ name: 'id' })
  async getStatus(@Param('id') id: string, @PrivyUser() user: { id: string }) {
    return this.privateBalanceService.getStatus(id, user.id);
  }
}
