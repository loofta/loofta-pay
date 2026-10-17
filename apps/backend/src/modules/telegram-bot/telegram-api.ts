const TELEGRAM_API = 'https://api.telegram.org';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

/** Thin Bot API client. Every call returns null on failure (logged by the caller's context). */
export class TelegramApi {
  constructor(private readonly token: string) {}

  async call<T = any>(method: string, body: Record<string, unknown>): Promise<T | null> {
    const res = await fetch(`${TELEGRAM_API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
    if (!json?.ok) {
      throw new Error(`Telegram ${method} failed: ${json?.description ?? res.status}`);
    }
    return json.result ?? null;
  }

  /** If Telegram cannot parse our HTML, send the same text as plain words instead of dropping the
   *  message: a formatting slip must never leave the user with no reply at all. */
  private async withPlainFallback<T>(send: (parseMode: 'HTML' | undefined, text: string) => Promise<T | null>, text: string) {
    try {
      return await send('HTML', text);
    } catch (e) {
      if (!/can't parse entities/i.test((e as Error).message)) throw e;
      const plain = text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      return send(undefined, plain);
    }
  }

  sendMessage(chatId: number, text: string, opts: { keyboard?: InlineKeyboard; replyTo?: number; forceReply?: string } = {}) {
    return this.withPlainFallback((parseMode, body) => this.sendMessageRaw(chatId, body, parseMode, opts), text);
  }

  private sendMessageRaw(chatId: number, text: string, parseMode: 'HTML' | undefined, opts: { keyboard?: InlineKeyboard; replyTo?: number; forceReply?: string }) {
    return this.call<{ message_id: number }>('sendMessage', {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      link_preview_options: { is_disabled: true },
      ...(opts.keyboard ? { reply_markup: opts.keyboard } : {}),
      // Opens the reply box already pointed at this message, with a hint of what to type. selective: in a
      // group only the person who asked is prompted.
      ...(opts.forceReply ? { reply_markup: { force_reply: true, selective: true, input_field_placeholder: opts.forceReply } } : {}),
      ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    });
  }

  editMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
    return this.withPlainFallback((parseMode, body) => this.editMessageRaw(chatId, messageId, body, parseMode, keyboard), text);
  }

  private editMessageRaw(chatId: number, messageId: number, text: string, parseMode: 'HTML' | undefined, keyboard?: InlineKeyboard) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard ?? { inline_keyboard: [] },
    });
  }

  answerCallback(callbackQueryId: string, text?: string) {
    return this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
  }
}
