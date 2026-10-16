import { Controller, Post, Body, Headers, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { TelegramBotService, type TgUpdate } from './telegram-bot.service';

@ApiExcludeController()
@Controller('telegram-bot')
export class TelegramBotController {
  constructor(
    private readonly bot: TelegramBotService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Telegram's webhook. The secret header (set via setWebhook secret_token) is the only thing
   * proving a request came from Telegram, so it is compared in constant time and a missing
   * server-side secret rejects everything. Answers immediately and works in the background so a
   * slow payment never makes Telegram time out and retry (retries are deduped by update_id anyway).
   */
  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  webhook(@Headers('x-telegram-bot-api-secret-token') header: string | undefined, @Body() update: TgUpdate) {
    const secret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    const a = Buffer.from(header ?? '');
    const b = Buffer.from(secret ?? '');
    if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    void this.bot.handleUpdate(update);
    return { ok: true };
  }
}
