import { randomUUID } from 'crypto';
import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrivyClient } from '@privy-io/server-auth';
import { SupabaseService } from '@/database/supabase.service';
import { isSolanaDevnetFromConfig } from '@/common/solana-cluster-env';
import { UsersService } from '../users/users.service';
import { TwitterAutopayService, UncertainPaymentError, RECLAIM_FEE_USD, type TelegramPaymentPlan } from '../twitter-autopay/twitter-autopay.service';
import { TelegramApi, InlineKeyboard, InlineButton, escapeHtml } from './telegram-api';
import { parseSendCommand, nextStep, type NextStep, DEFAULT_PRIVATE_DELAY_MS } from './telegram-parser';
import { IntentLlmService, intentToSentence } from './intent-llm';
import { TelegramWalletService } from './telegram-wallet.service';
import { WalletDraft, WalletToken, withdrawAmountRows, validateAddress, POPULAR_TOKENS, parseTokenQuery, chainLabel, shortAddress, formatTokenAmount } from './wallet-flow';
import { SEND_AMOUNTS, SendDraft, distinctRecents, recipientKeyboard, parseRecipientText, amountCard, commandForAmount, readyKeyboard, readyAction } from './send-flow';

interface TgUser { id: number; is_bot?: boolean; username?: string; first_name?: string }
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
  text?: string;
  reply_to_message?: { from?: TgUser; text?: string };
  /** Set when the person picked someone with the "Choose from Telegram" button. */
  users_shared?: { request_id: number; users: Array<{ user_id: number; username?: string; first_name?: string }> };
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
  /** Where the bot sends people to sign in / turn on auto-pay. The `from=telegram` flag tells
   *  that page to offer Telegram as the only login method, so the account the bot finds is the
   *  one they actually linked. */
  private readonly autoPayUrl: string;
  /** The docs page for the bot, on the marketing site. */
  private readonly guideUrl: string;

  constructor(
    private readonly db: SupabaseService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly autopay: TwitterAutopayService,
    private readonly llm: IntentLlmService,
    private readonly wallet: TelegramWalletService,
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
    this.autoPayUrl = `${this.appUrl}/app/auto-pay?from=telegram`;
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
        { command: 'send', description: 'Send money with a few taps' },
        { command: 'fund', description: 'Add money to your wallet' },
        { command: 'withdraw', description: 'Withdraw your money' },
        { command: 'pay', description: 'Pay someone, for example /pay 5 @someone' },
        { command: 'payprivately', description: 'Pay privately, for example /payprivately 5 @someone' },
        { command: 'history', description: 'Your recent payments' },
        { command: 'settings', description: 'Auto-pay limits and terms' },
        { command: 'logout', description: 'Sign out of the bot' },
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
      else if (update.message?.users_shared) await this.onUsersShared(update.message);
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

    if (isPrivate) this.touchNudge(msg.chat.id);
    // The always-visible buttons at the bottom send their label as a message.
    if (isPrivate && !command) {
      const action = readyAction(text);
      if (action) {
        this.forgetDraft(`${msg.chat.id}:${from.id}`);
        return action === 'send' ? this.startSend(msg.chat.id, from) : this.showBalance(msg.chat.id, from);
      }
    }

    // A pasted address or typed amount for a withdraw or deposit that is waiting for one.
    if (isPrivate && !command) {
      const wd = this.getWalletDraft(`${msg.chat.id}:${from.id}`);
      if (wd && (await this.onWalletText(msg, from, text, wd))) return;
    }

    // Guided /send: a bare /send starts it; while it waits for a recipient, a typed or tapped @name is that recipient.
    const draftKey = `${msg.chat.id}:${from.id}`;
    if (name === 'send' && !/\S/.test(text.replace(/^\/\S+/, ''))) {
      return this.privateOnly(msg, isPrivate, () => this.startSend(msg.chat.id, from));
    }
    const draft = isPrivate ? this.getDraft(draftKey) : null;
    if (draft?.awaiting === 'recipient' && !command) {
      const handle = parseRecipientText(text);
      if (!handle) {
        // A whole payment sentence typed instead: drop the guided flow and read it as usual.
        if (!/^(pay|send)/i.test(text)) {
          return void (await this.api!.sendMessage(msg.chat.id, 'Send an @username, or tap Choose from Telegram.', { replyTo: msg.message_id }));
        }
        this.forgetDraft(draftKey);
      } else {
        return this.chooseRecipient(msg.chat.id, from, handle);
      }
    }

    // /start is short on purpose: just the two things to try. The whole guide is behind /help.
    if (name === 'start' || name === 'help') return this.sendIntro(msg.chat.id, isPrivate, name === 'help');
    if (name === 'balance') return this.privateOnly(msg, isPrivate, () => this.showBalance(msg.chat.id, from));
    if (name === 'fund') return this.privateOnly(msg, isPrivate, () => this.showFund(msg.chat.id, from));
    if (name === 'withdraw') return this.privateOnly(msg, isPrivate, () => this.showWithdraw(msg.chat.id, from));
    if (name === 'history') return this.privateOnly(msg, isPrivate, () => this.showHistory(msg.chat.id, from));
    if (name === 'settings') return this.privateOnly(msg, isPrivate, () => this.showSettings(msg.chat.id, from));
    if (name === 'logout') return this.privateOnly(msg, isPrivate, () => this.logout(msg.chat.id, from));

    if (name === 'cancel') {
      this.forgetPrompt(`${msg.chat.id}:${from.id}`);
      this.forgetDraft(`${msg.chat.id}:${from.id}`);
      return void (await this.api!.sendMessage(msg.chat.id, 'Cancelled.', { replyTo: msg.message_id }));
    }

    // Payments, whole or in pieces. A phone sends a bare "/pay" when a suggestion is tapped, and people
    // type half a payment ("@someone", "5"). The bot keeps what it understood, asks only for what is
    // missing, and builds the full command from the answers.
    const key = `${msg.chat.id}:${from.id}`;
    const replied = msg.reply_to_message;
    const repliedToBot = replied?.from?.username?.toLowerCase() === this.botUsername.toLowerCase();
    const promptText = repliedToBot && replied?.text ? replied.text : isPrivate ? this.recallPrompt(key) : null;
    const replyTarget = replied && !replied.from?.is_bot ? replied.from?.username?.toLowerCase() ?? null : null;

    let step: NextStep = nextStep({ text, botUsername: this.botUsername, promptText, replyTarget, isPrivateChat: isPrivate });
    // Natural wording the plain reader cannot follow ("send five bucks to @someone"): ask the model to
    // rephrase it. It only describes the request; the answer is rebuilt into a normal sentence and
    // checked like anything typed by hand.
    if (step.kind !== 'run' && this.llm.enabled && this.worthAskingModel(text, name)) {
      const smart = await this.smartStep(text, from.id, promptText, replyTarget, isPrivate);
      if (smart) step = smart;
    }

    if (step.kind === 'ask') {
      if (isPrivate) this.rememberPrompt(key, step.plain);
      return void (await this.api!.sendMessage(msg.chat.id, step.prompt, { replyTo: msg.message_id, forceReply: step.placeholder }));
    }
    if (step.kind === 'run') {
      this.forgetPrompt(key);
      const parsed = parseSendCommand(step.command, this.botUsername);
      if (parsed) return this.onSend(msg, from, parsed);
    }

    if (isPrivate || text.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`)) {
      await this.api!.sendMessage(
        msg.chat.id,
        'I did not catch that. Try <code>pay $5 to @someone</code>, or just send <code>/pay</code> and I will ask.',
        { replyTo: msg.message_id },
      );
    }
  }

  /** Only sentences with some wording to them are worth a model call; bare fragments are handled above. */
  private worthAskingModel(text: string, commandName?: string): boolean {
    if (commandName && !['pay', 'payprivately', 'send', 'sendprivately'].includes(commandName)) return false;
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length >= 3 && text.length <= 400;
  }

  private async smartStep(text: string, userId: number, promptText: string | null, replyTarget: string | null, isPrivateChat: boolean): Promise<NextStep | null> {
    const intent = await this.llm.interpret(text, userId, promptText);
    if (!intent) return null;
    const sentence = intentToSentence(intent, text);
    if (!sentence) return null;
    const step = nextStep({ text: sentence, botUsername: this.botUsername, promptText, replyTarget, isPrivateChat });
    return step.kind === 'none' ? null : step;
  }

  // The last question asked in a private chat, so the next plain message is read as its answer
  // (in a group the answer is a reply to the question, which carries the same text).
  private readonly prompts = new Map<string, { text: string; expires: number }>();
  private rememberPrompt(key: string, text: string) {
    this.prompts.set(key, { text, expires: Date.now() + 10 * 60 * 1000 });
    if (this.prompts.size > 2000) for (const [k, v] of this.prompts) if (v.expires < Date.now()) this.prompts.delete(k);
  }
  private recallPrompt(key: string): string | null {
    const p = this.prompts.get(key);
    if (!p || p.expires < Date.now()) { this.prompts.delete(key); return null; }
    return p.text;
  }
  private forgetPrompt(key: string) {
    this.prompts.delete(key);
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
        [{ text: 'Send', callback_data: 'menu:send' }, { text: 'Balance', callback_data: 'menu:balance' }],
        [{ text: 'Fund', callback_data: 'menu:fund' }, { text: 'Withdraw', callback_data: 'menu:withdraw' }],
        [{ text: 'History', callback_data: 'menu:history' }],
        [{ text: 'Settings', callback_data: 'menu:settings' }, { text: 'Log out', callback_data: 'menu:logout' }],
      ],
    };
  }

  /** /start (short) and /help (the whole guide). In a group both give the one-line version. */
  private async sendIntro(chatId: number, isPrivate: boolean, full: boolean) {
    if (!isPrivate) {
      await this.api!.sendMessage(
        chatId,
        'Reply to someone with <code>/pay 5</code>, or type <code>/pay 5 @someone</code>. Add the word <code>privately</code> for a private payment. Message me directly to set up and fund your wallet.',
        { keyboard: { inline_keyboard: [[{ text: 'Open chat', url: `https://t.me/${this.botUsername}` }]] } },
      );
      return;
    }
    if (!full) {
      // Just the two things to try. Everything else is in /help.
      await this.api!.sendMessage(
        chatId,
        [
          '<b>Loofta Pay</b>',
          'Pay anyone on Telegram in USDC.',
          '',
          '<code>pay $5 to @someone</code>',
          '<code>pay $5 privately to @someone</code>',
        ].join('\n'),
        {
          keyboard: {
            inline_keyboard: [
              [{ text: 'Send', callback_data: 'menu:send' }, { text: 'Help', callback_data: 'menu:help' }],
            ],
          },
        },
      );
      await this.showReady(chatId, 'Send is one tap away.');
      return;
    }
    // The guide: what the bot can do, with a copyable example for each.
    const text = [
          '<b>Loofta Pay help</b>',
          'Pay anyone on Telegram in USDC, right from this chat.',
          '',
          '<b>Get started</b>',
          '1. Sign in to Loofta with Telegram and turn on auto-pay.',
          '2. Add money with /fund.',
          '3. Pay with a message. Examples below.',
          '',
          '<b>What you can do</b>',
          '<b>Send with taps</b>: /send, then pick who and how much',
          '',
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
          '<b>Add or withdraw money</b>',
          '/fund shows your address, or a private deposit, or lets you add other crypto.',
          '/withdraw sends USDC to any Solana wallet, or other crypto to another network. You see what you receive before you confirm.',
          '',
          '<b>Commands</b>: /send /balance /fund /withdraw /history /settings /logout /help',
          '',
          'Need a hand? Talk to us: t.me/looftapay',
        ].join('\n');
    await this.api!.sendMessage(chatId, text, {
      keyboard: {
        inline_keyboard: [
          [{ text: 'Set up auto-pay', url: `${this.autoPayUrl}` }],
          [{ text: 'Read the full guide', url: this.guideUrl }, { text: 'Support', url: 'https://t.me/looftapay' }],
          ...this.mainMenu().inline_keyboard,
        ],
      },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Identity

  /**
   * Telegram user id -> Loofta (Privy) user id, via the Telegram account linked in Privy.
   *
   * A local sign-out (from /logout, only when Privy refused to unlink the user's only login
   * method) wins over the Privy link: the user asked to be signed out, so the bot stops acting
   * for them until they sign back in on /app/auto-pay (see reconnect()).
   */
  private async resolveLinkedUser(telegramUserId: number): Promise<string | null> {
    const { data: local } = await this.db
      .getClient()
      .from('telegram_bot_users')
      .select('signed_out_at')
      .eq('telegram_user_id', telegramUserId)
      .maybeSingle();
    if (local?.signed_out_at) return null;

    if (!this.privy) return null;
    try {
      const user = await this.privy.getUserByTelegramUserId(String(telegramUserId));
      return user?.id ?? null;
    } catch (e) {
      this.logger.warn(`Privy telegram lookup failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** The Telegram user id linked to a Loofta (Privy) user, if any. Inverse of resolveLinkedUser. */
  private async findTelegramUserId(userId: string): Promise<string | null> {
    if (!this.privy) return null;
    try {
      const user = await this.privy.getUserById(userId);
      const tg = (user?.linkedAccounts ?? []).find((a) => a.type === 'telegram') as
        | { telegramUserId?: string }
        | undefined;
      return tg?.telegramUserId ?? null;
    } catch (e) {
      this.logger.warn(`Privy user lookup failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Called by the app once a user signs in / connects Telegram on /app/auto-pay. Clears a local
   * sign-out left by /logout so the bot recognizes them again. A no-op for anyone who never
   * signed out (the row simply does not have signed_out_at set).
   */
  async reconnect(userId: string): Promise<{ ok: boolean; telegramLinked: boolean }> {
    const telegramUserId = await this.findTelegramUserId(userId);
    if (!telegramUserId) return { ok: false, telegramLinked: false };
    const { error } = await this.db
      .getClient()
      .from('telegram_bot_users')
      .update({ signed_out_at: null })
      .eq('telegram_user_id', Number(telegramUserId));
    if (error) this.logger.warn(`reconnect clear failed: ${error.message}`);
    return { ok: !error, telegramLinked: true };
  }

  /**
   * Unlink the Telegram account from the Loofta (Privy) user, server-side. Returns false when
   * Privy refuses — e.g. Telegram is the user's only remaining login method.
   */
  private async privyUnlinkTelegram(userId: string, telegramUserId: string): Promise<boolean> {
    const appId = this.config.get<string>('PRIVY_APP_ID');
    const appSecret = this.config.get<string>('PRIVY_APP_SECRET');
    if (!appId || !appSecret) return false;
    try {
      const res = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/users/unlink`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'privy-app-id': appId,
          Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`,
        },
        body: JSON.stringify({ user_id: userId, type: 'telegram', handle: telegramUserId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`Privy telegram unlink failed (${res.status}): ${body.slice(0, 300)}`);
      }
      return res.ok;
    } catch (e) {
      this.logger.warn(`Privy telegram unlink error: ${(e as Error).message}`);
      return false;
    }
  }

  private signInKeyboard(label: string): InlineKeyboard {
    return { inline_keyboard: [[{ text: label, url: `${this.autoPayUrl}` }]] };
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

  // ---------------------------------------------------------------------------------------------
  // Guided /send

  private readonly drafts = new Map<string, SendDraft>();
  private getDraft(key: string): SendDraft | null {
    const d = this.drafts.get(key);
    if (!d || d.expires < Date.now()) { this.drafts.delete(key); return null; }
    return d;
  }
  private setDraft(key: string, d: Omit<SendDraft, 'expires'>) {
    this.drafts.set(key, { ...d, expires: Date.now() + 10 * 60 * 1000 });
    if (this.drafts.size > 2000) for (const [k, v] of this.drafts) if (v.expires < Date.now()) this.drafts.delete(k);
  }
  private forgetDraft(key: string) {
    this.drafts.delete(key);
  }

  /** Step 1: who. Telegram's own people picker, the people paid before, or a typed @name. */
  private async startSend(chatId: number, from: TgUser) {
    const userId = await this.resolveLinkedUser(from.id);
    if (!userId) {
      return void (await this.api!.sendMessage(chatId, 'Sign in to Loofta with Telegram first, then you can send money.', { keyboard: this.signInKeyboard('Sign in to Loofta') }));
    }
    const payer = await this.autopay.resolvePayerByUserId(userId);
    if (!payer?.signerGranted) {
      return void (await this.api!.sendMessage(chatId, 'Turn on auto-pay first, then I can send from your wallet.', { keyboard: this.signInKeyboard('Turn on auto-pay') }));
    }
    const { data } = await this.db
      .getClient()
      .from('telegram_bot_actions')
      .select('recipient_handle, created_at')
      .eq('telegram_user_id', from.id)
      .in('status', ['paid', 'processing'])
      .order('created_at', { ascending: false })
      .limit(30);
    const recents = distinctRecents(data ?? [], 4, from.username);
    this.setDraft(`${chatId}:${from.id}`, { isPrivate: true, awaiting: 'recipient', balanceUsd: await this.balanceOf(userId) });
    await this.api!.sendMessage(chatId, '<b>Who do you want to pay?</b>\nPick someone from Telegram, or type their @username.', {
      replyKeyboard: recipientKeyboard(recents),
    });
  }

  /** The person picked someone with the "Choose from Telegram" button. */
  private async onUsersShared(msg: TgMessage) {
    const from = msg.from;
    if (!from || from.is_bot || msg.chat.type !== 'private') return;
    const shared = msg.users_shared?.users?.[0];
    if (!shared) return;
    let handle = shared.username?.toLowerCase();
    if (!handle) {
      // No public username shared: a person already on Loofta may have one linked.
      handle = (await this.telegramUsernameOf(shared.user_id)) ?? undefined;
    }
    if (!handle) {
      return void (await this.api!.sendMessage(msg.chat.id, 'That person has no Telegram username, so I cannot pay them yet. They can set one in Telegram settings, or pick someone else.'));
    }
    return this.chooseRecipient(msg.chat.id, from, handle);
  }

  private async telegramUsernameOf(telegramUserId: number): Promise<string | null> {
    if (!this.privy) return null;
    try {
      const user: any = await this.privy.getUserByTelegramUserId(String(telegramUserId));
      const tg = (user?.linkedAccounts ?? []).find((a: any) => a?.type === 'telegram');
      return tg?.username ? String(tg.username).toLowerCase() : null;
    } catch {
      return null;
    }
  }

  /** Step 2: how much. Privacy on by default, five amounts, or custom. */
  private async chooseRecipient(chatId: number, from: TgUser, handle: string) {
    if (handle === from.username?.toLowerCase()) return void (await this.api!.sendMessage(chatId, 'You cannot pay yourself. Pick someone else.'));
    if (handle === this.botUsername.toLowerCase()) return void (await this.api!.sendMessage(chatId, 'I would love to keep it, but no. Pick someone else.'));
    const key = `${chatId}:${from.id}`;
    const existing = this.getDraft(key);
    const isPrivate = existing?.isPrivate ?? true;
    const balanceUsd = existing?.balanceUsd ?? (await this.balanceOf(await this.resolveLinkedUser(from.id)));
    this.setDraft(key, { handle, isPrivate, awaiting: 'amount', balanceUsd });
    const card = amountCard(handle, isPrivate, balanceUsd);
    await this.api!.sendMessage(chatId, card.text, { keyboard: card.keyboard });
  }

  private async onSendCallback(cb: TgCallback, arg?: string, val?: string) {
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    await this.api!.answerCallback(cb.id);
    if (!chatId || !messageId) return;
    const key = `${chatId}:${cb.from.id}`;
    const draft = this.getDraft(key);
    if (!draft || !draft.handle) {
      return void (await this.api!.editMessage(chatId, messageId, 'This has expired. Send /send to start again.'));
    }
    if (arg === 'cancel') {
      this.forgetDraft(key);
      return void (await this.api!.editMessage(chatId, messageId, 'Cancelled.'));
    }
    if (arg === 'priv') {
      this.setDraft(key, { ...draft, isPrivate: val === '1' });
      const card = amountCard(draft.handle, val === '1', draft.balanceUsd);
      return void (await this.api!.editMessage(chatId, messageId, card.text, card.keyboard));
    }
    if (arg === 'change') {
      this.forgetDraft(key);
      return this.startSend(chatId, cb.from);
    }
    if (arg === 'custom') {
      this.forgetDraft(key);
      const step = nextStep({ text: `${draft.isPrivate ? 'payprivately' : 'pay'} @${draft.handle}`, botUsername: this.botUsername, isPrivateChat: true });
      if (step.kind === 'ask') {
        this.rememberPrompt(key, step.plain);
        await this.api!.editMessage(chatId, messageId, `Pay <b>@${escapeHtml(draft.handle)}</b>`);
        return void (await this.api!.sendMessage(chatId, step.prompt, { forceReply: step.placeholder }));
      }
      return;
    }
    if (arg === 'amt') {
      const amount = Number(val);
      if (!SEND_AMOUNTS.includes(amount)) return;
      const parsed = parseSendCommand(commandForAmount(draft.handle, draft.isPrivate, amount), this.botUsername);
      this.forgetDraft(key);
      await this.api!.editMessage(chatId, messageId, `Pay <b>@${escapeHtml(draft.handle)}</b>: <b>${money(amount)}</b>${draft.isPrivate ? ' privately' : ''}`);
      return this.onSend({ message_id: messageId, chat: { id: chatId, type: 'private' } }, cb.from, parsed);
    }
  }

  /** The wallet balance in USD, or null when it cannot be read (a card then simply leaves the line out). */
  private async balanceOf(userId: string | null | undefined): Promise<number | null> {
    if (!userId) return null;
    try {
      return (await this.users.getSolanaWalletBalanceAndAddress(userId)).balanceUSD;
    } catch (e) {
      this.logger.warn(`Balance lookup failed: ${(e as Error).message}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Deposit (/fund) and withdraw (/withdraw), without leaving Telegram. Solana first.

  private readonly walletDrafts = new Map<string, WalletDraft>();
  private getWalletDraft(key: string): WalletDraft | null {
    const d = this.walletDrafts.get(key);
    if (!d || d.expires < Date.now()) { this.walletDrafts.delete(key); return null; }
    return d;
  }
  private setWalletDraft(key: string, d: Omit<WalletDraft, 'expires'>) {
    this.walletDrafts.set(key, { ...d, expires: Date.now() + 10 * 60 * 1000 });
    if (this.walletDrafts.size > 2000) for (const [k, v] of this.walletDrafts) if (v.expires < Date.now()) this.walletDrafts.delete(k);
  }
  private forgetWalletDraft(key: string) {
    this.walletDrafts.delete(key);
  }

  /** The person's Loofta user, or a prompt to sign in. Used by every wallet action. */
  private async linkedUserOrPrompt(chatId: number, from: TgUser, why: string): Promise<string | null> {
    const userId = await this.resolveLinkedUser(from.id);
    if (!userId) {
      await this.api!.sendMessage(chatId, `Sign in to Loofta with Telegram first, then ${why}.`, { keyboard: this.signInKeyboard('Sign in to Loofta') });
      return null;
    }
    return userId;
  }

  private async showFund(chatId: number, from: TgUser) {
    const userId = await this.linkedUserOrPrompt(chatId, from, 'I can show where to add money');
    if (!userId) return;
    const address = await this.users.getSolanaWalletAddress(userId);
    await this.api!.sendMessage(
      chatId,
      [
        'Send <b>USDC on Solana</b> to your Loofta wallet:',
        `<code>${escapeHtml(address)}</code>`,
        '',
        'Want it more private, or to add from another network? Pick below.',
      ].join('\n'),
      {
        keyboard: {
          inline_keyboard: [
            [{ text: 'Private deposit', callback_data: 'dp:priv' }, { text: 'Other crypto', callback_data: 'dp:other' }],
            [{ text: 'Card and more options', url: `${this.appUrl}/app?deposit=1` }],
          ],
        },
      },
    );
  }

  private async onDepositCallback(cb: TgCallback, arg?: string, val?: string) {
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    await this.api!.answerCallback(cb.id);
    if (!chatId || !messageId || cb.message?.chat.type !== 'private') return;
    const key = `${chatId}:${cb.from.id}`;
    if (arg === 'cancel') {
      this.forgetWalletDraft(key);
      return void (await this.api!.editMessage(chatId, messageId, 'Cancelled.'));
    }
    if (arg === 'other') return this.askToken(chatId, 'dp', messageId);
    if (arg === 'tokany') return this.askTokenTyped(chatId, cb.from, 'deposit');
    if (arg === 'tok') return this.pickPopular(chatId, cb.from, 'deposit', Number(val));
    if (arg === 'opt') return this.pickOption(chatId, cb.from, 'deposit', Number(val));
    if (arg === 'priv') {
      this.setWalletDraft(key, { flow: 'deposit', step: 'amount' });
      return void (await this.api!.editMessage(
        chatId,
        messageId,
        '<b>Private deposit</b>\nHow much USDC do you want to receive in your wallet? I will give you a one-time address to send to, and it reaches your wallet privately.',
        {
          inline_keyboard: [
            [25, 50, 100, 200].map((a) => ({ text: `$${a}`, callback_data: `dp:amt:${a}` })),
            [{ text: 'Custom amount', callback_data: 'dp:custom' }, { text: 'Cancel', callback_data: 'dp:cancel' }],
          ],
        },
      ));
    }
    if (arg === 'custom') {
      this.setWalletDraft(key, { flow: 'deposit', step: 'custom' });
      return void (await this.api!.sendMessage(chatId, 'How much USDC do you want to receive? Send an amount, for example 75. Minimum $1.', { forceReply: 'Amount in dollars' }));
    }
    if (arg === 'amt') return this.startPrivateDeposit(chatId, cb.from, Number(val), messageId);
  }

  private async startPrivateDeposit(chatId: number, from: TgUser, amount: number, editMessageId?: number) {
    this.forgetWalletDraft(`${chatId}:${from.id}`);
    if (!(amount >= 1 && amount <= 2000)) {
      return void (await this.api!.sendMessage(chatId, 'Private deposits are $1 to $2,000. Send /fund to try again.'));
    }
    const userId = await this.linkedUserOrPrompt(chatId, from, 'I can set up a private deposit');
    if (!userId) return;
    try {
      const d = await this.wallet.startPrivateDeposit(userId, Math.round(amount * 100) / 100);
      const text = [
        '<b>Private deposit</b>',
        `Send exactly <b>${money(d.amountToSendUsdc)} USDC on Solana</b> to this one-time address:`,
        `<code>${escapeHtml(d.depositAddress)}</code>`,
        '',
        `You receive <b>${money(amount)}</b> in your wallet, privately, within a few minutes. Fee: about ${money(d.feeEstimateUsdc)}.`,
        'Use this address once, and only for USDC on Solana.',
      ].join('\n');
      if (editMessageId) await this.api!.editMessage(chatId, editMessageId, text);
      else await this.api!.sendMessage(chatId, text);
    } catch (e) {
      this.logger.warn(`Private deposit failed: ${(e as Error).message}`);
      await this.api!.sendMessage(chatId, 'I could not set up a private deposit just now. Please try again in a moment.');
    }
  }

  // ----- Withdraw

  private async showWithdraw(chatId: number, from: TgUser) {
    const userId = await this.resolveLinkedUser(from.id);
    const payer = userId ? await this.autopay.resolvePayerByUserId(userId) : null;
    const appRow = [{ text: 'Bank or cash (in the app)', url: `${this.appUrl}/app?withdraw=1` }];
    if (!userId || !payer?.signerGranted) {
      // Not set up to act from the chat: the app's withdraw still works for anyone.
      return void (await this.api!.sendMessage(chatId, 'Withdraw your USDC to a wallet, a bank or a cash app. To withdraw from this chat, turn on auto-pay first.', {
        keyboard: { inline_keyboard: [[{ text: 'Withdraw in the app', url: `${this.appUrl}/app?withdraw=1` }], [{ text: 'Turn on auto-pay', url: this.autoPayUrl }]] },
      }));
    }
    const balance = await this.balanceOf(userId);
    await this.api!.sendMessage(
      chatId,
      ['<b>Withdraw</b>', balance != null ? `Your balance: <b>${money(balance)}</b>` : '', 'Where do you want to send it?'].filter(Boolean).join('\n'),
      { keyboard: { inline_keyboard: [[{ text: 'USDC on Solana', callback_data: 'wd:sol' }], [{ text: 'Other crypto', callback_data: 'wd:other' }], appRow] } },
    );
  }

  private async onWithdrawCallback(cb: TgCallback, arg?: string, val?: string) {
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    await this.api!.answerCallback(cb.id);
    if (!chatId || !messageId || cb.message?.chat.type !== 'private') return;
    const key = `${chatId}:${cb.from.id}`;
    if (arg === 'cancel') {
      this.forgetWalletDraft(key);
      return void (await this.api!.editMessage(chatId, messageId, 'Cancelled.'));
    }
    if (arg === 'other') return this.askToken(chatId, 'wd', messageId);
    if (arg === 'tokany') return this.askTokenTyped(chatId, cb.from, 'withdraw');
    if (arg === 'tok') return this.pickPopular(chatId, cb.from, 'withdraw', Number(val));
    if (arg === 'opt') return this.pickOption(chatId, cb.from, 'withdraw', Number(val));
    if (arg === 'sol') {
      const userId = await this.linkedUserOrPrompt(chatId, cb.from, 'you can withdraw');
      if (!userId) return;
      this.setWalletDraft(key, { flow: 'withdraw', step: 'address', balanceUsd: await this.balanceOf(userId) });
      return void (await this.api!.sendMessage(chatId, 'Paste the <b>Solana wallet address</b> to send your USDC to.', { forceReply: 'Solana wallet address' }));
    }
    const draft = this.getWalletDraft(key);
    if (!draft || draft.flow !== 'withdraw' || !draft.destination) {
      return void (await this.api!.editMessage(chatId, messageId, 'This has expired. Send /withdraw to start again.'));
    }
    if (arg === 'custom') {
      this.setWalletDraft(key, { ...draft, step: 'custom' });
      return void (await this.api!.sendMessage(chatId, 'How much USDC do you want to withdraw? Send an amount, for example 40.', { forceReply: 'Amount in dollars' }));
    }
    if (arg === 'amt') {
      const balance = draft.balanceUsd ?? 0;
      const amount = val === 'max' ? Math.floor(balance * 100) / 100 : Number(val);
      return this.proposeWithdrawal(chatId, cb.from, draft, amount, messageId);
    }
  }

  // ----- Other crypto (NEAR Intents)

  private askToken(chatId: number, prefix: 'dp' | 'wd', editMessageId?: number) {
    const rows: Array<Array<{ text: string; callback_data: string }>> = [];
    for (let i = 0; i < POPULAR_TOKENS.length; i += 2) {
      rows.push(POPULAR_TOKENS.slice(i, i + 2).map((t, j) => ({ text: t.label, callback_data: `${prefix}:tok:${i + j}` })));
    }
    rows.push([{ text: 'Another token', callback_data: `${prefix}:tokany` }]);
    rows.push([{ text: 'Cancel', callback_data: `${prefix}:cancel` }]);
    const text = prefix === 'wd' ? '<b>Withdraw other crypto</b>\nWhich crypto do you want to receive?' : '<b>Add other crypto</b>\nWhich crypto are you sending?';
    return editMessageId ? this.api!.editMessage(chatId, editMessageId, text, { inline_keyboard: rows }) : this.api!.sendMessage(chatId, text, { keyboard: { inline_keyboard: rows } });
  }

  private async askTokenTyped(chatId: number, from: TgUser, flow: 'withdraw' | 'deposit') {
    this.setWalletDraft(`${chatId}:${from.id}`, { flow, step: 'token', network: 'near' });
    await this.api!.sendMessage(chatId, 'Which crypto? Type the token and network, for example <code>ARB on Arbitrum</code> or <code>ETH</code>.', { forceReply: 'Token and network' });
  }

  private async pickPopular(chatId: number, from: TgUser, flow: 'withdraw' | 'deposit', idx: number) {
    const p = POPULAR_TOKENS[idx];
    if (!p) return;
    const r = await this.wallet.resolveToken(p.symbol, p.chains[0]);
    if (!r.token) return void (await this.api!.sendMessage(chatId, 'That one is not available right now. Pick another.'));
    return this.tokenChosen(chatId, from, flow, r.token);
  }

  private async pickOption(chatId: number, from: TgUser, flow: 'withdraw' | 'deposit', idx: number) {
    const opt = this.getWalletDraft(`${chatId}:${from.id}`)?.options?.[idx];
    if (!opt) return void (await this.api!.sendMessage(chatId, 'This has expired. Start again with /fund or /withdraw.'));
    return this.tokenChosen(chatId, from, flow, opt);
  }

  private async tokenChosen(chatId: number, from: TgUser, flow: 'withdraw' | 'deposit', token: WalletToken) {
    const userId = await this.linkedUserOrPrompt(chatId, from, flow === 'withdraw' ? 'you can withdraw' : 'I can set up a deposit');
    if (!userId) return;
    const balanceUsd = flow === 'withdraw' ? await this.balanceOf(userId) : null;
    this.setWalletDraft(`${chatId}:${from.id}`, { flow, step: 'address', network: 'near', token, balanceUsd });
    const where = `${token.symbol} on ${chainLabel(token.chain)}`;
    await this.api!.sendMessage(
      chatId,
      flow === 'withdraw'
        ? `Paste your <b>${escapeHtml(where)}</b> address to send to. Make sure it is on ${escapeHtml(chainLabel(token.chain))}, or the money can be lost.`
        : `Paste <b>your own ${escapeHtml(chainLabel(token.chain))} address</b>. It is only used to refund you if something goes wrong.`,
      { forceReply: `${chainLabel(token.chain)} address` },
    );
  }

  /** The person typed a token. */
  private async onTokenText(msg: TgMessage, from: TgUser, text: string, draft: WalletDraft): Promise<boolean> {
    const chatId = msg.chat.id;
    const q = parseTokenQuery(text);
    const r = q ? await this.wallet.resolveToken(q.symbol, q.chain) : {};
    const prefix = draft.flow === 'withdraw' ? 'wd' : 'dp';
    if (r.token) {
      await this.tokenChosen(chatId, from, draft.flow, r.token);
      return true;
    }
    if (r.options?.length) {
      this.setWalletDraft(`${chatId}:${from.id}`, { ...draft, options: r.options });
      await this.api!.sendMessage(chatId, `${escapeHtml(q!.symbol)} exists on more than one network. Which one?`, {
        keyboard: { inline_keyboard: [...r.options.map((t, i) => [{ text: `${t.symbol} on ${chainLabel(t.chain)}`, callback_data: `${prefix}:opt:${i}` }]), [{ text: 'Cancel', callback_data: `${prefix}:cancel` }]] },
      });
      return true;
    }
    await this.api!.sendMessage(chatId, 'I could not find that. Try the token and network, for example <code>USDT on Tron</code>.', { replyTo: msg.message_id });
    return true;
  }

  /** An address on another network, or a deposit amount, for the other-crypto flows. */
  private async onNearText(msg: TgMessage, from: TgUser, text: string, draft: WalletDraft): Promise<boolean> {
    const chatId = msg.chat.id;
    const key = `${chatId}:${from.id}`;
    const token = draft.token!;
    const userId = await this.linkedUserOrPrompt(chatId, from, draft.flow === 'withdraw' ? 'you can withdraw' : 'I can set up a deposit');
    if (!userId) return true;

    if (draft.step === 'address') {
      const address = text.trim();
      if (!validateAddress(address, token.chain)) {
        await this.api!.sendMessage(chatId, `That does not look like a ${escapeHtml(chainLabel(token.chain))} address. Paste it again.`, { replyTo: msg.message_id });
        return true;
      }
      if (draft.flow === 'withdraw') {
        const balance = draft.balanceUsd ?? (await this.balanceOf(userId));
        this.setWalletDraft(key, { ...draft, step: 'amount', destination: address, balanceUsd: balance });
        await this.api!.sendMessage(
          chatId,
          ['Withdraw to:', `<code>${escapeHtml(address)}</code>`, `on ${escapeHtml(chainLabel(token.chain))}`, balance != null ? `Your balance: <b>${money(balance)}</b>` : '', 'How much USDC do you want to convert?'].filter(Boolean).join('\n'),
          { keyboard: { inline_keyboard: withdrawAmountRows(balance ?? 0) } },
        );
      } else {
        this.setWalletDraft(key, { ...draft, step: 'amount', refundAddress: address });
        await this.api!.sendMessage(chatId, `How much <b>${escapeHtml(token.symbol)}</b> will you send? Send an amount, for example 0.5.`, { forceReply: `Amount of ${token.symbol}` });
      }
      return true;
    }

    // deposit amount
    const amount = Number(text.replace(/[,\s]/g, ''));
    if (!(amount > 0)) {
      await this.api!.sendMessage(chatId, 'Send an amount like 0.5 or 25.', { replyTo: msg.message_id });
      return true;
    }
    this.forgetWalletDraft(key);
    try {
      const q = await this.wallet.quoteDeposit({ userId, token, amountIn: amount, refundAddress: draft.refundAddress! });
      if ('error' in q) {
        await this.api!.sendMessage(chatId, `I could not get a quote: ${escapeHtml(String(q.error))}`);
        return true;
      }
      await this.api!.sendMessage(chatId, [
        `Send exactly <b>${escapeHtml(formatTokenAmount(amount))} ${escapeHtml(token.symbol)}</b> on <b>${escapeHtml(chainLabel(token.chain))}</b> to:`,
        `<code>${escapeHtml(q.depositAddress)}</code>`,
        q.memo ? `Memo (required): <code>${escapeHtml(q.memo)}</code>` : '',
        '',
        q.out != null ? `You receive about <b>${money(q.out)} USDC</b> on Solana, in your wallet.` : 'You receive USDC on Solana, in your wallet.',
        q.minAmountIn ? `Minimum: ${escapeHtml(String(q.minAmountIn))} ${escapeHtml(token.symbol)}.` : '',
        `Send only ${escapeHtml(token.symbol)} on ${escapeHtml(chainLabel(token.chain))}, and only once to this address. If something fails it refunds to ${escapeHtml(shortAddress(draft.refundAddress!))}.`,
      ].filter(Boolean).join('\n'));
    } catch (e) {
      this.logger.warn(`Deposit quote failed: ${(e as Error).message}`);
      await this.api!.sendMessage(chatId, 'I could not set that up just now. Please try again in a moment.');
    }
    return true;
  }

  /** Runs a confirmed withdrawal to a pasted Solana wallet, with the same lock, limits and "unconfirmed" rules as payments. */
  private async confirmWithdrawal(cb: TgCallback, chatId: number, messageId: number, batchId: string, row: { id: string; privy_user_id: string; amount_usd: number | string; kind?: string; destination_address?: string | null; destination_chain?: string | null; destination_token?: string | null; quote_out?: string | null }) {
    const supabase = this.db.getClient();
    const amount = Number(row.amount_usd);
    const destination = row.destination_address ?? '';
    try {
      const userId = await this.resolveLinkedUser(cb.from.id);
      if (!userId || userId !== row.privy_user_id) throw new BadRequestException('Your Telegram is no longer linked to this wallet.');
      const payer = await this.autopay.resolvePayerByUserId(userId);
      if (!payer?.signerGranted) throw new BadRequestException('Auto-pay is turned off.');
      await this.autopay.assertWithinLimits(payer, amount, { excludeTelegramBatchId: batchId, dailyTotalUsd: amount });
      if (row.kind === 'withdraw_near') return await this.finishNearWithdrawal(chatId, messageId, userId, row, amount, destination);

      // Checked again right before sending: the wallet could have changed since the card was shown.
      const check = await this.wallet.checkSolanaDestination(userId, destination);
      if (!check.ok) throw new BadRequestException(check.reason);

      const { signature } = await this.wallet.executeSolanaWithdrawal({ userId, destination, amountUsd: amount });
      await supabase.from('telegram_bot_actions').update({ status: 'paid', tx_signature: signature, paid_at: new Date().toISOString() }).eq('id', row.id);
      const after = await this.balanceOf(userId);
      await this.api!.editMessage(
        chatId,
        messageId,
        [`Withdrew <b>${money(amount)}</b> USDC to`, `<code>${escapeHtml(destination)}</code>`, after != null ? `Your balance: <b>${money(after)}</b>` : ''].filter(Boolean).join('\n'),
        { inline_keyboard: [[{ text: 'View on Solscan', url: `https://solscan.io/tx/${signature}` }]] },
      );
    } catch (e) {
      if (e instanceof UncertainPaymentError) {
        // It may have gone through: the row stays 'processing' (it still counts toward the limit and blocks an identical repeat).
        this.logger.error(`Withdrawal ${row.id} UNCONFIRMED (may have been sent): ${e.message}`);
        await supabase.from('telegram_bot_actions').update({ error: `unconfirmed: ${e.message}`.slice(0, 500), tx_signature: e.signature }).eq('id', row.id);
        return void (await this.api!.editMessage(
          chatId,
          messageId,
          `I could not confirm the withdrawal of <b>${money(amount)}</b>, so it may have gone through. Check your balance and /history before trying again.`,
          e.signature ? { inline_keyboard: [[{ text: 'Check on Solscan', url: `https://solscan.io/tx/${e.signature}` }]] } : undefined,
        ));
      }
      const insufficient = /insufficient funds/i.test((e as Error).message);
      const shown = e instanceof BadRequestException ? e.message : insufficient ? 'Not enough USDC in your wallet.' : 'Something went wrong, so nothing was sent.';
      this.logger.error(`Withdrawal ${row.id} failed: ${(e as Error).message}`);
      await supabase.from('telegram_bot_actions').update({ status: 'failed', error: (e as Error).message.slice(0, 500) }).eq('id', row.id);
      await this.api!.editMessage(chatId, messageId, escapeHtml(shown));
    }
  }

  /** The cross-chain leg: create the backend order, check the rate has not moved, then pay into it. */
  private async finishNearWithdrawal(chatId: number, messageId: number, userId: string, row: { id: string; destination_chain?: string | null; destination_token?: string | null; quote_out?: string | null }, amount: number, destination: string) {
    const supabase = this.db.getClient();
    const found = await this.wallet.resolveToken(row.destination_token ?? '', row.destination_chain ?? undefined);
    if (!found.token) throw new BadRequestException('That crypto is not available right now. Nothing was sent.');
    const token = found.token;
    const order = await this.wallet.createNearWithdrawal({ userId, token, amountUsd: amount, destination });
    const promised = Number(row.quote_out);
    if (order.out != null && promised > 0 && order.out < promised * 0.97) {
      throw new BadRequestException(`The rate moved: you would now receive about ${formatTokenAmount(order.out)} ${token.symbol}. Nothing was sent. Try again.`);
    }
    const { signature } = await this.wallet.payNearOrder({ userId, order, amountUsd: amount });
    await supabase.from('telegram_bot_actions').update({ status: 'paid', tx_signature: signature, order_id: order.id, paid_at: new Date().toISOString() }).eq('id', row.id);
    const after = await this.balanceOf(userId);
    await this.api!.editMessage(
      chatId,
      messageId,
      [
        `Withdrawing <b>${money(amount)}</b> USDC.`,
        `You receive about <b>${escapeHtml(formatTokenAmount(order.out ?? promised))} ${escapeHtml(token.symbol)}</b> on ${escapeHtml(chainLabel(token.chain))} at`,
        `<code>${escapeHtml(destination)}</code>`,
        'It usually arrives within a few minutes.',
        after != null ? `Your balance: <b>${money(after)}</b>` : '',
      ].filter(Boolean).join('\n'),
      { inline_keyboard: [[{ text: 'View on Solscan', url: `https://solscan.io/tx/${signature}` }]] },
    );
  }

  /** A pasted address, or a typed amount, while a deposit or withdraw is waiting for one. */
  private async onWalletText(msg: TgMessage, from: TgUser, text: string, draft: WalletDraft): Promise<boolean> {
    const chatId = msg.chat.id;
    const key = `${chatId}:${from.id}`;
    if (draft.step === 'token') return this.onTokenText(msg, from, text, draft);
    if (draft.network === 'near' && draft.token && (draft.step === 'address' || (draft.step === 'amount' && draft.flow === 'deposit'))) {
      return this.onNearText(msg, from, text, draft);
    }
    if (draft.flow === 'withdraw' && draft.step === 'address') {
      const userId = await this.linkedUserOrPrompt(chatId, from, 'you can withdraw');
      if (!userId) return true;
      const check = await this.wallet.checkSolanaDestination(userId, text);
      if (!check.ok) {
        await this.api!.sendMessage(chatId, escapeHtml(check.reason), { replyTo: msg.message_id });
        return true;
      }
      const destination = text.trim();
      const balance = draft.balanceUsd ?? (await this.balanceOf(userId));
      this.setWalletDraft(key, { flow: 'withdraw', step: 'amount', destination, balanceUsd: balance });
      await this.api!.sendMessage(
        chatId,
        [`Withdraw to:`, `<code>${escapeHtml(destination)}</code>`, balance != null ? `Your balance: <b>${money(balance)}</b>` : '', 'How much?'].filter(Boolean).join('\n'),
        { keyboard: { inline_keyboard: withdrawAmountRows(balance ?? 0) } },
      );
      return true;
    }
    if (draft.step === 'custom') {
      const amount = Number(text.replace(/[$,\s]/g, ''));
      if (!(amount > 0) || Math.round(amount * 100) / 100 !== amount) {
        await this.api!.sendMessage(chatId, 'Send an amount like 40 or 12.50.', { replyTo: msg.message_id });
        return true;
      }
      if (draft.flow === 'deposit') { await this.startPrivateDeposit(chatId, from, amount); return true; }
      await this.proposeWithdrawal(chatId, from, draft, amount);
      return true;
    }
    return false;
  }

  /** The Confirm card for a withdrawal. Checks the amount against the balance and the person's limits first. */
  private async proposeWithdrawal(chatId: number, from: TgUser, draft: WalletDraft, amount: number, editMessageId?: number) {
    const destination = draft.destination!;
    const key = `${chatId}:${from.id}`;
    const userId = await this.linkedUserOrPrompt(chatId, from, 'you can withdraw');
    if (!userId) return;
    const payer = await this.autopay.resolvePayerByUserId(userId);
    if (!payer?.signerGranted) {
      return void (await this.api!.sendMessage(chatId, 'Turn on auto-pay first, then I can withdraw from your wallet.', { keyboard: this.signInKeyboard('Turn on auto-pay') }));
    }
    const fail = (t: string) => this.api!.sendMessage(chatId, t);
    if (!(amount >= 1)) return void (await fail('The minimum withdrawal is $1.'));
    const balance = (await this.balanceOf(userId)) ?? draft.balanceUsd ?? 0;
    if (amount > balance + 1e-9) return void (await fail(`Your balance is ${money(balance)}, which is not enough for ${money(amount)}.`));
    try {
      await this.autopay.assertWithinLimits(payer, amount, { dailyTotalUsd: amount });
    } catch (e) {
      if (e instanceof BadRequestException) return void (await fail(escapeHtml(e.message)));
      throw e;
    }
    // Other crypto: say what they will receive before asking for the Confirm.
    const near = draft.network === 'near' && draft.token ? draft.token : null;
    let promisedOut: number | null = null;
    if (near) {
      try {
        const q = await this.wallet.quoteWithdrawal({ userId, token: near, amountUsd: amount, destination });
        if (q.error || !(q.out && q.out > 0)) return void (await fail(`I could not get a quote for ${money(amount)}: ${escapeHtml(q.error ?? 'no route right now')}`));
        promisedOut = q.out;
      } catch (e) {
        this.logger.warn(`Withdrawal quote failed: ${(e as Error).message}`);
        return void (await fail('I could not get a quote just now. Please try again in a moment.'));
      }
    }
    const kind = near ? 'withdraw_near' : 'withdraw_sol';
    // The same repeat guard as payments: a withdrawal of the same amount to the same address just went through or is unsettled.
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recent } = await this.db
      .getClient()
      .from('telegram_bot_actions')
      .select('status, created_at, paid_at, amount_usd')
      .eq('telegram_user_id', from.id)
      .eq('kind', kind)
      .eq('destination_address', destination)
      .in('status', ['paid', 'processing'])
      .gte('created_at', since);
    const dupe = (recent ?? []).find((r) => Number(r.amount_usd) === amount && (r.status === 'processing' || Date.now() - new Date(r.paid_at ?? r.created_at).getTime() < 90_000));
    if (dupe) {
      return void (await fail(dupe.status === 'processing' ? 'A withdrawal like this is still being processed or could not be confirmed. Check /history and your balance first.' : 'You just made this withdrawal. If you meant to do it again, wait a minute and repeat it.'));
    }

    await this.db.getClient().from('telegram_bot_actions').update({ status: 'cancelled' }).eq('telegram_user_id', from.id).eq('status', 'pending');
    const batchId = randomUUID();
    const { error } = await this.db.getClient().from('telegram_bot_actions').insert({
      batch_id: batchId,
      telegram_user_id: from.id,
      privy_user_id: userId,
      chat_id: chatId,
      recipient_handle: 'wallet',
      amount_usd: amount,
      kind,
      destination_address: destination,
      destination_chain: near ? near.chain : 'solana',
      destination_token: near ? near.symbol : 'USDC',
      quote_out: near ? String(promisedOut) : `${amount.toFixed(2)} USDC`,
      expires_at: new Date(Date.now() + CONFIRM_TTL_MS).toISOString(),
    });
    if (error) {
      this.logger.error(`Failed to create withdrawal action: ${error.message}`);
      return void (await fail('Something went wrong, please try again.'));
    }
    this.forgetWalletDraft(key);
    const text = near
      ? [
          `Withdraw <b>${money(amount)}</b> USDC?`,
          'To:',
          `<code>${escapeHtml(destination)}</code>`,
          `on <b>${escapeHtml(chainLabel(near.chain))}</b>`,
          `You receive about <b>${escapeHtml(formatTokenAmount(promisedOut!))} ${escapeHtml(near.symbol)}</b>. The rate can move a little, and I stop if it drops by more than 3%. It usually arrives within a few minutes.`,
          `Your balance after: ${money(Math.max(0, balance - amount))}`,
          'Check the address and the network. A withdrawal cannot be reversed.',
        ].join('\n')
      : [
          `Withdraw <b>${money(amount)}</b> USDC?`,
          'To:',
          `<code>${escapeHtml(destination)}</code>`,
          `They receive: <b>${money(amount)} USDC on Solana</b>. Network fees are covered by Loofta.`,
          `Your balance after: ${money(Math.max(0, balance - amount))}`,
          'Check the address. A withdrawal cannot be reversed.',
        ].join('\n');
    const keyboard = { inline_keyboard: [[{ text: 'Confirm', callback_data: `ok:${batchId}` }, { text: 'Cancel', callback_data: `no:${batchId}` }]] };
    if (editMessageId) await this.api!.editMessage(chatId, editMessageId, text, keyboard);
    else await this.api!.sendMessage(chatId, text, { keyboard });
  }

  private async showHistory(chatId: number, from: TgUser) {
    const base = 'id, amount_usd, recipient_handle, status, created_at, kind, payment_id';
    const query = (cols: string) =>
      this.db
        .getClient()
        .from('telegram_bot_actions')
        .select(cols)
        .eq('telegram_user_id', from.id)
        .in('status', ['paid', 'failed', 'processing'])
        .order('created_at', { ascending: false })
        .limit(8);
    let { data, error } = await query(`${base}, reclaim_state`);
    // Until the reclaim migration is applied the extra column does not exist; history must still work.
    if (error) ({ data } = await query(base));
    const rows = (data ?? []) as unknown as Array<{ id: string; amount_usd: number | string; recipient_handle: string; status: string; kind: string; payment_id: string | null; reclaim_state?: string | null }>;
    if (!rows.length) {
      await this.api!.sendMessage(chatId, 'No payments from Telegram yet. Try <code>pay $5 to @someone</code>.');
      return;
    }
    // A payment sent as a claim link that nobody has claimed yet can be taken back.
    let unclaimed = new Set<string>();
    const userId = await this.resolveLinkedUser(from.id);
    const candidates = rows.filter((r) => r.kind === 'pay' && r.status === 'paid' && r.payment_id && !r.reclaim_state);
    if (userId && candidates.length) {
      try {
        unclaimed = await this.autopay.unclaimedPaymentIds(userId, candidates.map((r) => r.payment_id!));
      } catch (e) {
        this.logger.warn(`Could not check which payments are unclaimed: ${(e as Error).message}`);
      }
    }
    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
    const lines = rows.map((r) => {
      if (r.kind !== 'pay') {
        const verb = r.status === 'paid' ? 'Withdrew' : r.status === 'processing' ? 'Unconfirmed' : 'Failed';
        return `${verb} ${money(Number(r.amount_usd))} to a wallet`;
      }
      const who = `@${escapeHtml(r.recipient_handle)}`;
      const amount = money(Number(r.amount_usd));
      if (r.reclaim_state === 'done') return `Got back ${amount} from ${who}`;
      if (r.reclaim_state === 'processing') return `Taking back ${amount} from ${who}, unconfirmed`;
      const verb = r.status === 'paid' ? 'Sent' : r.status === 'processing' ? 'Unconfirmed' : 'Failed';
      if (r.payment_id && unclaimed.has(r.payment_id)) {
        buttons.push([{ text: `Get back ${amount} from @${r.recipient_handle}`, callback_data: `rc:ask:${r.id}` }]);
        return `${verb} ${amount} to ${who}, not claimed yet`;
      }
      return `${verb} ${amount} to ${who}`;
    });
    const hint = buttons.length ? `\n\nA payment nobody has claimed can be taken back for ${money(RECLAIM_FEE_USD)}.` : '';
    await this.api!.sendMessage(chatId, `<b>Recent payments</b>\n${lines.join('\n')}${hint}`, buttons.length ? { keyboard: { inline_keyboard: buttons } } : {});
  }

  /** The "Get back" buttons: show what happens and what it costs, then do it only on a second tap. */
  private async onReclaimCallback(cb: TgCallback, arg?: string, id?: string) {
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    await this.api!.answerCallback(cb.id);
    if (!chatId || !messageId || cb.message?.chat.type !== 'private') return;
    if (arg === 'no') return void (await this.api!.editMessage(chatId, messageId, 'Cancelled. The payment stays as it is.'));
    if (!id || (arg !== 'ask' && arg !== 'yes')) return;

    const supabase = this.db.getClient();
    const userId = await this.resolveLinkedUser(cb.from.id);
    const { data: row } = await supabase
      .from('telegram_bot_actions')
      .select('id, privy_user_id, telegram_user_id, recipient_handle, amount_usd, status, kind, payment_id, reclaim_state')
      .eq('id', id)
      .maybeSingle();
    if (!userId || !row || row.privy_user_id !== userId || row.telegram_user_id !== cb.from.id || row.kind !== 'pay' || row.status !== 'paid' || !row.payment_id) {
      return void (await this.api!.editMessage(chatId, messageId, 'I cannot find that payment any more.'));
    }
    const amount = Number(row.amount_usd);
    const who = `@${escapeHtml(row.recipient_handle)}`;
    if (row.reclaim_state === 'done') return void (await this.api!.editMessage(chatId, messageId, `You already got this one back (${money(amount)} from ${who}).`));
    if (row.reclaim_state === 'processing') return void (await this.api!.editMessage(chatId, messageId, 'This is already being taken back. Check /history in a moment.'));

    if (arg === 'ask') {
      const back = Math.max(0, Math.round((amount - RECLAIM_FEE_USD) * 100) / 100);
      if (back <= 0) return void (await this.api!.editMessage(chatId, messageId, 'This payment is too small to get back after the fee.'));
      return void (await this.api!.editMessage(
        chatId,
        messageId,
        [
          `Take back your <b>${money(amount)}</b> to ${who}?`,
          `Fee: <b>${money(RECLAIM_FEE_USD)}</b>`,
          `You get back: <b>${money(back)}</b>, into your Loofta wallet`,
          '',
          `They will no longer be able to claim it. Fees you paid when sending are not refunded.`,
        ].join('\n'),
        { inline_keyboard: [[{ text: `Get back ${money(back)}`, callback_data: `rc:yes:${row.id}` }, { text: 'Keep it', callback_data: 'rc:no' }]] },
      ));
    }

    // yes: the NULL -> 'processing' flip is the lock, so a double tap can only run this once.
    const { data: claimed } = await supabase
      .from('telegram_bot_actions')
      .update({ reclaim_state: 'processing' })
      .eq('id', row.id)
      .eq('status', 'paid')
      .is('reclaim_state', null)
      .select('id');
    if (!claimed?.length) return void (await this.api!.editMessage(chatId, messageId, 'This is already being taken back. Check /history in a moment.'));
    await this.api!.editMessage(chatId, messageId, 'Taking it back…');
    try {
      const res = await this.autopay.reclaimUnclaimed(userId, row.payment_id);
      await supabase.from('telegram_bot_actions').update({ reclaim_state: 'done', reclaimed_at: new Date().toISOString() }).eq('id', row.id);
      const after = await this.balanceOf(userId);
      await this.api!.editMessage(
        chatId,
        messageId,
        [`Done. <b>${money(res.returnedUsd)}</b> is back in your wallet (fee ${money(res.feeUsd)}).`, after != null ? `Your balance: <b>${money(after)}</b>` : ''].filter(Boolean).join('\n'),
      );
    } catch (e) {
      // The burner's own balance decides whether money can still move, so a failed attempt is safe to retry.
      await supabase.from('telegram_bot_actions').update({ reclaim_state: null }).eq('id', row.id).eq('reclaim_state', 'processing');
      this.logger.error(`Reclaim of action ${row.id} failed: ${(e as Error).message}`);
      const msg = (e as Error).message ?? '';
      const shown = /too small/i.test(msg) ? 'This payment is too small to get back after the fee.' : e instanceof BadRequestException && !/Reclaim transfer failed/i.test(msg) ? msg : 'Something went wrong, so nothing changed. You can try again from /history.';
      await this.api!.editMessage(chatId, messageId, escapeHtml(shown));
    }
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

  /**
   * /logout. Unlink Telegram from their Loofta account so the bot — and the app — stop treating
   * this Telegram as their sign-in. Privy refuses when Telegram is their only login method; in
   * that case we sign them out of the bot locally (signed_out_at) and tell them to add another
   * login method first if they want it fully removed.
   */
  private async logout(chatId: number, from: TgUser) {
    const userId = await this.resolveLinkedUser(from.id);
    if (!userId) {
      await this.api!.sendMessage(chatId, 'You are not signed in.', { keyboard: this.signInKeyboard('Sign in to Loofta') });
      return;
    }
    const unlinked = await this.privyUnlinkTelegram(userId, String(from.id));
    if (unlinked) {
      await this.db.getClient().from('telegram_bot_users').update({ signed_out_at: null }).eq('telegram_user_id', from.id);
      await this.api!.sendMessage(
        chatId,
        'You are logged out. Telegram is no longer connected to your Loofta account, so I will not pay from your wallet. Sign in again any time with /start.',
      );
      return;
    }
    // Privy keeps the account when Telegram is the only way to sign in, so the bot forgets it locally.
    const { error } = await this.db
      .getClient()
      .from('telegram_bot_users')
      .update({ signed_out_at: new Date().toISOString() })
      .eq('telegram_user_id', from.id);
    if (error) this.logger.warn(`logout local sign-out failed: ${error.message}`);
    await this.api!.sendMessage(
      chatId,
      [
        'You are logged out. I will not pay from your wallet until you sign in again.',
        '',
        'Telegram is still the only way to sign in to your Loofta account, so it was kept. To remove it completely, add another sign-in method (like email) on the website, then log out here again.',
      ].join('\n'),
      { keyboard: this.signInKeyboard('Manage sign-in methods') },
    );
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
        { inline_keyboard: [[{ text: 'Sign in to Loofta', url: `${this.autoPayUrl}` }]] },
      ));
    }
    const payer = await this.autopay.resolvePayerByUserId(userId);
    if (!payer?.signerGranted) {
      return void (await reply(
        'Turn on auto-pay and accept the terms first, then I can pay from your wallet.',
        { inline_keyboard: [[{ text: 'Turn on auto-pay', url: `${this.autoPayUrl}` }]] },
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
    let balanceNow: number | null = null;
    try {
      const { balanceUSD } = await this.users.getSolanaWalletBalanceAndAddress(userId);
      balanceNow = balanceUSD;
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
      balanceNow,
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
    balanceUsd?: number | null,
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
    if (balanceUsd != null) lines.push(`Your balance: ${money(balanceUsd)}`);
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
      if (arg === 'withdraw') return this.showWithdraw(chatId, cb.from);
      if (arg === 'history') return this.showHistory(chatId, cb.from);
      if (arg === 'settings') return this.showSettings(chatId, cb.from);
      if (arg === 'logout') return this.logout(chatId, cb.from);
      if (arg === 'help') return this.sendIntro(chatId, true, true);
      if (arg === 'send') return this.startSend(chatId, cb.from);
      return;
    }

    if (cb.message?.chat.type === 'private') this.touchNudge(cb.message.chat.id);
    if (kind === 'rc') return this.onReclaimCallback(cb, arg, val);
    if (kind === 'snd') return this.onSendCallback(cb, arg, val);
    if (kind === 'dp') return this.onDepositCallback(cb, arg, val);
    if (kind === 'wd') return this.onWithdrawCallback(cb, arg, val);

    const supabase = this.db.getClient();
    // created_at is selected so rows can be put in order in code: PostgREST refuses to ORDER BY a column
    // that is not in the returned set of an UPDATE, and that error once looked like "no rows".
    const rowCols = 'id, privy_user_id, recipient_handle, amount_usd, is_private, private_split, private_max_delay_ms, created_at, kind, destination_address, destination_chain, destination_token, quote_out';
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
        await this.balanceOf(rowsNow[0].privy_user_id),
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
    // A wallet withdrawal, not a payment to a person: its own, simpler path.
    if (claimedRows[0].kind !== 'pay') {
      await this.api!.editMessage(chatId, messageId, 'Withdrawing…');
      return this.confirmWithdrawal(cb, chatId, messageId, arg!, claimedRows[0]);
    }
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
    // Each payment gets its link and a Share button that opens Telegram's share sheet with a ready message.
    const many = okOnes.length > 1;
    const linkRows: InlineButton[][] = okOnes.map((o) => [
      { text: many ? `View @${o.handle}` : 'View payment', url: o.shortLink! },
      { text: many ? `Share @${o.handle}` : 'Share link', url: this.shareUrl(o.amount, o.claimLink ?? o.shortLink!) },
    ]);
    if (outcomes.length === 1 && okOnes.length === 1) {
      // The same message as plain text, to copy: tapping a code block copies it.
      lines.push('', 'Send it to them:', `<code>${escapeHtml(this.shareText(okOnes[0].amount))}\n${escapeHtml(okOnes[0].claimLink ?? okOnes[0].shortLink!)}</code>`);
    }
    for (const o of unsure) {
      if (o.signature) linkRows.push([{ text: `Check on Solscan: @${o.handle}`, url: `https://solscan.io/tx/${o.signature}` }]);
    }
    if (unsure.length && outcomes.length > 1) lines.push('', 'The rest were not attempted. Check /history before sending again.');
    // The balance after the payment, read fresh so it already reflects what was just sent.
    const balanceAfter = await this.balanceOf(claimedRows[0]?.privy_user_id);
    if (balanceAfter != null) lines.push('', `Your balance: <b>${money(balanceAfter)}</b>`);
    const inPrivate = cb.message?.chat.type === 'private';
    if (inPrivate && !outcomes.some((o) => o.uncertain)) linkRows.push([{ text: 'Send again', callback_data: 'menu:send' }]);
    await this.api!.editMessage(chatId, messageId, lines.join('\n'), linkRows.length ? { inline_keyboard: linkRows } : undefined);
    // Bring the Send button back at the bottom of the chat, and again after a quiet while.
    if (inPrivate) {
      await this.showReady(chatId, 'Ready for the next one.');
      this.scheduleNudge(chatId);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Always-ready Send

  private readonly readyMsg = new Map<number, number>();
  private readonly nudgeTimers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Puts the Send / Balance buttons at the bottom of the chat (silently), replacing the last such message. */
  private async showReady(chatId: number, text: string) {
    const previous = this.readyMsg.get(chatId);
    if (previous) await this.api!.deleteMessage(chatId, previous);
    try {
      const sent = await this.api!.sendMessage(chatId, text, { replyKeyboard: readyKeyboard(), silent: true });
      if (sent?.message_id) this.readyMsg.set(chatId, sent.message_id);
    } catch (e) {
      this.logger.warn(`Could not show the ready keyboard: ${(e as Error).message}`);
    }
  }

  /** After a payment, one gentle reminder once the chat has gone quiet. Any new activity pushes it back. */
  private scheduleNudge(chatId: number) {
    const existing = this.nudgeTimers.get(chatId);
    if (existing) clearTimeout(existing);
    const minutes = Number(this.config.get<string>('BOT_NUDGE_MINUTES') || 10);
    const t = setTimeout(() => {
      this.nudgeTimers.delete(chatId);
      void this.showReady(chatId, 'Need to pay someone? Tap Send.');
    }, minutes * 60_000);
    t.unref?.();
    this.nudgeTimers.set(chatId, t);
  }
  /** Called on any activity in a chat that has a reminder waiting. */
  private touchNudge(chatId: number) {
    if (this.nudgeTimers.has(chatId)) this.scheduleNudge(chatId);
  }

  private shareText(amount: number): string {
    return `Hey, I just sent you ${money(amount)} on @${this.botUsername}, click the link below to claim it`;
  }

  /** Opens Telegram's own share sheet: pick a chat, the message and link are already filled in. */
  private shareUrl(amount: number, link: string): string {
    return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(this.shareText(amount))}`;
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
        keyboard: { inline_keyboard: [[{ text: 'Open payment', url: link }, { text: 'Withdraw', url: `${this.appUrl}/app?withdraw=1` }]] },
      });
    } catch (e) {
      this.logger.warn(`Could not notify @${handle}: ${(e as Error).message}`);
    }
  }
}
