import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { escapeHtml, TelegramApi } from '@/modules/telegram-bot/telegram-api';
import { SUPPORT_FAQ, WANTS_HUMAN } from './support-knowledge';
import { SupportLlmService } from './support-llm.service';

export type ChatMessage = { id: string; sender: 'user' | 'bot' | 'agent'; body: string; created_at: string };

const MAX_TEXT = 500;
const MAX_USER_MESSAGES_PER_DAY = 80;
/** After an agent answers, the person's next messages go straight to Telegram for this long. */
const HUMAN_WINDOW_MS = 12 * 60 * 60 * 1000;

/** What a cash-out status means to the person, in plain words. */
export function plainCashoutStatus(status: string): string {
  switch (status) {
    case 'PENDING_BRIDGE':
    case 'BRIDGING':
    case 'CREATING_DEPOSIT':
      return 'getting ready';
    case 'DEPOSITED':
      return 'waiting for a buyer to send the money';
    case 'CANCELLING':
      return 'being cancelled';
    case 'COMPLETE':
      return 'done';
    case 'CANCELLED':
      return 'cancelled';
    case 'FAILED':
      return 'did not go through';
    default:
      return 'in progress';
  }
}

@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);
  private readonly api: TelegramApi | null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly llm: SupportLlmService,
  ) {
    const token = this.config.get<string>('SUPPORT_BOT_TOKEN');
    this.api = token ? new TelegramApi(token) : null;
  }

  get agentChatId(): string | null {
    return this.config.get<string>('SUPPORT_TELEGRAM_CHAT_ID')?.trim() || null;
  }

  faq() {
    return SUPPORT_FAQ.map((f) => ({ id: f.id, question: f.question }));
  }

  // ------------------------------------------------------------ person side

  private async thread(userId: string, orgId?: string | null) {
    const { data: found } = await this.supabase.supportThreads.select('*').eq('user_id', userId).maybeSingle();
    if (found) {
      if (orgId && found.org_id !== orgId) await this.supabase.supportThreads.update({ org_id: orgId }).eq('id', found.id);
      return found as { id: string; email: string | null; org_id: string | null; mode: string; human_until: string | null };
    }
    const { data: user } = await this.supabase.users.select('email').eq('privy_user_id', userId).maybeSingle();
    const { data: made, error } = await this.supabase.supportThreads
      .insert({ user_id: userId, email: (user as { email?: string } | null)?.email ?? null, org_id: orgId ?? null })
      .select('*')
      .single();
    if (error || !made) {
      // A second request created it first.
      const { data: again } = await this.supabase.supportThreads.select('*').eq('user_id', userId).maybeSingle();
      if (again) return again as any;
      throw new BadRequestException('Could not open the chat.');
    }
    return made as any;
  }

  async messages(userId: string, after?: string): Promise<{ messages: ChatMessage[]; mode: 'bot' | 'human' }> {
    const { data: t } = await this.supabase.supportThreads.select('id, mode, human_until').eq('user_id', userId).maybeSingle();
    if (!t) return { messages: [], mode: 'bot' };
    let q = this.supabase.supportMessages.select('id, sender, body, created_at').eq('thread_id', t.id).neq('body', '').order('created_at', { ascending: true }).limit(100);
    if (after && !Number.isNaN(Date.parse(after))) q = q.gt('created_at', after);
    const { data } = await q;
    const human = t.mode === 'human' && t.human_until && new Date(t.human_until).getTime() > Date.now();
    return { messages: (data ?? []) as ChatMessage[], mode: human ? 'human' : 'bot' };
  }

  private async add(threadId: string, sender: ChatMessage['sender'], body: string, telegramMessageId?: number | null) {
    await this.supabase.supportMessages.insert({ thread_id: threadId, sender, body, telegram_message_id: telegramMessageId ?? null });
    await this.supabase.supportThreads.update({ updated_at: new Date().toISOString() }).eq('id', threadId);
  }

  /** The person's own latest cash-out, used as context for the assistant and for the agent. Their own data only. */
  private async latestCashout(userId: string): Promise<string> {
    const { data } = await this.supabase.getClient()
      .from('offramp_requests')
      .select('platform, amount_usdc, status, created_at')
      .eq('user_id', userId)
      .neq('status', 'DELETED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return 'No cash-out started yet.';
    const r = data as { platform: string; amount_usdc: number; status: string; created_at: string };
    const kind = r.platform === 'meld' ? 'bank or card' : `Private P2P via ${r.platform}`;
    return `Latest cash-out: ${kind}, $${Number(r.amount_usdc).toFixed(2)}, ${plainCashoutStatus(r.status)}, started ${new Date(r.created_at).toUTCString()}.`;
  }

  /**
   * One message from the person. A quick-question button is answered from the fixed list. Anything else goes to the
   * assistant, which only knows the hand-written knowledge. If they ask for a person, or the assistant is unsure or
   * unavailable, it goes to Telegram. Returns what to show now; the rest arrives by polling.
   */
  async send(userId: string, dto: { text?: string; faq?: string; human?: boolean; orgId?: string | null }) {
    const faq = dto.faq ? SUPPORT_FAQ.find((f) => f.id === dto.faq) : undefined;
    const text = (faq ? faq.question : (dto.text ?? '')).trim().slice(0, MAX_TEXT);
    if (!text && !dto.human) throw new BadRequestException('Write a message first.');

    const t = await this.thread(userId, dto.orgId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await this.supabase.supportMessages.select('id', { count: 'exact', head: true }).eq('thread_id', t.id).eq('sender', 'user').gt('created_at', since);
    if ((count ?? 0) >= MAX_USER_MESSAGES_PER_DAY) throw new HttpException('Too many messages today. Please try again tomorrow.', HttpStatus.TOO_MANY_REQUESTS);

    if (text) await this.add(t.id, 'user', text);

    const inHuman = t.mode === 'human' && t.human_until && new Date(t.human_until).getTime() > Date.now();
    if (dto.human || inHuman || (!faq && WANTS_HUMAN.test(text))) {
      await this.toAgent(userId, t, text || 'The person asked to talk to someone.');
      if (!inHuman) await this.add(t.id, 'bot', 'I passed this to our team. They will answer here, and you can keep this window open or come back later.');
      return { handled: 'human' as const };
    }

    if (faq) {
      await this.add(t.id, 'bot', faq.answer);
      return { handled: 'faq' as const };
    }

    const context = await this.latestCashout(userId);
    const out = await this.llm.answer(text, userId, context);
    if (!out || out.escalate) {
      await this.toAgent(userId, t, text);
      await this.add(t.id, 'bot', out?.answer && out.answer.length < 200 ? `${out.answer} I also passed this to our team.` : 'I am not sure about this one, so I passed it to our team. They will answer here.');
      return { handled: 'human' as const };
    }
    await this.add(t.id, 'bot', out.answer);
    return { handled: 'bot' as const };
  }

  // ------------------------------------------------------------ Telegram side

  private async toAgent(userId: string, t: { id: string; email: string | null; org_id: string | null }, text: string) {
    const chat = this.agentChatId;
    if (!this.api || !chat) {
      this.logger.warn('Support message needs a person but SUPPORT_BOT_TOKEN or SUPPORT_TELEGRAM_CHAT_ID is not set');
      return;
    }
    const context = await this.latestCashout(userId);
    const body =
      `<b>Support</b>${t.org_id ? ` · ${escapeHtml(t.org_id)}` : ''}\n` +
      `${escapeHtml(t.email ?? 'no email on file')}\n` +
      `<i>${escapeHtml(context)}</i>\n\n` +
      `${escapeHtml(text)}\n\n` +
      `<i>Reply to this message to answer.</i>`;
    try {
      const sent = await this.api.sendMessage(Number(chat), body);
      if (sent?.message_id) {
        // Remember which Telegram message belongs to which person, so a reply finds its way back.
        await this.supabase.supportMessages.insert({ thread_id: t.id, sender: 'bot', body: '', telegram_message_id: sent.message_id }).then(() => undefined);
      }
    } catch (e) {
      this.logger.warn(`Could not forward a support message: ${(e as Error).message}`);
    }
  }

  /** The agent replied in Telegram. Finds the person by the message replied to and shows the answer in their chat. */
  async agentReply(chatId: string, replyToMessageId: number, text: string): Promise<'ok' | 'unknown'> {
    if (!this.agentChatId || chatId !== this.agentChatId) return 'unknown';
    const { data: link } = await this.supabase.supportMessages.select('thread_id').eq('telegram_message_id', replyToMessageId).maybeSingle();
    if (!link) return 'unknown';
    await this.add(link.thread_id as string, 'agent', text.trim().slice(0, 1500));
    await this.supabase.supportThreads.update({ mode: 'human', human_until: new Date(Date.now() + HUMAN_WINDOW_MS).toISOString() }).eq('id', link.thread_id);
    return 'ok';
  }
}
