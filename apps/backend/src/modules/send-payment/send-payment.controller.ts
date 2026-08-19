import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
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
import { BuildMultiSendDto, BuildMultiSendHubDto, ConfirmMultiSendHubDto, ConfirmMultiSendDto } from './dto';

@ApiTags('send-payment')
@Controller('send-payment')
export class SendPaymentController {
  constructor(private readonly sendPaymentService: SendPaymentService) {}

  // Multi-recipient send is temporarily disabled — the shared-hub fan-out mechanism it relies on
  // has no per-sender isolation, which allowed both a fund-drain exploit and separate race-driven
  // double-payments to real recipients (both discovered and remediated 2026-08-19). Blocked at
  // every entry point until the hub is reworked with proper isolation.
  private static readonly MULTI_SEND_DISABLED_MESSAGE =
    "We're working on making Multi Send even better. Please send to one recipient at a time for now.";

  private assertMultiSendEnabled(): void {
    throw new ServiceUnavailableException(SendPaymentController.MULTI_SEND_DISABLED_MESSAGE);
  }

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
    this.assertMultiSendEnabled();
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
    this.assertMultiSendEnabled();
    return this.sendPaymentService.buildMultiPrivateTransfer(user.id, dto);
  }

  @Post('multi-build-hub')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(20, 60, 'sendpay:build')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Build the sender\'s one private hub transfer for a batch created by multi-create' })
  @ApiResponse({ status: 200, description: 'One unsigned MagicBlock tx (sender → hub) + payment IDs' })
  async buildMultiHub(
    @PrivyUser() user: { id: string },
    @Body() dto: BuildMultiSendHubDto,
  ) {
    this.assertMultiSendEnabled();
    return this.sendPaymentService.buildMultiSendHubTransfer(user.id, dto.multi_send_batch_id, dto.sender_wallet, dto.cluster);
  }

  @Post('multi-confirm-hub')
  @UseGuards(AuthGuard, RateLimitGuard)
  @RateLimit(10, 60, 'sendpay:confirm')
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Sender broadcast the hub transfer — start the server-side fan-out to each recipient burner' })
  async confirmMultiHub(
    @PrivyUser() user: { id: string },
    @Body() body: ConfirmMultiSendHubDto,
  ) {
    this.assertMultiSendEnabled();
    this.sendPaymentService.confirmMultiSendHub(user.id, body.multi_send_batch_id, body.tx_hash);
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
    this.assertMultiSendEnabled();
    await this.sendPaymentService.confirmMultiSend(user.id, body.payment_ids, body.tx_hash, body.fee_usdc, getClientIp(req));
    return { ok: true };
  }
}
