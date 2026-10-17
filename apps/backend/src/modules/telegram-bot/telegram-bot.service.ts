import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import { SupabaseService } from '@/database/supabase.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { UsersService } from '../users/users.service';
import { TwitterAutopayService } from '../twitter-autopay/twitter-autopay.service';
import { TelegramApi, InlineKeyboard, escapeHtml } from './telegram-api';
import { parseSendCommand } from './telegram-parser';

interface TgUser { id: number; is_bot?: boolean; username?: string; first_name?: string }
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  text?: string;
  reply_to_message?: { from?: TgUser };
}
interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

const CONFIRM_TTL_MS = 5 * 60 * 1000;
const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * @looftapay_bot. Chat-only payments, in the style of trading bots: every Telegram user is
 * authenticated by Telegram itself (the webhook secret proves the update came from Telegram, and
 * `from.id` can't be forged), mapped to a Loofta account through the Telegram account they linked
 * in Privy, and spends through the same auto-pay enrollment as the X bot: signer grant, accepted
 * terms, per-payment and daily limits. Every payment waits for a Confirm tap by the same person.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly api: TelegramApi | null;
  private readonly privy: PrivyClient | null;
  readonly botUsername: string;
  private readonly appUrl: string;

  constructor(
    private readonly db: SupabaseService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly autopay: TwitterAutopayService,
  ) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.api = token ? new TelegramApi(token) : null;
    const appId = this.config.get<string>('PRIVY_APP_ID');
    const appSecret = this.config.get<string>('PRIVY_APP_SECRET');
    this.privy = appId && appSecret ? new PrivyClient(appId, appSecret) : null;
    this.botUsername = this.config.get<string>('TELEGRAM_BOT_USERNAME') || 'looftapay_bot';
    this.appUrl = (
      this.config.get<string>('NEXT_PUBLIC_APP_URL') ||
      this.config.get<string>('NEXT_PUBLIC_BASE_URL') ||
      'https://pay.loofta.xyz'
    ).replace(/\/$/, '');
  }

  /** Production only: a local/dev backend must never steal the production bot's webhook. */
  async onModuleInit() {
    const rawUrl = this.config.get<string>('TELEGRAM_WEBHOOK_URL')?.trim();
    // Telegram only accepts https; tolerate the scheme being left off the env value.
    const url = rawUrl && (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    const secret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    if (!this.api || !url || !secret || process.env.NODE_ENV !== 'production') return;
    try {
      await this.api.call('setWebhook', {
        url,
        secret_token: secret,
        allowed_updates: ['message', 'callback_query'],
      });
      await this.api.call('setMyCommands', {
        commands: [
          { command: 'balance', description: 'Your balance' },
          { command: 'fund', description: 'Add money to your wallet' },
          { command: 'pay', description: 'Pay someone, for example /pay 5 @alice' },
          { command: 'history', description: 'Your recent payments' },
          { command: 'settings', description: 'Auto-pay limits and terms' },
          { command: 'help', description: 'How it works' },
        ],
      });
      this.logger.log(`Telegram webhook registered for @${this.botUsername}`);
    } catch (e) {
      this.logger.error(`Telegram webhook registration failed: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Entry point

  async handleUpdate(update: TgUpdate): Promise<void> {
    if (!this.api) return;
    try {
      // Telegram retries until it gets a 200, so make each update run exactly once.
      const { error } = await this.db.getClient().from('telegram_bot_updates').insert({ update_id: update.update_id });
      if (error?.code === '23505') return;
      if (error) this.logger.warn(`update dedupe insert failed: ${error.message}`);

      if (update.callback_query) await this.onCallback(update.callback_query);
      else if (update.message?.text) await this.onMessage(update.message);
    } catch (e) {
      this.logger.error(`Telegram update ${update.update_id} failed: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Messages

  private async onMessage(msg: TgMessage) {
    const from = msg.from;
    if (!from || from.is_bot) return;
    const isPrivate = msg.chat.type === 'private';
    const text = (msg.text ?? '').trim();
    await this.rememberUser(from, isPrivate ? msg.chat.id : null);

    const command = /^\/([a-z_]+)(?:@(\w+))?/i.exec(text);
    // In a group, a command addressed to some other bot is not ours.
    if (command?.[2] && command[2].toLowerCase() !== this.botUsername.toLowerCase()) return;
    const name = command?.[1]?.toLowerCase();

    if (name === 'start' || name === 'help') return this.sendWelcome(msg, isPrivate);
    if (name === 'balance') return this.privateOnly(msg, isPrivate, () => this.showBalance(msg.chat.id, from));
    if (name === 'fund') return this.privateOnly(msg, isPrivate, () => this.showFund(msg.chat.id, from));
    if (name === 'history') return this.privateOnly(msg, isPrivate, () => this.showHistory(msg.chat.id, from));
    if (name === 'settings') return this.privateOnly(msg, isPrivate, () => this.showSettings(msg.chat.id, from));

    const parsed = parseSendCommand(text, this.botUsername);
    if (parsed) return this.onSend(msg, from, parsed);

    if (isPrivate || text.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`)) {
      await this.api!.sendMessage(
        msg.chat.id,
        'I did not catch that. Try <code>pay $5 to @alice</code>, or reply to someone with <code>/pay 5</code>.',
        { replyTo: msg.message_id },
      );
    }
  }

  private async privateOnly(msg: TgMessage, isPrivate: boolean, fn: () => Promise<unknown>) {
    if (isPrivate) {
      await fn();
      return;
    }
    await this.api!.sendMessage(msg.chat.id, 'That one is private, so message me directly.', {
      replyTo: msg.message_id,
      keyboard: { inline_keyboard: [[{ text: 'Open chat', url: `https://t.me/${this.botUsername}` }]] },
    });
  }

  private async rememberUser(from: TgUser, privateChatId: number | null) {
    const username = from.username?.toLowerCase() ?? null;
    if (privateChatId !== null) {
      await this.db.getClient().from('telegram_bot_users').upsert(
        {
          telegram_user_id: from.id,
          chat_id: privateChatId,
          username,
          first_name: from.first_name ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'telegram_user_id' },
      );
    } else if (username) {
      // In a group we can't learn the DM chat id, but we can keep a known user's username fresh.
      await this.db.getClient().from('telegram_bot_users').update({ username }).eq('telegram_user_id', from.id);
    }
  }

  private mainMenu(): InlineKeyboard {
    return {
      inline_keyboard: [
        [{ text: 'Balance', callback_data: 'menu:balance' }, { text: 'Fund', callback_data: 'menu:fund' }],
        [{ text: 'Send', callback_data: 'menu:send' }, { text: 'History', callback_data: 'menu:history' }],
        [{ text: 'Settings', callback_data: 'menu:settings' }],
      ],
    };
  }

  private async sendWelcome(msg: TgMessage, isPrivate: boolean) {
    const text = isPrivate
      ? [
          '<b>Loofta Pay</b>',
          'Pay anyone on Telegram in USDC, right from this chat.',
          '',
          '1. Sign in to Loofta with Telegram and turn on auto-pay.',
          '2. Add money with /fund.',
          '3. Type <code>pay $5 to @alice</code>, or add me to a group and reply to a message with <code>/pay 5</code>.',
          '',
          'Every payment waits for your Confirm tap, and your limits are always checked.',
        ].join('\n')
      : 'Reply to someone with <code>/pay 5</code>, or type <code>/pay 5 @alice</code>. Message me directly to set up and fund your wallet.';
    await this.api!.sendMessage(msg.chat.id, text, {
      keyboard: isPrivate
        ? {
            inline_keyboard: [
              [{ text: 'Set up auto-pay', url: `${this.appUrl}/app/auto-pay` }],
              ...this.mainMenu().inline_keyboard,
            ],
          }
        : { inline_keyboard: [[{ text: 'Open chat', url: `https://t.me/${this.botUsername}` }]] },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Identity

  /** Telegram user id -> Loofta (Privy) user id, via the Telegram account linked in Privy. */
  private async resolveLinkedUser(telegramUserId: number): Promise<string | null> {
    if (!this.privy) return null;
    try {
      const user = await this.privy.getUserByTelegramUserId(String(telegramUserId));
      return user?.id ?? null;
    } catch (e) {
      this.logger.warn(`Privy telegram lookup failed: ${(e as Error).message}`);
      return null;
    }
  }

  private signInKeyboard(label: string): InlineKeyboard {
    return { inline_keyboard: [[{ text: label, url: `${this.appUrl}/app/auto-pay` }]] };
  }

  // ---------------------------------------------------------------------------------------------
  // Private-chat commands

  private async showBalance(chatId: number, from: TgUser) {
    const userId = await this.resolveLinkedUser(from.id);
    if (!userId) {
      await this.api!.sendMessage(chatId, 'Sign in to Loofta with Telegram first, then I can show your balance.', {
        keyboard: this.signInKeyboard('Sign in to Loofta'),
      });
      return;
    }
    const { balanceUSD } = await this.users.getSolanaWalletBalanceAndAddress(userId);
    await this.api!.sendMessage(chatId, `Your balance is <b>${money(balanceUSD)}</b>.`, { keyboard: this.mainMenu() });
  }

  private async showFund(chatId: number, from: TgUser) {
    const userId = await this.resolveLinkedUser(from.id);
    if (!userId) {
      await this.api!.sendMessage(chatId, 'Sign in to Loofta with Telegram first, then I can show where to add money.', {
        keyboard: this.signInKeyboard('Sign in to Loofta'),
      });
      return;
    }
    const address = await this.users.getSolanaWalletAddress(userId);
    await this.api!.sendMessage(
      chatId,
      [
        'Send <b>USDC on Solana</b> to your Loofta wallet:',
        `<code>${escapeHtml(address)}</code>`,
        '',
        'Or open Loofta to add money with a card or from another chain.',
      ].join('\n'),
      { keyboard: { inline_keyboard: [[{ text: 'Open Loofta', url: `${this.appUrl}/app` }]] } },
    );
  }

  private async showHistory(chatId: number, from: TgUser) {
    const { data } = await this.db
      .getClient()
      .from('telegram_bot_actions')
      .select('amount_usd, recipient_handle, status, created_at')
      .eq('telegram_user_id', from.id)
      .in('status', ['paid', 'failed'])
      .order('created_at', { ascending: false })
      .limit(8);
    if (!data?.length) {
      await this.api!.sendMessage(chatId, 'No payments from Telegram yet. Try <code>pay $5 to @alice</code>.');
      return;
    }
    const lines = data.map(
      (r) => `${r.status === 'paid' ? 'Sent' : 'Failed'} ${money(Number(r.amount_usd))} to @${escapeHtml(r.recipient_handle)}`,
    );
    await this.api!.sendMessage(chatId, `<b>Recent payments</b>\n${lines.join('\n')}`);
  }

  private async showSettings(chatId: number, from: TgUser) {
    const userId = await this.resolveLinkedUser(from.id);
    const payer = userId ? await this.autopay.resolvePayerByUserId(userId) : null;
    const text = payer?.signerGranted
      ? `Auto-pay is on.\nMax per payment: <b>${money(payer.perPaymentCapUsd)}</b>\nMax per day: <b>${money(payer.dailyCapUsd)}</b>`
      : 'Auto-pay is off. Turn it on to pay from Telegram.';
    await this.api!.sendMessage(chatId, text, {
      keyboard: this.signInKeyboard(payer?.signerGranted ? 'Change limits' : 'Turn on auto-pay'),
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Send

  private async onSend(msg: TgMessage, from: TgUser, parsed: ReturnType<typeof parseSendCommand>) {
    const chatId = msg.chat.id;
    const reply = (text: string, keyboard?: InlineKeyboard) =>
      this.api!.sendMessage(chatId, text, { replyTo: msg.message_id, keyboard });

    if (!parsed) return;
    if (!parsed.ok) return void (await reply(escapeHtml(parsed.error)));

    const handle = (parsed.handle ?? msg.reply_to_message?.from?.username ?? '').toLowerCase();
    if (!handle) {
      return void (await reply(
        parsed.handle === null && msg.reply_to_message
          ? 'That person has no Telegram username, so I cannot pay them yet.'
          : 'Who should get it? Try <code>pay $5 to @alice</code>.',
      ));
    }
    if (handle === from.username?.toLowerCase()) return void (await reply('You cannot pay yourself.'));
    if (handle === this.botUsername.toLowerCase()) return void (await reply('I would love to keep it, but no.'));

    const userId = await this.resolveLinkedUser(from.id);
    if (!userId) {
      return void (await reply(
        'To pay from Telegram, sign in to Loofta with Telegram first.',
        { inline_keyboard: [[{ text: 'Sign in to Loofta', url: `${this.appUrl}/app/auto-pay` }]] },
      ));
    }
    const payer = await this.autopay.resolvePayerByUserId(userId);
    if (!payer?.signerGranted) {
      return void (await reply(
        'Turn on auto-pay and accept the terms first, then I can pay from your wallet.',
        { inline_keyboard: [[{ text: 'Turn on auto-pay', url: `${this.appUrl}/app/auto-pay` }]] },
      ));
    }
    try {
      await this.autopay.assertWithinLimits(payer, parsed.amount);
    } catch (e) {
      if (e instanceof BadRequestException) return void (await reply(escapeHtml(e.message)));
      throw e;
    }

    const { data: action, error } = await this.db
      .getClient()
      .from('telegram_bot_actions')
      .insert({
        telegram_user_id: from.id,
        privy_user_id: userId,
        chat_id: chatId,
        recipient_handle: handle,
        amount_usd: parsed.amount,
        expires_at: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
      })
      .select('id')
      .single();
    if (error || !action) {
      this.logger.error(`Failed to create telegram action: ${error?.message}`);
      return void (await reply('Something went wrong, please try again.'));
    }

    await reply(
      [
        `Send <b>${money(parsed.amount)}</b> USDC to <b>@${escapeHtml(handle)}</b>?`,
        'If they are not on Loofta yet, they get a claim link.',
      ].join('\n'),
      {
        inline_keyboard: [[
          { text: 'Confirm', callback_data: `ok:${action.id}` },
          { text: 'Cancel', callback_data: `no:${action.id}` },
        ]],
      },
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Buttons

  private async onCallback(cb: TgCallback) {
    const [kind, arg] = (cb.data ?? '').split(':');
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    if (!chatId || !messageId) return void (await this.api!.answerCallback(cb.id));

    if (kind === 'menu') {
      await this.api!.answerCallback(cb.id);
      if (cb.message?.chat.type !== 'private') return;
      if (arg === 'balance') return this.showBalance(chatId, cb.from);
      if (arg === 'fund') return this.showFund(chatId, cb.from);
      if (arg === 'history') return this.showHistory(chatId, cb.from);
      if (arg === 'settings') return this.showSettings(chatId, cb.from);
      if (arg === 'send') {
        await this.api!.sendMessage(chatId, 'Type it like <code>pay $5 to @alice</code>.');
      }
      return;
    }

    if ((kind !== 'ok' && kind !== 'no') || !arg) return void (await this.api!.answerCallback(cb.id));
    const supabase = this.db.getClient();

    if (kind === 'no') {
      const { data } = await supabase
        .from('telegram_bot_actions')
        .update({ status: 'cancelled' })
        .eq('id', arg)
        .eq('telegram_user_id', cb.from.id)
        .eq('status', 'pending')
        .select('id');
      await this.api!.answerCallback(cb.id);
      if (data?.length) await this.api!.editMessage(chatId, messageId, 'Cancelled.');
      return;
    }

    // Confirm. The pending -> processing flip is the lock: a second tap, a Telegram retry or
    // someone else's tap in a group finds no row and does nothing. Only the person who asked
    // (telegram_user_id) can ever confirm.
    const { data: claimed } = await supabase
      .from('telegram_bot_actions')
      .update({ status: 'processing' })
      .eq('id', arg)
      .eq('telegram_user_id', cb.from.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('id, privy_user_id, recipient_handle, amount_usd')
      .maybeSingle();
    if (!claimed) {
      await this.api!.answerCallback(cb.id, 'This request has expired or was already used.');
      return;
    }
    await this.api!.answerCallback(cb.id, 'Sending…');
    await this.api!.editMessage(chatId, messageId, 'Sending…');

    const amount = Number(claimed.amount_usd);
    const handle = claimed.recipient_handle as string;
    try {
      const userId = await this.resolveLinkedUser(cb.from.id);
      if (!userId || userId !== claimed.privy_user_id) throw new BadRequestException('Your Telegram is no longer linked to this wallet.');
      const payer = await this.autopay.resolvePayerByUserId(userId);
      if (!payer?.signerGranted) throw new BadRequestException('Auto-pay is turned off.');
      await this.autopay.assertWithinLimits(payer, amount, { excludeTelegramActionId: claimed.id });

      const result = await this.autopay.executeAutoPay({
        senderUserId: userId,
        recipientHandle: handle,
        amountUsd: amount,
        isPrivate: false,
        isDevnet: isSolanaDevnetFromConfig(this.config),
        source: 'telegram',
      });
      await supabase
        .from('telegram_bot_actions')
        .update({ status: 'paid', payment_id: result.paymentId, claim_link: result.claimLink, paid_at: new Date().toISOString() })
        .eq('id', claimed.id);

      await this.api!.editMessage(chatId, messageId, `Sent <b>${money(amount)}</b> to <b>@${escapeHtml(handle)}</b>.`, {
        inline_keyboard: [[{ text: 'View payment', url: result.claimLink }]],
      });
      await this.notifyRecipient(handle, cb.from, amount, result.claimLink);
    } catch (e) {
      const userFacing = e instanceof BadRequestException ? e.message : 'Something went wrong, so nothing was sent. Please try again.';
      this.logger.error(`Telegram payment ${claimed.id} failed: ${(e as Error).message}`);
      await supabase
        .from('telegram_bot_actions')
        .update({ status: 'failed', error: (e as Error).message.slice(0, 500) })
        .eq('id', claimed.id);
      await this.api!.editMessage(chatId, messageId, escapeHtml(userFacing));
    }
  }

  /** Telegram only lets a bot message someone who pressed Start, so this is best effort. */
  private async notifyRecipient(handle: string, sender: TgUser, amount: number, link: string) {
    try {
      const { data } = await this.db
        .getClient()
        .from('telegram_bot_users')
        .select('chat_id')
        .eq('username', handle)
        .maybeSingle();
      if (!data?.chat_id) return;
      const who = sender.username ? `@${escapeHtml(sender.username)}` : escapeHtml(sender.first_name ?? 'Someone');
      await this.api!.sendMessage(Number(data.chat_id), `${who} sent you <b>${money(amount)}</b>.`, {
        keyboard: { inline_keyboard: [[{ text: 'Open payment', url: link }]] },
      });
    } catch (e) {
      this.logger.warn(`Could not notify @${handle}: ${(e as Error).message}`);
    }
  }
}
