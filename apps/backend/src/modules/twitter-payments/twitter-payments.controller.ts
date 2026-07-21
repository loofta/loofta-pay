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
import { AuthGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { PrivyUser } from '@/auth/privy-user.decorator';
import { TwitterPaymentsService } from './twitter-payments.service';
import { CreateTwitterPaymentDto } from './dto/create-twitter-payment.dto';
import { BotGuard } from './bot.guard';

@ApiTags('twitter-payments')
@Controller('twitter-payments')
export class TwitterPaymentsController {
  constructor(private readonly twitterPayments: TwitterPaymentsService) {}

  /** Bot-only: create a pending payment request from a parsed tweet */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(BotGuard)
  @ApiSecurity('bot-secret')
  @ApiOperation({ summary: 'Bot creates a pending Twitter payment request' })
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
