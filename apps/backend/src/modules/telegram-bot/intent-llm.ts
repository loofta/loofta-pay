import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAX_RECIPIENTS, MAX_COMMAND_AMOUNT_USD, TELEGRAM_HANDLE_RE } from './telegram-parser';

/**
 * What the model is allowed to produce: a description of what the person asked for, nothing else.
 * It never moves money. Its answer is turned back into an ordinary command sentence, which goes
 * through the same parser, limits, balance check and Confirm card as anything typed by hand.
 */
export interface LlmIntent {
  isPayment: boolean;
  isPrivate: boolean;
  delayMinutes: number | null;
  split: number | null;
  payments: Array<{ handle: string | null; amount: number | null }>;
}

const SYSTEM_PROMPT = `You read one chat message sent to a Telegram payment bot and extract the payment it asks for.
Answer with ONLY a JSON object, no other text:
{"is_payment": boolean, "private": boolean, "delay_minutes": number|null, "split": number|null, "payments": [{"handle": string|null, "amount": number|null}]}
Rules:
- "handle" is a Telegram username without the @, and only if it is literally written in the message. Never invent one. Use null if missing.
- "amount" is a number of US dollars. Convert number words ("five" -> 5, "ten bucks" -> 10). Use null if missing. Never invent one.
- If one amount is shared ("5 each", "$5 to @a and @b"), repeat it for every person.
- "private" is true only if the message asks for a private, secret or anonymous payment.
- "delay_minutes" and "split" only if the message states them (for example "delay 30m", "split 4"), otherwise null.
- At most 5 payments.
- If the message is not asking to pay, send, give or tip someone money, set "is_payment" to false and "payments" to [].`;

interface Target { name: string; baseUrl: string; apiKey: string; model: string }

