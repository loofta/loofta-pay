import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { SupportBotService, type SupportUpdate } from './support-bot.service';

/** Telegram's webhook for the support bot. The secret header is the only proof the request came from Telegram. */
@ApiExcludeController()
@Controller('support-bot')
export class SupportBotController {
  constructor(private readonly bot: SupportBotService) {}

  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  webhook(@Headers('x-telegram-bot-api-secret-token') header: string | undefined, @Body() update: SupportUpdate) {
    const secret = this.bot.secret;
    const a = Buffer.from(header ?? '');
    const b = Buffer.from(secret ?? '');
    if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    void this.bot.handleUpdate(update);
    return { ok: true };
  }
}
