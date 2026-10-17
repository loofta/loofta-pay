import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import { SupabaseService } from '@/database/supabase.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { UsersService } from '../users/users.service';
import { TwitterAutopayService, type TelegramPaymentPlan } from '../twitter-autopay/twitter-autopay.service';
import { TelegramApi, InlineKeyboard, InlineButton, escapeHtml } from './telegram-api';
import { parseSendCommand, DEFAULT_PRIVATE_DELAY_MS } from './telegram-parser';

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
    const text = isPrivate
      ? [
          '<b>Loofta Pay</b>',
          'Pay anyone on Telegram in USDC, right from this chat.',
          '',
          '1. Sign in to Loofta with Telegram and turn on auto-pay.',
          '2. Add money with /fund.',
          '3. Type <code>pay $5 to @someone</code>, or <code>pay $5 privately to @someone</code>. In a group, reply to a message with <code>/pay 5</code>.',
          '',
          'Every payment waits for your Confirm tap, and your limits are always checked.',
        ].join('\n')
      : 'Reply to someone with <code>/pay 5</code>, or type <code>/pay 5 @someone</code>. Add the word <code>privately</code> for a private payment. Message me directly to set up and fund your wallet.';
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
      .in('status', ['paid', 'failed'])
      .order('created_at', { ascending: false })
      .limit(8);
    if (!data?.length) {
      await this.api!.sendMessage(chatId, 'No payments from Telegram yet. Try <code>pay $5 to @someone</code>.');
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
          : 'Who should get it? Try <code>pay $5 to @someone</code>.',
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

    const isDevnet = isSolanaDevnetFromConfig(this.config);
    const plan = await this.autopay.planTelegramPayment(handle, parsed.isPrivate, isDevnet, parsed.amount);
    const needed = plan.totalUsd;

    // Fail early and plainly when the wallet can't cover it, instead of after a Confirm tap.
    try {
      const { balanceUSD } = await this.users.getSolanaWalletBalanceAndAddress(userId);
      if (balanceUSD + 1e-9 < needed) {
        return void (await reply(
          `Your balance is ${money(balanceUSD)}, which is not enough for this payment (${money(needed)} with fees). Use /fund to add money.`,
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

    const { data: action, error } = await this.db
      .getClient()
      .from('telegram_bot_actions')
      .insert({
        telegram_user_id: from.id,
        privy_user_id: userId,
        chat_id: chatId,
        recipient_handle: handle,
        amount_usd: parsed.amount,
        is_private: parsed.isPrivate,
        private_split: parsed.isPrivate ? parsed.split : null,
        private_max_delay_ms: parsed.isPrivate ? parsed.delayMs : null,
        expires_at: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
      })
      .select('id')
      .single();
    if (error || !action) {
      this.logger.error(`Failed to create telegram action: ${error?.message}`);
      return void (await reply('Something went wrong, please try again.'));
    }

    const card = this.renderCard(
      {
        id: action.id,
        recipient_handle: handle,
        amount_usd: parsed.amount,
        is_private: parsed.isPrivate,
        private_split: parsed.isPrivate ? parsed.split : null,
        private_max_delay_ms: parsed.isPrivate ? parsed.delayMs : null,
      },
      plan,
    );
    await reply(card.text, card.keyboard);
  }

  /**
   * The Confirm card. For a private payment it carries the privacy options as buttons (delay and
   * split), so they can be changed with a tap; typing the command again with "delay 30m split 4"
   * works too. The selected option is shown in [brackets].
   */
  private renderCard(
    a: {
      id: string;
      recipient_handle: string;
      amount_usd: number;
      is_private: boolean;
      private_split: number | null;
      private_max_delay_ms: number | string | null;
    },
    plan: TelegramPaymentPlan,
  ): { text: string; keyboard: InlineKeyboard } {
    const handle = escapeHtml(a.recipient_handle);
    const amount = Number(a.amount_usd);
    const delayMs = a.private_max_delay_ms != null ? Number(a.private_max_delay_ms) : null;
    const lines: string[] = [];
    const rows: InlineButton[][] = [];

    if (a.is_private) {
      const delayLabel = delayMs ? this.formatDelay(delayMs) : '10 minutes (default)';
      lines.push(`Send <b>${money(amount)}</b> USDC <b>privately</b> to <b>@${handle}</b>?`);
      lines.push('');
      lines.push(`<b>Delay:</b> up to ${delayLabel}`);
      lines.push('How long it can take to arrive. A longer delay is harder to trace.');
      lines.push('');
      lines.push(`<b>Split:</b> ${a.private_split ? `${a.private_split} parts` : 'random'}`);
      lines.push('How many smaller parts it is sent in. More parts is harder to trace.');
      lines.push('');
      lines.push('Tap a button to change them, or type it: <code>delay 30m split 4</code>.');
      const effDelayMin = Math.round((delayMs ?? DEFAULT_PRIVATE_DELAY_MS) / 60_000);
      rows.push(
        DELAY_CHOICES_MIN.map((m) => ({
          text: effDelayMin === m ? `[${this.formatDelayButton(m)}]` : this.formatDelayButton(m),
          callback_data: `dl:${a.id}:${m}`,
        })),
      );
      rows.push(
        SPLIT_CHOICES.map((n) => {
          const label = n === 'r' ? 'Random' : `${n} parts`;
          return {
            text: (a.private_split ?? 'r') === n ? `[${label}]` : label,
            callback_data: `sp:${a.id}:${n}`,
          };
        }),
      );
    } else {
      lines.push(`Send <b>${money(amount)}</b> USDC to <b>@${handle}</b>?`);
      lines.push(
        plan.delivery === 'instant'
          ? `@${handle} is on Loofta, so it arrives straight in their wallet.`
          : 'They get a claim link.',
      );
    }
    // Fees, always spelled out before the Confirm tap. "~" means approximate. The private fee is one
    // MagicBlock line (it includes the privacy API's own Loofta 10 bps); Loofta's separate 0.2% and the
    // $0.10 claim fee share the Loofta line.
    lines.push('');
    lines.push('<b>Fees</b>');
    if (a.is_private) lines.push(`Private payment fee: ~${feeMoney(plan.privateFeeUsd)} (MagicBlock)`);
    if (plan.claimFeeUsd > 0) {
      lines.push(
        `Loofta + Claim fee: ${feeMoney(plan.looftaFeeUsd)} (0.2%) + ${feeMoney(plan.claimFeeUsd)} (@${handle} is not on Loofta yet)`,
      );
    } else {
      lines.push(`Loofta: ${feeMoney(plan.looftaFeeUsd)} (0.2%)`);
    }
    lines.push(`<b>Total from your wallet: ${a.is_private ? '~' : ''}${money(plan.totalUsd)}</b>`);
    rows.push([
      { text: 'Confirm', callback_data: `ok:${a.id}` },
      { text: 'Cancel', callback_data: `no:${a.id}` },
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
        await this.api!.sendMessage(chatId, 'Type it like <code>pay $5 to @someone</code>.');
      }
      return;
    }

    if (kind === 'dl' || kind === 'sp') {
      await this.api!.answerCallback(cb.id);
      if (!arg || !val) return;
      const patch =
        kind === 'dl'
          ? { private_max_delay_ms: Number(val) * 60_000 }
          : { private_split: val === 'r' ? null : Number(val) };
      if (kind === 'dl' && !DELAY_CHOICES_MIN.includes(Number(val))) return;
      if (kind === 'sp' && val !== 'r' && !SPLIT_CHOICES.includes(Number(val))) return;
      const { data: row } = await this.db
        .getClient()
        .from('telegram_bot_actions')
        .update(patch)
        .eq('id', arg)
        .eq('telegram_user_id', cb.from.id)
        .eq('status', 'pending')
        .eq('is_private', true)
        .gt('expires_at', new Date().toISOString())
        .select('id, recipient_handle, amount_usd, is_private, private_split, private_max_delay_ms')
        .maybeSingle();
      if (!row) return;
      const plan = await this.autopay.planTelegramPayment(row.recipient_handle, true, isSolanaDevnetFromConfig(this.config), Number(row.amount_usd));
      const card = this.renderCard(row as any, plan);
      await this.api!.editMessage(chatId, messageId, card.text, card.keyboard);
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
      .select('id, privy_user_id, recipient_handle, amount_usd, is_private, private_split, private_max_delay_ms')
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

      const result = await this.autopay.executeTelegramAutoPay({
        senderUserId: userId,
        recipientHandle: handle,
        amountUsd: amount,
        isPrivate: !!claimed.is_private,
        isDevnet: isSolanaDevnetFromConfig(this.config),
        splitOverride: claimed.private_split ?? null,
        maxDelayMsOverride: claimed.private_max_delay_ms != null ? Number(claimed.private_max_delay_ms) : null,
      });
      await supabase
        .from('telegram_bot_actions')
        .update({ status: 'paid', payment_id: result.paymentId, claim_link: result.claimLink, paid_at: new Date().toISOString() })
        .eq('id', claimed.id);

      await this.api!.editMessage(chatId, messageId, claimed.is_private ? `Sent <b>${money(amount)}</b> privately to <b>@${escapeHtml(handle)}</b>. It lands after the delay.` : `Sent <b>${money(amount)}</b> to <b>@${escapeHtml(handle)}</b>.`, {
        // The share page (/share/:short_id) is the sender's view of a payment; /c/ is the claim page.
        inline_keyboard: [[{ text: 'View payment', url: result.shortId ? `${this.appUrl}/share/${result.shortId}` : result.claimLink }]],
      });
      await this.notifyRecipient(handle, cb.from, amount, result.claimLink, !!claimed.is_private);
    } catch (e) {
      const insufficient = /insufficient funds/i.test((e as Error).message);
      const userFacing = e instanceof BadRequestException
        ? e.message
        : insufficient
          ? 'Your wallet does not have enough USDC for this payment. Use /fund to add money, then try again.'
          : 'Something went wrong, so nothing was sent. Please try again.';
      this.logger.error(`Telegram payment ${claimed.id} failed: ${(e as Error).message}`);
      await supabase
        .from('telegram_bot_actions')
        .update({ status: 'failed', error: (e as Error).message.slice(0, 500) })
        .eq('id', claimed.id);
      await this.api!.editMessage(chatId, messageId, escapeHtml(userFacing));
    }
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
