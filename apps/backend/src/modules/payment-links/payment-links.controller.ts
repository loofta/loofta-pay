import { Controller, Post, Get, Body, Param, Req, Headers, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity, ApiParam } from '@nestjs/swagger';
import { IntegratorGuard, RateLimitGuard } from '@/common/guards';
import { RateLimit } from '@/common/decorators/rate-limit.decorator';
import { RequireScope } from '@/common/decorators/require-scope.decorator';
import type { AuthenticatedIntegrator } from '@/modules/integrators/integrators.service';
import { PaymentLinksService } from './payment-links.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';

@ApiTags('payment-links')
@Controller('payment-links')
export class PaymentLinksController {
  constructor(private readonly paymentLinks: PaymentLinksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RequireScope('payment_links:create')
  @RateLimit(20, 60, 'payment-links:create', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiOperation({ summary: 'Create a checkout link that pays the API key owner {amount, message, webhook_url}' })
  @ApiResponse({ status: 201, description: '{ short_id, url, amount, message, webhook_secret }' })
  async create(
    @Body() dto: CreatePaymentLinkDto,
    @Req() req: { integrator: AuthenticatedIntegrator },
    @Headers('origin') origin: string | undefined,
  ) {
    const { shortId, url, amount, message, webhookSecret } = await this.paymentLinks.create(dto, req.integrator, origin);
    return { short_id: shortId, url, amount, message, webhook_secret: webhookSecret };
  }

  @Get(':shortId')
  @UseGuards(IntegratorGuard, RateLimitGuard)
  @RequireScope('payment_links:create')
  @RateLimit(60, 60, 'payment-links:status', 'integrator')
  @ApiSecurity('integrator-key')
  @ApiParam({ name: 'shortId', description: 'The short_id returned when the link was created' })
  @ApiOperation({ summary: 'Poll a payment link\'s status — the alternative to webhook_url, for merchants who\'d rather check than be pushed to' })
  @ApiResponse({ status: 200, description: '{ short_id, status, paid, amount, message, paid_at } — check `paid`, not `status`, for "did the customer pay"' })
  async getStatus(@Param('shortId') shortId: string, @Req() req: { integrator: AuthenticatedIntegrator }) {
    const link = await this.paymentLinks.getStatus(shortId, req.integrator);
    return {
      short_id: link.shortId,
      status: link.status,
      paid: link.paid,
      amount: link.amount,
      message: link.message,
      paid_at: link.paidAt,
    };
  }
}
