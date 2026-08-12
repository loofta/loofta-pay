import { Controller, Post, Get, Body, Param, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { RateLimitGuard, IntegratorGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { TwitterTicketGiftsService } from './twitter-ticket-gifts.service';
import { CreateTwitterTicketGiftDto } from './dto/create-twitter-ticket-gift.dto';
import type { AuthenticatedIntegrator } from '../integrators/integrators.service';

@ApiTags('twitter-ticket-gifts')
@Controller('twitter-ticket-gifts')
export class TwitterTicketGiftsController {
  constructor(private readonly ticketGifts: TwitterTicketGiftsService) {}

  /**
   * Integrator-only, same shape as POST /twitter-payments: the bot calls this once per matching
   * tweet. Unlike twitter-payments, there's no separate /fund step — createGift() either buys
   * the tickets immediately (recipient already registered) or creates a claim link, both
   * synchronously, so this single call is the whole flow.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RateLimit(20, 60, 'twitter-ticket-gifts:create', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Integrator (bot) gifts Megapot tickets to a Twitter-tagged recipient' })
  @ApiResponse({ status: 201, description: '{ short_id, link, delivered_instantly }' })
  async create(@Body() dto: CreateTwitterTicketGiftDto, @Req() req: { integrator: AuthenticatedIntegrator }) {
    return this.ticketGifts.create(dto, req.integrator);
  }

  @Get(':short_id')
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 60, 'twitter-ticket-gifts:get')
  @ApiOperation({ summary: 'Get public details of a Twitter ticket gift' })
  async getPublic(@Param('short_id') shortId: string) {
    return this.ticketGifts.getPublic(shortId);
  }
}
