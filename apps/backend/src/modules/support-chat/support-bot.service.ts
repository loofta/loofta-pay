import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramApi } from '@/modules/telegram-bot/telegram-api';
import { SupportChatService } from './support-chat.service';

export interface SupportUpdate {
  update_id: number;
  message?: { message_id: number; text?: string; chat: { id: number; type: string }; reply_to_message?: { message_id: number } };
}

/**
 * The staff side of support chat. It is a separate bot from the payment bot and never moves money. Only the one chat
 * named in SUPPORT_TELEGRAM_CHAT_ID can answer people; everyone else is ignored.
 */
@Injectable()
export class SupportBotService implements OnModuleInit {
  private readonly logger = new Logger(SupportBotService.name);
  private readonly api: TelegramApi | null;
  readonly secret: string | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly support: SupportChatService,
  ) {
    const token = this.config.get<string>('SUPPORT_BOT_TOKEN');
    this.api = token ? new TelegramApi(token) : null;
    this.secret = this.config.get<string>('SUPPORT_BOT_WEBHOOK_SECRET');
  }

  /** Production only, like the payment bot: a local backend must never steal the live webhook. */
  async onModuleInit() {
    const rawUrl = this.config.get<string>('SUPPORT_BOT_WEBHOOK_URL')?.trim();
    const url = rawUrl && (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    if (!this.api || !url || !this.secret || process.env.NODE_ENV !== 'production') return;
    try {
      await this.api.call('setWebhook', { url, secret_token: this.secret, allowed_updates: ['message'] });
    } catch (e) {
      this.logger.warn(`Support bot webhook not set: ${(e as Error).message}`);
    }
  }

  async handleUpdate(update: SupportUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text || !this.api) return;
    const chatId = String(msg.chat.id);
    const configured = this.support.agentChatId;
    try {
      if (!configured) {
        // Setup help: the person who messages the bot learns the id to put in SUPPORT_TELEGRAM_CHAT_ID.
        if (msg.chat.type === 'private') await this.api.sendMessage(msg.chat.id, `This chat id is ${chatId}. Set SUPPORT_TELEGRAM_CHAT_ID to it to receive support messages here.`);
        return;
      }
      if (chatId !== configured) return; // not the team chat: ignore
      if (msg.reply_to_message) {
        const r = await this.support.agentReply(chatId, msg.reply_to_message.message_id, msg.text);
        if (r === 'unknown') await this.api.sendMessage(msg.chat.id, 'I could not match that to a person. Reply directly to a support message.', { replyTo: msg.message_id });
        return;
      }
      if (msg.text.startsWith('/start') || msg.text.startsWith('/help')) {
        await this.api.sendMessage(msg.chat.id, 'Support messages from the withdraw page arrive here. Reply to one to answer that person.');
      }
    } catch (e) {
      this.logger.warn(`Support bot update failed: ${(e as Error).message}`);
    }
  }
}
