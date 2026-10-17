/**
 * Parses a payment command typed to @looftapay_bot. Pure and regex-based (no LLM), same
 * approach as apps/twitter-bot/src/parser.ts. `pay` and `send` are interchangeable, with or
 * without a leading slash, and the amount may carry the dollar sign on either side:
 *   pay $5 to @someone      send 5$ to @someone      /pay 5 @someone      /pay 5 (as a reply)
 *   send 5$ privately to @someone      pay 5 private @someone      /payprivately 5 @someone
 *   pay 5 privately to @someone delay 30m split 4
 */
export type ParsedSend =
  | {
      ok: true;
      amount: number;
      handle: string | null;
      isPrivate: boolean;
      /** Max delivery delay in ms for a private payment; null = default (10 minutes). */
      delayMs: number | null;
      /** Number of private transfer parts (1-15); null = random. */
      split: number | null;
      /** Set when one message pays several people (2 to 5). `amount` is then their sum and `handle` is null. */
      payments?: Array<{ handle: string; amount: number }>;
    }
  | { ok: false; error: string };

const AMOUNT = String.raw`\$?(\d+(?:\.\d+)?)\$?`;
const UNIT = String.raw`(?:\s*(?:usdc|usd|dollars?|bucks))?`;
const HANDLE = String.raw`@?([a-z0-9_]{1,40})`;
const VERB = String.raw`\/?(?:pay|send)`;

const AMOUNT_FIRST = new RegExp(`^${VERB}\\s+${AMOUNT}${UNIT}(?:\\s+(?:to\\s+)?${HANDLE})?$`);
const HANDLE_FIRST = new RegExp(`^${VERB}\\s+${HANDLE}\\s+${AMOUNT}${UNIT}$`);

export const TELEGRAM_HANDLE_RE = /^[a-z0-9_]{5,32}$/;
export const MAX_COMMAND_AMOUNT_USD = 500;
export const MAX_RECIPIENTS = 5;
export const MIN_PRIVATE_AMOUNT_USD = 1;
export const DEFAULT_PRIVATE_DELAY_MS = 10 * 60 * 1000;
export const MIN_PRIVATE_DELAY_MS = 60 * 1000;
export const MAX_PRIVATE_DELAY_MS = 24 * 60 * 60 * 1000;

const PRIVATE_RE = /\b(?:privately|private|privatly)\b/;
const DELAY_RE = /\bdelay\s+(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?)?\b/;
const SPLIT_RE = /\bsplit\s+(\d+|random)\b/;

function delayToMs(value: number, unit: string | undefined): number {
  const u = unit ?? 'm';
  if (u.startsWith('s')) return Math.round(value * 1000);
  if (u.startsWith('h')) return Math.round(value * 3_600_000);
  return Math.round(value * 60_000);
}

