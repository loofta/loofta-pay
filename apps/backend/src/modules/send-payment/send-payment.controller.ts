import {
  Controller,
  Post,
  Body,
  Req,
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
import { getClientIp } from '@/common/get-client-ip';
import { SendPaymentService } from './send-payment.service';
import { BuildMultiSendDto, BuildMultiSendFundingDto, ConfirmMultiSendFundingDto, ConfirmMultiSendDto } from './dto';

@ApiTags('send-payment')
@Controller('send-payment')
export class SendPaymentController {
  constructor(private readonly sendPaymentService: SendPaymentService) {}

  // Multi-recipient send: re-enabled 2026-08-22 on mainnet, at the user's explicit request and
  // ahead of a completed devnet verification pass — flagged as a real risk (this redesign had not
  // completed a single successful run on any cluster at the time this was opened) and confirmed
  // anyway. The original shared-hub design had no per-sender isolation, which allowed both a
  // fund-drain exploit and separate race-driven double-payments to real recipients (both
  // discovered and remediated 2026-08-19) — the redesign (per-batch throwaway burner, row-level
  // idempotent fan-out, per-recipient fees; see send-payment.service.ts) addresses that class of
  // bug structurally, but watch its first live runs closely (fee-payer balance, burner reclaim,
  // any row stuck IN_FLIGHT) rather than assuming the redesign is correct just because it compiles.

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

  @Post('multi-build-funding')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'sendpay:build')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Build the sender\'s one funding transfer into a fresh, single-use batch burner (created by multi-create)' })
  @ApiResponse({ status: 200, description: 'One unsigned MagicBlock tx (sender → batch burner) + payment IDs' })
  async buildMultiFunding(
    @PrivyUser() user: { id: string },
    @Body() dto: BuildMultiSendFundingDto,
  ) {
    return this.sendPaymentService.buildMultiSendBatchFunding(user.id, dto.multi_send_batch_id, dto.sender_wallet, dto.cluster);
  }

  @Post('multi-confirm-funding')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'sendpay:confirm')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Sender broadcast the funding transfer — flip this batch\'s rows to IN_FLIGHT and start the server-side fan-out from the batch burner' })
  async confirmMultiFunding(
    @PrivyUser() user: { id: string },
    @Body() body: ConfirmMultiSendFundingDto,
  ) {
    this.sendPaymentService.confirmMultiSendBatchFunding(user.id, body.multi_send_batch_id, body.tx_hash);
    return { ok: true };
  }

  @Post('multi-confirm')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'sendpay:confirm')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Mark multi-send payments as transferred after tx confirmation (public combined-tx path)' })
  async confirmMulti(
    @PrivyUser() user: { id: string },
    @Body() body: ConfirmMultiSendDto,
    @Req() req: any,
  ) {
    await this.sendPaymentService.confirmMultiSend(user.id, body.payment_ids, body.tx_hash, body.fee_usdc, getClientIp(req));
    return { ok: true };
  }
}
