import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard, RateLimitGuard, IntegratorGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { TwitterPaymentsService } from './twitter-payments.service';
import { CreateTwitterPaymentDto } from './dto/create-twitter-payment.dto';

@ApiTags('twitter-payments')
@Controller('twitter-payments')
export class TwitterPaymentsController {
  constructor(private readonly twitterPayments: TwitterPaymentsService) {}

  /**
   * Integrator-only: create a pending payment request from a parsed tweet. This is unchanged
   * from when it used the old static-secret BotGuard — the twitter-bot only ever creates an
   * INVOICE here (twitter_payment_requests row); the actual funding still happens via /fund
   * below, driven by the tweet's human sender logging into their own Loofta account. That's a
   * genuinely different funding model from POST /integrators/v1/pay-human (where the integrator
   * itself deposits funds directly), so this endpoint was deliberately NOT replaced by that one —
   * only its auth mechanism changed, from one shared static secret to a real, individually
   * revocable integrator API key.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IntegratorGuard)
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Integrator (bot) creates a pending Twitter payment request' })
  @ApiResponse({ status: 201, description: '{ short_id, link }' })
  async create(@Body() dto: CreateTwitterPaymentDto) {
    return this.twitterPayments.create(dto);
  }

  /** Public: get payment request details for the funding page */
  @Get(':short_id')
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 60, 'twitter-payments:get')
  @ApiOperation({ summary: 'Get public details of a Twitter payment request' })
  async getPublic(@Param('short_id') shortId: string) {
    return this.twitterPayments.getPublic(shortId);
  }

  /** Sender (Privy-authed): verify Twitter handle and create real payment */
  @Post(':short_id/fund')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @ApiSecurity('privy-auth')
  @ApiOperation({ summary: 'Sender confirms and funds the Twitter payment request' })
  @ApiResponse({ status: 200, description: '{ payment_id, payment_link }' })
  async fund(
    @Param('short_id') shortId: string,
    @PrivyUser() user: { id: string },
  ) {
    return this.twitterPayments.fund(shortId, user.id);
  }
}
