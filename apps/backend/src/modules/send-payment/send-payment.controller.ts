import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
} from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { SendPaymentService } from './send-payment.service';
import { BuildMultiSendDto } from './dto';

@ApiTags('send-payment')
@Controller('send-payment')
export class SendPaymentController {
  constructor(private readonly sendPaymentService: SendPaymentService) {}

  @Post('multi-create')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'sendpay:create')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Create N payment records for multi-send (step 1 — no MagicBlock calls yet)' })
  async multiCreate(
    @PrivyUser() user: { id: string },
    @Body() dto: BuildMultiSendDto,
  ) {
    return this.sendPaymentService.createMultiPayments(user.id, dto);
  }

  @Post('multi-build')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'sendpay:build')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Build one combined SPL transaction for multiple recipients' })
  @ApiResponse({ status: 200, description: 'Unsigned tx + payment IDs' })
  async buildMulti(
    @PrivyUser() user: { id: string },
    @Body() dto: BuildMultiSendDto,
  ) {
    return this.sendPaymentService.buildMultiPrivateTransfer(user.id, dto);
  }

  @Post('multi-build-private')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'sendpay:build')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Build one MagicBlock private transfer tx per recipient (sign all in one go)' })
  @ApiResponse({ status: 200, description: 'N unsigned MagicBlock txs + payment IDs' })
  async buildMultiPrivate(
    @PrivyUser() user: { id: string },
    @Body() dto: BuildMultiSendDto,
  ) {
    return this.sendPaymentService.buildMultiPrivateMagicblock(user.id, dto);
  }

  @Post('multi-confirm')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Mark multi-send payments as transferred after tx confirmation' })
  async confirmMulti(
    @PrivyUser() user: { id: string },
    @Body() body: { payment_ids: string[]; tx_hash?: string; fee_usdc?: number },
  ) {
    await this.sendPaymentService.confirmMultiSend(user.id, body.payment_ids ?? [], body.tx_hash, body.fee_usdc);
    return { ok: true };
  }
}