const clampNum = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/** Validates and normalises whatever the model returned. Anything unexpected becomes "not a payment". */
export function parseLlmJson(raw: string): LlmIntent | null {
  let obj: any;
  try {
    obj = JSON.parse(raw.trim().replace(/^```(?:json)?|```$/g, ''));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const payments = Array.isArray(obj.payments) ? obj.payments.slice(0, MAX_RECIPIENTS) : [];
  return {
    isPayment: obj.is_payment === true && payments.length > 0,
    isPrivate: obj.private === true,
    delayMinutes: clampNum(obj.delay_minutes),
    split: clampNum(obj.split),
    payments: payments.map((p: any) => ({
      handle: typeof p?.handle === 'string' ? p.handle.replace(/^@/, '').toLowerCase().trim() : null,
      amount: clampNum(p?.amount),
    })),
  };
}

/**
 * Turns the model's answer into a plain sentence for the normal parser, refusing anything that is
 * not grounded in what the person actually wrote: a name must literally appear in their message,
 * amounts must be sane. Returns null when the intent cannot be rebuilt safely.
 */
export function intentToSentence(intent: LlmIntent, originalText: string): string | null {
  if (!intent.isPayment || intent.payments.length === 0) return null;
  const haystack = originalText.toLowerCase();
  const items = intent.payments;
  for (const p of items) {
    if (p.handle !== null) {
      if (!TELEGRAM_HANDLE_RE.test(p.handle)) return null;
      if (!haystack.includes(p.handle)) return null; // never trust a name the person did not write
    }
    if (p.amount !== null) {
      if (!(p.amount > 0) || p.amount > MAX_COMMAND_AMOUNT_USD) return null;
      if (Math.round(p.amount * 100) / 100 !== p.amount) return null;
    }
  }
  const verb = intent.isPrivate ? 'payprivately' : 'pay';
  const options = [
    intent.isPrivate && intent.delayMinutes && Number.isInteger(intent.delayMinutes) && intent.delayMinutes >= 1 && intent.delayMinutes <= 1440
      ? `delay ${intent.delayMinutes}m`
      : '',
    intent.isPrivate && intent.split && Number.isInteger(intent.split) && intent.split >= 1 && intent.split <= 15 ? `split ${intent.split}` : '',
  ].filter(Boolean).join(' ');

  const complete = items.every((p) => p.handle !== null && p.amount !== null);
  if (complete) {
    return `${verb} ${items.map((p) => `$${p.amount} to @${p.handle}`).join(', ')}${options ? ` ${options}` : ''}`;
  }
  // A single piece is missing: hand back just what is known, and the normal flow asks for the rest.
  if (items.length === 1) {
    const [p] = items;
    if (p.handle !== null) return `${verb} @${p.handle}${options ? ` ${options}` : ''}`;
    if (p.amount !== null) return `${verb} $${p.amount}${options ? ` ${options}` : ''}`;
  }
  return null;
}

@Injectable()
export class IntentLlmService {
  private readonly logger = new Logger(IntentLlmService.name);
  private readonly targets: Target[];
  private readonly cooldownUntil = new Map<string, number>();
  private readonly perUser = new Map<number, number[]>();
  private day = new Date().toISOString().slice(0, 10);
  private usedToday = 0;
  private readonly dailyLimit: number;
  private readonly perUserPerMinute: number;

  constructor(private readonly config: ConfigService) {
    const baseUrl = (this.config.get<string>('LLM_BASE_URL') || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
    const key = this.config.get<string>('LLM_API_KEY');
    // Models are tried in order. On Groq each model has its own free limits, so listing two gives
    // both more room and a second chance when one is overloaded.
    const models = (this.config.get<string>('LLM_MODELS') || 'llama-3.1-8b-instant,openai/gpt-oss-20b').split(',').map((m) => m.trim()).filter(Boolean);
    this.targets = key ? models.map((model) => ({ name: `${new URL(baseUrl).hostname}/${model}`, baseUrl, apiKey: key, model })) : [];
    // Optional second provider (any OpenAI-compatible API) for when the first is down.
    const fbKey = this.config.get<string>('LLM_FALLBACK_API_KEY');
    const fbUrl = this.config.get<string>('LLM_FALLBACK_BASE_URL');
    const fbModel = this.config.get<string>('LLM_FALLBACK_MODEL');
    if (fbKey && fbUrl && fbModel) {
      this.targets.push({ name: `${new URL(fbUrl).hostname}/${fbModel}`, baseUrl: fbUrl.replace(/\/$/, ''), apiKey: fbKey, model: fbModel });
    }
    this.dailyLimit = Number(this.config.get<string>('LLM_DAILY_LIMIT') || 800);
    this.perUserPerMinute = Number(this.config.get<string>('LLM_USER_PER_MINUTE') || 8);
  }

  get enabled(): boolean {
    return this.targets.length > 0;
  }

  private allow(userId: number): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.usedToday = 0; }
    if (this.usedToday >= this.dailyLimit) return false; // keep inside the free quota
    const now = Date.now();
    const recent = (this.perUser.get(userId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perUserPerMinute) return false;
    recent.push(now);
    this.perUser.set(userId, recent);
    this.usedToday++;
    return true;
  }

  /** Never throws: any problem means "no answer", and the bot carries on without the model. */
  async interpret(text: string, userId: number, promptText?: string | null): Promise<LlmIntent | null> {
    if (!this.enabled || !this.allow(userId)) return null;
    const user = promptText ? `The bot had just asked: "${promptText.slice(0, 200)}"\nThe person answered: ${text.slice(0, 400)}` : text.slice(0, 400);
    for (const t of this.targets) {
      if ((this.cooldownUntil.get(t.name) ?? 0) > Date.now()) continue;
      try {
        const res = await fetch(`${t.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t.apiKey}` },
          body: JSON.stringify({
            model: t.model,
            temperature: 0,
            max_tokens: 220,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (res.status === 429 || res.status >= 500) {
          this.cooldownUntil.set(t.name, Date.now() + 60_000); // rest this one for a minute
          this.logger.warn(`LLM ${t.name} answered ${res.status}, trying the next one`);
          continue;
        }
        if (!res.ok) {
          this.logger.warn(`LLM ${t.name} answered ${res.status}`);
          continue;
        }
        const json: any = await res.json();
        const intent = parseLlmJson(json?.choices?.[0]?.message?.content ?? '');
        if (intent) return intent;
      } catch (e) {
        this.cooldownUntil.set(t.name, Date.now() + 30_000);
        this.logger.warn(`LLM ${t.name} failed: ${(e as Error).message}`);
      }
    }
    return null;
  }
}
