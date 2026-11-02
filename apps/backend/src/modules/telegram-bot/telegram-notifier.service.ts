import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { TelegramApi, type InlineKeyboard } from './telegram-api';

/** What the bot calls when someone taps Approve or Deny on an agent's payment request. */
export interface AgentApprovalHandler {
  decide(userId: string, actionId: string, approve: boolean): Promise<{ status: string; summary: string }>;
}

/**
 * Sends a Telegram message to a Loofta account from outside the bot (an agent's funding finished, a
 * payment arrived). Best effort: it only reaches people who linked Telegram and pressed Start.
 */
@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);
  private readonly api: TelegramApi | null;

  constructor(
    config: ConfigService,
    private readonly db: SupabaseService,
    private readonly users: UsersService,
  ) {
    const token = config.get<string>('TELEGRAM_BOT_TOKEN');
    this.api = token ? new TelegramApi(token) : null;
  }

  private approvals: AgentApprovalHandler | null = null;

  /** The agent module registers itself here, so the bot needs no import of it (the modules would loop). */
  registerApprovalHandler(handler: AgentApprovalHandler) {
    this.approvals = handler;
  }

  async decideAgentRequest(userId: string, actionId: string, approve: boolean) {
    if (!this.approvals) throw new Error('Agent approvals are not available.');
    return this.approvals.decide(userId, actionId, approve);
  }

  /** Returns true when the message was handed to Telegram. */
  async notifyUser(privyUserId: string, html: string, keyboard?: InlineKeyboard): Promise<boolean> {
    if (!this.api) return false;
    try {
      const handle = await this.users.findSocialHandle(privyUserId, 'telegram');
      if (!handle) return false;
      const { data } = await this.db.getClient().from('telegram_bot_users').select('chat_id').eq('username', handle.toLowerCase()).maybeSingle();
      if (!data?.chat_id) return false;
      const sent = await this.api.sendMessage(Number(data.chat_id), html, keyboard ? { keyboard } : {});
      return !!sent;
    } catch (e) {
      this.logger.warn(`Could not notify ${privyUserId}: ${(e as Error).message}`);
      return false;
    }
  }
}