export function parseSendCommand(raw: string, botUsername: string): ParsedSend | null {
  let text = raw
    .toLowerCase()
    .replace(new RegExp(`@${botUsername.toLowerCase()}`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();

  // /payprivately, /pay_privately, /sendprivately (and "private") are the private forms of pay/send.
  text = text.replace(/^(\/?)(pay|send)_?(privately|private)\b/, '$1$2 privately');

  // Only treat the message as a payment if it starts like one. The private options are pulled out
  // afterwards so they can sit anywhere after the verb.
  if (!new RegExp(`^${VERB}\\b`).test(text)) return null;

  const isPrivate = PRIVATE_RE.test(text);
  text = text.replace(PRIVATE_RE, ' ');

  let delayMs: number | null = null;
  const d = DELAY_RE.exec(text);
  if (d) {
    delayMs = delayToMs(Number(d[1]), d[2]);
    text = text.replace(DELAY_RE, ' ');
  }

  let split: number | null = null;
  const sp = SPLIT_RE.exec(text);
  if (sp) {
    split = sp[1] === 'random' ? null : Number(sp[1]);
    text = text.replace(SPLIT_RE, ' ');
  }

  text = text.replace(/\s+/g, ' ').trim();

  // Several people in one message: two or more @handles. Handles need the "@" here so plain words
  // ("and", "each") can never be mistaken for a username.
  if ((text.match(/@[a-z0-9_]{1,40}/g) ?? []).length >= 2) {
    const payments = parseMultiPayments(text.replace(new RegExp(`^${VERB}\\s*`), ''));
    if (!payments.ok) return payments;
    if (!isPrivate && (d || (sp && sp[1] !== 'random'))) {
      return { ok: false, error: 'Delay and split only apply to private payments. Add the word "privately".' };
    }
    if (isPrivate && payments.items.some((p) => p.amount < MIN_PRIVATE_AMOUNT_USD)) {
      return { ok: false, error: `Private payments start at $${MIN_PRIVATE_AMOUNT_USD} each.` };
    }
    if (delayMs !== null && (delayMs < MIN_PRIVATE_DELAY_MS || delayMs > MAX_PRIVATE_DELAY_MS)) {
      return { ok: false, error: 'The delay must be between 1 minute and 24 hours, for example delay 30m or delay 2h.' };
    }
    if (split !== null && (!Number.isInteger(split) || split < 1 || split > 15)) {
      return { ok: false, error: 'Split must be a number from 1 to 15, or "random".' };
    }
    const total = payments.items.reduce((t, p) => t + p.amount, 0);
    return { ok: true, amount: Math.round(total * 100) / 100, handle: null, isPrivate, delayMs, split, payments: payments.items };
  }

  let amountStr: string | undefined;
  let handle: string | null = null;
  let m = AMOUNT_FIRST.exec(text);
  if (m) {
    amountStr = m[1];
    handle = m[2] ?? null;
  } else if ((m = HANDLE_FIRST.exec(text))) {
    handle = m[1];
    amountStr = m[2];
  } else {
    return null;
  }

  if (!isPrivate && (d || (sp && sp[1] !== 'random'))) {
    return { ok: false, error: 'Delay and split only apply to private payments. Add the word "privately", for example: pay 5 privately to @someone delay 30m split 4.' };
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountStr)) {
    return { ok: false, error: 'Amounts can have at most 2 decimals, for example $5 or $2.50.' };
  }
  const amount = Number(amountStr);
  if (!(amount > 0)) return { ok: false, error: 'The amount must be more than $0.' };
  if (amount > MAX_COMMAND_AMOUNT_USD) {
    return { ok: false, error: `The most I can send in one payment is $${MAX_COMMAND_AMOUNT_USD}.` };
  }
  if (isPrivate && amount < MIN_PRIVATE_AMOUNT_USD) {
    return { ok: false, error: `Private payments start at $${MIN_PRIVATE_AMOUNT_USD}.` };
  }
  if (handle !== null && !TELEGRAM_HANDLE_RE.test(handle)) {
    return { ok: false, error: `"@${handle}" is not a valid Telegram username (5 to 32 letters, numbers or underscores).` };
  }
  if (delayMs !== null && (delayMs < MIN_PRIVATE_DELAY_MS || delayMs > MAX_PRIVATE_DELAY_MS)) {
    return { ok: false, error: 'The delay must be between 1 minute and 24 hours, for example delay 30m or delay 2h.' };
  }
  if (split !== null && (!Number.isInteger(split) || split < 1 || split > 15)) {
    return { ok: false, error: 'Split must be a number from 1 to 15, or "random".' };
  }
  return { ok: true, amount, handle, isPrivate, delayMs, split };
}

/**
 * "$5 to @a, $10 to @b and $2 to @c", "@a 5, @b 10", "5 to @a @b @c" (5 each), "$5 to @a, @b" (the
 * last amount carries over), "@a, @b 5" (a trailing amount covers the names before it). Anything left
 * over that is not an amount or a name is refused rather than guessed at.
 */
function parseMultiPayments(rest: string): { ok: true; items: Array<{ handle: string; amount: number }> } | { ok: false; error: string } {
  const handles: string[] = [];
  let t = rest.replace(/@([a-z0-9_]{1,40})/g, (_m, h: string) => {
    handles.push(h);
    return ` HNDL${String.fromCharCode(96 + handles.length)} `;
  });
  t = t.replace(/\band\b|&|\+|;/g, ',');
  t = t.replace(/\b(?:to|each|usdc|usd|dollars?|bucks|for)\b/g, ' ');

  if (handles.length > MAX_RECIPIENTS) return { ok: false, error: `I can pay up to ${MAX_RECIPIENTS} people in one message.` };

  const items: Array<{ handle: string; amount: number }> = [];
  let pending: string[] = [];
  let last: number | null = null;
  const give = (h: string, amount: number) => items.push({ handle: h, amount });

  for (const segment of t.split(',').map((x) => x.trim()).filter(Boolean)) {
    const segHandles = [...segment.matchAll(/HNDL([a-z])/g)].map((m) => handles[m[1].charCodeAt(0) - 97]);
    const withoutHandles = segment.replace(/HNDL[a-z]/g, ' ');
    const amounts = [...withoutHandles.matchAll(/\$?(\d+(?:\.\d+)?)\$?/g)].map((m) => m[1]);
    const leftover = withoutHandles.replace(/\$?\d+(?:\.\d+)?\$?/g, ' ').trim();
    if (leftover) return { ok: false, error: `I did not understand "${leftover}". Try: pay $5 to @someone, $10 to @another.` };
    if (amounts.length > 1) return { ok: false, error: 'Give each person one amount, for example: pay $5 to @someone, $10 to @another.' };

    if (amounts.length === 1) {
      if (!/^\d+(?:\.\d{1,2})?$/.test(amounts[0])) {
        return { ok: false, error: 'Amounts can have at most 2 decimals, for example $5 or $2.50.' };
      }
      const amount = Number(amounts[0]);
      if (!(amount > 0)) return { ok: false, error: 'Each amount must be more than $0.' };
      if (amount > MAX_COMMAND_AMOUNT_USD) return { ok: false, error: `The most I can send in one payment is $${MAX_COMMAND_AMOUNT_USD}.` };
      if (segHandles.length === 0 && pending.length === 0) return { ok: false, error: `Who should get $${amount}? Put the @name next to each amount.` };
      for (const h of [...pending, ...segHandles]) give(h, amount);
      pending = [];
      last = amount;
    } else if (segHandles.length > 0) {
      if (last !== null) for (const h of segHandles) give(h, last);
      else pending.push(...segHandles);
    }
  }
  if (pending.length > 0) return { ok: false, error: `How much should @${pending[0]} get? Put an amount next to each name.` };
  if (items.length < 2) return { ok: false, error: 'I could not read that. Try: pay $5 to @someone, $10 to @another.' };
  if (items.length > MAX_RECIPIENTS) return { ok: false, error: `I can pay up to ${MAX_RECIPIENTS} people in one message.` };
  for (const it of items) {
    if (!TELEGRAM_HANDLE_RE.test(it.handle)) return { ok: false, error: `"@${it.handle}" is not a valid Telegram username (5 to 32 letters, numbers or underscores).` };
  }
  if (new Set(items.map((i) => i.handle)).size !== items.length) return { ok: false, error: 'Each person can only be paid once per message.' };
  return { ok: true, items };
}

/* ───────────── Conversation: ask only for what is missing ─────────────
 * People type half a payment ("/pay", "@someone", "5"). On a phone a tap on the command suggestion
 * sends "/pay" with nothing after it. Instead of failing, the bot keeps what it understood, asks for
 * the missing piece, and builds the full command from the answers. What it knows is carried in the
 * wording of its own question, so it still works when the answer is a reply to that question. */
export const PAY_PROMPT = 'Who do you want to pay, and how much?';
export const PAY_PRIVATE_PROMPT = 'Who do you want to pay privately, and how much?';
export const payTargetPrompt = (handle: string, isPrivate: boolean) => `How much should @${handle} get${isPrivate ? ' privately' : ''}?`;
export const payWhoPrompt = (amount: number, isPrivate: boolean) => `Who should get $${amount.toFixed(2)}${isPrivate ? ' privately' : ''}?`;

export type NextStep =
  | { kind: 'run'; command: string }
  | { kind: 'ask'; prompt: string; plain: string; placeholder: string }
  | { kind: 'none' };

const VERB_START = /^\/?(?:pay|send)(?:_?privately|_?private)?\b/;
const ctxOf = (promptText: string | null | undefined) => {
  if (!promptText) return null;
  let m = /^Who do you want to pay( privately)?, and how much\?/.exec(promptText);
  if (m) return { isPrivate: !!m[1], handle: undefined as string | undefined, amount: undefined as number | undefined };
  m = /^How much should @([a-z0-9_]{1,40}) get( privately)?\?/i.exec(promptText);
  if (m) return { isPrivate: !!m[2], handle: m[1].toLowerCase(), amount: undefined };
  m = /^Who should get \$(\d+(?:\.\d+)?)( privately)?\?/.exec(promptText);
  if (m) return { isPrivate: !!m[2], handle: undefined, amount: Number(m[1]) };
  return null;
};

const askBoth = (isPrivate: boolean): NextStep => ({
  kind: 'ask',
  plain: isPrivate ? PAY_PRIVATE_PROMPT : PAY_PROMPT,
  prompt: `${isPrivate ? PAY_PRIVATE_PROMPT : PAY_PROMPT} Reply with a name and an amount, for example <code>@someone 5</code>, or several people: <code>@someone 5, @another 10</code>.${isPrivate ? ' You can add <code>delay 30m split 4</code>.' : ''}`,
  placeholder: '@someone 5',
});
const askAmount = (handle: string, isPrivate: boolean): NextStep => ({
  kind: 'ask',
  plain: payTargetPrompt(handle, isPrivate),
  prompt: `${payTargetPrompt(handle, isPrivate)} Reply with an amount, for example <code>5</code>.`,
  placeholder: '5',
});
const askWho = (amount: number, isPrivate: boolean): NextStep => ({
  kind: 'ask',
  plain: payWhoPrompt(amount, isPrivate),
  prompt: `${payWhoPrompt(amount, isPrivate)} Reply with their Telegram username, for example <code>@someone</code>.`,
  placeholder: '@someone',
});

/**
 * Decides what to do with a message that may be (part of) a payment.
 *  - promptText: the question this message answers (a reply to it, or the last question asked in this chat)
 *  - replyTarget: the person whose message this one replies to (so "/pay 5" in a group knows who)
 */
export function nextStep(input: { text: string; botUsername: string; promptText?: string | null; replyTarget?: string | null; isPrivateChat: boolean }): NextStep {
  const { botUsername, replyTarget, isPrivateChat } = input;
  const clean = input.text
    .toLowerCase()
    .replace(new RegExp(`@${botUsername.toLowerCase()}`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
  const ctx = ctxOf(input.promptText);
  const isVerb = VERB_START.test(clean);
  if (clean.startsWith('/') && !isVerb) return { kind: 'none' };

  const loneAmount = /^\$?\d+(?:\.\d+)?\$?$/.test(clean);
  const loneFragment = isPrivateChat && (/@[a-z0-9_]{1,40}/.test(clean) || loneAmount);
  // Not a payment sentence and not an answer to a question: leave it alone.
  if (!isVerb && !ctx && !loneFragment) return { kind: 'none' };

  const privateWord = /^\/?(?:pay|send)(?:_?privately|_?private)\b/.test(clean) || PRIVATE_RE.test(clean);
  const isPrivate = !!ctx?.isPrivate || privateWord;
  const verb = isPrivate ? 'payprivately' : 'pay';
  const body = isVerb ? clean.replace(VERB_START, '').trim() : clean;

  // Names and amounts present in this message (the "@" is required, except a lone bare name below).
  const handles = [...body.matchAll(/@([a-z0-9_]{1,40})/g)].map((m) => m[1]);
  const noHandles = body.replace(/@[a-z0-9_]{1,40}/g, ' ').replace(DELAY_RE, ' ').replace(SPLIT_RE, ' ').replace(PRIVATE_RE, ' ');
  const amounts = [...noHandles.matchAll(/\$?(\d+(?:\.\d+)?)\$?/g)].map((m) => Number(m[1]));
  const bareWord = !handles.length && /^[a-z0-9_]{5,32}$/.test(body) && ctx?.amount !== undefined ? body : null;

  const knownHandle = handles[0] ?? bareWord ?? ctx?.handle ?? (isVerb ? replyTarget ?? undefined : undefined);
  const knownAmount = amounts[0] ?? ctx?.amount;

  // 1) Everything is here: build the full command and run it. A complete sentence is used as typed.
  const fullAsTyped = isVerb ? clean : null;
  const typedResult = fullAsTyped ? parseSendCommand(fullAsTyped, botUsername) : null;
  // "Something is missing" results become a question below; real mistakes (decimals, limits) are shown as they are.
  const asTyped = typedResult && !(!typedResult.ok && /^(?:How much should|Who should get|I could not read)/.test(typedResult.error)) ? typedResult : null;
  if (asTyped) {
    // The multi-person reader found names but no amounts: ask, rather than show its error.
    if (!asTyped.ok && /^(How much should|Who should get)/.test(asTyped.error)) return askBoth(isPrivate);
    const needsWho = asTyped.ok && asTyped.handle === null && !asTyped.payments && !replyTarget;
    if (!needsWho) return { kind: 'run', command: clean };
    return askWho(asTyped.amount, isPrivate);
  }
  if (handles.length >= 2) {
    // "@a, @b" with no amounts, or an answer that is a list: try it whole before asking.
    const whole = parseSendCommand(`${verb} ${body}`, botUsername);
    const missing = !!whole && !whole.ok && /^(?:How much should|Who should get|I could not read)/.test(whole.error);
    if (whole && !missing) return { kind: 'run', command: `${verb} ${body}` }; // complete, or a real mistake to show
    return askBoth(isPrivate);
  }
  if (knownHandle && knownAmount !== undefined && amounts.length <= 1) {
    const extra = [DELAY_RE.exec(body)?.[0], SPLIT_RE.exec(body)?.[0]].filter(Boolean).join(' ');
    const command = `${verb} ${knownAmount} to @${knownHandle}${extra ? ` ${extra}` : ''}`;
    return { kind: 'run', command };
  }
  if (amounts.length >= 1 && handles.length === 0 && body.trim() && !loneAmount && !ctx && !isVerb) return { kind: 'none' };

  // 2) Something is missing: ask for only that.
  if (knownHandle && knownAmount === undefined) return askAmount(knownHandle, isPrivate);
  if (!knownHandle && knownAmount !== undefined) return askWho(knownAmount, isPrivate);
  return askBoth(isPrivate);
}
