import { randomUUID } from 'crypto';
import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import { SupabaseService } from '@/database/supabase.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { UsersService } from '../users/users.service';
import { TwitterAutopayService, UncertainPaymentError, type TelegramPaymentPlan } from '../twitter-autopay/twitter-autopay.service';
import { TelegramApi, InlineKeyboard, InlineButton, escapeHtml } from './telegram-api';
import { parseSendCommand, commandFromPrompt, PAY_PROMPT, PAY_PRIVATE_PROMPT, payTargetPrompt, DEFAULT_PRIVATE_DELAY_MS } from './telegram-parser';

interface TgUser { id: number; is_bot?: boolean; username?: string; first_name?: string }
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  text?: string;
  reply_to_message?: { from?: TgUser; text?: string };
}
interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallback }

const CONFIRM_TTL_MS = 5 * 60 * 1000;
/** Delay choices (minutes) and split choices offered as buttons on a private card. 'r' = random. */
const DELAY_CHOICES_MIN = [1, 10, 60, 360, 1440];
const SPLIT_CHOICES: Array<number | 'r'> = ['r', 2, 3, 5, 8];
const money = (n: number) => `$${n.toFixed(2)}`;
/** Fees can be fractions of a cent on small amounts; never show a real fee as $0.00. */
// Messages are sent as HTML, so a literal "<" would be read as a tag and Telegram would reject the whole message.
const feeMoney = (n: number) => (n > 0 && n < 0.005 ? 'under $0.01' : money(n));

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
  /** The docs page for the bot, on the marketing site. */
  private readonly guideUrl: string;

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
    this.guideUrl = `${(this.config.get<string>('MARKETING_URL') || 'https://loofta.xyz').replace(/\/$/, '')}/docs?p=telegram-bot`;
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
      // Registered per scope so groups show the menu too (a default-only list is sometimes not shown
      // there). Groups only get the commands that work in a group; the rest are DM-only.
      const privateCommands = [
        { command: 'balance', description: 'Your balance' },
        { command: 'fund', description: 'Add money to your wallet' },
        { command: 'pay', description: 'Pay someone, for example /pay 5 @someone' },
        { command: 'payprivately', description: 'Pay privately, for example /payprivately 5 @someone' },
        { command: 'history', description: 'Your recent payments' },
        { command: 'settings', description: 'Auto-pay limits and terms' },
        { command: 'help', description: 'How it works' },
      ];
      const groupCommands = [
        { command: 'pay', description: 'Pay someone, or reply to a message with /pay 5' },
        { command: 'payprivately', description: 'Pay privately, or reply with /payprivately 5' },
        { command: 'help', description: 'How it works' },
      ];
      await this.api.call('setMyCommands', { commands: privateCommands });
      await this.api.call('setMyCommands', { commands: privateCommands, scope: { type: 'all_private_chats' } });
      await this.api.call('setMyCommands', { commands: groupCommands, scope: { type: 'all_group_chats' } });
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

    // A bare /pay or /payprivately (what a tap on the command suggestion sends): ask who and how much.
    if ((name === 'pay' || name === 'payprivately' || name === 'send' || name === 'sendprivately') && !/\S/.test(text.replace(/^\/\S+/, ''))) {
      const isPrivatePay = name!.endsWith('privately');
      const target = msg.reply_to_message?.from;
      const targetHandle = target && !target.is_bot ? target.username?.toLowerCase() : undefined;
      const prompt = targetHandle
        ? `${payTargetPrompt(targetHandle, isPrivatePay)} Reply with an amount, for example <code>5</code>.`
        : isPrivatePay
          ? `${PAY_PRIVATE_PROMPT} Reply to this message, for example <code>@someone 5</code>. You can add <code>delay 30m split 4</code>.`
          : `${PAY_PROMPT} Reply to this message, for example <code>@someone 5</code>, or several people: <code>@someone 5, @another 10</code>.`;
      return void (await this.api!.sendMessage(msg.chat.id, prompt, { replyTo: msg.message_id, forceReply: targetHandle ? '5' : '@someone 5' }));
    }

    // The answer to one of those questions, as a reply to it.
    const replied = msg.reply_to_message;
    if (replied?.from?.username?.toLowerCase() === this.botUsername.toLowerCase() && replied.text && !command) {
      const composed = commandFromPrompt(replied.text, text);
      if (composed) {
        const parsedAnswer = parseSendCommand(composed, this.botUsername);
        if (parsedAnswer) return this.onSend(msg, from, parsedAnswer);
      }
    }

    const parsed = parseSendCommand(text, this.botUsername);
    if (parsed) return this.onSend(msg, from, parsed);

    if (isPrivate || text.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`)) {
      await this.api!.sendMessage(
        msg.chat.id,
        'I did not catch that. Try <code>pay $5 to @someone</code>, or reply to someone with <code>/pay 5</code>.',
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
    // The guide shown on /start and /help: what the bot can do, with a copyable example for each.
    const text = isPrivate
      ? [
          '<b>Loofta Pay</b>',
          'Pay anyone on Telegram in USDC, right from this chat.',
          '',
          '<b>Get started</b>',
          '1. Sign in to Loofta with Telegram and turn on auto-pay.',
          '2. Add money with /fund.',
          '3. Pay with a message. Examples below.',
          '',
          '<b>What you can do</b>',
          '<b>Pay one person</b>',
          '<code>pay $5 to @someone</code>',
          '',
          '<b>Pay up to 5 people at once</b>, each their own amount',
          '<code>pay $5 to @someone, $10 to @another</code>',
          '',
          '<b>Pay privately</b>, with a delay and a split you choose',
          '<code>pay $5 privately to @someone</code>',
          '',
          '<b>Pay from a group</b>: add me, then reply to a message with',
          '<code>/pay 5</code>',
          '',
          'If they are not on Loofta yet they get a claim link, with a $0.10 claim fee.',
          '',
          '<b>Good to know</b>',
          'Every fee is shown on the card before you confirm, and every payment waits for your Confirm tap. Your limits are always checked.',
          '',
          '<b>Commands</b>: /balance /fund /history /settings /help',
        ].join('\n')
      : 'Reply to someone with <code>/pay 5</code>, or type <code>/pay 5 @someone</code>. Pay up to 5 people at once: <code>/pay $5 to @someone, $10 to @another</code>. Add the word <code>privately</code> for a private payment. Message me directly to set up and fund your wallet.';
    await this.api!.sendMessage(msg.chat.id, text, {
      keyboard: isPrivate
        ? {
            inline_keyboard: [
              [{ text: 'Set up auto-pay', url: `${this.appUrl}/app/auto-pay` }],
              [{ text: 'Read the full guide', url: this.guideUrl }],
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
        'Or tap below to add money with a card or from another chain.',
      ].join('\n'),
      { keyboard: { inline_keyboard: [[{ text: 'Add money', url: `${this.appUrl}/app?deposit=1` }]] } },
    );
  }

  private async showHistory(chatId: number, from: TgUser) {
    const { data } = await this.db
      .getClient()
      .from('telegram_bot_actions')
      .select('amount_usd, recipient_handle, status, created_at')
      .eq('telegram_user_id', from.id)
      .in('status', ['paid', 'failed', 'processing'])
      .order('created_at', { ascending: false })
      .limit(8);
    if (!data?.length) {
      await this.api!.sendMessage(chatId, 'No payments from Telegram yet. Try <code>pay $5 to @someone</code>.');
      return;
    }
    const lines = data.map(
      (r) => `${r.status === 'paid' ? 'Sent' : r.status === 'processing' ? 'Unconfirmed' : 'Failed'} ${money(Number(r.amount_usd))} to @${escapeHtml(r.recipient_handle)}`,
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

    // One person (the usual case) or up to five in the same sentence, each with their own amount.
    let items: Array<{ handle: string; amount: number }>;
    if (parsed.payments) {
      items = parsed.payments;
    } else {
      const handle = (parsed.handle ?? msg.reply_to_message?.from?.username ?? '').toLowerCase();
      if (!handle) {
        return void (await reply(
          parsed.handle === null && msg.reply_to_message
            ? 'That person has no Telegram username, so I cannot pay them yet.'
            : 'Who should get it? Try <code>pay $5 to @someone</code>.',
        ));
      }
      items = [{ handle, amount: parsed.amount }];
    }
    for (const it of items) {
      if (it.handle === from.username?.toLowerCase()) return void (await reply('You cannot pay yourself.'));
      if (it.handle === this.botUsername.toLowerCase()) return void (await reply('I would love to keep it, but no.'));
    }

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
    // Every payment must fit the per-payment limit, and together they must fit the daily limit.
    const batchAmount = items.reduce((t, i) => t + i.amount, 0);
    try {
      for (const it of items) await this.autopay.assertWithinLimits(payer, it.amount, { dailyTotalUsd: batchAmount });
    } catch (e) {
      if (e instanceof BadRequestException) return void (await reply(escapeHtml(e.message)));
      throw e;
    }

    // Never pay the same thing twice by accident: refuse a repeat of a payment that just went through
    // (90 seconds) or is still being processed or unconfirmed (30 minutes).
    {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data: recent } = await this.db
        .getClient()
        .from('telegram_bot_actions')
        .select('recipient_handle, amount_usd, status, created_at, paid_at')
        .eq('telegram_user_id', from.id)
        .in('status', ['paid', 'processing'])
        .gte('created_at', since);
      for (const it of items) {
        const hit = (recent ?? []).find((r) => {
          if (r.recipient_handle !== it.handle || Number(r.amount_usd) !== it.amount) return false;
          if (r.status === 'processing') return true;
          return Date.now() - new Date(r.paid_at ?? r.created_at).getTime() < 90_000;
        });
        if (hit) {
          return void (await reply(
            hit.status === 'processing'
              ? `A payment of ${money(it.amount)} to @${escapeHtml(it.handle)} is still being processed or could not be confirmed. Check /history and your balance before sending it again.`
              : `You just sent ${money(it.amount)} to @${escapeHtml(it.handle)}. If you meant to send it again, wait a minute and repeat the command.`,
          ));
        }
      }
    }

    const isDevnet = isSolanaDevnetFromConfig(this.config);
    const plans = await Promise.all(items.map((it) => this.autopay.planTelegramPayment(it.handle, parsed.isPrivate, isDevnet, it.amount)));
    const needed = plans.reduce((t, p) => t + p.totalUsd, 0);

    // Fail early and plainly when the wallet can't cover it, instead of after a Confirm tap.
    try {
      const { balanceUSD } = await this.users.getSolanaWalletBalanceAndAddress(userId);
      if (balanceUSD + 1e-9 < needed) {
        return void (await reply(
          `Your balance is ${money(balanceUSD)}, which is not enough for ${items.length > 1 ? 'these payments' : 'this payment'} (${money(needed)} with fees). Use /fund to add money.`,
        ));
      }
    } catch (e) {
      this.logger.warn(`Balance check failed, continuing: ${(e as Error).message}`);
    }

    // A new request replaces any older card from the same person that is still waiting.
    await this.db
      .getClient()
      .from('telegram_bot_actions')
      .update({ status: 'cancelled' })
      .eq('telegram_user_id', from.id)
      .eq('status', 'pending');

    const batchId = randomUUID();
    const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS).toISOString();
    const { error } = await this.db
      .getClient()
      .from('telegram_bot_actions')
      .insert(
        items.map((it) => ({
          batch_id: batchId,
          telegram_user_id: from.id,
          privy_user_id: userId,
          chat_id: chatId,
          recipient_handle: it.handle,
          amount_usd: it.amount,
          is_private: parsed.isPrivate,
          private_split: parsed.isPrivate ? parsed.split : null,
          private_max_delay_ms: parsed.isPrivate ? parsed.delayMs : null,
          expires_at: expiresAt,
        })),
      );
    if (error) {
      this.logger.error(`Failed to create telegram actions: ${error.message}`);
      return void (await reply('Something went wrong, please try again.'));
    }

    const card = this.renderCard(
      batchId,
      items.map((it) => ({ recipient_handle: it.handle, amount_usd: it.amount })),
      { isPrivate: parsed.isPrivate, split: parsed.isPrivate ? parsed.split : null, delayMs: parsed.isPrivate ? parsed.delayMs : null },
      plans,
    );
    await reply(card.text, card.keyboard);
  }

  /**
   * The Confirm card, for one person or a batch. For private payments it carries the privacy options
   * as buttons (delay and split, applied to every payment in the batch); typing the command again
   * with "delay 30m split 4" works too. The selected option is shown in [brackets].
   */
  private renderCard(
    batchId: string,
    items: Array<{ recipient_handle: string; amount_usd: number | string }>,
    opts: { isPrivate: boolean; split: number | null; delayMs: number | string | null },
    plans: TelegramPaymentPlan[],
  ): { text: string; keyboard: InlineKeyboard } {
    const lines: string[] = [];
    const rows: InlineButton[][] = [];
    const many = items.length > 1;
    const handleOf = (i: number) => escapeHtml(items[i].recipient_handle);
    const amountOf = (i: number) => Number(items[i].amount_usd);
    const delayMs = opts.delayMs != null ? Number(opts.delayMs) : null;

    if (opts.isPrivate) {
      const delayLabel = delayMs ? this.formatDelay(delayMs) : '10 minutes (default)';
      lines.push(many ? `Pay <b>${items.length} people</b> <b>privately</b>?` : `Send <b>${money(amountOf(0))}</b> USDC <b>privately</b> to <b>@${handleOf(0)}</b>?`);
      if (many) items.forEach((_, i) => lines.push(`${i + 1}. @${handleOf(i)}: <b>${money(amountOf(i))}</b>`));
      lines.push('');
      lines.push(`<b>Delay:</b> up to ${delayLabel}`);
      lines.push('How long it can take to arrive. A longer delay is harder to trace.');
      lines.push('');
      lines.push(`<b>Split:</b> ${opts.split ? `${opts.split} parts` : 'random'}`);
      lines.push('How many smaller parts it is sent in. More parts is harder to trace.');
      if (many) lines.push('Delay and split apply to every payment.');
      lines.push('');
      lines.push('Tap a button to change them, or type it: <code>delay 30m split 4</code>.');
      const effDelayMin = Math.round((delayMs ?? DEFAULT_PRIVATE_DELAY_MS) / 60_000);
      rows.push(
        DELAY_CHOICES_MIN.map((m) => ({
          text: effDelayMin === m ? `[${this.formatDelayButton(m)}]` : this.formatDelayButton(m),
          callback_data: `dl:${batchId}:${m}`,
        })),
      );
      rows.push(
        SPLIT_CHOICES.map((n) => {
          const label = n === 'r' ? 'Random' : `${n} parts`;
          return {
            text: (opts.split ?? 'r') === n ? `[${label}]` : label,
            callback_data: `sp:${batchId}:${n}`,
          };
        }),
      );
    } else if (many) {
      lines.push(`Pay <b>${items.length} people</b>?`);
      items.forEach((_, i) =>
        lines.push(`${i + 1}. @${handleOf(i)}: <b>${money(amountOf(i))}</b> (${plans[i].delivery === 'instant' ? 'arrives in their wallet' : 'claim link'})`),
      );
    } else {
      lines.push(`Send <b>${money(amountOf(0))}</b> USDC to <b>@${handleOf(0)}</b>?`);
      lines.push(
        plans[0].delivery === 'instant'
          ? `@${handleOf(0)} is on Loofta, so it arrives straight in their wallet.`
          : 'They get a claim link.',
      );
    }

    // Fees, always spelled out before the Confirm tap. "~" means approximate. The private fee is one
    // MagicBlock line (it includes the privacy API's own Loofta 10 bps); Loofta's separate 0.2% and the
    // $0.10 claim fee share the Loofta line.
    const sum = (f: (p: TelegramPaymentPlan) => number) => plans.reduce((t, p) => t + f(p), 0);
    const unregistered = items.map((_, i) => i).filter((i) => plans[i].claimFeeUsd > 0);
    lines.push('');
    lines.push('<b>Fees</b>');
    if (opts.isPrivate) lines.push(`Private payment fee: ~${feeMoney(sum((p) => p.privateFeeUsd))} (MagicBlock)`);
    if (unregistered.length > 0) {
      const who = unregistered.map((i) => `@${handleOf(i)}`).join(', ');
      lines.push(
        `Loofta + Claim fee: ${feeMoney(sum((p) => p.looftaFeeUsd))} (0.2%) + ${feeMoney(sum((p) => p.claimFeeUsd))} (${who} ${unregistered.length > 1 ? 'are' : 'is'} not on Loofta yet)`,
      );
    } else {
      lines.push(`Loofta: ${feeMoney(sum((p) => p.looftaFeeUsd))} (0.2%)`);
    }
    lines.push(`<b>Total from your wallet: ${opts.isPrivate ? '~' : ''}${money(sum((p) => p.totalUsd))}</b>`);
    rows.push([
      { text: many ? `Confirm all ${items.length}` : 'Confirm', callback_data: `ok:${batchId}` },
      { text: 'Cancel', callback_data: `no:${batchId}` },
    ]);
    return { text: lines.join('\n'), keyboard: { inline_keyboard: rows } };
  }

  private formatDelayButton(min: number): string {
    if (min < 60) return `${min} min`;
    const h = min / 60;
    return h === 1 ? '1 hour' : h === 24 ? '1 day' : `${h} hours`;
  }

  private formatDelay(ms: number): string {
    if (ms % 3_600_000 === 0) return `${ms / 3_600_000} hour${ms === 3_600_000 ? '' : 's'}`;
    return `${Math.round(ms / 60_000)} minutes`;
  }

  // ---------------------------------------------------------------------------------------------
  // Buttons

  private async onCallback(cb: TgCallback) {
    const [kind, arg, val] = (cb.data ?? '').split(':');
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
        await this.api!.sendMessage(chatId, 'Type it like <code>pay $5 to @someone</code>, or pay several people at once: <code>pay $5 to @someone, $10 to @another</code>.');
      }
      return;
    }

    const supabase = this.db.getClient();
    // created_at is selected so rows can be put in order in code: PostgREST refuses to ORDER BY a column
    // that is not in the returned set of an UPDATE, and that error once looked like "no rows".
    const rowCols = 'id, privy_user_id, recipient_handle, amount_usd, is_private, private_split, private_max_delay_ms, created_at';
    const byCreated = <T extends { created_at: string }>(rows: T[] | null) => (rows ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at));

    if (kind === 'dl' || kind === 'sp') {
      await this.api!.answerCallback(cb.id);
      if (!arg || !val) return;
      const patch =
        kind === 'dl'
          ? { private_max_delay_ms: Number(val) * 60_000 }
          : { private_split: val === 'r' ? null : Number(val) };
      if (kind === 'dl' && !DELAY_CHOICES_MIN.includes(Number(val))) return;
      if (kind === 'sp' && val !== 'r' && !SPLIT_CHOICES.includes(Number(val))) return;
      const { data: rowsRaw, error: patchError } = await supabase
        .from('telegram_bot_actions')
        .update(patch)
        .eq('batch_id', arg)
        .eq('telegram_user_id', cb.from.id)
        .eq('status', 'pending')
        .eq('is_private', true)
        .gt('expires_at', new Date().toISOString())
        .select(rowCols);
      if (patchError) this.logger.error(`Telegram option update failed: ${patchError.message}`);
      const rowsNow = byCreated(rowsRaw);
      if (!rowsNow.length) return;
      const isDevnet = isSolanaDevnetFromConfig(this.config);
      const plans = await Promise.all(rowsNow.map((r) => this.autopay.planTelegramPayment(r.recipient_handle, true, isDevnet, Number(r.amount_usd))));
      const card = this.renderCard(
        arg,
        rowsNow,
        { isPrivate: true, split: rowsNow[0].private_split ?? null, delayMs: rowsNow[0].private_max_delay_ms ?? null },
        plans,
      );
      await this.api!.editMessage(chatId, messageId, card.text, card.keyboard);
      return;
    }

    if ((kind !== 'ok' && kind !== 'no') || !arg) return void (await this.api!.answerCallback(cb.id));

    if (kind === 'no') {
      const { data } = await supabase
        .from('telegram_bot_actions')
        .update({ status: 'cancelled' })
        .eq('batch_id', arg)
        .eq('telegram_user_id', cb.from.id)
        .eq('status', 'pending')
        .select('id');
      await this.api!.answerCallback(cb.id);
      if (data?.length) await this.api!.editMessage(chatId, messageId, 'Cancelled.');
      return;
    }

    // Confirm. The pending -> processing flip is the lock: a second tap, a Telegram retry or
    // someone else's tap in a group finds no rows and does nothing. Only the person who asked
    // (telegram_user_id) can ever confirm, and it flips the whole batch at once.
    const { data: claimedRaw, error: claimError } = await supabase
      .from('telegram_bot_actions')
      .update({ status: 'processing' })
      .eq('batch_id', arg)
      .eq('telegram_user_id', cb.from.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select(rowCols);
    if (claimError) this.logger.error(`Telegram confirm could not claim batch ${arg}: ${claimError.message}`);
    const claimedRows = byCreated(claimedRaw);
    if (!claimedRows.length) {
      await this.api!.answerCallback(cb.id, 'This request has expired or was already used.');
      return;
    }
    await this.api!.answerCallback(cb.id, 'Sending…');
    await this.api!.editMessage(chatId, messageId, claimedRows.length > 1 ? `Sending ${claimedRows.length} payments…` : 'Sending…');

    const batchTotal = claimedRows.reduce((t, r) => t + Number(r.amount_usd), 0);
    const outcomes: Array<{ handle: string; amount: number; isPrivate: boolean; shortLink?: string; claimLink?: string; error?: string; uncertain?: boolean; signature?: string | null }> = [];
    let stopped = false; // set after an unconfirmed payment: nothing further is attempted
    const isDevnet = isSolanaDevnetFromConfig(this.config);

    for (const row of claimedRows) {
      const amount = Number(row.amount_usd);
      const handle = row.recipient_handle as string;
      if (stopped) {
        await supabase.from('telegram_bot_actions').update({ status: 'failed', error: 'not attempted: an earlier payment in this batch was unconfirmed' }).eq('id', row.id);
        outcomes.push({ handle, amount, isPrivate: !!row.is_private, error: 'not attempted, an earlier payment was unconfirmed' });
        continue;
      }
      try {
        const userId = await this.resolveLinkedUser(cb.from.id);
        if (!userId || userId !== row.privy_user_id) throw new BadRequestException('Your Telegram is no longer linked to this wallet.');
        const payer = await this.autopay.resolvePayerByUserId(userId);
        if (!payer?.signerGranted) throw new BadRequestException('Auto-pay is turned off.');
        await this.autopay.assertWithinLimits(payer, amount, { excludeTelegramBatchId: arg, dailyTotalUsd: batchTotal });

        const result = await this.autopay.executeTelegramAutoPay({
          senderUserId: userId,
          recipientHandle: handle,
          amountUsd: amount,
          isPrivate: !!row.is_private,
          isDevnet,
          splitOverride: row.private_split ?? null,
          maxDelayMsOverride: row.private_max_delay_ms != null ? Number(row.private_max_delay_ms) : null,
        });
        await supabase
          .from('telegram_bot_actions')
          .update({ status: 'paid', payment_id: result.paymentId, claim_link: result.claimLink, paid_at: new Date().toISOString() })
          .eq('id', row.id);
        outcomes.push({
          handle,
          amount,
          isPrivate: !!row.is_private,
          // The share page (/share/:short_id) is the sender's view of a payment; /c/ is the claim page.
          shortLink: result.shortId ? `${this.appUrl}/share/${result.shortId}` : result.claimLink,
          claimLink: result.claimLink,
        });
        await this.notifyRecipient(handle, cb.from, amount, result.claimLink, !!row.is_private);
      } catch (e) {
        if (e instanceof UncertainPaymentError) {
          // It may have gone through. The row stays 'processing' (it still counts toward the daily limit
          // and blocks an identical repeat), and the person is told to check before trying again.
          this.logger.error(`Telegram payment ${row.id} UNCONFIRMED (may have been sent): ${e.message}`);
          await supabase.from('telegram_bot_actions').update({ error: `unconfirmed: ${e.message}`.slice(0, 500), payment_id: e.paymentId }).eq('id', row.id);
          outcomes.push({ handle, amount, isPrivate: !!row.is_private, uncertain: true, signature: e.signature, error: 'could not be confirmed' });
          stopped = true;
          continue;
        }
        const insufficient = /insufficient funds/i.test((e as Error).message);
        const userFacing = e instanceof BadRequestException
          ? e.message
          : insufficient
            ? 'not enough USDC in your wallet. Use /fund to add money.'
            : 'something went wrong, nothing was sent.';
        this.logger.error(`Telegram payment ${row.id} failed: ${(e as Error).message}`);
        await supabase
          .from('telegram_bot_actions')
          .update({ status: 'failed', error: (e as Error).message.slice(0, 500) })
          .eq('id', row.id);
        outcomes.push({ handle, amount, isPrivate: !!row.is_private, error: userFacing });
      }
    }

    // Result: one line per person and a link button for each payment that went through.
    const okOnes = outcomes.filter((o) => !o.error);
    const unsure = outcomes.filter((o) => o.uncertain);
    const lines: string[] = [];
    if (outcomes.length === 1) {
      const o = outcomes[0];
      lines.push(
        o.uncertain
          ? `I could not confirm the payment of <b>${money(o.amount)}</b> to <b>@${escapeHtml(o.handle)}</b>, so it may have gone through. Check your balance and /history before trying again.`
          : o.error
          ? escapeHtml(o.error.charAt(0).toUpperCase() + o.error.slice(1))
          : o.isPrivate
            ? `Sent <b>${money(o.amount)}</b> privately to <b>@${escapeHtml(o.handle)}</b>. It lands after the delay.`
            : `Sent <b>${money(o.amount)}</b> to <b>@${escapeHtml(o.handle)}</b>.`,
      );
    } else {
      lines.push(okOnes.length === outcomes.length ? `Done. All ${outcomes.length} payments sent.` : `${okOnes.length} of ${outcomes.length} payments sent.`);
      outcomes.forEach((o, i) =>
        lines.push(
          o.uncertain
            ? `${i + 1}. @${escapeHtml(o.handle)}: ${money(o.amount)} could not be confirmed, it may have gone through`
            : o.error
            ? `${i + 1}. @${escapeHtml(o.handle)}: ${money(o.amount)} not sent (${escapeHtml(o.error)})`
            : `${i + 1}. @${escapeHtml(o.handle)}: <b>${money(o.amount)}</b> sent${o.isPrivate ? ' privately' : ''}`,
        ),
      );
    }
    const linkRows: InlineButton[][] = okOnes.map((o) => [
      { text: okOnes.length > 1 ? `View payment to @${o.handle}` : 'View payment', url: o.shortLink! },
    ]);
    for (const o of unsure) {
      if (o.signature) linkRows.push([{ text: `Check on Solscan: @${o.handle}`, url: `https://solscan.io/tx/${o.signature}` }]);
    }
    if (unsure.length && outcomes.length > 1) lines.push('', 'The rest were not attempted. Check /history before sending again.');
    await this.api!.editMessage(chatId, messageId, lines.join('\n'), linkRows.length ? { inline_keyboard: linkRows } : undefined);
  }

  /** Telegram only lets a bot message someone who pressed Start, so this is best effort. */
  private async notifyRecipient(handle: string, sender: TgUser, amount: number, link: string, isPrivate = false) {
    try {
      const { data } = await this.db
        .getClient()
        .from('telegram_bot_users')
        .select('chat_id')
        .eq('username', handle)
        .maybeSingle();
      if (!data?.chat_id) return;
      const who = sender.username ? `@${escapeHtml(sender.username)}` : escapeHtml(sender.first_name ?? 'Someone');
      await this.api!.sendMessage(Number(data.chat_id), isPrivate ? `${who} is sending you <b>${money(amount)}</b> privately. It arrives after the delay they chose.` : `${who} sent you <b>${money(amount)}</b>.`, {
        keyboard: { inline_keyboard: [[{ text: 'Open payment', url: link }]] },
      });
    } catch (e) {
      this.logger.warn(`Could not notify @${handle}: ${(e as Error).message}`);
    }
  }
}
