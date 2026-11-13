import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PrivyAuthGuard } from '../../auth/privy-auth.guard';
import { PrivyUser } from '../../auth/privy-user.decorator';
import { MeldOnrampService } from './meld-onramp.service';

/**
 * Buy USDC with Apple Pay, Google Pay or a card (Meld). The mini app reaches this through a Vercel
 * rewrite, so the caller's country and IP come from the headers Vercel adds, not from the request body.
 */
@ApiTags('meld-onramp')
@ApiBearerAuth()
@UseGuards(PrivyAuthGuard)
@Controller('meld-onramp')
export class MeldOnrampController {
  constructor(private readonly service: MeldOnrampService) {}

  @Post('quote')
  @Throttle({ short: { ttl: 10_000, limit: 6 } })
  @ApiOperation({ summary: 'Every way to pay for this amount, best first' })
  quote(@Body() body: { amount?: number }, @Headers('x-vercel-ip-country') country?: string) {
    return this.service.quote(body?.amount, country);
  }

  @Post('session')
  @Throttle({ short: { ttl: 60_000, limit: 6 } })
  @ApiOperation({ summary: 'Open a checkout that sends USDC to the caller\'s own wallet' })
  session(
    @PrivyUser() user: { id: string },
    @Body() body: { amount?: number; serviceProvider?: string; paymentMethodType?: string; redirectUrl?: string },
    @Headers('x-vercel-ip-country') country?: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
  ) {
    const clientIp = (forwardedFor ?? '').split(',')[0].trim() || undefined;
    return this.service.session(user.id, { amount: body?.amount, serviceProvider: body?.serviceProvider, paymentMethodType: body?.paymentMethodType, redirectUrl: body?.redirectUrl, country, clientIp });
  }
}
